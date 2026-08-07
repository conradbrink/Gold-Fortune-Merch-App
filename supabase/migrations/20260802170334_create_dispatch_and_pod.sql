-- Getting the order out of the building, and proving it arrived.
--
-- ------------------------------------------------------- where in-transit is
--
-- Dispatching moves stock from `reserved` at the warehouse to `in_transit`.
-- Where in_transit *sits* depends on who is carrying it:
--
--   * our own van   -> the vehicle's own stock location, so "what is on that
--                      lorry right now" is a real query
--   * a courier     -> the source warehouse's own in_transit bucket, because
--                      there is no location to point at and inventing one per
--                      courier would litter the estate with rows nobody manages
--
-- Either way `qty_on_hand` excludes in_transit, so the stock is not counted at
-- the place it left. That exclusion is what makes the courier case safe.
--
-- A vehicle's stock location is created on first dispatch rather than being set
-- up in advance. Asking a clerk to create a "stock location" for a van before
-- they can load it is asking them to understand the data model; the van already
-- exists as a `vehicles` row, and that is the thing they know about.
--
-- ------------------------------------------------------ a failed delivery
--
-- This migration widens the status graph by one pair: `dispatched -> packed`.
--
-- A delivery that does not happen — nobody at the shop, the customer refuses it,
-- the van breaks down — is ordinary, and the order is going out again tomorrow.
-- Without this the only way back is to cancel and re-key the whole order, which
-- would lose the audit trail of the first attempt and annoy everyone.
--
-- The return posts `in_transit -> reserved`, not `-> available`. That is what
-- makes it symmetrical: the allocations go back to exactly the state dispatch
-- found them in, so re-dispatching is the same code path with nothing special
-- about it. Returning to `available` would have left the order packed with
-- nothing held for it, and the stock could be sold out from under it.
--
-- Both ways out of `dispatched` — packed and cancelled — still require the
-- `app.stock_returned` session flag, so no code path can leave the goods on a
-- van with the order saying otherwise.
--
-- ------------------------------------------------------------------ the POD
--
-- Delivery sets `pod_status = 'outstanding'`. Registering a document of type
-- `pod` sets it to `received`, by trigger rather than by the RPC, so any path
-- that files a signed page marks the order — including a correction made in
-- SQL. `orders_missing_pod()` is the report that falls out of it.

-- -------------------------------------------------------------- dispatches

create table if not exists public.dispatches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dispatch_number text not null,
  order_id uuid not null references public.orders(id) on delete restrict,

  driver_id uuid references public.drivers(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete restrict,
  carrier_name text,
  tracking_reference text,

  -- Where it left from, and where its in_transit stock is being held.
  dispatch_location_id uuid not null references public.stock_locations(id) on delete restrict,
  transit_location_id uuid not null references public.stock_locations(id) on delete restrict,

  dispatched_at timestamptz not null default now(),
  dispatched_by uuid references public.profiles(id) on delete set null,
  expected_delivery_on date,

  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id) on delete set null,
  received_by_name text,

  status text not null default 'in_transit',
  failure_reason text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dispatches is
  'One consignment leaving the warehouse. Carries the driver, vehicle or courier, the tracking reference, and what came of it.';

alter table public.dispatches drop constraint if exists dispatches_status_check;
alter table public.dispatches add constraint dispatches_status_check
  check (status in ('in_transit', 'delivered', 'failed', 'returned'));

-- Something has to be carrying it. A dispatch with no driver, no vehicle and no
-- courier is a box that left the building unaccounted for.
alter table public.dispatches drop constraint if exists dispatches_has_a_carrier;
alter table public.dispatches add constraint dispatches_has_a_carrier
  check (driver_id is not null or vehicle_id is not null or carrier_name is not null);

alter table public.dispatches drop constraint if exists dispatches_failure_reason;
alter table public.dispatches add constraint dispatches_failure_reason
  check (status not in ('failed', 'returned') or failure_reason is not null);

alter table public.dispatches drop constraint if exists dispatches_delivered_stamped;
alter table public.dispatches add constraint dispatches_delivered_stamped
  check (status <> 'delivered' or delivered_at is not null);

create unique index if not exists dispatches_org_number_key
  on public.dispatches (org_id, dispatch_number);
create index if not exists dispatches_order_idx on public.dispatches (order_id);
create index if not exists dispatches_org_status_idx
  on public.dispatches (org_id, status, dispatched_at desc);
create index if not exists dispatches_driver_idx
  on public.dispatches (driver_id) where driver_id is not null;
