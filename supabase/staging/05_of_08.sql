-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 5 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260729084849_create_products_and_projects.sql
--    .. through 20260729151556_lock_privilege_and_gps_fields.sql
--
-- Run the chunks in order.
--
-- Wrapped in a transaction, so a statement that fails should take the
-- whole chunk back out with it. That is a *should*: supabase/README.md
-- records a 377 KB script that failed and had partly applied anyway,
-- so the editor cannot be assumed to honour it. The per-migration
-- stamps and 99_resume.sql are still the authority on what landed —
-- check them rather than re-running blind.
-- ──────────────────────────────────────────────────────────────────────────

begin;
-- ──────────────────────────────────────────────────────────────────────────
-- 49/76  20260729084849_create_products_and_projects.sql
-- ──────────────────────────────────────────────────────────────────────────

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

drop trigger if exists products_set_updated_at on public.products;
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

drop trigger if exists projects_set_updated_at on public.projects;
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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729084849', 'create_products_and_projects')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 50/76  20260729085516_create_project_report_rpcs.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What a promotion is doing, at two levels of zoom.
--
-- Both follow the house pattern: aggregate before joining, so a project row
-- cannot fan out across its stores and products. Two earlier reports in this
-- schema needed corrective migrations for exactly that, and a promotion has
-- three collections hanging off it rather than one.

