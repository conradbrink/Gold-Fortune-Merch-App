-- The things stock belongs to, and the people and vehicles that move it.
--
-- Four tables, none of which hold a quantity. They exist first because the
-- ledger that follows points at them, and because getting the shape of a
-- "place" wrong is the one mistake here that cannot be corrected later without
-- rewriting every movement ever posted.
--
-- ---------------------------------------------------------------- locations
--
-- The business has one warehouse. This models it generically anyway, as a typed
-- location, because the requirement is explicit that stock must be able to move
-- "between warehouses, vehicles or sales representatives" — and the difference
-- between a schema that can express a van and one that cannot is a migration
-- against a live ledger, which is the worst kind to need.
--
-- The cost of the generality is one join and one column that is always the same
-- value until the day it isn't. That is a small price. The UI hides the location
-- picker while only one location exists, so nobody is asked to choose between
-- one thing.
--
-- A vehicle location and a vehicle are separate rows on purpose. `vehicles` is
-- the fleet record — registration, licence, who may drive it. The location is
-- the *stock* that happens to be aboard. Merging them would mean a lorry that
-- has never carried our stock still owns a balance row, and retiring one would
-- mean deleting stock history.
--
-- ------------------------------------------------------------ drivers, not users
--
-- Drivers have no login. That was decided deliberately: a driver's entire
-- interaction with this system is being named on a dispatch and having a signed
-- page photographed on their behalf, and an account is a credential to leak, a
-- password to reset and a seat to pay for in exchange for nothing. `drivers`
-- carries no `profile_id` today; adding one later is an additive column, which
-- is the direction that stays cheap.

-- ------------------------------------------------------------------ drivers

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  phone text,
  id_number text,
  licence_number text,
  licence_expires_on date,
  -- Soft delete, as everywhere else here: a driver who has left still appears
  -- on every dispatch they ever made, and the delivery history has to keep
  -- naming them.
  active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.drivers is
  'People who deliver orders. Deliberately not user accounts — a driver is named on a dispatch, not signed in.';

create index if not exists drivers_org_idx
  on public.drivers (org_id, active, full_name);

drop trigger if exists drivers_set_updated_at on public.drivers;
create trigger drivers_set_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- vehicles

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  registration text not null,
  description text,
  make_model text,
  capacity_note text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vehicles is
  'The delivery fleet. A vehicle is the asset; the stock aboard it is a stock_locations row of type ''vehicle''.';

-- Case-insensitive, because a registration keyed as "b 123 abc" and "B 123 ABC"
-- is the same lorry and the second one would otherwise open a second stock
-- location holding half the van's contents.
create unique index if not exists vehicles_org_registration_key
  on public.vehicles (org_id, upper(registration));

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- stock_locations

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  type text not null,
  -- Set for exactly one type each; see the shape checks below.
  vehicle_id uuid references public.vehicles(id) on delete restrict,
  rep_id uuid references public.profiles(id) on delete restrict,
  address text,
  -- Where an order is fulfilled from unless told otherwise, and where a GRN
  -- lands by default. Exactly one per org.
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_locations is
  'Anywhere stock can be. A warehouse, a delivery vehicle, or a rep carrying samples. Balances and movements are keyed on these.';

alter table public.stock_locations drop constraint if exists stock_locations_type_check;
alter table public.stock_locations add constraint stock_locations_type_check
  check (type in ('warehouse', 'vehicle', 'rep'));

-- A location is what it says it is. Both directions are asserted — `= (… is not
-- null)` rather than a one-way implication — so a warehouse cannot quietly
-- carry a vehicle_id, which would make "which van is this stock on" ambiguous
-- for the one row where it matters.
alter table public.stock_locations drop constraint if exists stock_locations_vehicle_shape;
alter table public.stock_locations add constraint stock_locations_vehicle_shape
  check ((type = 'vehicle') = (vehicle_id is not null));

alter table public.stock_locations drop constraint if exists stock_locations_rep_shape;
alter table public.stock_locations add constraint stock_locations_rep_shape
  check ((type = 'rep') = (rep_id is not null));

