-- Products, promotions, and whether the promotion is actually running.
--
-- The audit form asks "was **our product** in stock" and "how many facings does
-- **our product** have" — one boolean and one number for the entire range — and
-- records out-of-stock lines as free text a rep types. `oos_hotspots` already
-- parses `top_skus` out of that text, so the moment one rep writes "Coke 500ml"
-- and another writes "coca-cola 500ML" the report counts two different
-- products. You cannot count what you cannot identify.
--
-- A promotion makes that unavoidable, because a promotion is about specific
-- lines. So the SKU list comes first and everything else hangs off it.

-- Shaped from the customer's own price card, which is the document this data
-- actually arrives in.
create table if not exists public.products (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  -- The price card's DETAIL column, e.g.
  -- "OKSO/ELF BOX DIGITAL 12000 (5%) BLUE RAZZ ICE".
  name      text not null,
  brand     text,
  category  text,
  -- Two barcodes, and the distinction matters. The unit barcode is what is on
  -- the item a shopper picks up and therefore what a rep would scan at a shelf;
  -- the shrink barcode is on the outer the store receives. Conflating them
  -- would make a scan match nothing.
  unit_barcode   text,
  shrink_barcode text,
  -- How many sellable units are in a shrink: 10 for the vape lines, 5 for the
  -- pouches. An integer rather than the card's "10 UNITS" string, because it
  -- gets multiplied.
  units_per_shrink int,
  -- The trade price of a shrink, from the price card.
  --
  -- Explicitly *not* the shelf price. Per-unit selling prices differ from store
  -- to store, which is why the audit already asks a rep what the shelf price
  -- is on the day. Naming these for the shrink keeps the two from being
  -- confused later by someone reading a column called "price".
  shrink_price_excl_vat numeric(12, 2),
  shrink_price_incl_vat numeric(12, 2),
  -- The customer's own code, when they have one. This price card carries none —
  -- barcodes are the identifier here — but other customers will.
  sku_code  text,
  active    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_org_name_idx on public.products (org_id, name);

-- Import matches on these to decide insert-or-update, so each has to be unique
-- within an org where it is set. Partial, because all three are optional and
-- several blanks must not collide.
create unique index if not exists products_org_sku_code_idx
  on public.products (org_id, sku_code)
  where sku_code is not null and sku_code <> '';
create unique index if not exists products_org_unit_barcode_idx
  on public.products (org_id, unit_barcode)
  where unit_barcode is not null and unit_barcode <> '';
create unique index if not exists products_org_shrink_barcode_idx
  on public.products (org_id, shrink_barcode)
  where shrink_barcode is not null and shrink_barcode <> '';

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- A promotion running at a set of outlets, for a window of dates.
--
-- Called "projects" because that is the word on the sidebar and in the
-- customer's head; every column here is about a promotion.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  -- What the rep should be looking for. Shown on the phone above the products.
  brief       text,
  starts_on   date not null,
  ends_on     date not null,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.projects drop constraint if exists projects_dates_check;
alter table public.projects add constraint projects_dates_check
  check (ends_on >= starts_on);

create index if not exists projects_org_window_idx
  on public.projects (org_id, starts_on, ends_on);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Which lines the promotion covers.
create table if not exists public.project_products (
  project_id uuid not null references public.projects(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (project_id, product_id)
);

create index if not exists project_products_product_idx
  on public.project_products (product_id);

-- Which outlets it runs at.
--
-- Stores are listed individually even when chosen a chain at a time. Resolving
-- a chain at read time would silently change which stores a past promotion
-- covered whenever a store moved group, and then the compliance figures for a
-- finished promotion would drift after the fact.
create table if not exists public.project_stores (
  project_id uuid not null references public.projects(id) on delete cascade,
  store_id   uuid not null references public.stores(id) on delete cascade,
  primary key (project_id, store_id)
);

create index if not exists project_stores_store_idx
  on public.project_stores (store_id);

-- The rep's answer: is this promotion actually running on this line, here?
--
-- Three states rather than two. A rep who finds the shop has never stocked the
-- line is not reporting a failed promotion, and forcing that into "no" would
-- quietly turn a ranging gap into a compliance problem — two different
-- conversations with two different people.
create table if not exists public.project_checks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  visit_id    uuid references public.visits(id) on delete set null,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  status      text not null,
  note        text,
  checked_at  timestamptz not null default now(),
  -- Offline idempotency, same contract as visits and photos: the phone mints
  -- this before it has any connection and a replay upserts rather than
  -- duplicating.
  client_generated_id uuid not null unique,
  created_at  timestamptz not null default now()
);

alter table public.project_checks drop constraint if exists project_checks_status_check;
alter table public.project_checks add constraint project_checks_status_check
  check (status in ('running', 'not_running', 'not_stocked'));

create index if not exists project_checks_project_idx
  on public.project_checks (project_id, store_id);
create index if not exists project_checks_org_checked_idx
  on public.project_checks (org_id, checked_at desc);

alter table public.products enable row level security;
alter table public.projects enable row level security;
alter table public.project_products enable row level security;
alter table public.project_stores enable row level security;
alter table public.project_checks enable row level security;

-- Products and promotions: everyone in the org reads, managers write. Reps must
-- read them or the phone has nothing to show.
create policy products_select on public.products
  for select using (org_id = (select public.current_org_id()));
create policy products_write on public.products
  for all using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  ) with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy projects_select on public.projects
  for select using (org_id = (select public.current_org_id()));