create index if not exists dispatches_vehicle_idx
  on public.dispatches (vehicle_id) where vehicle_id is not null;

drop trigger if exists dispatches_set_updated_at on public.dispatches;
create trigger dispatches_set_updated_at
  before update on public.dispatches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- dispatch_lines

create table if not exists public.dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  order_line_id uuid not null references public.order_lines(id) on delete restrict,
  order_allocation_id uuid references public.order_allocations(id) on delete set null,
  batch_id uuid references public.product_batches(id) on delete restrict,

  qty integer not null,
  qty_delivered integer not null default 0,
  qty_returned integer not null default 0,

  created_at timestamptz not null default now()
);

alter table public.dispatch_lines drop constraint if exists dispatch_lines_qty_check;
alter table public.dispatch_lines add constraint dispatch_lines_qty_check
  check (
    qty > 0
    and qty_delivered >= 0 and qty_returned >= 0
    and qty_delivered + qty_returned <= qty
  );

create index if not exists dispatch_lines_dispatch_idx on public.dispatch_lines (dispatch_id);
create index if not exists dispatch_lines_order_line_idx on public.dispatch_lines (order_line_id);

-- ------------------------------------------------------ delivery_documents

create table if not exists public.delivery_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  dispatch_id uuid references public.dispatches(id) on delete set null,

  doc_type text not null,
  -- The row that owns the entitlement rule. The storage policy joins to this,
  -- exactly as the files bucket joins to public.files, so the rule lives in one
  -- place and a guessed object path signs nothing.
  storage_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes bigint,

  signed_by_name text,
  signed_at timestamptz,

  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.delivery_documents is
  'Delivery notes, signed proofs of delivery and delivery photos. storage_path is what the fulfilment-docs bucket policy joins to.';

alter table public.delivery_documents drop constraint if exists delivery_documents_type_check;
alter table public.delivery_documents add constraint delivery_documents_type_check
  check (doc_type in ('delivery_note', 'pod', 'delivery_photo', 'other'));

-- A proof of delivery that nobody signed is a photograph of a box.
alter table public.delivery_documents drop constraint if exists delivery_documents_pod_signed;
alter table public.delivery_documents add constraint delivery_documents_pod_signed
  check (doc_type <> 'pod' or signed_by_name is not null);

alter table public.delivery_documents drop constraint if exists delivery_documents_size_check;
alter table public.delivery_documents add constraint delivery_documents_size_check
  check (size_bytes is null or size_bytes > 0);

create index if not exists delivery_documents_order_idx
  on public.delivery_documents (order_id, doc_type);
create index if not exists delivery_documents_dispatch_idx
  on public.delivery_documents (dispatch_id) where dispatch_id is not null;

/**
 * Filing a signed proof of delivery answers the order's outstanding POD.
 *
 * A trigger rather than a line in the RPC, so every path that files one counts
 * — including a correction made directly in SQL. The same reason
 * order_status_events is trigger-written.
 */
create or replace function public.delivery_documents_mark_pod()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.doc_type = 'pod' then
    update public.orders
       set pod_status = 'received'
     where id = new.order_id and pod_status = 'outstanding';
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_documents_pod_received on public.delivery_documents;
create trigger delivery_documents_pod_received
  after insert on public.delivery_documents
  for each row execute function public.delivery_documents_mark_pod();

/**
 * Dispatch children belong to the same organisation as their dispatch.
 */
create or replace function public.dispatch_lines_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.dispatches where id = new.dispatch_id;
  if v_org is distinct from new.org_id then
    raise exception 'That dispatch belongs to another organisation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dispatch_lines_org_guard on public.dispatch_lines;
create trigger dispatch_lines_org_guard
  before insert or update on public.dispatch_lines
  for each row execute function public.dispatch_lines_enforce_org();

-- ------------------------------------------------- the widened status graph
--
-- Replaces the function created with the orders migration, adding
-- `dispatched -> packed` for a delivery that did not happen. Both exits from
-- `dispatched` now require the session flag that only order_return_undelivered()
-- sets, so neither can be taken by hand while the goods are still on a van.

create or replace function public.orders_enforce_transition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_legal boolean;
begin
  if new.status is not distinct from old.status then
    if new.org_id is distinct from old.org_id then
      raise exception 'An order cannot be moved to another organisation.'
        using errcode = '42501';
    end if;
    if new.store_id is distinct from old.store_id and old.status <> 'new' then
      raise exception 'Order % has been confirmed; it cannot be moved to another customer.',
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
  );

  if not v_legal then
    raise exception 'An order cannot go from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  if old.status = 'dispatched' and new.status in ('cancelled', 'packed')
     and coalesce(current_setting('app.stock_returned', true), '') <> new.id::text then
    raise exception
      'Take a dispatched order back through order_return_undelivered(), so the stock comes with it.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------- RLS