create unique index if not exists stock_locations_org_name_key
  on public.stock_locations (org_id, lower(name));

-- One stock location per vehicle and per rep. Two would split the same physical
-- stock across two balances with no way to tell which was real.
create unique index if not exists stock_locations_vehicle_key
  on public.stock_locations (vehicle_id) where vehicle_id is not null;
create unique index if not exists stock_locations_rep_key
  on public.stock_locations (rep_id) where rep_id is not null;

create unique index if not exists stock_locations_one_default
  on public.stock_locations (org_id) where is_default;

create index if not exists stock_locations_org_type_idx
  on public.stock_locations (org_id, type, active);

drop trigger if exists stock_locations_set_updated_at on public.stock_locations;
create trigger stock_locations_set_updated_at
  before update on public.stock_locations
  for each row execute function public.set_updated_at();

/**
 * A vehicle or rep location must belong to the same organisation as the vehicle
 * or rep it names.
 *
 * A foreign key proves the row exists, not that it is ours. The same hole
 * `territory_reps_enforce_org()` was written to close: without this, a location
 * in org A could point at org B's van, and stock would be transferable across
 * the tenant boundary through a legitimate-looking transfer.
 */
create or replace function public.stock_locations_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_other_org uuid;
begin
  if new.vehicle_id is not null then
    select org_id into v_other_org from public.vehicles where id = new.vehicle_id;
    if v_other_org is distinct from new.org_id then
      raise exception 'That vehicle belongs to another organisation.'
        using errcode = '42501';
    end if;
  end if;

  if new.rep_id is not null then
    select org_id into v_other_org from public.profiles where id = new.rep_id;
    if v_other_org is distinct from new.org_id then
      raise exception 'That person belongs to another organisation.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists stock_locations_org_guard on public.stock_locations;
create trigger stock_locations_org_guard
  before insert or update on public.stock_locations
  for each row execute function public.stock_locations_enforce_org();

-- ---------------------------------------------------------------- suppliers

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  account_ref text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.suppliers is
  'Who stock is bought from. Goods received notes also snapshot the name, so renaming a supplier does not rewrite past receipts.';

create unique index if not exists suppliers_org_name_key
  on public.suppliers (org_id, lower(name));

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS
--
-- Reps can see stock locations and nothing else here. They need the list so a
-- van or their own name can be shown against stock they are carrying; they have
-- no business knowing who we buy from or who drives.

alter table public.stock_locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;

drop policy if exists stock_locations_select on public.stock_locations;
create policy stock_locations_select on public.stock_locations
  for select using (org_id = (select public.current_org_id()));

-- Creating a place stock can live is a structural decision with a permanent
-- effect on every report, so it stays with managers even though the clerk runs
-- everything that happens inside it.
drop policy if exists stock_locations_insert on public.stock_locations;
create policy stock_locations_insert on public.stock_locations
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists stock_locations_update on public.stock_locations;
create policy stock_locations_update on public.stock_locations
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  ) with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

-- No delete policy on any of these four, deliberately. A location with history
-- cannot be removed without removing the history; `active = false` is the
-- retirement, and the ledger's `on delete restrict` is the backstop.

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists drivers_select on public.drivers;
create policy drivers_select on public.drivers
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists drivers_insert on public.drivers;
create policy drivers_insert on public.drivers
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists drivers_update on public.drivers;
create policy drivers_update on public.drivers
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- ---------------------------------------------------------------- seed
--
-- Every organisation gets one warehouse, so that the ledger, goods receipts and
-- orders all have somewhere to point on the day they are created and nobody has
-- to complete a setup form before the module will run at all.
--
-- Idempotent by the org's own default: an org that already has a default
-- location is left alone, so re-running this cannot mint a second one (and the
-- partial unique index would refuse it anyway).

insert into public.stock_locations (org_id, name, code, type, is_default)
select o.id, 'Main Warehouse', 'MAIN', 'warehouse', true
from public.organizations o
where not exists (
  select 1 from public.stock_locations l
  where l.org_id = o.id and l.is_default
);
