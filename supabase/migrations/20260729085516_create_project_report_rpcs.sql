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
