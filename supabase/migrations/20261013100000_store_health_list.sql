-- The stores behind the dashboard's Store health card, as a list (owner, 13 Oct
-- 2026: "i want to be able to go into this and see what stores havent ordered
-- etc.").
--
-- store_health() is now the one place the card's rules live, one row per active
-- store:
--   * status 'not_visited': no check-in in the last 30 days (or ever);
--   * status 'no_order':    a check-in in the last 30 days, but no order;
--   * status 'ordering':    a check-in and an order in the last 30 days;
--   * lapsed:               it has ordered before, and nothing in 60 days.
-- The three statuses split the active stores with nothing left over, exactly as
-- the card's bar does. An order is any order that was not cancelled, counted on
-- when it was captured; a visit is any check-in. The 30 and 60 days are the
-- card's own, moved here unchanged.
--
-- dashboard_business counts this function instead of repeating the rules, as it
-- does offsite_checkins; nothing else in that function changes. Security
-- invoker throughout, as before: each caller sees only the stores, visits and
-- orders their row-level security already lets them read.

create or replace function public.store_health()
returns table (
  store_id uuid,
  store_name text,
  city text,
  last_visit_at timestamptz,
  last_order_at timestamptz,
  orders_ever integer,
  days_since_visit integer,
  days_since_order integer,
  status text,
  lapsed boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz
  ),
  last_visit as (
    select v.store_id, max(v.checkin_at) as at
    from public.visits v
    cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null
    group by v.store_id
  ),
  last_order as (
    select o.store_id, max(o.created_at) as at, count(*)::integer as ever
    from public.orders o
    cross join cfg
    where o.org_id = cfg.org and o.status <> 'cancelled'
    group by o.store_id
  )
  select s.id,
         s.name,
         s.city,
         lv.at,
         lo.at,
         coalesce(lo.ever, 0),
         -- Calendar days in the company's time, as the card has always shown
         -- them: a visit late yesterday is 1 day ago, not 0.
         (now() at time zone cfg.tz)::date - (lv.at at time zone cfg.tz)::date,
         (now() at time zone cfg.tz)::date - (lo.at at time zone cfg.tz)::date,
         case
           when lv.at is null or lv.at < now() - interval '30 days' then 'not_visited'
           when lo.at >= now() - interval '30 days' then 'ordering'
           else 'no_order'
         end,
         coalesce(lo.ever, 0) > 0 and lo.at < now() - interval '60 days'
  from public.stores s
  cross join cfg
  left join last_visit lv on lv.store_id = s.id
  left join last_order lo on lo.store_id = s.id
  where s.org_id = cfg.org and s.active
  -- "Go here first" order: never visited, then the longest since a visit. The
  -- list keeps it, and the card's five are the first five of it.
  order by lv.at nulls first, s.name, s.id
$$;

revoke all on function public.store_health() from public, anon;
grant execute on function public.store_health() to authenticated;

comment on function public.store_health() is
  'Each active store with its last check-in and last order, and the Store health group it falls in: ordering, no_order or not_visited (30 days), and lapsed (ordered before, nothing in 60 days). Security invoker.';

-- README rule 4: every authenticated-callable function belongs to a module. The
-- dashboard is core, as dashboard_business is; for a company without
-- distribution, orders read as none through their own module gate.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'store_health', 'core')
on conflict do nothing;

-- dashboard_business: the health section now counts store_health(). Two
-- anchors, each replaced exactly once, as in 20261010215000.
do $migration$
declare
  v_def text := pg_get_functiondef('public.dashboard_business(timestamptz, timestamptz)'::regprocedure);
  c_old_ctes constant text := $a$  stores_active as (
    select id, name, city from public.stores where org_id = v_org and active
  ),
  last_visit as (
    select v.store_id, max(v.checkin_at) as at
    from public.visits v
    where v.org_id = v_org and v.checkin_at is not null
    group by v.store_id
  ),
  last_order as (
    select o.store_id, max(o.created_at) as at, count(*) as ever
    from public.orders o
    where o.org_id = v_org and o.status <> 'cancelled'
    group by o.store_id
  ),
  health as (
    select sa.id, sa.name, sa.city, lv.at as visited_at, lo.at as ordered_at, coalesce(lo.ever, 0) as ever_ordered
    from stores_active sa
    left join last_visit lv on lv.store_id = sa.id
    left join last_order lo on lo.store_id = sa.id
  )$a$;
  c_new_ctes constant text := $b$  -- One rule, in store_health: these counts and the lists the card opens
  -- can never disagree.
  health as (
    select * from public.store_health()
  )$b$;
  c_old_health constant text := $c$    'health', jsonb_build_object(
      'stores_active', (select count(*) from health),
      'ordered_30d', (select count(*) from health where ordered_at >= now() - interval '30 days'),
      'visited_no_order_30d', (select count(*) from health where visited_at >= now() - interval '30 days' and (ordered_at is null or ordered_at < now() - interval '30 days')),
      'not_visited_30d', (select count(*) from health where visited_at is null or visited_at < now() - interval '30 days'),
      'lapsed_60d', (select count(*) from health where ever_ordered > 0 and ordered_at < now() - interval '60 days'),
      'longest_unvisited', (
        select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select jsonb_build_object(
                   'id', id, 'name', name, 'city', city,
                   'days', case when visited_at is null then null
                                else (v_today - (visited_at at time zone v_tz)::date) end
                 ) as x
          from health
          where visited_at is null or visited_at < now() - interval '30 days'
          -- Never-visited first, then the longest gap: both are "go here first".
          order by visited_at nulls first, name
          limit 5
        ) t
      )
    ),$c$;
  c_new_health constant text := $d$    'health', jsonb_build_object(
      'stores_active', (select count(*) from health),
      'ordered_30d', (select count(*) from health where last_order_at >= now() - interval '30 days'),
      'visited_no_order_30d', (select count(*) from health where status = 'no_order'),
      'not_visited_30d', (select count(*) from health where status = 'not_visited'),
      'lapsed_60d', (select count(*) from health where lapsed),
      'longest_unvisited', (
        select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select jsonb_build_object(
                   'id', store_id, 'name', store_name, 'city', city,
                   'days', days_since_visit
                 ) as x
          from health
          where status = 'not_visited'
          -- Never-visited first, then the longest gap: both are "go here first".
          -- store_health() returns its rows in this order, so these five head
          -- the list the card opens. The id settles two stores of one name.
          order by last_visit_at nulls first, store_name, store_id
          limit 5
        ) t
      )
    ),$d$;
begin
  if (length(v_def) - length(replace(v_def, c_old_ctes, ''))) / length(c_old_ctes) <> 1 then
    raise exception 'dashboard_business: expected 1 of the health CTEs, the function is not the text this migration expects';
  end if;
  if (length(v_def) - length(replace(v_def, c_old_health, ''))) / length(c_old_health) <> 1 then
    raise exception 'dashboard_business: expected 1 of the health section, the function is not the text this migration expects';
  end if;
  execute replace(replace(v_def, c_old_ctes, c_new_ctes), c_old_health, c_new_health);
end;
$migration$;
