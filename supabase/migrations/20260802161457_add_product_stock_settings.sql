-- What a product needs to know before it can be counted.
--
-- `products` has been a catalogue: identity, barcodes, pack maths and a trade
-- price. Nothing on it says whether we hold any, how little is too little, or
-- whether a unit of it can be told apart from the next one. This adds those
-- three things, and the batch table that the third implies.
--
-- ------------------------------------------------------- units, and one trap
--
-- Every quantity in this module is an integer count of the base sellable unit —
-- the thing the `unit_barcode` scans. Not shrinks, not cases. The conversion
-- happens once, at the edge, when a goods received note is posted, and the
-- factor used is written onto that receipt line rather than looked up later.
--
-- That last part matters more than it looks. `units_per_shrink` is editable. If
-- a report multiplied a historical receipt by today's pack size, then correcting
-- a product from 10-per-shrink to 12 would silently restate every delivery ever
-- taken. `unit_of_measure` here is only the default the capture form offers.
--
-- ------------------------------------------------------------------ batches
--
-- `is_batch_tracked` is off by default, and most lines will leave it off. A
-- tracked product gets one balance row per batch and is reserved and picked
-- first-expiry-first-out; an untracked one lives permanently on a single
-- `batch_id is null` row. Both are the same table and the same code path — the
-- flag decides whether a batch is demanded at receipt, not whether a different
-- mechanism runs.
--
-- Turning the flag on for a product that already holds untracked stock is
-- legitimate and leaves that stock where it is, on the null-batch row, to be
-- drawn down after every dated batch (the FEFO sort puts nulls last). It does
-- not need a backfill and must not get one — inventing a batch number for stock
-- whose real batch nobody recorded would be a lie with an expiry date on it.

-- --------------------------------------------------------- products, widened

alter table public.products
  add column if not exists is_stock_tracked boolean not null default true,
  add column if not exists is_batch_tracked boolean not null default false,
  add column if not exists min_stock_level integer,
  add column if not exists reorder_point integer,
  add column if not exists reorder_qty integer,
  add column if not exists unit_of_measure text not null default 'each';

comment on column public.products.is_stock_tracked is
  'Off for anything sold without a balance being kept — services, printed matter. An untracked product cannot be received, reserved or counted.';
comment on column public.products.is_batch_tracked is
  'On means every receipt must name a batch and expiry, and stock is reserved first-expiry-first-out. Off means one balance row per location.';
comment on column public.products.min_stock_level is
  'Below this is a shortage worth an alert. Null means no floor has been set.';
comment on column public.products.reorder_point is
  'At or below this, buy more. Sits at or above the minimum: the point is to reorder *before* the floor is breached, not when it already has been.';
comment on column public.products.unit_of_measure is
  'The default unit the receiving form offers. Balances are always in base sellable units regardless.';

alter table public.products drop constraint if exists products_unit_of_measure_check;
alter table public.products add constraint products_unit_of_measure_check
  check (unit_of_measure in ('each', 'shrink', 'case'));

alter table public.products drop constraint if exists products_stock_levels_non_negative;
alter table public.products add constraint products_stock_levels_non_negative
  check (
    (min_stock_level is null or min_stock_level >= 0)
    and (reorder_point is null or reorder_point >= 0)
    and (reorder_qty is null or reorder_qty > 0)
  );

-- A reorder point below the minimum would fire the alert after the shortage it
-- exists to prevent. Only asserted when both are set, so either can be used
-- alone.
alter table public.products drop constraint if exists products_reorder_point_above_min;
alter table public.products add constraint products_reorder_point_above_min
  check (
    min_stock_level is null or reorder_point is null
    or reorder_point >= min_stock_level
  );

-- --------------------------------------------------------- product_batches

create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_number text not null,
  expiry_date date,
  manufactured_on date,
  -- Stamped by the first receipt that brought this batch in, for stock ageing.
  first_received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.product_batches is
  'A distinguishable lot of one product. Created by goods receipt, never by hand; balances and movements point at it.';

alter table public.product_batches drop constraint if exists product_batches_dates_sane;
alter table public.product_batches add constraint product_batches_dates_sane
  check (
    manufactured_on is null or expiry_date is null
    or expiry_date >= manufactured_on
  );

-- Case-insensitive per product: "LOT-2026-04" and "lot-2026-04" are one batch,
-- and two rows would split its stock across two balances that nobody could
-- reconcile.
create unique index if not exists product_batches_product_number_key
  on public.product_batches (org_id, product_id, lower(batch_number));

-- The "what is going off" scan.
create index if not exists product_batches_expiry_idx
  on public.product_batches (org_id, expiry_date)
  where expiry_date is not null;

/**
 * A batch belongs to the same organisation as its product.
 *
 * The foreign key proves the product exists; it does not prove it is ours. Same
 * hole, same fix, as the location guard in the previous migration.
 */
create or replace function public.product_batches_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_org uuid;
begin
  select org_id into v_product_org from public.products where id = new.product_id;
  if v_product_org is distinct from new.org_id then
    raise exception 'That product belongs to another organisation.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists product_batches_org_guard on public.product_batches;
create trigger product_batches_org_guard
  before insert or update on public.product_batches
  for each row execute function public.product_batches_enforce_org();

-- ------------------------------------------------- product_location_settings

create table if not exists public.product_location_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  min_stock_level integer,
  reorder_point integer,
  reorder_qty integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_location_settings is
  'Per-site override of a product''s minimum and reorder point. The alert reads this first and falls back to the product default.';

alter table public.product_location_settings
  drop constraint if exists product_location_settings_levels_non_negative;
alter table public.product_location_settings
  add constraint product_location_settings_levels_non_negative
  check (
    (min_stock_level is null or min_stock_level >= 0)
    and (reorder_point is null or reorder_point >= 0)
    and (reorder_qty is null or reorder_qty > 0)
  );

alter table public.product_location_settings
  drop constraint if exists product_location_settings_reorder_above_min;
alter table public.product_location_settings
  add constraint product_location_settings_reorder_above_min
  check (
    min_stock_level is null or reorder_point is null
    or reorder_point >= min_stock_level
  );

create unique index if not exists product_location_settings_key
  on public.product_location_settings (org_id, product_id, location_id);

drop trigger if exists product_location_settings_set_updated_at
  on public.product_location_settings;
create trigger product_location_settings_set_updated_at
  before update on public.product_location_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS
--
-- Batches are readable by everyone in the org — a rep's van stock will name one
-- — but written only by the goods-receipt RPC, which runs as definer. There is
-- deliberately no insert, update or delete policy: a batch conjured by hand
-- would be a lot number with no delivery behind it.

alter table public.product_batches enable row level security;
alter table public.product_location_settings enable row level security;

drop policy if exists product_batches_select on public.product_batches;
create policy product_batches_select on public.product_batches
  for select using (org_id = (select public.current_org_id()));

drop policy if exists product_location_settings_select on public.product_location_settings;
create policy product_location_settings_select on public.product_location_settings
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- Reorder policy is a buying decision, so it stays with managers — the same
-- line drawn for creating a stock location.
drop policy if exists product_location_settings_insert on public.product_location_settings;
create policy product_location_settings_insert on public.product_location_settings
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists product_location_settings_update on public.product_location_settings;
create policy product_location_settings_update on public.product_location_settings
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  ) with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists product_location_settings_delete on public.product_location_settings;
create policy product_location_settings_delete on public.product_location_settings
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );
