-- An order invoiced without stock is picked and packed, as one with stock is.
--
-- Without Stock control (the add-on) an order went new -> invoiced ->
-- dispatched -> delivered: there was nothing reserved, so the picking list,
-- packing and the board's tick boxes were all Stock control's. The owner, 30
-- Oct 2026, for Aqua Blast: "Please may you still include this function for
-- companies that do not have the inventory function add on, so orders can be
-- picked and packed." The same company asked earlier that day for "no units
-- that they need to go and confirm in the orders", so nothing is counted:
-- the picking list is the order's own lines, and packing puts the whole
-- order in the box.
--
-- ------------------------------------------------------------ what changes
--
--   orders_fulfil_location_set  dropped: picking and packed no longer need a
--                               location (see below).
--   order_start_picking         needs Deliveries, and Stock control only for
--                               an order holding stock (Stock control needs
--                               Deliveries, so a stock company is unchanged).
--                               Moved to Deliveries in module_assignments.
--   order_mark_packed           the same; and with no location there is
--                               nothing to be short, so no short check.
--   order_picking_list          the same; with no location it lists the live
--                               lines still to go, at the quantity ordered,
--                               with no allocation, batch or place, status
--                               'to_pick', while the order is invoiced or
--                               being picked.
--   order_dispatch              with no location, from packed as well as from
--                               confirmed; still every live line in full.
--   order_return_undelivered    with no location, back to packed when it had
--                               been packed (the box comes back), else to
--                               confirmed as before.
--   order_cancel_without_stock  takes an order being picked or packed too, and
--                               settles its invoice as for one invoiced.
--
-- The transition guard already allows confirmed -> picking -> packed ->
-- dispatched for every order. Nothing here reserves, counts or moves stock,
-- and order_record_pick stays Stock control's: there is nothing to record.
-- An order with a location is unchanged in every function.
--
-- The six functions are written out in full from their live definitions
-- (pg_get_functiondef), changed only where marked by the comments above.
--
-- Rollback: supabase/rollback/20261030210500_no_stock_pick_and_pack.down.sql.

-- ------------------------------------------------- the location constraint

-- Picking and packing said "there is a location": only stock was picked. An
-- order invoiced without stock is now picked and packed too, with no
-- location, so every status may be without one. What keeps stock straight is
-- the functions: a location is only ever set by order_confirm, and the
-- functions above read the order's own location to choose their path.
alter table public.orders drop constraint orders_fulfil_location_set;

-- --------------------------------------------------- order_start_picking