alter table public.dispatches enable row level security;
alter table public.dispatch_lines enable row level security;
alter table public.delivery_documents enable row level security;

drop policy if exists dispatches_select on public.dispatches;
create policy dispatches_select on public.dispatches
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists dispatch_lines_select on public.dispatch_lines;
create policy dispatch_lines_select on public.dispatch_lines
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- A rep sees the paperwork for their own orders — they are the one the shop
-- rings when the delivery note is wrong.
drop policy if exists delivery_documents_select on public.delivery_documents;
create policy delivery_documents_select on public.delivery_documents
  for select using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = delivery_documents.order_id
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  );

-- Only a manager removes a filed document, and only ever a wrong one. The
-- bucket object has to go with it, which the UI does explicitly.
drop policy if exists delivery_documents_delete on public.delivery_documents;
create policy delivery_documents_delete on public.delivery_documents
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

-- Dispatches and their lines are written only by the RPCs below; documents only
-- by delivery_document_register(), so the row and the object cannot disagree.
revoke insert, update, delete on public.dispatches from authenticated, anon;
revoke insert, update, delete on public.dispatch_lines from authenticated, anon;
revoke insert, update on public.delivery_documents from authenticated, anon;

-- ------------------------------------------------------------- order_dispatch

/**
 * Sends a packed order out.
 *
 * Moves every picked allocation from reserved at the warehouse to in_transit,
 * creates the dispatch and its lines, and marks the order dispatched.
 */
