-- Rollback of 20261017100000_stocktake_short_counts_and_recount: stocktake_decide
-- as it was (a shortfall taken from `available` only), and no recount. Lines
-- already recounted keep their recount_qty; the variance still reads it.

drop function if exists public.stocktake_recount_line(uuid, integer, text);
delete from public.module_assignments where kind = 'function' and name = 'stocktake_recount_line';

CREATE OR REPLACE FUNCTION public.stocktake_decide(p_stocktake_id uuid, p_approve boolean, p_note text DEFAULT NULL::text, p_reconfirm_line_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_st public.stocktakes;
  v_line record;
  v_live integer;
  v_up integer := 0;
  v_down integer := 0;
  v_lines integer := 0;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  v_role := public."current_role"();

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

  for v_line in
    select l.*, p.name as product_name
    from public.stocktake_lines l
    join public.products p on p.id = l.product_id
    where l.stocktake_id = v_st.id and l.variance_qty is distinct from 0
    order by l.product_id, l.batch_id nulls first, l.id
  loop
    select coalesce(b.qty_on_hand, 0) into v_live
    from public.stock_balances b
    where b.org_id = v_org and b.location_id = v_st.location_id
      and b.product_id = v_line.product_id
      and b.batch_id is not distinct from v_line.batch_id;
    v_live := coalesce(v_live, 0);

    -- 🔴 The guard this whole design exists for. If the stock moved between
    -- submit and now, the variance on the sheet no longer describes reality,
    -- and posting it would double-count whatever moved.
    if v_live <> v_line.system_qty_at_submit
       and not (v_line.id = any(coalesce(p_reconfirm_line_ids, array[]::uuid[]))) then
      raise exception
        '% has moved since the count was handed in: it said % and now says %. Re-check that line before approving.',
        v_line.product_name, v_line.system_qty_at_submit, v_live
        using errcode = '23514';
    end if;

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
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket,
        reason, reference, note, source_doc_type, source_doc_id, source_line_id,
        actor_id, approved_by)
      values (
        v_org, v_line.product_id, v_line.batch_id, abs(v_line.variance_qty),
        v_st.location_id, 'available',
        'stocktake_variance_decrease', v_st.stocktake_number,
        v_line.variance_reason, 'stocktake', v_st.id, v_line.id,
        v_st.submitted_by, auth.uid());
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
$function$;
