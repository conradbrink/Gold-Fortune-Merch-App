-- Rollback of 20261030175300_no_expired_reservations. Orders confirmed while it
-- was in place keep their reservations. The three functions as they were live
-- before it (pg_get_functiondef md5: order_availability_check
-- 7124fcf0fc3b78613f585aeaca54e316, order_confirm ae06273c74ba5380514bce8b76f31b88,
-- order_record_pick 2230b1a9a4bf33c2e5ab4834da51b254).

drop function public.order_availability_check(uuid, uuid);
CREATE OR REPLACE FUNCTION public.order_availability_check(p_order_id uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_line_id uuid, product_id uuid, product_name text, qty_ordered integer, qty_already_reserved integer, qty_available integer, qty_short integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.require_module('warehouse');
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  loc as (
    select coalesce(
      p_location_id,
      (select o.fulfil_location_id from public.orders o where o.id = p_order_id),
      (select l.id from public.stock_locations l cross join cfg
        where l.org_id = cfg.org and l.is_default limit 1)
    ) as id
  )
  select
    ol.id,
    ol.product_id,
    p.name,
    ol.qty_ordered,
    ol.qty_reserved,
    coalesce(b.available, 0)::integer,
    greatest(ol.qty_ordered - ol.qty_reserved - ol.qty_dispatched
             - coalesce(b.available, 0), 0)::integer
  from public.order_lines ol
  cross join cfg
  cross join loc
  join public.orders o on o.id = ol.order_id
  join public.products p on p.id = ol.product_id
  left join lateral (
    select sum(sb.qty_available)::integer as available
    from public.stock_balances sb
    where sb.org_id = cfg.org
      and sb.location_id = loc.id
      and sb.product_id = ol.product_id
  ) b on true
  where ol.order_id = p_order_id
    and ol.org_id = cfg.org
    and o.org_id = cfg.org
    and ol.line_status <> 'cancelled'
  order by p.name;
$function$
;

revoke all on function public.order_availability_check(uuid, uuid) from public, anon;
grant execute on function public.order_availability_check(uuid, uuid) to authenticated, service_role;

comment on function public.order_availability_check(uuid, uuid) is
  'Per line: ordered, already reserved, available at the location, and how many short. The pre-confirm warning.';

CREATE OR REPLACE FUNCTION public.order_confirm(p_order_id uuid, p_location_id uuid DEFAULT NULL::uuid, p_shortfall_action text DEFAULT 'reject'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_order public.orders;
  v_loc uuid;
  v_line record;
  v_bal record;
  v_remaining integer;
  v_take integer;
  v_taken integer;
  v_short_total integer := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can confirm an order.' using errcode = '42501';
  end if;
  if p_shortfall_action not in ('reject', 'partial', 'backorder', 'hold') then
    raise exception 'Unknown shortfall action: %.', p_shortfall_action using errcode = '22023';
  end if;

  -- Two clerks pressing Confirm on the same order must not both reserve it.
  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into v_order from public.orders where id = p_order_id and org_id = v_org;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  if v_order.status <> 'new' then
    raise exception 'Order % is already %.', v_order.order_number, v_order.status
      using errcode = '42501';
  end if;
  if v_order.on_hold then
    raise exception 'Order % is on hold (%). Release the hold first.',
      v_order.order_number, coalesce(v_order.hold_reason, 'no reason given')
      using errcode = '42501';
  end if;

  v_loc := coalesce(p_location_id, v_order.fulfil_location_id,
    (select id from public.stock_locations
      where org_id = v_org and is_default and active limit 1));

  if v_loc is null then
    raise exception 'There is nowhere to fulfil this order from. Set a default warehouse.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.stock_locations
                 where id = v_loc and org_id = v_org and active) then
    raise exception 'That fulfilment location does not exist here.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.order_lines where order_id = v_order.id) then
    raise exception 'Order % has no lines.', v_order.order_number using errcode = '42501';
  end if;

  -- Sorted by product so concurrent confirmations lock in a consistent order.
  for v_line in
    select ol.*, p.name as product_name
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    where ol.order_id = v_order.id and ol.line_status <> 'cancelled'
    order by ol.product_id, ol.id
  loop
    v_remaining := v_line.qty_ordered - v_line.qty_reserved - v_line.qty_dispatched;
    v_taken := 0;

    if v_remaining > 0 then
      for v_bal in
        select b.id, b.batch_id, b.qty_available
        from public.stock_balances b
        left join public.product_batches pb on pb.id = b.batch_id
        where b.org_id = v_org
          and b.location_id = v_loc
          and b.product_id = v_line.product_id
          and b.qty_available > 0
        -- FEFO. Nulls last so undated stock is drawn only after every dated
        -- batch; b.id as a stable tiebreak so two sessions agree on the order.
        order by pb.expiry_date nulls last, b.batch_id nulls first, b.id
        for update of b
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_bal.qty_available);

        insert into public.stock_movements (
          org_id, product_id, batch_id, qty,
          from_location_id, from_bucket, to_location_id, to_bucket,
          reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id)
        values (
          v_org, v_line.product_id, v_bal.batch_id, v_take,
          v_loc, 'available', v_loc, 'reserved',
          'order_reservation', v_order.order_number,
          'order', v_order.id, v_line.id, auth.uid());

        insert into public.order_allocations (
          org_id, order_id, order_line_id, location_id, batch_id, qty_reserved, status)
        values (v_org, v_order.id, v_line.id, v_loc, v_bal.batch_id, v_take, 'reserved');

        v_remaining := v_remaining - v_take;
        v_taken := v_taken + v_take;
      end loop;
    end if;

    if v_remaining > 0 and p_shortfall_action = 'reject' then
      raise exception
        'Not enough % to confirm this order: % short of % needed. Choose partial fulfilment, a back order, or hold it.',
        v_line.product_name, v_remaining, v_line.qty_ordered
        using errcode = '23514';
    end if;

    update public.order_lines
       set qty_reserved = qty_reserved + v_taken,
           line_status = case
             when v_remaining <= 0 then 'open'
             when p_shortfall_action = 'backorder' then 'backordered'
             else 'partial'
           end
     where id = v_line.id;

    v_short_total := v_short_total + v_remaining;
    v_lines := v_lines || jsonb_build_object(
      'order_line_id', v_line.id,
      'product_name', v_line.product_name,
      'qty_ordered', v_line.qty_ordered,
      'qty_reserved', v_taken,
      'qty_short', v_remaining);
  end loop;

  update public.orders
     set status = 'confirmed',
         fulfil_location_id = v_loc,
         confirmed_by = auth.uid(),
         confirmed_at = now()
   where id = v_order.id;

  -- Applied after the transition, not before: the guard refuses to move an
  -- order that is already on hold, so holding it first would block its own
  -- confirmation.
  if v_short_total > 0 and p_shortfall_action = 'hold' then
    update public.orders
       set on_hold = true,
           hold_reason = 'Waiting for stock: ' || v_short_total || ' unit(s) short',
           held_at = now(), held_by = auth.uid()
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', 'confirmed',
    'fulfil_location_id', v_loc,
    'shortfall_action', p_shortfall_action,
    'total_short', v_short_total,
    'on_hold', (v_short_total > 0 and p_shortfall_action = 'hold'),
    'lines', v_lines);