create or replace function public.order_dispatch(
  p_order_id uuid,
  p_driver_id uuid default null,
  p_vehicle_id uuid default null,
  p_carrier_name text default null,
  p_tracking_reference text default null,
  p_expected_delivery_on date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_order public.orders;
  v_dispatch_id uuid;
  v_number text;
  v_transit uuid;
  v_reg text;
  v_alloc record;
  v_total integer := 0;
  v_lines integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_role is null or v_role not in ('manager', 'warehouse') then
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
  if v_order.status <> 'packed' then
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
  if p_vehicle_id is not null then
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
$$;

-- ------------------------------------------------------- order_mark_delivered

/**
 * Records that a consignment arrived.
 *
 * p_lines is [{"dispatch_line_id": uuid, "qty_delivered": int}]; omit it and
 * everything is delivered in full. Anything not delivered comes back to the
 * warehouse as available stock in the same transaction — a short delivery is
 * not a reason for units to go missing from the ledger.
 */
create or replace function public.order_mark_delivered(
  p_dispatch_id uuid,
  p_received_by_name text,
  p_delivered_at timestamptz default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_dispatch public.dispatches;
  v_order public.orders;
  v_line record;
  v_delivered integer;
  v_back integer;
  v_total_delivered integer := 0;
  v_total_back integer := 0;
  v_when timestamptz;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can record a delivery.' using errcode = '42501';
  end if;
  if p_received_by_name is null or btrim(p_received_by_name) = '' then
    raise exception 'Who took delivery? A name is what makes the record worth keeping.'
      using errcode = '22023';
  end if;

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

    if v_delivered > 0 then
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
    if v_back > 0 then
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

    update public.order_lines
       set qty_delivered = qty_delivered + v_delivered,
           qty_returned = qty_returned + v_back,
           line_status = case when v_delivered >= qty_ordered then 'fulfilled'
                              when v_delivered > 0 then 'partial'
                              else line_status end
     where id = v_line.order_line_id;

    v_total_delivered := v_total_delivered + v_delivered;
    v_total_back := v_total_back + v_back;
  end loop;

  update public.dispatches
     set status = 'delivered', delivered_at = v_when,
         delivered_by = auth.uid(), received_by_name = btrim(p_received_by_name)
   where id = v_dispatch.id;

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
$$;

-- --------------------------------------------------- order_return_undelivered

/**
 * The delivery did not happen and the goods are back.
 *
 * `p_cancel` decides what becomes of the order: false puts it back to `packed`
 * with its reservations intact, ready to go out again; true cancels it and
 * releases the stock for anyone.
 *
 * This is the only thing that sets `app.stock_returned`, which is what the
 * transition guard demands before it will let an order leave `dispatched`.
 */
create or replace function public.order_return_undelivered(
  p_dispatch_id uuid,
  p_reason text,
  p_cancel boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_dispatch public.dispatches;
  v_order public.orders;
  v_line record;
  v_total integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can record a failed delivery.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the delivery did not happen.' using errcode = '22023';
  end if;

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
   where id = v_dispatch.id;

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
$$;

-- ------------------------------------------------- delivery_document_register

/**
 * Records a document that has already been uploaded to the fulfilment-docs
 * bucket, and is what makes it readable — the storage policy joins to this row.
 *
 * The upload happens first, from the browser, because the bytes should not pass
 * through the database. The object is therefore unreachable until this runs.
 */
create or replace function public.delivery_document_register(
  p_order_id uuid,
  p_doc_type text,
  p_storage_path text,
  p_dispatch_id uuid default null,
  p_file_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_signed_by_name text default null,
  p_signed_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_id uuid;
  v_pod text;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can file a delivery document.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and org_id = v_org) then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;

  -- The path must sit under this organisation's own prefix, which is what the
  -- storage policy checks too. Registering somebody else's object would make it
  -- readable here.
  if p_storage_path is null or p_storage_path not like v_org::text || '/%' then
    raise exception 'A delivery document must be stored under this organisation''s own folder.'
      using errcode = '42501';
  end if;

  insert into public.delivery_documents (
    org_id, order_id, dispatch_id, doc_type, storage_path,
    file_name, mime_type, size_bytes, signed_by_name, signed_at, uploaded_by)
  values (
    v_org, p_order_id, p_dispatch_id, p_doc_type, p_storage_path,
    p_file_name, p_mime_type, p_size_bytes, p_signed_by_name,
    coalesce(p_signed_at, case when p_doc_type = 'pod' then now() end), auth.uid())
  returning id into v_id;

  select pod_status into v_pod from public.orders where id = p_order_id;

  return jsonb_build_object('document_id', v_id, 'order_id', p_order_id,
                            'doc_type', p_doc_type, 'pod_status', v_pod);
end;
$$;

-- ---------------------------------------------------------- outstanding PODs

/**
 * Delivered orders whose signed proof has not been filed.
 *
 * `p_min_days` lets the dashboard separate "delivered an hour ago" from
 * "delivered last week and still nothing", which are different problems.
 */
drop function if exists public.orders_missing_pod(integer);
create or replace function public.orders_missing_pod(p_min_days integer default 0)
returns table (
  order_id uuid,
  order_number text,
  store_name text,
  delivered_at timestamptz,
  days_outstanding integer,
  driver_name text,
  received_by_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org)
  select
    o.id, o.order_number, s.name, o.delivered_at,
    floor(extract(epoch from (now() - o.delivered_at)) / 86400)::integer,
    d.full_name, dp.received_by_name
  from public.orders o
  cross join cfg
  join public.stores s on s.id = o.store_id
  left join lateral (
    select * from public.dispatches x
    where x.order_id = o.id and x.status = 'delivered'
    order by x.delivered_at desc limit 1
  ) dp on true
  left join public.drivers d on d.id = dp.driver_id
  where o.org_id = cfg.org
    and o.pod_status = 'outstanding'
    and o.delivered_at is not null
    and o.delivered_at <= now() - make_interval(days => greatest(p_min_days, 0))
  order by o.delivered_at;
$$;

comment on function public.orders_missing_pod(integer) is
  'Delivered orders with no signed proof of delivery filed, oldest first.';

-- ------------------------------------------------------------------- grants

revoke all on function public.order_dispatch(uuid, uuid, uuid, text, text, date, text) from public, anon;
grant execute on function public.order_dispatch(uuid, uuid, uuid, text, text, date, text) to authenticated;
revoke all on function public.order_mark_delivered(uuid, text, timestamptz, jsonb) from public, anon;
grant execute on function public.order_mark_delivered(uuid, text, timestamptz, jsonb) to authenticated;
revoke all on function public.order_return_undelivered(uuid, text, boolean) from public, anon;
grant execute on function public.order_return_undelivered(uuid, text, boolean) to authenticated;
revoke all on function public.delivery_document_register(uuid, text, text, uuid, text, text, bigint, text, timestamptz) from public, anon;
grant execute on function public.delivery_document_register(uuid, text, text, uuid, text, text, bigint, text, timestamptz) to authenticated;
revoke all on function public.orders_missing_pod(integer) from public, anon;
grant execute on function public.orders_missing_pod(integer) to authenticated;
revoke all on function public.delivery_documents_mark_pod() from public, anon, authenticated;
revoke all on function public.dispatch_lines_enforce_org() from public, anon, authenticated;
