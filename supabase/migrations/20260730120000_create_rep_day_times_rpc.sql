-- When the team actually starts and finishes.
--
-- "First activity of the day" is not one table's business. A rep may open the
-- workday before driving anywhere, check in somewhere without ever pressing
-- start, or spend a morning on prospects and never touch a scheduled store.
-- Taking only visits would report the last of those as no day at all, so this
-- unions everything that is evidence of the rep being at work:
--
--   * workday_sessions   — the day opened and closed explicitly
--   * visits             — check-in and check-out
--   * leads              — a sales call started and completed
--
-- Times are local. Botswana is UTC+2, so an evening close-of-day stored in UTC
-- belongs to the previous date, and averaging the raw timestamps would report a
-- start time two hours before anybody arrived. Every grouping and every
-- average below happens after the conversion.
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
  with cfg as materialized (
    select public.current_org_id() as org,
           -- One place to change if the customer ever operates outside CAT.
           'Africa/Gaborone'::text as tz
  ),
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
  -- One row per rep per working day: when they first did anything, and last.
  per_day as (
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
         count(*) as days_worked,
         -- Seconds since local midnight, averaged across the rep's days. Kept
         -- as seconds rather than a time so the caller can render it and the
         -- overall average can be taken without re-parsing.
         round(avg(extract(epoch from d.first_at::time))::numeric, 0) as avg_start_seconds,
         round(avg(extract(epoch from d.last_at::time))::numeric, 0) as avg_end_seconds,
         round(avg(extract(epoch from (d.last_at - d.first_at)))::numeric, 0) as avg_length_seconds
  from per_day d
  left join profiles p on p.id = d.rep_id
  group by d.rep_id, p.full_name
  order by p.full_name nulls last;
$$;

comment on function public.rep_day_times is
  'Average local start and end of day per rep, from workday sessions, visits and sales calls.';