end;
$function$
;

comment on function public.order_confirm(uuid, uuid, text) is
  'Confirms an order and reserves stock FEFO. p_shortfall_action is reject | partial | backorder | hold.';

CREATE OR REPLACE FUNCTION public.order_record_pick(p_order_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_order public.orders;
  v_item jsonb;
  v_alloc public.order_allocations;
  v_qty integer;
  v_actual uuid;
  v_updated integer := 0;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can record a pick.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into v_order from public.orders where id = p_order_id and org_id = v_org;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  if v_order.status <> 'picking' then
    raise exception 'Order % is %, not being picked.', v_order.order_number, v_order.status
      using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_alloc from public.order_allocations
    where id = (v_item->>'allocation_id')::uuid and order_id = v_order.id and org_id = v_org
    for update;

    if not found then
      raise exception 'That line is not part of order %.', v_order.order_number
        using errcode = 'P0002';
    end if;

    v_qty := coalesce((v_item->>'qty_picked')::integer, 0);
    if v_qty < 0 or v_qty > v_alloc.qty_reserved then
      raise exception 'Cannot pick % against a reservation of %.', v_qty, v_alloc.qty_reserved
        using errcode = '23514';
    end if;

    v_actual := nullif(v_item->>'actual_batch_id', '')::uuid;

    -- The picker took a different lot. Two movements, not one: the reservation
    -- on the original batch goes back to available, and the same quantity of
    -- the substitute is reserved in its place.
    --
    -- It cannot be expressed as a single movement, because a movement carries
    -- one batch_id — and a reserved-to-reserved leg at the same location is a
    -- no-op that `stock_movements_has_effect` rightly refuses. Both legs share
    -- the `batch_reallocation` reason so the pair reads together in the
    -- movement history.
    --
    -- Release first, reserve second. If the substitute turns out not to have
    -- the stock, the second insert trips the non-negative check and the whole
    -- pick rolls back — rather than leaving the original released and nothing
    -- held in its place.
    if v_actual is not null and v_actual is distinct from v_alloc.batch_id then
      -- A substitution has to cover the whole allocation.
      --
      -- Swapping only part of it would leave the allocation row naming the new
      -- batch while the remainder stayed reserved against the old one — the
      -- ledger would still balance, so `stock_balance_drift()` would not notice,
      -- but the picking list and the dispatch would both be wrong about which
      -- lot is going out. Splitting an allocation in two is the right answer and
      -- is more than this needs today; until it exists, refuse rather than
      -- quietly misreport.
      if v_qty <> v_alloc.qty_reserved then
        raise exception
          'Picking a different batch has to cover the whole line: % reserved, % picked.',
          v_alloc.qty_reserved, v_qty
          using errcode = '22023';
      end if;

      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
      select v_org, ol.product_id, v_alloc.batch_id, v_qty,
             v_alloc.location_id, 'reserved', v_alloc.location_id, 'available',
             'batch_reallocation', v_order.order_number,
             'order', v_order.id, v_alloc.order_line_id, auth.uid(),
             'Picker took a different batch'
      from public.order_lines ol where ol.id = v_alloc.order_line_id;

      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
      select v_org, ol.product_id, v_actual, v_qty,
             v_alloc.location_id, 'available', v_alloc.location_id, 'reserved',
             'batch_reallocation', v_order.order_number,
             'order', v_order.id, v_alloc.order_line_id, auth.uid(),
             'Substituted for the batch originally allocated'
      from public.order_lines ol where ol.id = v_alloc.order_line_id;

      update public.order_allocations
         set batch_id = v_actual, qty_picked = v_qty, status = 'picked'
       where id = v_alloc.id;
    else
      update public.order_allocations
         set qty_picked = v_qty, status = case when v_qty > 0 then 'picked' else 'reserved' end
       where id = v_alloc.id;
    end if;

    v_updated := v_updated + 1;
  end loop;

  -- Roll the allocation totals up onto the lines, so the line is always the
  -- sum of its parts rather than a number somebody remembered to increment.
  update public.order_lines ol
     set qty_picked = coalesce(agg.picked, 0)
    from (
      select order_line_id, sum(qty_picked) as picked
      from public.order_allocations
      where order_id = v_order.id and status in ('reserved', 'picked')
      group by order_line_id
    ) agg
   where ol.id = agg.order_line_id;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'allocations_updated', v_updated);
end;
$function$
;
