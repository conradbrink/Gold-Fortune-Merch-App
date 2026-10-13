-- Rollback of 20261013100000_store_health_list: dashboard_business gets its own
-- health rules back (the exact text 20261007160113 wrote), then store_health()
-- and its module registration go.

do $rollback$
declare
  v_def text := pg_get_functiondef('public.dashboard_business(timestamptz, timestamptz)'::regprocedure);
  c_new_ctes constant text := $b$  -- One rule, in store_health: these counts and the lists the card opens
  -- can never disagree.
  health as (
    select * from public.store_health()
  )$b$;
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
begin
  if (length(v_def) - length(replace(v_def, c_new_ctes, ''))) / length(c_new_ctes) <> 1 then
    raise exception 'dashboard_business: expected 1 of the store_health CTE';
  end if;
  if (length(v_def) - length(replace(v_def, c_new_health, ''))) / length(c_new_health) <> 1 then
    raise exception 'dashboard_business: expected 1 of the store_health section';
  end if;
  execute replace(replace(v_def, c_new_ctes, c_old_ctes), c_new_health, c_old_health);
end;
$rollback$;

drop function public.store_health();

delete from public.module_assignments where kind = 'function' and name = 'store_health';
