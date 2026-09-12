-- `route_catchups` used two different conventions for the same boundary.
--
-- CodeRabbit on #60. `missed` bounds rounds with `bounds.from_date`, a calendar
-- date resolved in the organisation's timezone. `free_visits` bounded candidate
-- visits with the raw `p_from` instant. For a caller in Africa/Gaborone those
-- are the same moment and nothing differs — which is why the figures this
-- change produces are identical — but they are not the same *rule*, and a
-- function that states its own boundary two ways will eventually be read as
-- stating it once.
--
-- For a caller outside CAT they genuinely disagree: `p_from` is browser-local
-- midnight, so a visit early on the first day of the period can fall outside
-- `checkin_at >= p_from` while its local date is inside `from_date`. The round
-- it should have paid off then shows as never served, in both the report and
-- the Adherence tab.
--
-- Fixed here rather than deferred with its siblings because this one is inside
-- the function. The related findings on #57 and on the report's date rendering
-- need the *client* to know the organisation's timezone — one change, across
-- the RPC signatures and the formatters, still outstanding. This one needs
-- nothing but consistency with the CTE above it.
--
-- ⚠️ Still true afterwards, and still the open item: `p_from` itself arrives as
-- browser-local midnight. Bounding on its local date makes the two halves of
-- this function agree with each other; it does not make the period boundary
-- right for a caller outside the organisation's timezone.

create or replace function public.route_catchups(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (route_id uuid, caught_up_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz
  ),
  bounds as materialized (
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  missed as (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date,
           row_number() over (partition by ro.rep_id, ro.store_id
                              order by ro.scheduled_date, ro.id) as rn
    from routes ro
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      and ro.scheduled_date <= b.today
      and not exists (select 1 from visits v
                       where v.route_id = ro.id and v.status = 'checked_out')
  ),
  -- Bounded below by the same calendar date the rounds are, in the same
  -- timezone. No upper bound: the catch-up may fall after the reporting
  -- period, and a store served two days into September was still served.
  free_visits as (
    select v.rep_id, v.store_id, v.checkin_at,
           (v.checkin_at at time zone cfg.tz)::date as local_day,
           row_number() over (partition by v.rep_id, v.store_id
                              order by v.checkin_at) as vn
    from visits v
    cross join cfg
    cross join bounds b
    where v.org_id = cfg.org
      and v.status = 'checked_out'
      and v.route_id is null
      and (v.checkin_at at time zone cfg.tz)::date >= b.from_date
  ),
  available as (
    select rep_id, store_id, max(vn) as m from free_visits group by rep_id, store_id
  ),
  -- g: the first visit this round could possibly be credited to.
  eligible as (
    select m.*,
           (select min(f.vn) from free_visits f
             where f.rep_id = m.rep_id
               and f.store_id = m.store_id
               and f.local_day >= m.scheduled_date) as g
    from missed m
  ),
  -- f: that, pushed past whatever the earlier rounds already took.
  pointer as (
    select e.*,
           e.rn + max(e.g - e.rn) over (
             partition by e.rep_id, e.store_id
             order by e.rn
             rows between unbounded preceding and current row
           ) as f
    from eligible e
  )
  select p.id, f.checkin_at
  from pointer p
  join available a  on a.rep_id = p.rep_id and a.store_id = p.store_id
  join free_visits f on f.rep_id = p.rep_id and f.store_id = p.store_id and f.vn = p.f
  where p.g is not null
    and p.f <= a.m;
$$;