CREATE OR REPLACE FUNCTION public.order_start_picking(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_number text;
  v_stock boolean;
begin
  perform public.require_writable();
  -- Picking is part of sending an order out (Deliveries). An order with no
  -- location was invoiced without stock: it is picked from the quantities
  -- ordered, with nothing reserved or counted. One holding stock needs
  -- Stock control as well (which itself needs Deliveries).
  perform public.require_module('deliveries');
  v_org := public.current_org_id();
  select fulfil_location_id is not null into v_stock
    from public.orders where id = p_order_id and org_id = v_org;
  if v_stock is not false then
    perform public.require_module('warehouse');
  end if;
  v_role := public."current_role"();
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can start picking.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  -- The status is re-checked in the WHERE clause rather than read first, so two
  -- clerks starting the same order cannot both win. Same shape as
  -- close_abandoned_workday.
  update public.orders
     set status = 'picking', picking_started_by = auth.uid(), picking_started_at = now()
   where id = p_order_id and org_id = v_org and status = 'confirmed'
  returning order_number into v_number;

  if v_number is null then
    raise exception 'That order is not waiting to be picked.' using errcode = '42501';
  end if;

  return jsonb_build_object('order_id', p_order_id, 'order_number', v_number,
                            'status', 'picking');
end;
$function$;

-- ----------------------------------------------------- order_mark_packed

CREATE OR REPLACE FUNCTION public.order_mark_packed(p_order_id uuid, p_accept_short boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_order public.orders;
  v_short record;
  v_number text;
  v_stock boolean;
begin
  perform public.require_writable();
  -- As order_start_picking: Deliveries, and Stock control for an order
  -- holding stock.
  perform public.require_module('deliveries');
  v_org := public.current_org_id();
  select fulfil_location_id is not null into v_stock
    from public.orders where id = p_order_id and org_id = v_org;
  if v_stock is not false then
    perform public.require_module('warehouse');
  end if;
  v_role := public."current_role"();
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can pack an order.' using errcode = '42501';
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

  -- Without stock nothing was reserved or counted, so nothing can be short:
  -- the box holds the order as invoiced, and order_dispatch sends it in full.
  if not p_accept_short and v_order.fulfil_location_id is not null then
    select p.name, ol.qty_picked, ol.qty_reserved into v_short
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    where ol.order_id = v_order.id
      and ol.line_status <> 'cancelled'
      and ol.qty_picked < ol.qty_reserved
    order by p.name
    limit 1;

    if found then
      raise exception
        'Only % of % % have been picked. Finish the pick, or pack it short deliberately.',
        v_short.qty_picked, v_short.qty_reserved, v_short.name
        using errcode = '23514';
    end if;
  end if;

  update public.orders
     set status = 'packed', packed_by = auth.uid(), packed_at = now()
   where id = v_order.id and status = 'picking'
  returning order_number into v_number;

  if v_number is null then
    raise exception 'That order is no longer being picked.' using errcode = '42501';
  end if;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_number,
                            'status', 'packed', 'packed_short', p_accept_short);
end;
$function$;

-- ---------------------------------------------------- order_picking_list

CREATE OR REPLACE FUNCTION public.order_picking_list(p_order_id uuid)
 RETURNS TABLE(allocation_id uuid, order_line_id uuid, product_id uuid, product_name text, brand text, unit_barcode text, batch_id uuid, batch_number text, expiry_date date, location_name text, qty_to_pick integer, qty_picked integer, allocation_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Picking is part of sending an order out (Deliveries). One holding stock
  -- needs Stock control as well; an order with no location was invoiced
  -- without stock and needs nothing more.
  select public.require_module('deliveries');
  select public.require_module('warehouse')
   where not exists (select 1 from public.orders o
                      where o.id = p_order_id and o.org_id = public.current_org_id()
                        and o.fulfil_location_id is null);
  with cfg as materialized (select public.current_org_id() as org),
  picks as (
  select
    a.id as r_allocation, a.order_line_id as r_line, ol.product_id as r_product,
    p.name as r_name, p.brand as r_brand, p.unit_barcode as r_barcode,
    a.batch_id as r_batch, pb.batch_number as r_batch_number, pb.expiry_date as r_expiry,
    l.name as r_location, a.qty_reserved as r_to_pick, a.qty_picked as r_picked, a.status as r_status
  from public.order_allocations a
  cross join cfg
  join public.order_lines ol on ol.id = a.order_line_id
  join public.products p on p.id = ol.product_id
  join public.stock_locations l on l.id = a.location_id
  left join public.product_batches pb on pb.id = a.batch_id
  where a.order_id = p_order_id
    and a.org_id = cfg.org
    and a.status in ('reserved', 'picked')
  union all
  -- Without stock: every live line still to go, at the quantity ordered,
  -- while the order is invoiced or being picked. Nothing was reserved, so
  -- there is no allocation, batch or place, and nothing is counted as
  -- picked: the order is packed and sent as invoiced. 'to_pick' says so.
  select
    null, ol.id, ol.product_id, p.name, p.brand, p.unit_barcode,
    null, null, null, null, ol.qty_ordered - ol.qty_dispatched, 0, 'to_pick'
  from public.orders o
  cross join cfg
  join public.order_lines ol on ol.order_id = o.id
  join public.products p on p.id = ol.product_id
  where o.id = p_order_id
    and o.org_id = cfg.org
    and o.fulfil_location_id is null
    and o.status in ('confirmed', 'picking')
    and ol.line_status <> 'cancelled'
    and ol.qty_ordered > ol.qty_dispatched
  )
  select r_allocation, r_line, r_product, r_name, r_brand, r_barcode, r_batch,
         r_batch_number, r_expiry, r_location, r_to_pick, r_picked, r_status
  from picks
  -- Oldest stock first, so the sheet reads in the order it should be walked.
  order by r_expiry nulls last, r_name;
$function$;

-- -------------------------------------------------------- order_dispatch

CREATE OR REPLACE FUNCTION public.order_dispatch(p_order_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_carrier_name text DEFAULT NULL::text, p_tracking_reference text DEFAULT NULL::text, p_expected_delivery_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_role text;
  v_order public.orders;
  v_dispatch_id uuid;
  v_number text;
  v_transit uuid;
  v_reg text;
  v_alloc record;
  v_line record;
  v_total integer := 0;
  v_lines integer := 0;
begin
  perform public.require_writable();
  perform public.require_module('deliveries');
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can dispatch an order.' using errcode = '42501';
  end if;
  if p_driver_id is null and p_vehicle_id is null
     and (p_carrier_name is null or btrim(p_carrier_name) = '') then
    raise exception 'Say who is taking it: a driver, a vehicle, or a courier.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into v_order from public.orders where id = p_order_id and org_id = v_org;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  -- No location: invoiced by a company that keeps no stock. It goes out once
  -- packed, or straight from confirmed as it did before packing was offered
  -- to it (30 Oct 2026); either way nothing was reserved, so it goes in full.
  if v_order.fulfil_location_id is null then
    if v_order.status not in ('confirmed', 'packed') then
      raise exception 'Order % is %, not invoiced and ready to go.',
        v_order.order_number, v_order.status using errcode = '42501';
    end if;
  elsif v_order.status <> 'packed' then
    raise exception 'Order % is %, not packed and ready to go.',
      v_order.order_number, v_order.status using errcode = '42501';
  end if;

  if p_driver_id is not null and not exists (
      select 1 from public.drivers where id = p_driver_id and org_id = v_org and active) then
    raise exception 'That driver is not on the active list.' using errcode = '42501';
  end if;
  if p_vehicle_id is not null and not exists (
      select 1 from public.vehicles where id = p_vehicle_id and org_id = v_org and active) then
    raise exception 'That vehicle is not on the active list.' using errcode = '42501';
  end if;

  -- Where the in-transit stock lives. Our own van gets its own location,
  -- created on first use; a courier leaves it in the warehouse's in_transit
  -- bucket, which is excluded from on_hand and so does not double-count.
  -- Without stock, nowhere: nothing is carried out of a location.
  if v_order.fulfil_location_id is null then
    v_transit := null;
  elsif p_vehicle_id is not null then
    select id into v_transit from public.stock_locations
    where vehicle_id = p_vehicle_id and org_id = v_org;

    if v_transit is null then
      select registration into v_reg from public.vehicles where id = p_vehicle_id;
      insert into public.stock_locations (org_id, name, type, vehicle_id, created_by)
      values (v_org, 'Vehicle ' || v_reg, 'vehicle', p_vehicle_id, auth.uid())
      returning id into v_transit;
    end if;
  else
    v_transit := v_order.fulfil_location_id;
  end if;

  v_number := public.next_document_number(v_org, 'dispatch', 'DSP');

  insert into public.dispatches (
    org_id, dispatch_number, order_id, driver_id, vehicle_id, carrier_name,
    tracking_reference, dispatch_location_id, transit_location_id,
    dispatched_by, expected_delivery_on, notes)
  values (
    v_org, v_number, v_order.id, p_driver_id, p_vehicle_id, nullif(btrim(coalesce(p_carrier_name, '')), ''),
    p_tracking_reference, v_order.fulfil_location_id, v_transit,
    auth.uid(), p_expected_delivery_on, p_notes)
  returning id into v_dispatch_id;

  if v_order.fulfil_location_id is null then
    -- Every live line, in full, at the quantity invoiced. Nothing is moved.
    for v_line in
      select ol.id, ol.qty_ordered - ol.qty_dispatched as qty
      from public.order_lines ol
      where ol.order_id = v_order.id and ol.line_status <> 'cancelled'
        and ol.qty_ordered > ol.qty_dispatched
      order by ol.product_id, ol.id
      for update
    loop
      insert into public.dispatch_lines (org_id, dispatch_id, order_line_id, qty)
      values (v_org, v_dispatch_id, v_line.id, v_line.qty);

      update public.order_lines
         set qty_dispatched = qty_dispatched + v_line.qty
       where id = v_line.id;

      v_total := v_total + v_line.qty;
      v_lines := v_lines + 1;
    end loop;
  else
    -- Sorted, for the same deadlock reason every other multi-line RPC here is.
    for v_alloc in
      select a.*, ol.product_id
      from public.order_allocations a
      join public.order_lines ol on ol.id = a.order_line_id
      where a.order_id = v_order.id and a.status in ('reserved', 'picked')
        and a.qty_reserved > 0
      order by ol.product_id, a.batch_id nulls first, a.id
    loop
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id)
      values (
        v_org, v_alloc.product_id, v_alloc.batch_id, v_alloc.qty_reserved,
        v_alloc.location_id, 'reserved', v_transit, 'in_transit',
        'order_dispatch', v_number,
        'dispatch', v_dispatch_id, v_alloc.order_line_id, auth.uid());

      insert into public.dispatch_lines (
        org_id, dispatch_id, order_line_id, order_allocation_id, batch_id, qty)
      values (v_org, v_dispatch_id, v_alloc.order_line_id, v_alloc.id,
              v_alloc.batch_id, v_alloc.qty_reserved);

      update public.order_lines
         set qty_reserved = qty_reserved - v_alloc.qty_reserved,
             qty_dispatched = qty_dispatched + v_alloc.qty_reserved
       where id = v_alloc.order_line_id;

      update public.order_allocations
         set status = 'dispatched',
             qty_dispatched = v_alloc.qty_reserved,
             qty_reserved = 0
       where id = v_alloc.id;

      v_total := v_total + v_alloc.qty_reserved;
      v_lines := v_lines + 1;
    end loop;
  end if;

  if v_lines = 0 then
    raise exception 'Order % has nothing held to dispatch.', v_order.order_number
      using errcode = '42501';
  end if;

  update public.orders
     set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now()
   where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_id', v_dispatch_id, 'dispatch_number', v_number,
    'status', 'dispatched', 'transit_location_id', v_transit,
    'lines', v_lines, 'units', v_total);
end;
$function$;

-- ---------------------------------------------- order_return_undelivered

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
  -- A dispatch with no transit location carried no stock: nothing goes back
  -- on a shelf. The order returns to packed if it was packed before it went
  -- (the box comes back), else to confirmed, ready to go again.
  v_stock boolean;
  v_back text;
begin
  perform public.require_writable();
  perform public.require_module('deliveries');
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
  v_stock := v_dispatch.transit_location_id is not null;

  perform pg_advisory_xact_lock(hashtext('order_transition'),
                                hashtext(v_dispatch.order_id::text));

  select * into v_order from public.orders where id = v_dispatch.order_id;
  v_back := case when v_order.fulfil_location_id is null and v_order.packed_at is null
                 then 'confirmed' else 'packed' end;

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
    if v_stock then
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
    end if;

    update public.dispatch_lines set qty_returned = v_line.qty where id = v_line.id;

    -- When the order is cancelled, what was picked goes back with it: the
    -- stock is on the shelf again, not in a box for this order. Left alone,
    -- picked stayed above what the line holds and the update failed
    -- order_lines_picked_within_held on every packed order. In the same
    -- statement, so a line split over two batches never sits in between.
    -- Without stock nothing was reserved, so nothing is again.
    update public.order_lines
       set qty_dispatched = qty_dispatched - v_line.qty,
           qty_reserved = qty_reserved + case when p_cancel or not v_stock then 0 else v_line.qty end,
           qty_picked = case when p_cancel then least(qty_picked, qty_dispatched - v_line.qty)
                             else qty_picked end
     where id = v_line.order_line_id;

    if v_line.order_allocation_id is not null then
      update public.order_allocations
         set status = case when p_cancel then 'released' else 'picked' end,
             qty_dispatched = 0,
             qty_reserved = case when p_cancel then 0 else v_line.qty end,
             qty_picked = case when p_cancel then 0 else qty_picked end
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
    -- Invoiced without stock: its invoice is settled here too where the
    -- follow trigger would leave it standing.
    if not v_stock then
      perform public.order_cancel_settle_invoice(v_order.id);
    end if;
  else
    update public.orders
       set status = v_back,
           dispatched_at = null, dispatched_by = null
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_number', v_dispatch.dispatch_number,
    'status', case when p_cancel then 'cancelled' else v_back end,
    'units_returned', v_total);
