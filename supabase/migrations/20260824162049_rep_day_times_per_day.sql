-- Every rep-day behind the working-day averages.
--
-- `rep_day_times` (20260730101806) already builds exactly this in its `per_day`
-- CTE — one row per rep per local day, first activity to last — and then throws
-- it away by aggregating. The dashboard needs to show a single chosen day for
-- the whole team, so the detail is lifted out and returned.
--
-- The important part is that it is lifted, not copied. "What counts as a working
-- day" is a real definition — a union of workday sessions, visits and sales
-- calls, converted to local time before any grouping — and two copies of it
-- would eventually disagree, at which point a day shown in the detail would not
-- be one of the days the average was taken over. So `rep_day_times` is recreated
-- below to aggregate over this function rather than to repeat its body. One
-- definition, two shapes.
--
-- Return shape of `rep_day_times` is deliberately UNCHANGED: the dashboard reads
-- it today and this migration must not move it.

create or replace function public.rep_day_times_per_day(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id         uuid,
  rep_name       text,
  local_day      date,
  start_seconds  numeric,
  end_seconds    numeric,
  length_seconds numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           -- One place to change if the customer ever operates outside CAT.
           'Africa/Gaborone'::text as tz
  ),
  -- Anything that is evidence of the rep being at work. A rep may open the
  -- workday before driving anywhere, check in somewhere without ever pressing
  -- start, or spend a morning on prospects and never touch a scheduled store.
  events as (
    select w.rep_id, w.started_at as at from workday_sessions w cross join cfg
     where w.org_id = cfg.org and w.started_at is not null
    union all
    select w.rep_id, w.ended_at from workday_sessions w cross join cfg
     where w.org_id = cfg.org and w.ended_at is not null
    union all
    select v.rep_id, v.checkin_at from visits v cross join cfg
     where v.org_id = cfg.org and v.checkin_at is not null
    union all
    select v.rep_id, v.checkout_at from visits v cross join cfg
     where v.org_id = cfg.org and v.checkout_at is not null
    union all
    select l.rep_id, l.started_at from leads l cross join cfg
     where l.org_id = cfg.org
    union all
    select l.rep_id, l.completed_at from leads l cross join cfg
     where l.org_id = cfg.org and l.completed_at is not null
  ),
  per_day as (
    -- Botswana is UTC+2, so an evening close stored in UTC belongs to the
    -- previous date. Convert before grouping or the day itself is wrong, not
    -- just the time.
    select e.rep_id,
           (e.at at time zone cfg.tz)::date as local_day,
           min(e.at at time zone cfg.tz) as first_at,
           max(e.at at time zone cfg.tz) as last_at
    from events e cross join cfg
    where e.at >= p_from and e.at < p_to
    group by e.rep_id, (e.at at time zone cfg.tz)::date
  )
  select d.rep_id,
         p.full_name as rep_name,
         d.local_day,
         -- Seconds since local midnight, matching `rep_day_times`, so the web
         -- formats both with one function instead of two conventions.
         round(extract(epoch from d.first_at::time)::numeric, 0),
         round(extract(epoch from d.last_at::time)::numeric, 0),
         round(extract(epoch from (d.last_at - d.first_at))::numeric, 0)
  from per_day d
  left join profiles p on p.id = d.rep_id
  order by d.local_day desc, p.full_name nulls last;
$$;

comment on function public.rep_day_times_per_day is
  'One row per rep per local working day: first activity, last activity, and the span between. The detail `rep_day_times` averages.';

-- Recreated to aggregate over the function above rather than repeat its body.
-- Same name, same arguments, same return shape, same numbers — the only change
-- is that there is now a single definition of a rep-day.
create or replace function public.rep_day_times(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id            uuid,
  rep_name          text,
  days_worked       bigint,
  avg_start_seconds numeric,
  avg_end_seconds   numeric,
  avg_length_seconds numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select d.rep_id,
         d.rep_name,
         count(*) as days_worked,
         round(avg(d.start_seconds), 0) as avg_start_seconds,
         round(avg(d.end_seconds), 0) as avg_end_seconds,
         round(avg(d.length_seconds), 0) as avg_length_seconds
  from public.rep_day_times_per_day(p_from, p_to) d
  group by d.rep_id, d.rep_name
  order by d.rep_name nulls last;
$$;

comment on function public.rep_day_times is
  'Average local start and end of day per rep, from workday sessions, visits and sales calls. Aggregates rep_day_times_per_day.';
