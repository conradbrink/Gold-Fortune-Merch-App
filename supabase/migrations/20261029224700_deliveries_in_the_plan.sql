-- Deliveries are part of the plan; only keeping stock is the paid add-on.
--
-- Owner, 29 Oct 2026: "dispatch, ordering, all that kind of stuff will count
-- towards the operations of the business and will be included in the paid
-- normal plan, excluding the add-on. The add-on will be for the HR feature and
-- the inventory management software section, where they have inventory in
-- warehouses ... and they can track the inventory."
--
-- Until now one module, `warehouse` ("Warehouse and deliveries"), held both:
-- the stock (balances, movements, reservations, picking and packing, goods
-- received, stock counts, transfers, adjustments, batches, the stock reports)
-- and the delivery (dispatches, drivers, vehicles, proof of delivery, the
-- driver's phone, route planning). A company without it could take and
-- invoice an order (#234) but never send it out.
--
-- ------------------------------------------------------------ the modules
--
-- A new module, `deliveries`, takes the delivery half: the tables dispatches,
-- dispatch_lines, drivers, vehicles and delivery_documents, the fulfilment-docs
-- bucket, and the functions that send an order out and record what happened
-- to it. `warehouse` keeps its code (the price list, billing, Paystack
-- add-ons, the web and the phone all name it) and becomes "Inventory", the
-- paid add-on, with every stock table and function exactly as they were: none
-- of their bodies is touched here.
--
-- `deliveries` is an `edition` module, like Distribution, not `included`:
-- provision_company_modules switches every built `included` module on for
-- every new company, and deliveries cannot be on without Distribution, so a
-- cleaning company's sign-up would fail. It comes with the Distribution
-- template instead (create_company switches modules on in sort order, so
-- Distribution 70 before Deliveries 75 before Inventory 80), and is switched on
-- here for every company that has Distribution today. Inventory needs
-- Deliveries (its dispatch moves the stock out), and Deliveries needs
-- Distribution (it sends orders).
--
-- New sign-ups get Deliveries and not Inventory: the Distribution template
-- drops `warehouse` (version bumped). Companies that have Inventory keep it;
-- nothing a company can see or do today goes away.
--
-- -------------------------------------------- an order with no stock to move
--
-- An order invoiced by order_invoice_without_stock has no fulfilment
-- location: its company keeps no stock. That, read from the order and never
-- from the company's modules, is what every step below asks, so an order keeps
-- the path it started on if the company buys or drops Inventory halfway.
--
--   new --order_invoice_without_stock--> confirmed   (invoiced, ready to go)
--   confirmed --order_dispatch--> dispatched          (no picking, no packing)
--   dispatched --delivery_confirm / order_mark_delivered--> delivered
--   dispatched --order_return_undelivered--> confirmed, or cancelled
--   new or confirmed --order_cancel_without_stock--> cancelled
--
-- No stock is reserved, moved or counted at any step; the dispatch has no
-- dispatch or transit location, its lines no allocation or batch. A company
-- with Distribution but not Deliveries (the operator can still switch it off)
-- keeps #234's one step: the order is invoiced and finished as delivered.
--
-- The invoice is issued when the order is confirmed, as before, and follows
-- the order from there through orders_invoice_follow (20261013180000): sent
-- short or delivered short is credited, cancelled is voided. Where "Invoice
-- every order" is off the follow trigger does nothing, so cancelling here
-- voids the invoice itself, the same way.
--
-- -------------------------------------------------- the rules it changes
--
-- orders_fulfil_location_set: an order with no location may now be confirmed,
-- dispatched or delivered; only picking and packing still need one (and new
-- and cancelled never did). order_confirm sets the location in the same
-- statement that confirms, so a stock-kept order is never without one.
--
-- dispatches.dispatch_location_id / transit_location_id may be null, both
-- together, for a dispatch that carries no stock.
--
-- orders_enforce_transition: confirmed -> dispatched and dispatched ->
-- confirmed, for an order with no location only, the second only through
-- order_return_undelivered (the same flag that guards dispatched -> packed).
--
-- Rollback: supabase/rollback/20261029224700_deliveries_in_the_plan.down.sql.
-- It refuses while a dispatch without stock, or an order without a location
-- past `new` and not finished by #234, exists.

---------------------------------------------------------------- the catalogue

insert into public.modules (code, name, description, plan_type, is_built, sort_order) values
  ('deliveries', 'Deliveries',
   'Dispatch orders to a driver, a rep or a courier; drivers and vehicles; the driver''s phone with the receiver''s signature, failed deliveries and route planning; proof of delivery.',
   'edition', true, 75);

update public.modules
   set name = 'Inventory',
       description = 'Stock in your warehouses: receiving, reserving, picking and packing, stock counts, transfers, adjustments, batches and expiry, and the stock reports.'
 where code = 'warehouse';

insert into public.module_dependencies (module_code, requires_code) values
  ('deliveries', 'distribution'),
  ('warehouse', 'deliveries');

-- Every company that sends orders today, Gold Fortune included, has the
-- delivery half already (inside `warehouse`) or is meant to (owner, above).
insert into public.company_modules (org_id, module_code, enabled)
select cm.org_id, 'deliveries', true
  from public.company_modules cm
 where cm.module_code = 'distribution' and cm.enabled
on conflict (org_id, module_code) do nothing;

insert into public.template_modules (template_code, module_code) values ('distribution', 'deliveries');
delete from public.template_modules where template_code = 'distribution' and module_code = 'warehouse';
update public.industry_templates set version = version + 1 where code = 'distribution';

-- What the add-on is called on a plan and its invoice. Same prices.
update public.price_list
   set label = 'Inventory, per warehouse'
 where code = 'warehouse' and kind = 'addon' and label = 'Warehouse and deliveries, per warehouse';

-------------------------------------------------------- which module owns what

update public.module_assignments set module_code = 'deliveries'
 where module_code = 'warehouse'
   and (kind, name) in (
     ('table', 'dispatches'), ('table', 'dispatch_lines'), ('table', 'drivers'),
     ('table', 'vehicles'), ('table', 'delivery_documents'),
     ('bucket', 'fulfilment-docs'),
     ('function', 'assign_dispatch_rep'), ('function', 'delivery_confirm'),
     ('function', 'delivery_contents'), ('function', 'delivery_document_register'),
     ('function', 'order_dispatch'), ('function', 'order_mark_delivered'),
     ('function', 'order_return_undelivered'), ('function', 'orders_missing_pod'));

do $$
declare v_n int;
begin
  select count(*) into v_n from public.module_assignments where module_code = 'deliveries';
  if v_n <> 14 then
    raise exception 'Expected 14 module assignments moved to deliveries, found %', v_n;
  end if;
end;
$$;

alter policy module_gate on public.dispatches
  using ((select public.module_enabled('deliveries'))) with check ((select public.module_enabled('deliveries')));
alter policy module_gate on public.dispatch_lines
  using ((select public.module_enabled('deliveries'))) with check ((select public.module_enabled('deliveries')));
alter policy module_gate on public.drivers
  using ((select public.module_enabled('deliveries'))) with check ((select public.module_enabled('deliveries')));
alter policy module_gate on public.vehicles
  using ((select public.module_enabled('deliveries'))) with check ((select public.module_enabled('deliveries')));
alter policy module_gate on public.delivery_documents
  using ((select public.module_enabled('deliveries'))) with check ((select public.module_enabled('deliveries')));

alter policy module_gate_fulfilment_docs on storage.objects
  using (bucket_id <> 'fulfilment-docs' or (select public.module_enabled('deliveries')))
  with check (bucket_id <> 'fulfilment-docs' or (select public.module_enabled('deliveries')));

-- Functions whose only change is the module they check. Rewritten from their
-- live definitions, as enforce_modules (20261007112638) wrote the checks in,
-- asserting the call appears exactly once in each.
do $$
declare
  r record;
  v_def text;
  c_from constant text := 'require_module(''warehouse'')';
  c_to constant text := 'require_module(''deliveries'')';
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('assign_dispatch_rep', 'delivery_confirm', 'delivery_contents',
                         'delivery_document_register', 'order_mark_delivered', 'orders_missing_pod')
  loop
    v_def := pg_get_functiondef(r.oid);
    if (length(v_def) - length(replace(v_def, c_from, ''))) / length(c_from) <> 1 then
      raise exception '% does not call require_module(''warehouse'') exactly once', r.proname;
    end if;
    execute replace(v_def, c_from, c_to);
  end loop;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('assign_dispatch_rep', 'delivery_confirm', 'delivery_contents',
                           'delivery_document_register', 'order_mark_delivered', 'orders_missing_pod')
         and p.prosrc like '%' || c_to || '%') <> 6 then
    raise exception 'Not all six delivery functions now check the deliveries module';
  end if;
end;
$$;

------------------------------------------------------------------ the rules

alter table public.orders drop constraint orders_fulfil_location_set;
alter table public.orders add constraint orders_fulfil_location_set
  check (fulfil_location_id is not null
         or status in ('new', 'cancelled', 'confirmed', 'dispatched', 'delivered'));

alter table public.dispatches alter column dispatch_location_id drop not null;
alter table public.dispatches alter column transit_location_id drop not null;
alter table public.dispatches add constraint dispatches_locations_together
  check ((dispatch_location_id is null) = (transit_location_id is null));

comment on column public.dispatches.transit_location_id is
  'Where the stock sits while it is on the road. Null, with dispatch_location_id, for an order sent out by a company that keeps no stock: nothing is moved.';

create or replace function public.orders_enforce_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_legal boolean;
begin
  if new.status is not distinct from old.status then
    if new.org_id is distinct from old.org_id then
      raise exception 'An order cannot be moved to another organisation.'
        using errcode = '42501';
    end if;
    if new.store_id is distinct from old.store_id and old.status <> 'new' then
      raise exception 'Order % has been confirmed; it cannot be moved to another location.',
        old.order_number using errcode = '42501';
    end if;
    return new;
  end if;

  if old.on_hold and new.status <> 'cancelled' then
    raise exception 'Order % is on hold (%). Release the hold first.',
      old.order_number, coalesce(old.hold_reason, 'no reason given')
      using errcode = '42501';
  end if;

  v_legal := (old.status, new.status) in (
    ('new', 'confirmed'),       ('new', 'cancelled'),
    ('confirmed', 'picking'),   ('confirmed', 'cancelled'),
    ('picking', 'confirmed'),   ('picking', 'packed'),      ('picking', 'cancelled'),
    ('packed', 'picking'),      ('packed', 'dispatched'),   ('packed', 'cancelled'),
    ('dispatched', 'delivered'),('dispatched', 'cancelled'),('dispatched', 'packed')
  )
  -- Invoiced and finished in one step by order_invoice_without_stock, for a
  -- company that keeps no stock and does not deliver. Only through it.
  or ((old.status, new.status) = ('new', 'delivered')
      and coalesce(current_setting('app.finished_without_stock', true), '') = new.id::text)
  -- An order with no stock to pick or pack goes out straight from confirmed,
  -- and comes back there when a delivery fails.
  or (new.fulfil_location_id is null
      and (old.status, new.status) in (('confirmed', 'dispatched'), ('dispatched', 'confirmed')));

  if not v_legal then
    raise exception 'An order cannot go from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  if old.status = 'dispatched' and new.status in ('cancelled', 'packed', 'confirmed')
     and coalesce(current_setting('app.stock_returned', true), '') <> new.id::text then
    raise exception
      'Take a dispatched order back through order_return_undelivered(), so the stock comes with it.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

------------------------------------------------------------ sending it out

create or replace function public.order_dispatch(p_order_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_carrier_name text DEFAULT NULL::text, p_tracking_reference text DEFAULT NULL::text, p_expected_delivery_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
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
  -- No location: invoiced by a company that keeps no stock, so there is
  -- nothing to pick or pack and it goes out from confirmed.
  if v_order.fulfil_location_id is null then
    if v_order.status <> 'confirmed' then
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

------------------------------------------------------- recording what happened

create or replace function public.order_mark_delivered_unchecked(p_dispatch_id uuid, p_received_by_name text, p_delivered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_dispatch public.dispatches;
  v_order public.orders;
  v_line record;
  v_delivered integer;
  v_back integer;
  v_total_delivered integer := 0;
  v_total_back integer := 0;
  v_when timestamptz;
begin
  perform public.require_writable();
  perform public.require_module('deliveries');
  v_org := public.current_org_id();
  if p_received_by_name is null or btrim(p_received_by_name) = '' then
    raise exception 'Who took delivery? A name is what makes the record worth keeping.'
      using errcode = '22023';
  end if;

  -- Before the read. The order-level lock below cannot go here: it is keyed on
  -- a column of the row this select is about to fetch.
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

  v_when := coalesce(p_delivered_at, now());
  if v_when > now() + interval '1 minute' then
    raise exception 'A delivery cannot be recorded in the future.' using errcode = '22023';
  end if;

  for v_line in
    select dl.*, ol.product_id
    from public.dispatch_lines dl
    join public.order_lines ol on ol.id = dl.order_line_id
    where dl.dispatch_id = v_dispatch.id
    order by ol.product_id, dl.batch_id nulls first, dl.id
  loop
    v_delivered := coalesce(
      (select (e->>'qty_delivered')::integer
       from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'dispatch_line_id')::uuid = v_line.id),
      v_line.qty);

    if v_delivered < 0 or v_delivered > v_line.qty then
      raise exception 'Cannot deliver % of a consignment line of %.', v_delivered, v_line.qty
        using errcode = '23514';
    end if;
    v_back := v_line.qty - v_delivered;

    -- A dispatch with no transit location carried no stock (a company that
    -- keeps none): the quantities are recorded, nothing is moved.
    if v_delivered > 0 and v_dispatch.transit_location_id is not null then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id,
        occurred_at, actor_id)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_delivered,
        v_dispatch.transit_location_id, 'in_transit',
        'order_delivery', v_dispatch.dispatch_number,
        'dispatch', v_dispatch.id, v_line.order_line_id, v_when, auth.uid());
    end if;

    -- Whatever the customer would not take goes back on the shelf, not into
    -- the gap between two numbers.
    if v_back > 0 and v_dispatch.transit_location_id is not null then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id,
        occurred_at, actor_id, note)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_back,
        v_dispatch.transit_location_id, 'in_transit',
        v_dispatch.dispatch_location_id, 'available',
        'order_return_undelivered', v_dispatch.dispatch_number,
        'dispatch', v_dispatch.id, v_line.order_line_id, v_when, auth.uid(),
        'Not accepted at delivery');
    end if;

    update public.dispatch_lines
       set qty_delivered = v_delivered, qty_returned = v_back
     where id = v_line.id;

    -- `qty_delivered + v_delivered`, not `v_delivered` alone. The old test
    -- compared one consignment line against the whole ordered quantity, so a
    -- line delivered in full across two batches never reached 'fulfilled' and
    -- the last iteration overwrote what the earlier ones had set.
    update public.order_lines
       set qty_delivered = qty_delivered + v_delivered,
           qty_returned = qty_returned + v_back,
           line_status = case
             when qty_delivered + v_delivered >= qty_ordered then 'fulfilled'
             when qty_delivered + v_delivered > 0 then 'partial'
             else line_status end
     where id = v_line.order_line_id;

    v_total_delivered := v_total_delivered + v_delivered;
    v_total_back := v_total_back + v_back;
  end loop;

  update public.dispatches
     set status = 'delivered', delivered_at = v_when,
         delivered_by = auth.uid(), received_by_name = btrim(p_received_by_name)
   where id = v_dispatch.id and status = 'in_transit';
  if not found then
    raise exception 'Dispatch % was closed by somebody else while this was running.',
      v_dispatch.dispatch_number using errcode = '40001';
  end if;

  update public.orders
     set status = 'delivered', delivered_by = auth.uid(), delivered_at = v_when,
         pod_status = 'outstanding'
   where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_number', v_dispatch.dispatch_number,
    'status', 'delivered', 'pod_status', 'outstanding',
    'units_delivered', v_total_delivered, 'units_returned', v_total_back);