-- The list view: one row per promotion.
create or replace function public.project_summaries()
returns table (
  project_id     uuid,
  name           text,
  brief          text,
  starts_on      date,
  ends_on        date,
  active         boolean,
  products       int,
  stores         int,
  -- Covered stores where every listed product has an answer.
  stores_checked int,
  -- Covered stores where at least one product came back running.
  stores_running int,
  last_checked_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  prod as (
    select pp.project_id, count(*)::int as n
    from project_products pp group by pp.project_id
  ),
  st as (
    select ps.project_id, count(*)::int as n
    from project_stores ps group by ps.project_id
  ),
  -- Per store first, then rolled up. Counting distinct across a three-way join
  -- would be both slower and easier to get subtly wrong.
  per_store as (
    select pc.project_id, pc.store_id,
           count(distinct pc.product_id)::int as answered,
           count(*) filter (where pc.status = 'running') as running,
           max(pc.checked_at) as last_at
    from project_checks pc
    cross join cfg
    where pc.org_id = cfg.org
    group by pc.project_id, pc.store_id
  ),
  rolled as (
    select ps.project_id,
           count(*) filter (
             where ps.answered >= coalesce((select n from prod where prod.project_id = ps.project_id), 0)
           )::int as stores_checked,
           count(*) filter (where ps.running > 0)::int as stores_running,
           max(ps.last_at) as last_at
    from per_store ps
    group by ps.project_id
  )
  select p.id, p.name, p.brief, p.starts_on, p.ends_on, p.active,
         coalesce(prod.n, 0), coalesce(st.n, 0),
         coalesce(rolled.stores_checked, 0), coalesce(rolled.stores_running, 0),
         rolled.last_at
  from projects p
  cross join cfg
  left join prod   on prod.project_id = p.id
  left join st     on st.project_id = p.id
  left join rolled on rolled.project_id = p.id
  where p.org_id = cfg.org
  order by p.active desc, p.ends_on desc, p.name;
$$;

comment on function public.project_summaries is
  'One row per promotion: how many products and outlets it covers, how many of those outlets have answered for every product, and how many have it running.';

-- The detail view: one row per covered store, so a manager can see who has not
-- answered and who has answered badly.
create or replace function public.project_store_status(p_project_id uuid)
returns table (
  store_id     uuid,
  store_name   text,
  city         text,
  answered     int,
  running      int,
  not_running  int,
  not_stocked  int,
  last_checked_at timestamptz,
  rep_name     text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  answers as (
    select pc.store_id,
           count(distinct pc.product_id)::int as answered,
           count(*) filter (where pc.status = 'running')::int     as running,
           count(*) filter (where pc.status = 'not_running')::int as not_running,
           count(*) filter (where pc.status = 'not_stocked')::int as not_stocked,
           max(pc.checked_at) as last_at,
           -- Whoever answered most recently. A store can be visited by more
           -- than one rep over a promotion's life, and the latest answer is
           -- the one the manager is looking at.
           (array_agg(pc.rep_id order by pc.checked_at desc))[1] as last_rep
    from project_checks pc
    cross join cfg
    where pc.org_id = cfg.org and pc.project_id = p_project_id
    group by pc.store_id
  )
  select s.id, s.name, s.city,
         coalesce(a.answered, 0), coalesce(a.running, 0),
         coalesce(a.not_running, 0), coalesce(a.not_stocked, 0),
         a.last_at, pr.full_name
  from project_stores ps
  join stores s on s.id = ps.store_id
  cross join cfg
  left join answers a on a.store_id = s.id
  left join profiles pr on pr.id = a.last_rep
  where ps.project_id = p_project_id
    and s.org_id = cfg.org
  -- Unanswered first: those are the ones needing action, and a manager opening
  -- this is looking for the gap rather than admiring the coverage.
  order by coalesce(a.answered, 0), s.name;
$$;

comment on function public.project_store_status is
  'Per covered outlet for one promotion: how many of its products have been answered and how those answers fell. Outlets with no answer sort first, because that is the list worth acting on.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729085516', 'create_project_report_rpcs')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 51/76  20260729090406_rename_projects_to_promotions.sql
-- ──────────────────────────────────────────────────────────────────────────

-- "Projects" was the word on the sidebar; "Promotions" is the word for the
-- thing. Every column on that table is about a promotion — a window of dates, a
-- set of outlets, a set of lines — and calling it something vaguer only made
-- the next reader work out that they were the same idea.
--
-- Done now because it is free now: the tables went in this morning, hold no
-- rows, and nothing reads them yet. Left alone, the schema would have said
-- `projects` while the UI said Promotions for the rest of the project's life.
--
-- Constraints and indexes are renamed too. Postgres keeps their old names
-- through a table rename, and a `projects_dates_check` on a table called
-- `promotions` is exactly the loose thread someone pulls on later.
alter table public.projects          rename to promotions;
alter table public.project_products  rename to promotion_products;
alter table public.project_stores    rename to promotion_stores;
alter table public.project_checks    rename to promotion_checks;

alter table public.promotion_products rename column project_id to promotion_id;
alter table public.promotion_stores   rename column project_id to promotion_id;
alter table public.promotion_checks   rename column project_id to promotion_id;

alter table public.promotions        rename constraint projects_dates_check to promotions_dates_check;
alter table public.promotion_checks  rename constraint project_checks_status_check to promotion_checks_status_check;

-- Foreign keys keep their names through a table rename too, and these are the
-- ones that matter most: a constraint name is the only way to disambiguate a
-- PostgREST embed when two tables are joined more than once. Writing
-- `stores!project_checks_store_id_fkey` against a table called
-- promotion_checks is the kind of thing that makes a reader doubt everything
-- else on the page.
alter table public.promotion_checks   rename constraint project_checks_org_id_fkey      to promotion_checks_org_id_fkey;
alter table public.promotion_checks   rename constraint project_checks_product_id_fkey  to promotion_checks_product_id_fkey;
alter table public.promotion_checks   rename constraint project_checks_rep_id_fkey      to promotion_checks_rep_id_fkey;
alter table public.promotion_checks   rename constraint project_checks_store_id_fkey    to promotion_checks_store_id_fkey;
alter table public.promotion_checks   rename constraint project_checks_visit_id_fkey    to promotion_checks_visit_id_fkey;
alter table public.promotion_checks   rename constraint project_checks_project_id_fkey  to promotion_checks_promotion_id_fkey;
alter table public.promotion_checks   rename constraint project_checks_pkey             to promotion_checks_pkey;
alter table public.promotion_checks   rename constraint project_checks_client_generated_id_key to promotion_checks_client_generated_id_key;
alter table public.promotion_products rename constraint project_products_product_id_fkey to promotion_products_product_id_fkey;
alter table public.promotion_products rename constraint project_products_project_id_fkey to promotion_products_promotion_id_fkey;
alter table public.promotion_products rename constraint project_products_pkey            to promotion_products_pkey;
alter table public.promotion_stores   rename constraint project_stores_store_id_fkey     to promotion_stores_store_id_fkey;
alter table public.promotion_stores   rename constraint project_stores_project_id_fkey   to promotion_stores_promotion_id_fkey;
alter table public.promotion_stores   rename constraint project_stores_pkey              to promotion_stores_pkey;
alter table public.promotions         rename constraint projects_created_by_fkey         to promotions_created_by_fkey;
alter table public.promotions         rename constraint projects_org_id_fkey             to promotions_org_id_fkey;
alter table public.promotions         rename constraint projects_pkey                    to promotions_pkey;

alter index if exists projects_org_window_idx      rename to promotions_org_window_idx;
alter index if exists project_products_product_idx rename to promotion_products_product_idx;
alter index if exists project_stores_store_idx     rename to promotion_stores_store_idx;
alter index if exists project_checks_project_idx   rename to promotion_checks_promotion_idx;
alter index if exists project_checks_org_checked_idx rename to promotion_checks_org_checked_idx;

alter policy projects_select          on public.promotions         rename to promotions_select;
alter policy projects_write           on public.promotions         rename to promotions_write;
alter policy project_products_select  on public.promotion_products rename to promotion_products_select;
alter policy project_products_write   on public.promotion_products rename to promotion_products_write;
alter policy project_stores_select    on public.promotion_stores   rename to promotion_stores_select;
alter policy project_stores_write     on public.promotion_stores   rename to promotion_stores_write;
alter policy project_checks_select    on public.promotion_checks   rename to promotion_checks_select;
alter policy project_checks_insert    on public.promotion_checks   rename to promotion_checks_insert;

-- The trigger's function is shared; only the trigger's own name carries the old
-- word.
alter trigger projects_set_updated_at on public.promotions rename to promotions_set_updated_at;

drop function if exists public.project_summaries();
drop function if exists public.project_store_status(uuid);

create or replace function public.promotion_summaries()
returns table (
  promotion_id   uuid,
  name           text,
  brief          text,
  starts_on      date,
  ends_on        date,
  active         boolean,
  products       int,
  stores         int,
  stores_checked int,
  stores_running int,
  last_checked_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  prod as (
    select pp.promotion_id, count(*)::int as n
    from promotion_products pp group by pp.promotion_id
  ),
  st as (
    select ps.promotion_id, count(*)::int as n
    from promotion_stores ps group by ps.promotion_id
  ),
  per_store as (
    select pc.promotion_id, pc.store_id,
           count(distinct pc.product_id)::int as answered,
           count(*) filter (where pc.status = 'running') as running,
           max(pc.checked_at) as last_at
    from promotion_checks pc
    cross join cfg
    where pc.org_id = cfg.org
    group by pc.promotion_id, pc.store_id
  ),
  rolled as (
    select ps.promotion_id,
           count(*) filter (
             where ps.answered >= coalesce((select n from prod where prod.promotion_id = ps.promotion_id), 0)
           )::int as stores_checked,
           count(*) filter (where ps.running > 0)::int as stores_running,
           max(ps.last_at) as last_at
    from per_store ps
    group by ps.promotion_id
  )
  select p.id, p.name, p.brief, p.starts_on, p.ends_on, p.active,
         coalesce(prod.n, 0), coalesce(st.n, 0),
         coalesce(rolled.stores_checked, 0), coalesce(rolled.stores_running, 0),
         rolled.last_at
  from promotions p
  cross join cfg
  left join prod   on prod.promotion_id = p.id
  left join st     on st.promotion_id = p.id
  left join rolled on rolled.promotion_id = p.id
  where p.org_id = cfg.org
  order by p.active desc, p.ends_on desc, p.name;
$$;

comment on function public.promotion_summaries is
  'One row per promotion: how many products and outlets it covers, how many of those outlets have answered for every product, and how many have it running.';

create or replace function public.promotion_store_status(p_promotion_id uuid)
returns table (
  store_id     uuid,
  store_name   text,
  city         text,
  answered     int,
  running      int,
  not_running  int,
  not_stocked  int,
  last_checked_at timestamptz,
  rep_name     text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  answers as (
    select pc.store_id,
           count(distinct pc.product_id)::int as answered,
           count(*) filter (where pc.status = 'running')::int     as running,
           count(*) filter (where pc.status = 'not_running')::int as not_running,
           count(*) filter (where pc.status = 'not_stocked')::int as not_stocked,
           max(pc.checked_at) as last_at,
           (array_agg(pc.rep_id order by pc.checked_at desc))[1] as last_rep
    from promotion_checks pc
    cross join cfg
    where pc.org_id = cfg.org and pc.promotion_id = p_promotion_id
    group by pc.store_id
  )
  select s.id, s.name, s.city,
         coalesce(a.answered, 0), coalesce(a.running, 0),
         coalesce(a.not_running, 0), coalesce(a.not_stocked, 0),
         a.last_at, pr.full_name
  from promotion_stores ps
  join stores s on s.id = ps.store_id
  cross join cfg
  left join answers a on a.store_id = s.id
  left join profiles pr on pr.id = a.last_rep
  where ps.promotion_id = p_promotion_id
    and s.org_id = cfg.org
  order by coalesce(a.answered, 0), s.name;
$$;

comment on function public.promotion_store_status is
  'Per covered outlet for one promotion: how many of its products have been answered and how those answers fell. Outlets with no answer sort first, because that is the list worth acting on.';

comment on table public.promotions is
  'A promotion running at a set of outlets over a window of dates. Rides on the visits the call cycle already plans rather than scheduling its own.';
comment on table public.promotion_stores is
  'Outlets a promotion covers, listed individually even when picked a chain at a time, so a finished promotion''s coverage cannot change afterwards when a store moves group.';
comment on column public.promotion_checks.status is
  'running = promotion is up on this line here; not_running = it should be and is not; not_stocked = this outlet does not carry the line at all, which is a ranging question rather than a compliance failure.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729090406', 'rename_projects_to_promotions')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 52/76  20260729141843_fix_promotion_check_counting.sql
-- ──────────────────────────────────────────────────────────────────────────

-- This migration widens a function's return type, which
-- `create or replace` cannot do (42P13). Dropping first is the
-- only way the history replays onto an empty database.
drop function if exists public.promotion_summaries();

-- Count each line once, and say when a promotion was never ranged.
--
-- Three defects in the two report functions as first written, all found before
-- anything read them.
--
-- **1. Repeat visits were double-counted.** `answered` used
-- `count(distinct product_id)` while running/not_running/not_stocked used a
-- plain `count(*) filter`. A promotion runs for a month and a store is visited
-- weekly, so several rows per (store, line) is the designed-for case, not an
-- edge one — the schema comment says corrections belong to the next visit
-- rather than to an update. A store answering "not running" in week one and
-- "running" in week two counted in both, and the three statuses summed higher
-- than the number of lines. Reducing to the latest answer per (store, line)
-- also makes `stores_running` mean "has it up now" rather than "ever had it
-- up", which is what the phrase is read as.
--
-- **2. Detaching a line left its answers behind.** The check's foreign key is
-- to `products`, not to `promotion_products`, so removing a line from a live
-- promotion orphaned its checks. `answered` could then exceed the line count
-- and every outlet flipped to fully checked. Both functions now join through
-- `promotion_products`, so the answer set follows the promotion's current
-- shape.
--
-- **3. A promotion nobody ranges looked exactly like one everybody fails.**
-- Both read `stores_checked = 30, stores_running = 0`. Those are the two
-- different conversations with two different people that the third status
-- exists to separate — a buyer's ranging problem is not a rep's compliance
-- problem — so the summary now carries `stores_not_stocked` and the caller can
-- tell them apart without opening the promotion.
create or replace function public.promotion_summaries()
returns table (
  promotion_id       uuid,
  name               text,
  brief              text,
  starts_on          date,
  ends_on            date,
  active             boolean,
  products           int,
  stores             int,
  stores_checked     int,
  stores_running     int,
  stores_not_stocked int,
  last_checked_at    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  prod as (
    select pp.promotion_id, count(*)::int as n
    from promotion_products pp group by pp.promotion_id
  ),
  st as (
    select ps.promotion_id, count(*)::int as n
    from promotion_stores ps group by ps.promotion_id
  ),
  -- One row per (promotion, store, line): the most recent answer, and only for
  -- lines the promotion still covers.
  latest as (
    select distinct on (pc.promotion_id, pc.store_id, pc.product_id)
           pc.promotion_id, pc.store_id, pc.product_id, pc.status, pc.checked_at
    from promotion_checks pc
    cross join cfg
    join promotion_products pp
      on pp.promotion_id = pc.promotion_id and pp.product_id = pc.product_id
    where pc.org_id = cfg.org
    order by pc.promotion_id, pc.store_id, pc.product_id, pc.checked_at desc
  ),
  per_store as (
    select l.promotion_id, l.store_id,
           count(*)::int                                          as answered,
           count(*) filter (where l.status = 'running')::int       as running,
           count(*) filter (where l.status = 'not_running')::int   as not_running,
           count(*) filter (where l.status = 'not_stocked')::int   as not_stocked,
           max(l.checked_at)                                       as last_at
    from latest l
    group by l.promotion_id, l.store_id
  ),
  rolled as (
    select ps.promotion_id,
           count(*) filter (
             where ps.answered >= coalesce(
               (select n from prod where prod.promotion_id = ps.promotion_id), 0)
           )::int as stores_checked,
           count(*) filter (where ps.running > 0)::int as stores_running,
           -- Nothing up, nothing failing, and something not carried: the outlet
           -- was never a candidate for this promotion in the first place.
           count(*) filter (
             where ps.not_stocked > 0 and ps.running = 0 and ps.not_running = 0
           )::int as stores_not_stocked,
           max(ps.last_at) as last_at
    from per_store ps
    group by ps.promotion_id
  )
  select p.id, p.name, p.brief, p.starts_on, p.ends_on, p.active,
         coalesce(prod.n, 0), coalesce(st.n, 0),
         coalesce(rolled.stores_checked, 0), coalesce(rolled.stores_running, 0),
         coalesce(rolled.stores_not_stocked, 0),
         rolled.last_at
  from promotions p
  cross join cfg
  left join prod   on prod.promotion_id = p.id
  left join st     on st.promotion_id = p.id
  left join rolled on rolled.promotion_id = p.id
  where p.org_id = cfg.org
  order by p.active desc, p.ends_on desc, p.name;
$$;

comment on function public.promotion_summaries is
  'One row per promotion, counting each covered line once at its most recent answer: how many outlets have answered for every line, how many have it running, and how many simply do not carry it.';

create or replace function public.promotion_store_status(p_promotion_id uuid)
returns table (
  store_id     uuid,
  store_name   text,
  city         text,
  answered     int,
  running      int,
  not_running  int,
  not_stocked  int,
  last_checked_at timestamptz,
  rep_name     text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  latest as (
    select distinct on (pc.store_id, pc.product_id)
           pc.store_id, pc.product_id, pc.status, pc.checked_at, pc.rep_id
    from promotion_checks pc
    cross join cfg
    join promotion_products pp
      on pp.promotion_id = pc.promotion_id and pp.product_id = pc.product_id
    where pc.org_id = cfg.org and pc.promotion_id = p_promotion_id
    order by pc.store_id, pc.product_id, pc.checked_at desc
  ),
  answers as (
    select l.store_id,
           count(*)::int                                        as answered,
           count(*) filter (where l.status = 'running')::int     as running,
           count(*) filter (where l.status = 'not_running')::int as not_running,
           count(*) filter (where l.status = 'not_stocked')::int as not_stocked,
           max(l.checked_at) as last_at,
           -- Whoever answered most recently. A store can be visited by more
           -- than one rep over a promotion's life.
           (array_agg(l.rep_id order by l.checked_at desc))[1] as last_rep
    from latest l
    group by l.store_id
  )
  select s.id, s.name, s.city,
         coalesce(a.answered, 0), coalesce(a.running, 0),
         coalesce(a.not_running, 0), coalesce(a.not_stocked, 0),
         a.last_at, pr.full_name
  from promotion_stores ps
  join stores s on s.id = ps.store_id
  cross join cfg
  left join answers a on a.store_id = s.id
  left join profiles pr on pr.id = a.last_rep
  where ps.promotion_id = p_promotion_id
    and s.org_id = cfg.org
  order by coalesce(a.answered, 0), s.name;
$$;

comment on function public.promotion_store_status is
  'Per covered outlet for one promotion, each line counted once at its most recent answer. Outlets with no answer sort first, because that is the list worth acting on.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729141843', 'fix_promotion_check_counting')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 53/76  20260729142051_create_product_delete_impact_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What deleting a product would destroy.
--
-- `promotion_products.product_id` and `promotion_checks.product_id` both
-- cascade, so removing a line erases every answer ever recorded against it —
-- including answers on promotions that finished months ago, whose figures then
-- change retroactively. That is the same trap `store_delete_impact`
-- (20260728145421) and `rep_delete_impact` (20260727202504) exist for, and the
-- dialog has to be able to state the cost before anyone confirms it.
--
-- Deactivating is the right call in almost every real case: a discontinued line
-- keeps its history and simply stops appearing when someone builds the next
-- promotion.
create or replace function public.product_delete_impact(p_product_id uuid)
returns table (
  product_name       text,
  promotions         bigint,
  promotions_live    bigint,
  checks             bigint,
  stores_answered    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select
    (select p.name from products p cross join cfg
      where p.id = p_product_id and p.org_id = cfg.org),
    (select count(*) from promotion_products pp cross join cfg
      join promotions pr on pr.id = pp.promotion_id
      where pp.product_id = p_product_id and pr.org_id = cfg.org),
    -- Promotions running right now are the ones a rep could be standing in
    -- front of, so they are worth naming separately from finished ones.
    (select count(*) from promotion_products pp cross join cfg
      join promotions pr on pr.id = pp.promotion_id
      where pp.product_id = p_product_id and pr.org_id = cfg.org
        and pr.active
        and current_date between pr.starts_on and pr.ends_on),
    (select count(*) from promotion_checks pc cross join cfg
      where pc.product_id = p_product_id and pc.org_id = cfg.org),
    (select count(distinct pc.store_id) from promotion_checks pc cross join cfg
      where pc.product_id = p_product_id and pc.org_id = cfg.org);
$$;

comment on function public.product_delete_impact is
  'Rows a hard product delete would cascade away, including answers on finished promotions whose figures would change retroactively. Shown before confirming; deactivating keeps history instead.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729142051', 'create_product_delete_impact_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 54/76  20260729151556_lock_privilege_and_gps_fields.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Two holes found by audit, both confirmed by exploiting them against the live
-- database inside a rolled-back transaction.
--
-- ## 1. Any rep could make themselves a manager (critical)
--
-- `profiles_update` reads:
--
--     using (id = auth.uid() or (org_id = current_org_id() and current_role() = 'manager'))
--
-- with no `with check`, so Postgres reuses the `using` expression for the new
-- row. That tests *who owns the row*, never *which columns changed* — and a rep
-- setting `role = 'manager'` on their own row still satisfies `id = auth.uid()`.
-- One PostgREST call was enough:
--
--     PATCH /rest/v1/profiles?id=eq.<own id>   {"role":"manager"}
--
-- Confirmed: role came back 'manager'. From there they read every visit, GPS
-- trail, photo and store in the organisation, and can write to all of them.
--
-- The same path let a rep flip their own `is_active` back to true after being
-- deactivated (the RLS helpers return null for an inactive profile, which stops
-- them *reading*, but `id = auth.uid()` still allowed the write), and change
-- their own `org_id` to any organisation whose id they could learn.
--
-- RLS cannot express "these columns are read-only" — a policy sees the whole
-- row, not the diff. Column privileges can, so the fix is to take UPDATE away
-- at the column level and hand back only the fields a person may edit about
-- themselves. `service_role` is unaffected, which is what matters: deactivation
-- already runs through `/api/reps/[id]`, which uses the service key and also
-- bans the auth user, and rep creation runs through `/api/reps/invite`, which
-- sets `role` server-side after verifying the caller is a manager.
--
-- Anything that needs to change a role from now on must go through a server
-- route that checks the caller, not through the table.

revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- The fields a person may legitimately change about themselves or, as a
-- manager, about a rep. Everything omitted here — id, org_id, role, is_active,
-- email, created_at — is now server-controlled.
grant update (full_name, phone, job_title) on public.profiles to authenticated;

comment on column public.profiles.role is
  'Server-controlled. UPDATE is revoked from `authenticated` at column level; changing it requires the service role via a route that verifies the caller is a manager. A policy cannot enforce this — RLS sees the row, not which columns changed.';
comment on column public.profiles.is_active is
  'Server-controlled, and paired with an auth ban in /api/reps/[id]. Revoking the column stops a deactivated user simply setting it back to true.';
comment on column public.profiles.org_id is
  'Server-controlled. It is the tenancy boundary every policy is built on, so a user must never be able to move themselves between organisations.';

-- ## 2. A rep could rewrite their own GPS history (high)
--
-- `visits_update` allows a rep to update their own rows, which they must be
-- able to do — a check-out writes `checkout_at` and its coordinates onto the
-- row created at check-in. But the same policy let them go back afterwards and
-- move `checkin_lat`/`checkin_lng`, change `checkin_at`, or rewrite
-- `checkin_distance_from_store_m`. Confirmed: an off-site check-in recorded at
-- 4,200 m was edited to 5 m.
--
-- Every geofencing claim in this product rests on those columns. If the person
-- being measured can edit the measurement afterwards, the activity feed's
-- "off site" verdict, the rep scorecard's verified rate and the whole audit
-- trail mean nothing.
--
-- Recorded once, then frozen: null to a value is allowed, because that is the
-- check-out completing a row the check-in opened. A value to a *different*
-- value is refused. Nulling a recorded value out is refused too — that would
-- erase the evidence rather than alter it.
create or replace function public.freeze_recorded_position()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The service role and direct SQL are exempt: a manager correcting genuinely
  -- broken data is a deliberate, logged, out-of-band act, not something the
  -- field app can do.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if old.checkin_at is not null and new.checkin_at is distinct from old.checkin_at then
    raise exception 'A recorded check-in time cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_lat is not null and new.checkin_lat is distinct from old.checkin_lat then
    raise exception 'A recorded check-in position cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_lng is not null and new.checkin_lng is distinct from old.checkin_lng then
    raise exception 'A recorded check-in position cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_distance_from_store_m is not null
     and new.checkin_distance_from_store_m is distinct from old.checkin_distance_from_store_m then
    raise exception 'A recorded check-in distance cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_gps_accuracy_m is not null
     and new.checkin_gps_accuracy_m is distinct from old.checkin_gps_accuracy_m then
    raise exception 'A recorded GPS accuracy cannot be changed.' using errcode = '42501';
  end if;

  if old.checkout_at is not null and new.checkout_at is distinct from old.checkout_at then
    raise exception 'A recorded check-out time cannot be changed.' using errcode = '42501';
  end if;
  if old.checkout_lat is not null and new.checkout_lat is distinct from old.checkout_lat then
    raise exception 'A recorded check-out position cannot be changed.' using errcode = '42501';
  end if;
  if old.checkout_lng is not null and new.checkout_lng is distinct from old.checkout_lng then
    raise exception 'A recorded check-out position cannot be changed.' using errcode = '42501';
  end if;

  -- Ownership and tenancy are set once, at insert, under a policy that pins
  -- them to the caller. Nothing should move a visit between reps, stores or
  -- organisations afterwards.
  if new.org_id is distinct from old.org_id
     or new.rep_id is distinct from old.rep_id
     or new.store_id is distinct from old.store_id then
    raise exception 'A visit cannot be reassigned after it is created.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_freeze_recorded_position on public.visits;
drop trigger if exists visits_freeze_recorded_position on public.visits;
create trigger visits_freeze_recorded_position
  before update on public.visits
  for each row execute function public.freeze_recorded_position();

comment on function public.freeze_recorded_position is
  'Makes a recorded GPS position and its timestamps write-once. A check-out may fill a null column; nothing may change or erase a value already there. Without this, the person being measured could edit the measurement.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729151556', 'lock_privilege_and_gps_fields')
on conflict (version) do nothing;

commit;
