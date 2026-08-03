-- Customer orders, and the audit trail of what happened to each one.
--
-- An order arrives one of two ways: a rep captures it standing in the shop, or
-- a clerk keys it from a WhatsApp message, an email or a phone call. Both land
-- in the same table with a `source` and a `received_via`, because the warehouse
-- does the same work either way and the manager's question — "who took this
-- order?" — has to have one answer.
--
-- This migration is the shape and the guards only. Nothing here moves stock;
-- the RPCs that do come next. That split is deliberate: the tables and the
-- rules about who may change what should be reviewable without reading three
-- hundred lines of reservation arithmetic at the same time.
--
-- ------------------------------------------------------------ the status
--
--   new -> confirmed -> picking -> packed -> dispatched -> delivered
--
-- with cancelled reachable from everything up to and including dispatched, and
-- `delivered` and `cancelled` terminal. Going backwards is allowed within the
-- warehouse (picking -> confirmed, packed -> picking) because a picker who
-- starts too early should be able to put it down again. Going backwards from
-- `dispatched` is not: the goods are on a van, and the only way out is
-- `order_return_undelivered()`, which brings the stock back first.
--
-- ------------------------------------------- why the columns are revoked
--
-- Every timestamp and actor on this table is server-controlled, and so is
-- `status`. RLS cannot express "this column is read-only" — a policy is shown
-- the row, not the diff — so the grant is narrowed instead, exactly as
-- lock_privilege_and_gps_fields did for `profiles.role`.
--
-- Without it, a warehouse user with a perfectly reasonable update policy could
-- PATCH /rest/v1/orders?id=eq.… {"status":"dispatched"} and the stock would
-- never move. The order would show as gone; the warehouse would still have it.
-- That is the single most damaging thing that can happen to this module, and a
-- column grant is the only mechanism that actually prevents it.
--
-- The transition trigger below is the second layer, and it catches what the
-- grant cannot: the service-role key, a seed script, a hand-run UPDATE.
--
-- ------------------------------------------------------ the audit trail
--
-- `order_status_events` is written by a trigger, never by application code, for
-- the reason `security_events` already established here: code that remembers to
-- log is code that eventually forgets. Every path that changes the status —
-- including a direct SQL update by an administrator — leaves a row.

-- ------------------------------------------------------------------ orders

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_number text not null,

  store_id uuid not null references public.stores(id) on delete restrict,
  contact_name text,
  contact_phone text,
  -- Who took it. Null for a clerk-keyed order with no rep involved.
  rep_id uuid references public.profiles(id) on delete set null,

  source text not null,
  received_via text not null default 'other',
  status text not null default 'new',

  fulfil_location_id uuid references public.stock_locations(id) on delete restrict,
  required_by date,

  -- Orthogonal to status: a hold freezes an order wherever it is, rather than
  -- moving it to a "held" state and losing the place it was up to.
  on_hold boolean not null default false,
  hold_reason text,
  held_at timestamptz,
  held_by uuid references public.profiles(id) on delete set null,

  -- Set on the follow-on order when a line is back-ordered, so the two can be
  -- read together.
  parent_order_id uuid references public.orders(id) on delete set null,

  pod_status text not null default 'not_required',
  notes text,
  cancel_reason text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  picking_started_by uuid references public.profiles(id) on delete set null,
  picking_started_at timestamptz,
  packed_by uuid references public.profiles(id) on delete set null,
  packed_at timestamptz,
  dispatched_by uuid references public.profiles(id) on delete set null,
  dispatched_at timestamptz,
  delivered_by uuid references public.profiles(id) on delete set null,
  delivered_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),

  -- The offline idempotency key every rep-writable table here carries. The
  -- phone app is a later phase, but adding this afterwards would mean a
  -- migration against a table that already holds orders.
  client_generated_id uuid not null unique
);

comment on table public.orders is
  'Customer orders, from a rep in the field or a clerk keying a WhatsApp, email or phone order. Status transitions and timestamps are server-controlled.';

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('rep_app', 'warehouse_manual', 'import'));