create policy projects_write on public.projects
  for all using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  ) with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

-- The join tables scope through their parent project. The subquery reads
-- `projects`, whose own policy does not read back here, so there is no cycle —
-- unlike the files/file_reps pair that produced "infinite recursion detected in
-- policy" and had to be moved into a security-definer function.
create policy project_products_select on public.project_products
  for select using (
    exists (select 1 from public.projects p
             where p.id = project_products.project_id
               and p.org_id = (select public.current_org_id()))
  );
create policy project_products_write on public.project_products
  for all using (
    (select public.current_role()) = 'manager'
    and exists (select 1 from public.projects p
                 where p.id = project_products.project_id
                   and p.org_id = (select public.current_org_id()))
  ) with check (
    (select public.current_role()) = 'manager'
    and exists (select 1 from public.projects p
                 where p.id = project_products.project_id
                   and p.org_id = (select public.current_org_id()))
  );

create policy project_stores_select on public.project_stores
  for select using (
    exists (select 1 from public.projects p
             where p.id = project_stores.project_id
               and p.org_id = (select public.current_org_id()))
  );
create policy project_stores_write on public.project_stores
  for all using (
    (select public.current_role()) = 'manager'
    and exists (select 1 from public.projects p
                 where p.id = project_stores.project_id
                   and p.org_id = (select public.current_org_id()))
  ) with check (
    (select public.current_role()) = 'manager'
    and exists (select 1 from public.projects p
                 where p.id = project_stores.project_id
                   and p.org_id = (select public.current_org_id()))
  );

-- Checks: a manager sees the org's, a rep sees their own. A rep writes only
-- their own, and cannot edit one after the fact — a confirmation is a statement
-- about a moment, and correcting it belongs to the next visit, not to a rewrite.
create policy project_checks_select on public.project_checks
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy project_checks_insert on public.project_checks
  for insert with check (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );

comment on table public.products is
  'The SKU list. Exists so an out-of-stock report or a promotion can name a line rather than describing it in free text.';
comment on table public.projects is
  'A promotion running at a set of outlets over a window of dates. Rides on the visits the call cycle already plans rather than scheduling its own.';
comment on table public.project_stores is
  'Outlets a promotion covers, listed individually even when picked a chain at a time, so a finished promotion''s coverage cannot change afterwards when a store moves group.';
comment on column public.project_checks.status is
  'running = promotion is up on this line here; not_running = it should be and is not; not_stocked = this outlet does not carry the line at all, which is a ranging question rather than a compliance failure.';
