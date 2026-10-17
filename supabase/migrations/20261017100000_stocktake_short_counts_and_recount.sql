-- Stocktakes: a count that comes in below the stock packed for orders gets a
-- plain answer instead of a constraint error, and a manager can recount one
-- line of a handed-in sheet.
--
-- Owner, 17 Oct 2026, pressing Approve on STK-000005: "new row for relation
-- "stock_balances" violates check constraint "stock_balances_non_negative"".
--
-- ------------------------------------------------------------------ why
--
-- A count is compared with everything on hand: available, set aside for orders
-- (reserved), damaged, expired and promotional. But a shortfall was always
-- taken out of `available` alone. Kiwi Passion Fruit had 50 on hand, 10
-- available and 40 packed for four Liquorama orders that had not been
-- dispatched. The count found 8, so approval tried to take 42 out of 10 and
-- the balance went below nothing. ZYN, which is all in `expired`, could not be
-- counted down at all for the same reason.
--
-- ------------------------------------------------------------------ what
--
-- stocktake_decide:
--  * A shortfall comes out of available first, then damaged, expired and
--    promotional. Those are in the building and go missing like any other
--    stock.
--  * Stock set aside for orders is never taken. The orders are counting on
--    it, and their dispatch would fail later on a balance that is not there.
--    When a count is lower than what is set aside, the approval is refused
--    with the product, the count, how many are set aside and the order
--    numbers, for every such line at once. Nothing moves until every line
--    has been checked.
--  * The balance row is locked before it is read (deferred finding:
--    "stocktake_decide unlocked balance read"), so a dispatch cannot land
--    between the check and the movement.
--
-- stocktake_recount_line (new): a manager (warehouse_approve) recounts one
-- line of a handed-in sheet. A recount is a count taken now, so it is measured
-- against what the system says now: `recount_qty` is set and
-- `system_qty_at_submit` is read again. The first count stays on the line.
-- This is how a missed box of packed stock, or stock that left before the
-- count but was only dispatched in the system afterwards, is put right without
-- throwing the whole sheet away.

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

    -- 🔴 The guard this whole design exists for. If the stock moved between
    -- submit and now, the variance on the sheet may no longer describe
    -- reality, and posting it could double-count whatever moved.
    if v_live <> v_line.system_qty_at_submit
       and not (v_line.id = any(coalesce(p_reconfirm_line_ids, array[]::uuid[]))) then
      raise exception
        '% has moved since the count was handed in: it said % and now says %. Recount that line, or tick it as re-checked, before approving.',
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
        -- Nothing packed: the sheet asks for more than there is (the stock
        -- moved after hand-in and the line was ticked). A recount fixes it.
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

create or replace function public.stocktake_recount_line(
  p_line_id uuid,
  p_counted integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_line public.stocktake_lines;
  v_st public.stocktakes;
  v_live integer;
  v_variance integer;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();

  if not public.has_permission('warehouse_approve') then
    raise exception 'Only a manager can recount a line on a handed-in stocktake.'
      using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'A recount is a number of single units, 0 or more.' using errcode = '22023';
  end if;

  select * into v_line from public.stocktake_lines where id = p_line_id and org_id = v_org;
  if not found then
    raise exception 'That stocktake line does not exist.' using errcode = 'P0002';
  end if;

  -- The same lock as submit and decide, so a recount cannot land halfway
  -- through an approval.
  perform pg_advisory_xact_lock(hashtext('stocktake'), hashtext(v_line.stocktake_id::text));

  select * into v_st from public.stocktakes where id = v_line.stocktake_id and org_id = v_org;
  if v_st.status <> 'submitted' then
    raise exception 'Stocktake % is %. Only a handed-in count can be recounted.',
      v_st.stocktake_number, v_st.status using errcode = '42501';
  end if;

  select b.qty_on_hand into v_live
  from public.stock_balances b
  where b.org_id = v_org and b.location_id = v_st.location_id
    and b.product_id = v_line.product_id
    and b.batch_id is not distinct from v_line.batch_id
  for update;
  v_live := coalesce(v_live, 0);

  -- A reason belongs to a difference: a recount that agrees with the system
  -- clears it, and one that does not keeps the counter's unless a new one is
  -- given. The check constraint on the column refuses an unknown reason.
  update public.stocktake_lines
     set recount_qty = p_counted,
         system_qty_at_submit = v_live,
         variance_reason = case when p_counted = v_live then null
                                else coalesce(nullif(btrim(p_reason), ''), variance_reason) end,
         line_status = 'recount'
   where id = v_line.id
  returning variance_qty into v_variance;

  return jsonb_build_object(
    'line_id', v_line.id, 'recount_qty', p_counted,
    'system_qty', v_live, 'variance_qty', v_variance);
end;
$$;

comment on function public.stocktake_recount_line(uuid, integer, text) is
  'A manager recounts one line of a handed-in stocktake. Measured against the system now: recount_qty is set and system_qty_at_submit read again. The first count stays on the line.';

revoke all on function public.stocktake_recount_line(uuid, integer, text) from public, anon;
grant execute on function public.stocktake_recount_line(uuid, integer, text) to authenticated;

-- Warehouse, like every other stocktake function: a company without the
-- module cannot reach it (require_module above), and the module suite's
-- coverage check knows which module it belongs to.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'stocktake_recount_line', 'warehouse')
on conflict do nothing;