alter table public.orders drop constraint if exists orders_received_via_check;
alter table public.orders add constraint orders_received_via_check
  check (received_via in ('rep_visit', 'whatsapp', 'email', 'phone', 'in_person', 'other'));

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('new', 'confirmed', 'picking', 'packed', 'dispatched',
                    'delivered', 'cancelled'));

alter table public.orders drop constraint if exists orders_pod_status_check;
alter table public.orders add constraint orders_pod_status_check
  check (pod_status in ('not_required', 'outstanding', 'received'));

alter table public.orders drop constraint if exists orders_hold_has_reason;
alter table public.orders add constraint orders_hold_has_reason
  check (on_hold = false or hold_reason is not null);

alter table public.orders drop constraint if exists orders_cancel_has_reason;
alter table public.orders add constraint orders_cancel_has_reason
  check (status <> 'cancelled' or cancel_reason is not null);

-- Everything past 'new' is being fulfilled from somewhere.
alter table public.orders drop constraint if exists orders_fulfil_location_set;
alter table public.orders add constraint orders_fulfil_location_set
  check (status in ('new', 'cancelled') or fulfil_location_id is not null);

-- An order cannot be its own parent, which is the one self-reference a
-- back-order chain could plausibly produce by accident.
alter table public.orders drop constraint if exists orders_parent_not_self;
alter table public.orders add constraint orders_parent_not_self
  check (parent_order_id is null or parent_order_id <> id);

create unique index if not exists orders_org_number_key
  on public.orders (org_id, order_number);
create index if not exists orders_org_status_idx
  on public.orders (org_id, status, created_at desc);
create index if not exists orders_store_idx
  on public.orders (org_id, store_id, created_at desc);
create index if not exists orders_rep_idx
  on public.orders (rep_id, created_at desc) where rep_id is not null;
-- The "whose proof of delivery is missing" scan.
create index if not exists orders_outstanding_pod_idx
  on public.orders (org_id, delivered_at) where pod_status = 'outstanding';

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- order_lines

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,

  qty_ordered integer not null,
  -- Open reservation. Falls back to zero as stock is dispatched, so this is
  -- "still held for this line", not "ever held".
  qty_reserved integer not null default 0,
  qty_picked integer not null default 0,
  qty_dispatched integer not null default 0,
  qty_delivered integer not null default 0,
  qty_returned integer not null default 0,

  unit_price numeric(12,2),
  line_status text not null default 'open',

  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

comment on column public.order_lines.qty_reserved is
  'Currently held for this line. Decremented on dispatch, so a back-ordered line can be reserved again later without the constraint below tripping.';

alter table public.order_lines drop constraint if exists order_lines_status_check;
alter table public.order_lines add constraint order_lines_status_check
  check (line_status in ('open', 'partial', 'fulfilled', 'backordered', 'cancelled'));

alter table public.order_lines drop constraint if exists order_lines_qty_non_negative;
alter table public.order_lines add constraint order_lines_qty_non_negative
  check (
    qty_ordered > 0
    and qty_reserved >= 0 and qty_picked >= 0 and qty_dispatched >= 0
    and qty_delivered >= 0 and qty_returned >= 0
  );

-- Never hold or ship more than was asked for. Open reservation plus what has
-- already gone out is the thing that must not exceed the order.
alter table public.order_lines drop constraint if exists order_lines_not_over_ordered;
alter table public.order_lines add constraint order_lines_not_over_ordered
  check (qty_reserved + qty_dispatched <= qty_ordered);

alter table public.order_lines drop constraint if exists order_lines_picked_within_held;
alter table public.order_lines add constraint order_lines_picked_within_held
  check (qty_picked <= qty_reserved + qty_dispatched);

alter table public.order_lines drop constraint if exists order_lines_delivered_within_dispatched;
alter table public.order_lines add constraint order_lines_delivered_within_dispatched
  check (qty_delivered <= qty_dispatched and qty_returned <= qty_dispatched);

-- One line per product per order. Two lines for the same SKU is a data-entry
-- slip that makes the picking list contradict itself.
create unique index if not exists order_lines_order_product_key
  on public.order_lines (order_id, product_id);
create index if not exists order_lines_product_idx
  on public.order_lines (org_id, product_id);

-- ------------------------------------------------------- order_allocations

