-- `route_catchups` paired by row number, and row numbers do not line up.
--
-- Found by CodeRabbit on #60, confirmed, and it loses real catch-ups. The old
-- version numbered missed rounds 1..n and unscheduled visits 1..m per rep and
-- store, paired them on that number, then dropped the pair if the visit fell
-- before the round. But the visits are numbered from the start of the period,
-- **including visits earlier than any missed round** — so one early visit
-- shifts every pairing by one and the last eligible visit falls off the end.
--
--     unscheduled visit   3 Aug        <- consumes rn = 1
--     missed round       10 Aug  rn=1  <- paired with 3 Aug, fails the date
--     unscheduled visit  15 Aug  vn=2  <- no round has rn = 2, never matched
--
-- The 10 Aug round was caught up on 15 Aug and the function said it never was.
-- CodeRabbit's note that filtering from `min(scheduled_date)` would not fix it
-- is also right: a visit *between* two missed rounds produces the same offset.
--
-- What it cost, over 1 Aug – today:
--
--     rep                credited (paired)   credited (correct)
--     Tshepo Mmereki                     5                    6
--     Atang Kheumla                      3                    3
--     Jerry Habana                      25                   30
--
-- Jerry loses five return trips he actually made — 54.8% where the truth is
-- 58.9%. The figures quoted in `20260912220852`'s header are wrong for that
-- reason; these are the right ones.
--
-- ## The fix, and why it is not a loop
--
-- The rule wanted is greedy: take each missed round in date order and give it
-- the earliest unused unscheduled visit on or after it. Written as a pointer,
--
--     f(i) = max( f(i-1) + 1 , g(i) )
--
-- where `g(i)` is the index of the first visit on or after round i's date. That
-- recurrence unrolls to a running maximum:
--
--     f(i) = max over k <= i of ( g(k) + i - k )
--          = i + max over k <= i of ( g(k) - k )
--
-- which is one window function, no recursion and no plpgsql loop. A recursive
-- CTE cannot express it anyway: the recursive reference would have to sit
-- inside a correlated subquery, which PostgreSQL forbids.
--
-- `g` is non-decreasing in `i` (later rounds can only start later), so once it
-- is null it stays null and the running maximum is taken over a clean prefix.
-- A round is credited when it has an eligible visit at all (`g` not null) and
-- the pointer has not run past the end (`f <= m`). Both checks are needed:
-- the first keeps the credited visit on or after the round, the second stops
-- two rounds sharing one trip.

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
  -- No upper bound: the catch-up may fall after the reporting period, and a
  -- store served two days into September was still served.
  free_visits as (
    select v.rep_id, v.store_id, v.checkin_at,
           (v.checkin_at at time zone cfg.tz)::date as local_day,
           row_number() over (partition by v.rep_id, v.store_id
                              order by v.checkin_at) as vn
    from visits v
    cross join cfg
    where v.org_id = cfg.org
      and v.status = 'checked_out'
      and v.route_id is null
      and v.checkin_at >= p_from
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

comment on function public.route_catchups is
  'Missed rounds paid off by an unscheduled return visit, each round taking the earliest still-unused eligible visit. The single definition of a caught-up visit, read by rep_performance_missed and schedule_adherence.';