end;
$function$;

create or replace function public.order_return_undelivered(p_dispatch_id uuid, p_reason text, p_cancel boolean DEFAULT false)
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
  -- on a shelf, and the order returns to confirmed, ready to go again.
  v_stock boolean;
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
  else
    update public.orders
       set status = case when v_order.fulfil_location_id is null then 'confirmed' else 'packed' end,
           dispatched_at = null, dispatched_by = null
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_number', v_dispatch.dispatch_number,
    'status', case when p_cancel then 'cancelled'
                   when v_order.fulfil_location_id is null then 'confirmed'
                   else 'packed' end,
    'units_returned', v_total);
end;
$function$;

-------------------------------------------------- invoicing without stock (#234)

create or replace function public.order_invoice_without_stock(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  o public.orders;
  v_live integer;
  v_missing text;
  v_quotes text;
  v_invoice_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  v_org := public.current_org_id();

  if public.module_enabled('warehouse') then
    raise exception 'Your company keeps stock, so confirm the order with "Confirm and reserve", which takes the stock off the shelf.'
      using errcode = '42501';
  end if;
  if not public.has_permission('warehouse') then
    raise exception 'Invoicing an order needs the Orders permission.' using errcode = '42501';
  end if;

  -- As order_confirm: two people pressing the button must not both invoice it.
  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into o from public.orders where id = p_order_id and org_id = v_org for update;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  if o.status <> 'new' then
    raise exception 'Order % is already %.', o.order_number, o.status using errcode = '42501';
  end if;

  -- The lines too, so a change to a line saved while this runs waits for it.
  -- A line added or removed at the same moment is not held off (the same
  -- window order_confirm has).
  perform 1 from public.order_lines where order_id = o.id for update;

  select count(*),
         string_agg(p.name, ', ' order by p.name) filter (where ol.unit_price is null)
    into v_live, v_missing
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = o.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0;
  if v_live = 0 then
    raise exception 'Order % has nothing on it to invoice.', o.order_number using errcode = '22023';
  end if;
  -- A QuickBooks number means it was invoiced there: no second invoice, so
  -- no prices needed.
  if o.invoice_number is null and v_missing is not null then
    raise exception '% has products with no price: %. Price them before invoicing.', o.order_number, v_missing
      using errcode = '22023';
  end if;
  if exists (select 1 from public.tax_invoices t where t.order_id = o.id and t.status = 'issued') then
    raise exception '% already has a tax invoice.', o.order_number using errcode = '23505';
  end if;
  -- Made from a quote that was invoiced already (in full, or a deposit):
  -- invoicing the order too would bill the customer twice, the deposit not
  -- taken off. quote_convert does not stop that; for these companies this is
  -- the step that would issue the second invoice, so it stops here. The way
  -- on is the quote's own: its final balance (invoice_from_quote) bills what
  -- is left with the deposit taken off. A credit note would not clear this:
  -- a credited invoice is still issued.
  select string_agg(distinct q.quote_number || ' (' || t.invoice_number || ')', ', ')
    into v_quotes
    from public.quotes q
    join public.tax_invoices t on t.quote_id = q.id and t.status = 'issued'
   where q.converted_order_id = o.id;
  if v_quotes is not null then
    raise exception '% was made from a quote that is already invoiced: %. Invoice what is left from the quote instead, and cancel this order.',
      o.order_number, v_quotes using errcode = '23505';
  end if;

  -- Only the warehouse could release it, and there is none.
  if o.on_hold then
    update public.orders set on_hold = false, hold_reason = null, held_at = null, held_by = null
     where id = o.id;
  end if;

  if o.invoice_number is null then
    v_invoice_id := public.order_invoice_write(o.id);
  end if;

  -- With Deliveries (part of the plan for distributors since 29 Oct 2026) the
  -- order is invoiced and waits to be dispatched: confirmed, with no
  -- location, which order_dispatch sends straight out. Its invoice then
  -- follows it (orders_invoice_follow) as any order's does.
  if public.module_enabled('deliveries') then
    update public.orders
       set status = 'confirmed',
           confirmed_by = auth.uid(),
           confirmed_at = now()
     where id = o.id;

    return jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'status', 'confirmed',
      'invoice_id', v_invoice_id);
  end if;

  -- Without it nothing follows invoicing, so the order is finished here:
  -- each live line sent and delivered in full, no POD asked for.
  update public.order_lines
     set qty_dispatched = qty_ordered,
         qty_delivered = qty_ordered,
         line_status = 'fulfilled'
   where order_id = o.id and line_status <> 'cancelled';

  perform set_config('app.finished_without_stock', o.id::text, true);
  update public.orders
     set status = 'delivered',
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         delivered_by = auth.uid(),
         delivered_at = now(),
         pod_status = 'not_required'
   where id = o.id;
  perform set_config('app.finished_without_stock', '', true);

  return jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'status', 'delivered',
    'invoice_id', v_invoice_id);