create table if not exists public.order_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_line_id uuid not null references public.order_lines(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete restrict,

  qty_reserved integer not null default 0,
  qty_picked integer not null default 0,
  qty_dispatched integer not null default 0,
  status text not null default 'reserved',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.order_allocations is
  'Which batch, at which location, is held for which order line. Reconstructible from the ledger; kept as a working set so the picking list and a partial release are one query.';

alter table public.order_allocations drop constraint if exists order_allocations_status_check;
alter table public.order_allocations add constraint order_allocations_status_check
  check (status in ('reserved', 'picked', 'dispatched', 'released'));

alter table public.order_allocations drop constraint if exists order_allocations_qty_check;
alter table public.order_allocations add constraint order_allocations_qty_check
  check (qty_reserved >= 0 and qty_picked >= 0 and qty_dispatched >= 0);

create index if not exists order_allocations_order_idx
  on public.order_allocations (order_id);
create index if not exists order_allocations_line_idx
  on public.order_allocations (order_line_id);
create index if not exists order_allocations_open_idx
  on public.order_allocations (org_id, location_id)
  where status in ('reserved', 'picked');

drop trigger if exists order_allocations_set_updated_at on public.order_allocations;
create trigger order_allocations_set_updated_at
  before update on public.order_allocations
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ order_status_events

create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  note text,
  detail jsonb,
  created_at timestamptz not null default now()
);

comment on table public.order_status_events is
  'Append-only trail of every status change on an order. Written only by a trigger, so no code path can forget to record one.';

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, created_at);

-- ------------------------------------------------------------- the guards

/**
 * Children belong to the same organisation as their parent order.
 *
 * Foreign keys prove the rows exist, not that they are ours. Also stops a line
 * being filed under an order in another tenant, which would put somebody else's
 * product on our picking list.
 */
create or replace function public.order_children_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.orders where id = new.order_id;
  if v_org is distinct from new.org_id then
    raise exception 'That order belongs to another organisation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists order_lines_org_guard on public.order_lines;
create trigger order_lines_org_guard
  before insert or update on public.order_lines
  for each row execute function public.order_children_enforce_org();

drop trigger if exists order_allocations_org_guard on public.order_allocations;
create trigger order_allocations_org_guard
  before insert or update on public.order_allocations
  for each row execute function public.order_children_enforce_org();

/**
 * The status graph, enforced.
 *
 * The column grant below stops a signed-in user setting `status` at all. This
 * catches everything else: the service-role key, a seed script, a hand-run
 * UPDATE in the SQL editor, and the fulfilment RPCs themselves.
 *
 * Leaving `dispatched` for `cancelled` is the one transition that is legal in
 * the graph and still refused here unless `order_return_undelivered()` has said
 * it brought the stock back. Without that, cancelling a dispatched order would
 * leave the goods on a van with nothing in the ledger to say where they went.
 */
create or replace function public.orders_enforce_transition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_legal boolean;
begin
  -- Not a transition. Still refuse the two reassignments that would rewrite
  -- what an order *is* rather than where it has got to.
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
    ('dispatched', 'delivered'),('dispatched', 'cancelled')
  );

  if not v_legal then
    raise exception 'An order cannot go from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  if old.status = 'dispatched' and new.status = 'cancelled'
     and coalesce(current_setting('app.stock_returned', true), '') <> new.id::text then
    raise exception
      'Cancel a dispatched order through order_return_undelivered(), so the stock comes back.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_transition_guard on public.orders;
create trigger orders_transition_guard
  before update on public.orders
  for each row execute function public.orders_enforce_transition();

/**
 * Records every status change, without anything having to remember to.
 */
create or replace function public.orders_log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events
      (org_id, order_id, from_status, to_status, actor_id, detail)
    values (new.org_id, new.id, null, new.status, auth.uid(),
            jsonb_build_object('source', new.source, 'received_via', new.received_via,
                               'via', current_user));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_events
      (org_id, order_id, from_status, to_status, actor_id, note, detail)
    values (new.org_id, new.id, old.status, new.status, auth.uid(),
            case when new.status = 'cancelled' then new.cancel_reason else null end,
            jsonb_build_object('via', current_user));
  end if;

  -- A hold is not a status change but it is exactly the kind of thing somebody
  -- will later ask "when did that happen, and who?" about.
  if new.on_hold is distinct from old.on_hold then
    insert into public.order_status_events
      (org_id, order_id, from_status, to_status, actor_id, note, detail)
    values (new.org_id, new.id, new.status, new.status, auth.uid(),
            new.hold_reason,
            jsonb_build_object('on_hold', new.on_hold, 'via', current_user));
  end if;

  return new;
