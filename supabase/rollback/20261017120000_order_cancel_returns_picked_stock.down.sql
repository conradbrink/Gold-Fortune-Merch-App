-- Rollback of 20261017120000_order_cancel_returns_picked_stock: order_cancel as
-- it was, which leaves qty_picked on the lines (a packed order then cannot be
-- cancelled: order_lines_picked_within_held).

CREATE OR REPLACE FUNCTION public.order_cancel(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_order public.orders;
  v_alloc record;
  v_released integer := 0;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can cancel an order.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the order is being cancelled.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into v_order from public.orders where id = p_order_id and org_id = v_org;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'Order % is already %.', v_order.order_number, v_order.status
      using errcode = '42501';
  end if;
  if v_order.status = 'dispatched' then
    raise exception
      'Order % has been dispatched. Record the delivery or the return instead of cancelling.',
      v_order.order_number using errcode = '42501';
  end if;

  for v_alloc in
    select a.*, ol.product_id
    from public.order_allocations a
    join public.order_lines ol on ol.id = a.order_line_id
    where a.order_id = v_order.id and a.status in ('reserved', 'picked')
    order by ol.product_id, a.batch_id nulls first, a.id
  loop
    if v_alloc.qty_reserved > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
      values (
        v_org, v_alloc.product_id, v_alloc.batch_id, v_alloc.qty_reserved,
        v_alloc.location_id, 'reserved', v_alloc.location_id, 'available',
        'order_reservation_release', v_order.order_number,
        'order', v_order.id, v_alloc.order_line_id, auth.uid(),
        'Cancelled: ' || p_reason);
      v_released := v_released + v_alloc.qty_reserved;
    end if;

    update public.order_allocations
       set status = 'released', qty_reserved = 0
     where id = v_alloc.id;
  end loop;

  update public.order_lines
     set qty_reserved = 0, line_status = 'cancelled'
   where order_id = v_order.id and line_status <> 'cancelled';

  update public.orders
     set status = 'cancelled', cancel_reason = p_reason,
         cancelled_by = auth.uid(), cancelled_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'status', 'cancelled', 'units_released', v_released);
end;
$function$;
