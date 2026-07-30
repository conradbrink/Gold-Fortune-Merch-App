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
