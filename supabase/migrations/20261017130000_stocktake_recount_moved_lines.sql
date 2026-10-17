-- Stocktakes: a line that changed after it was counted must be recounted.
--
-- Owner, 17 Oct 2026, approving STK-000005 again: "still not working?". The
-- refusal: "Kiwi Passion Fruit was counted at 8 against 59, but the system now
-- has 19". Lines were recounted at 13:06-13:08 while 40 were still packed
-- (59 = 10 free + 9 returned + 40 packed); the orders were dispatched at
-- 13:11-13:14; then the lines were ticked "re-checked", which posts the
-- difference as counted (8 - 59 = -51). Ten lines had changed after their
-- count, by dispatches, a customer return, undelivered dispatches taken back
-- and cancellations, and ticking any of them posts the wrong difference.
--
-- Now every line that changed after it was counted is named in one refusal
-- and has to be recounted; the tick is gone (its parameter stays, ignored).

create or replace function public.stocktake_decide(
  p_stocktake_id uuid,
  p_approve boolean,
  p_note text default null,
  p_reconfirm_line_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_st public.stocktakes;
  v_line record;
  v_bal public.stock_balances;
  v_live integer;
  v_left integer;
  v_take integer;
  v_bucket text;
  v_orders text;
  v_moved text[] := array[]::text[];
  v_short text[] := array[]::text[];
  v_up integer := 0;
  v_down integer := 0;
  v_lines integer := 0;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();

  if not public.has_permission('warehouse_approve') then
    raise exception 'Only a manager can approve or reject a stocktake.' using errcode = '42501';
  end if;
  if not p_approve and (p_note is null or btrim(p_note) = '') then
    raise exception 'Say why the stocktake is being rejected.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('stocktake'), hashtext(p_stocktake_id::text));

  select * into v_st from public.stocktakes where id = p_stocktake_id and org_id = v_org;
  if not found then
    raise exception 'That stocktake does not exist.' using errcode = 'P0002';
  end if;
  if v_st.status <> 'submitted' then
    raise exception 'Stocktake % is %, not waiting for a decision.',
      v_st.stocktake_number, v_st.status using errcode = '42501';
  end if;

  if not p_approve then
    update public.stocktakes
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = p_note
     where id = v_st.id;
    return jsonb_build_object('stocktake_id', v_st.id,
      'stocktake_number', v_st.stocktake_number, 'status', 'rejected');
  end if;

  -- A line whose stock changed after it was counted is recounted, never
  -- approved as it stands. p_reconfirm_line_ids is kept so callers do not
  -- break, and ignored: ticking a moved line posted the difference as counted,
  -- and the owner's STK-000005 (17 Oct 2026) showed how that goes wrong. Its
  -- packed orders were dispatched after the count: the tick wanted to take 51
  -- Kiwi Passion Fruit out of 19. An undelivered dispatch taken back after the
  -- count would have been added twice. Whether a change was trade or paperwork
  -- catching up cannot be known here; a recount, measured against the system
  -- now, is right either way. Zero-difference lines are included: they post
  -- nothing, but the count they agree with is no longer the system's figure.
  select coalesce(array_agg(format('%s (it said %s when counted, %s now)',
           x.name, x.system_qty_at_submit, x.live) order by x.name), array[]::text[])
    into v_moved
    from (
      select p.name, l.system_qty_at_submit, coalesce(b.qty_on_hand, 0) as live
      from public.stocktake_lines l
      join public.products p on p.id = l.product_id
      left join public.stock_balances b
        on b.org_id = v_org and b.location_id = v_st.location_id
       and b.product_id = l.product_id and b.batch_id is not distinct from l.batch_id
      where l.stocktake_id = v_st.id
        and coalesce(b.qty_on_hand, 0) <> l.system_qty_at_submit
    ) x;
  if cardinality(v_moved) > 0 then
    raise exception
      'Recount % before approving: %. Stock changed after % counted, so the count no longer lines up with the system. A recount is measured against the system now.',
      case when cardinality(v_moved) = 1 then 'this line' else 'these ' || cardinality(v_moved) || ' lines' end,
      array_to_string(v_moved, '; '),
      case when cardinality(v_moved) = 1 then 'it was' else 'they were' end
      using errcode = '23514';
  end if;

  -- First pass: check every line before anything moves. The balance rows are
  -- locked here, in the same order every time, and held until the end.
  for v_line in
    select l.*, p.name as product_name
    from public.stocktake_lines l
    join public.products p on p.id = l.product_id
    where l.stocktake_id = v_st.id and l.variance_qty is distinct from 0
    order by l.product_id, l.batch_id nulls first, l.id
  loop
    v_bal := null;
    select * into v_bal
    from public.stock_balances b
    where b.org_id = v_org and b.location_id = v_st.location_id
      and b.product_id = v_line.product_id
      and b.batch_id is not distinct from v_line.batch_id
    for update;
    v_live := coalesce(v_bal.qty_on_hand, 0);

    -- Read again under the lock: a dispatch between the check above and here
    -- is refused the same way.
    if v_live <> v_line.system_qty_at_submit then
      raise exception
        'Recount this line before approving: % (it said % when counted, % now).',
        v_line.product_name, v_line.system_qty_at_submit, v_live
        using errcode = '23514';
    end if;

    if v_line.variance_qty < 0
       and abs(v_line.variance_qty) > coalesce(v_bal.qty_available, 0)
                                      + coalesce(v_bal.qty_damaged, 0)
                                      + coalesce(v_bal.qty_expired, 0)
                                      + coalesce(v_bal.qty_promotional, 0) then
      select string_agg(o.order_number, ', ' order by o.order_number) into v_orders
      from public.orders o
      where o.org_id = v_org
        and o.fulfil_location_id = v_st.location_id
        and exists (select 1 from public.order_lines ol
                    where ol.order_id = o.id
                      and ol.product_id = v_line.product_id
                      and ol.qty_reserved > 0);
      v_short := v_short || case
        when coalesce(v_bal.qty_reserved, 0) > 0 then format(
          '%s was counted at %s, but %s of the %s in the system are packed or set aside for %s',
          v_line.product_name,
          coalesce(v_line.recount_qty, v_line.counted_qty),
          v_bal.qty_reserved,
          v_live,
          coalesce(case when v_orders like '%,%' then 'orders ' else 'order ' end || v_orders,
                   'orders'))
        -- Nothing packed: cannot happen once every line agrees with the
        -- system (a count is never negative), kept so it never says "orders".
        else format('%s was counted at %s against %s, but the system now has %s',
          v_line.product_name,
          coalesce(v_line.recount_qty, v_line.counted_qty),
          v_line.system_qty_at_submit,
          v_live)
        end;
    end if;
  end loop;

  if cardinality(v_short) > 0 then
    raise exception
      '%. A count never takes away stock that an order is waiting for. If those boxes are still in the warehouse, recount the line and include them. If they have already gone out, dispatch those orders first, then recount the line.',
      array_to_string(v_short, '. ')
      using errcode = '23514';
  end if;

  -- Second pass: post. Every line has been checked and every balance row is
  -- locked, so nothing below can be refused for lack of stock.
  for v_line in
    select l.*
    from public.stocktake_lines l
    where l.stocktake_id = v_st.id and l.variance_qty is distinct from 0
    order by l.product_id, l.batch_id nulls first, l.id
  loop
    if v_line.variance_qty > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        to_location_id, to_bucket,
        reason, reference, note, source_doc_type, source_doc_id, source_line_id,
        actor_id, approved_by)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_line.variance_qty,
        v_st.location_id, 'available',
        'stocktake_variance_increase', v_st.stocktake_number,
        v_line.variance_reason, 'stocktake', v_st.id, v_line.id,
        v_st.submitted_by, auth.uid());
      v_up := v_up + v_line.variance_qty;
    else
      v_bal := null;
      select * into v_bal
      from public.stock_balances b
      where b.org_id = v_org and b.location_id = v_st.location_id
        and b.product_id = v_line.product_id
        and b.batch_id is not distinct from v_line.batch_id;

      v_left := abs(v_line.variance_qty);
      foreach v_bucket in array array['available', 'damaged', 'expired', 'promotional'] loop
        exit when v_left = 0;
        v_take := least(v_left, case v_bucket
          when 'available' then v_bal.qty_available
          when 'damaged' then v_bal.qty_damaged
          when 'expired' then v_bal.qty_expired
          else v_bal.qty_promotional end);
        continue when coalesce(v_take, 0) <= 0;

        insert into public.stock_movements (
          org_id, product_id, batch_id, qty,
          from_location_id, from_bucket,
          reason, reference, note, source_doc_type, source_doc_id, source_line_id,
          actor_id, approved_by)
        values (
          v_org, v_line.product_id, v_line.batch_id, v_take,
          v_st.location_id, v_bucket,
          'stocktake_variance_decrease', v_st.stocktake_number,
          v_line.variance_reason, 'stocktake', v_st.id, v_line.id,
          v_st.submitted_by, auth.uid());
        v_left := v_left - v_take;
      end loop;

      v_down := v_down + abs(v_line.variance_qty);
    end if;

    update public.stocktake_lines set line_status = 'accepted' where id = v_line.id;
    v_lines := v_lines + 1;
  end loop;

  update public.stocktakes
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, freeze_movements = false
   where id = v_st.id;

  return jsonb_build_object(
    'stocktake_id', v_st.id, 'stocktake_number', v_st.stocktake_number,
    'status', 'approved', 'lines_adjusted', v_lines,
    'units_added', v_up, 'units_removed', v_down);
end;
$$;