end;
$$;

drop trigger if exists orders_log_status on public.orders;
create trigger orders_log_status
  after insert or update on public.orders
  for each row execute function public.orders_log_status_change();

-- --------------------------------------------- goods_receipts back-reference
--
-- A customer return is a goods receipt that points at the order it came back
-- from. The column could not be created with that table, because `orders` did
-- not exist yet.

alter table public.goods_receipts
  add column if not exists source_order_id uuid references public.orders(id) on delete set null;

comment on column public.goods_receipts.source_order_id is
  'For receipt_type = customer_return: the order the goods went out on.';

create index if not exists goods_receipts_source_order_idx
  on public.goods_receipts (source_order_id) where source_order_id is not null;

-- ---------------------------------------------------------------------- RLS

alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_allocations enable row level security;
alter table public.order_status_events enable row level security;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) in ('manager', 'warehouse')
      or rep_id = (select auth.uid())
    )
  );

-- Pinned to the caller and to the source, exactly as visits_insert is. A rep
-- cannot book an order as somebody else, and cannot pass their own capture off
-- as a clerk's manual entry — which would hide it from the "who took this
-- order?" question the audit trail exists to answer.
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert with check (
    org_id = (select public.current_org_id())
    and status = 'new'
    and (
      (
        (select public."current_role"()) = 'rep'
        and rep_id = (select auth.uid())
        and source = 'rep_app'
      )
      or (
        (select public."current_role"()) in ('manager', 'warehouse')
        and source in ('warehouse_manual', 'import')
      )
    )
  );

-- Governs contact details, the required-by date and notes. Everything that
-- decides stock or status is revoked below, because a policy sees the row and
-- not the diff. A rep may correct their own order until it is confirmed; after
-- that it is a promise made to a customer.
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) in ('manager', 'warehouse')
      or (rep_id = (select auth.uid()) and status = 'new')
    )
  ) with check (
    org_id = (select public.current_org_id())
  );

-- No delete policy. An order that was placed is a record of a customer asking
-- for something, and 'cancelled' is the answer to that, not erasure.

drop policy if exists order_lines_select on public.order_lines;
create policy order_lines_select on public.order_lines
  for select using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  );

drop policy if exists order_lines_insert on public.order_lines;
create policy order_lines_insert on public.order_lines
  for insert with check (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and o.status = 'new'
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  );

drop policy if exists order_lines_update on public.order_lines;
create policy order_lines_update on public.order_lines
  for update using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and o.status = 'new'
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  ) with check (
    org_id = (select public.current_org_id())
  );

drop policy if exists order_lines_delete on public.order_lines;
create policy order_lines_delete on public.order_lines
  for delete using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and o.status = 'new'
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  );

-- Allocations are the ledger's working set. Read-only to everyone; the
-- fulfilment RPCs are the only writers.
drop policy if exists order_allocations_select on public.order_allocations;
create policy order_allocations_select on public.order_allocations
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists order_status_events_select on public.order_status_events;
create policy order_status_events_select on public.order_status_events
  for select using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_status_events.order_id
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  );

-- ----------------------------------------------------- column-level grants
--
-- The load-bearing part. See the header.

revoke update on public.orders from authenticated, anon;
grant update (
  store_id, contact_name, contact_phone, received_via,
  required_by, notes, updated_at
) on public.orders to authenticated;

revoke update on public.order_lines from authenticated, anon;
grant update (qty_ordered, unit_price) on public.order_lines to authenticated;

-- Allocations and the event log are written by definer functions and triggers
-- only. No policy, no privilege.
revoke insert, update, delete on public.order_allocations from authenticated, anon;
revoke insert, update, delete on public.order_status_events from authenticated, anon;