end;
$function$;

-- -------------------------------------------- order_cancel_without_stock

CREATE OR REPLACE FUNCTION public.order_cancel_without_stock(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  o public.orders;
  -- Any run of white space, tabs and new lines included, counts as one space.
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  v_org := public.current_org_id();

  if not public.has_permission('warehouse') then
    raise exception 'Cancelling an order needs the Orders permission.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Say why the order is being cancelled.' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into o from public.orders where id = p_order_id and org_id = v_org for update;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  -- A company that keeps stock cancels with order_cancel, which puts the
  -- stock back; only an order invoiced without stock before it bought
  -- Stock control is still this function's.
  if public.module_enabled('warehouse')
     and not (o.fulfil_location_id is null
              and o.status in ('confirmed', 'picking', 'packed', 'dispatched')) then
    raise exception 'Your company keeps stock, so cancel the order with "Cancel", which also puts any reserved stock back.'
      using errcode = '42501';
  end if;
  if o.status = 'cancelled' then
    raise exception 'Order % is already cancelled.', o.order_number using errcode = '42501';
  end if;
  if o.status = 'delivered' then
    -- Delivered, or finished here: either way a correction is a credit note,
    -- when there is an invoice to credit.
    raise exception 'Order % is delivered, so it cannot be cancelled. If it was invoiced, issue a credit note on its invoice instead.',
      o.order_number using errcode = '42501';
  end if;
  if o.status = 'dispatched' and o.fulfil_location_id is null then
    raise exception 'Order % is out for delivery. Record the delivery as failed, and cancel it there.',
      o.order_number using errcode = '42501';
  end if;
  -- Being picked or packed holds nothing either: no stock to put back.
  if o.status not in ('new', 'confirmed', 'picking', 'packed') or o.fulfil_location_id is not null then
    -- Moved on through the warehouse before the company dropped it.
    raise exception 'Order % is %, which only the warehouse steps can undo.', o.order_number, o.status
      using errcode = '42501';
  end if;

  -- Lines first, then the order, as order_cancel does.
  update public.order_lines set line_status = 'cancelled'
   where order_id = o.id and line_status <> 'cancelled';
  update public.orders
     set status = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by = auth.uid(),
         cancelled_at = now()
   where id = o.id;
  -- Invoiced and not sent yet: its invoice is voided, or credited once paid
  -- (orders_invoice_follow where "Invoice every order" is on, else here).
  if o.status in ('confirmed', 'picking', 'packed') then
    perform public.order_cancel_settle_invoice(o.id);
  end if;

  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'status', 'cancelled');
end;
$function$;

-- ------------------------------------------------------ which module owns them

-- Each now starts with require_module('deliveries'), and asks for Stock
-- control only for an order holding stock.
update public.module_assignments set module_code = 'deliveries'
 where kind = 'function' and module_code = 'warehouse'
   and name in ('order_start_picking', 'order_mark_packed', 'order_picking_list');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.module_assignments
   where kind = 'function' and module_code = 'deliveries'
     and name in ('order_start_picking', 'order_mark_packed', 'order_picking_list');
  if v_n <> 3 then
    raise exception 'Expected 3 functions moved to deliveries, found %', v_n;
  end if;
end;
$$;

comment on function public.order_picking_list(uuid) is
  'The picking list for an order: product, batch, expiry, location and quantity, oldest stock first. An order with no stock lists its live lines at the quantity ordered, with no batch or location.';

comment on function public.order_cancel_without_stock(uuid, text) is
  'For an order with no stock: cancels it while new, or invoiced, being picked or packed and not yet sent (its invoice voided, or credited once paid).';
