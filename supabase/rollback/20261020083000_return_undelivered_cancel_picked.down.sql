-- Rollback of 20261020083000_return_undelivered_cancel_picked: the function as
-- it was on production before (pg_get_functiondef md5 786e1aee3b26ce55092b7b0c88f59b3c).

CREATE OR REPLACE FUNCTION public.order_return_undelivered(p_dispatch_id uuid, p_reason text, p_cancel boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_dispatch public.dispatches;
  v_order public.orders;
  v_line record;
  v_total integer := 0;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can record a failed delivery.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the delivery did not happen.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dispatch_doc'), hashtext(p_dispatch_id::text));

  select * into v_dispatch from public.dispatches where id = p_dispatch_id and org_id = v_org;
  if not found then
    raise exception 'That dispatch does not exist.' using errcode = 'P0002';
  end if;
  if v_dispatch.status <> 'in_transit' then
    raise exception 'Dispatch % is already %.', v_dispatch.dispatch_number, v_dispatch.status
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'),
                                hashtext(v_dispatch.order_id::text));

  select * into v_order from public.orders where id = v_dispatch.order_id;

  for v_line in
    select dl.*, ol.product_id
    from public.dispatch_lines dl
    join public.order_lines ol on ol.id = dl.order_line_id
    where dl.dispatch_id = v_dispatch.id
    order by ol.product_id, dl.batch_id nulls first, dl.id
  loop
    -- Back to `reserved` when the order lives on, so re-dispatching is the same
    -- code path with nothing special about it; to `available` when it is being
    -- cancelled, because nothing is holding it any more.
    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty,
      v_dispatch.transit_location_id, 'in_transit',
      v_dispatch.dispatch_location_id, case when p_cancel then 'available' else 'reserved' end,
      'order_return_undelivered', v_dispatch.dispatch_number,
      'dispatch', v_dispatch.id, v_line.order_line_id, auth.uid(), p_reason);

    update public.dispatch_lines set qty_returned = v_line.qty where id = v_line.id;

    update public.order_lines
       set qty_dispatched = qty_dispatched - v_line.qty,
           qty_reserved = qty_reserved + case when p_cancel then 0 else v_line.qty end
     where id = v_line.order_line_id;

    if v_line.order_allocation_id is not null then
      update public.order_allocations
         set status = case when p_cancel then 'released' else 'picked' end,
             qty_dispatched = 0,
             qty_reserved = case when p_cancel then 0 else v_line.qty end
       where id = v_line.order_allocation_id;
    end if;

    v_total := v_total + v_line.qty;
  end loop;

  update public.dispatches
     set status = 'returned', failure_reason = p_reason
   where id = v_dispatch.id and status = 'in_transit';
  if not found then
    raise exception 'Dispatch % was closed by somebody else while this was running.',
      v_dispatch.dispatch_number using errcode = '40001';
  end if;

  -- The flag the transition guard is looking for. Transaction-local, and set
  -- only here, so no other path can move an order out of `dispatched`.
  perform set_config('app.stock_returned', v_order.id::text, true);

  if p_cancel then
    update public.order_lines set line_status = 'cancelled'
     where order_id = v_order.id and line_status <> 'cancelled';
    update public.orders
       set status = 'cancelled', cancel_reason = p_reason,
           cancelled_by = auth.uid(), cancelled_at = now()
     where id = v_order.id;
  else
    update public.orders
       set status = 'packed', dispatched_at = null, dispatched_by = null
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_number', v_dispatch.dispatch_number,
    'status', case when p_cancel then 'cancelled' else 'packed' end,
    'units_returned', v_total);
end;
$function$
;