end;
$function$;

create or replace function public.order_cancel_without_stock(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  o public.orders;
  i public.tax_invoices;
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
  -- Inventory is still this function's.
  if public.module_enabled('warehouse')
     and not (o.fulfil_location_id is null and o.status in ('confirmed', 'dispatched')) then
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
  if o.status not in ('new', 'confirmed') or o.fulfil_location_id is not null then
    -- Moved on through the warehouse before the company dropped it.
    raise exception 'Order % is %, which only the warehouse steps can undo.', o.order_number, o.status
      using errcode = '42501';
  end if;

  -- Invoiced and not sent yet. Where "Invoice every order" is on,
  -- orders_invoice_follow voids the invoice (or credits it, once paid) when
  -- the order is cancelled. Where it is off that trigger does nothing, so the
  -- invoice this order's confirm issued is voided here, the same way; one
  -- with payments or credits against it is the invoicing page's to credit.
  if o.status = 'confirmed' and not public.order_invoices_on(v_org) then
    select * into i from public.tax_invoices t
     where t.order_id = o.id and t.status = 'issued' for update;
    if found then
      if exists (select 1 from public.invoice_payments p where p.invoice_id = i.id)
         or exists (select 1 from public.credit_notes c where c.invoice_id = i.id) then
        raise exception '% has payments or credit notes against it. Credit what is left on the invoice, then send the order out or leave it.',
          i.invoice_number using errcode = '42501';
      end if;
      update public.tax_invoices
         set status = 'void', void_reason = format('%s was cancelled.', o.order_number),
             voided_by = auth.uid(), voided_at = now()
       where id = i.id;
      update public.orders set invoice_number = null
       where id = o.id and invoice_number = i.invoice_number;
    end if;
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

  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'status', 'cancelled');
end;
$function$;

comment on function public.order_invoice_without_stock(uuid) is
  'For a company without Inventory: invoices a new order at the quantities ordered. With Deliveries the order is then confirmed, ready to dispatch; without, it is finished as delivered. Never touches stock.';
comment on function public.order_cancel_without_stock(uuid, text) is
  'For an order with no stock: cancels it while new, or invoiced and not yet sent (its invoice voided or credited).';
