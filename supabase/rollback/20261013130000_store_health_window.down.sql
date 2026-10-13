-- Rollback of 20261013130000_store_health_window: store_health() goes back to
-- the fixed 30 days, exactly as 20261013100000 created it.

drop function public.store_health(timestamptz);

create function public.store_health()
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
