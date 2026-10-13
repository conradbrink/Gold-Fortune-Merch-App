-- Store health over a window the page chooses (owner, 13 Oct 2026: "i'd like
-- there to be a place where you can select the dates").
--
-- store_health() looked at the last 30 days. It now takes where the window
-- starts, p_since, and the window still ends now. With no argument it is the
-- card's own 30 days, to the microsecond, so dashboard_business (which calls it
-- without one) and the dashboard's counts do not change.
--
--   * not_visited: no check-in since p_since;
--   * no_order:    a check-in since p_since, but no order;
--   * ordering:    a check-in and an order since p_since;
--   * lapsed:      it has ordered before, and nothing for twice the window
--                  (60 days at the card's 30, as before).
--
-- A start in the future is treated as now, so the window is never negative.
-- The argument list changes, so the old function is dropped first; the call in
-- dashboard_business resolves to this one through the default.

drop function public.store_health();

create function public.store_health(p_since timestamptz default null)
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
           public.org_timezone(public.current_org_id()) as tz,
           least(coalesce(p_since, now() - interval '30 days'), now()) as since
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
           when lv.at is null or lv.at < cfg.since then 'not_visited'
           when lo.at >= cfg.since then 'ordering'
           else 'no_order'
         end,
         -- Twice the window: at the card's 30 days, nothing in 60.
         coalesce(lo.ever, 0) > 0 and lo.at < cfg.since - (now() - cfg.since)
  from public.stores s
  cross join cfg
  left join last_visit lv on lv.store_id = s.id
  left join last_order lo on lo.store_id = s.id
  where s.org_id = cfg.org and s.active
  -- "Go here first" order: never visited, then the longest since a visit. The
  -- list keeps it, and the card's five are the first five of it.
  order by lv.at nulls first, s.name, s.id
$$;

revoke all on function public.store_health(timestamptz) from public, anon;
grant execute on function public.store_health(timestamptz) to authenticated;

comment on function public.store_health(timestamptz) is
  'Each active store with its last check-in and last order, and the Store health group it falls in since p_since (default: the last 30 days): ordering, no_order or not_visited, and lapsed (ordered before, nothing for twice the window). Security invoker.';

-- Already registered as core by 20261013100000; kept so this file stands alone.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'store_health', 'core')
on conflict do nothing;
