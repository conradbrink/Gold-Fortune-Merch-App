-- A workday nobody ends, ends itself at 19:30.
--
-- A rep who forgets to end their day leaves it open all night: the phone's
-- foreground service keeps sampling, the day never reaches the nightly
-- road-distance job (which only settles finished days), and the attendance
-- report has a shift with no end. That happened in September 2026. The owner
-- asked for an automatic end at 7pm or 7:30pm; this is 7:30, and the phone
-- (`workday_auto_end.dart`) uses the same figure.
--
-- Closed *as of the cut-off on the day the session started*, in the
-- organisation's timezone — never as of when this happened to run. A job that
-- fires late, or a phone that wakes the next morning, then writes the same
-- answer, and the two cannot disagree about when the day ended.
--
-- Distance is taken from the pings up to the cut-off, chords between
-- consecutive fixes with the same 50 m floor the phone's odometer applies
-- (`kOdometerFloorM`), because the phone only reports its own figure at the
-- moment the rep ends the day, which by definition did not happen. The rep's
-- own end, arriving later from an offline phone, replaces all of this: the
-- replay writes `ended_at` unconditionally and nulls `auto_ended_at`.
--
-- `close_abandoned_workday` stays as it is: that is a manager's deliberate act
-- on one day, guarded by a twelve-hour minimum age. This is the rule.

alter table public.workday_sessions
  add column if not exists auto_ended_at timestamptz;

comment on column public.workday_sessions.auto_ended_at is
  'Set when the day was closed by the automatic end-of-day rule rather than by '
  'the rep or a manager. Null otherwise; cleared when the rep''s own end arrives.';

create or replace function public.auto_end_overdue_workdays(
  p_cutoff time default time '19:30'
)
returns table (
  session_id      uuid,
  rep_id          uuid,
  started_at      timestamptz,
  ended_at        timestamptz,
  distance_meters double precision,
  legs            int
)
language sql
security definer
set search_path = public
as $$
  with overdue as (
    select ws.id, ws.org_id, ws.rep_id, ws.started_at,
           ((ws.started_at at time zone public.org_timezone(ws.org_id))::date
              + p_cutoff)
             at time zone public.org_timezone(ws.org_id) as cutoff_at
    from public.workday_sessions ws
    where ws.ended_at is null
  ),
  due as (
    select * from overdue where cutoff_at <= now()
  ),
  fixes as (
    select lp.workday_session_id as sid,
           lp.recorded_at, lp.lat, lp.lng,
           lag(lp.lat) over w as prev_lat,
           lag(lp.lng) over w as prev_lng
    from public.location_pings lp
    join due d on d.id = lp.workday_session_id
    where lp.recorded_at <= d.cutoff_at
    window w as (partition by lp.workday_session_id order by lp.recorded_at)
  ),
  legs as (
    select sid, prev_lat,
           public.haversine_m(prev_lat, prev_lng, lat, lng) as leg
    from fixes
  ),
  trail as (
    select sid,
           coalesce(sum(case when leg >= 50 then leg else 0 end), 0)::double precision
             as meters,
           count(*) filter (where prev_lat is not null)::int as legs
    from legs
    group by sid
  ),
  last_fix as (
    select distinct on (sid) sid, lat, lng
    from fixes
    order by sid, recorded_at desc
  )
  update public.workday_sessions ws
     set ended_at         = d.cutoff_at,
         auto_ended_at    = now(),
         duration_seconds = greatest(
           extract(epoch from d.cutoff_at - ws.started_at)::int, 0),
         distance_meters  = greatest(ws.distance_meters, coalesce(t.meters, 0)),
         end_lat          = coalesce(ws.end_lat, lf.lat),
         end_lng          = coalesce(ws.end_lng, lf.lng)
    from due d
    left join trail t on t.sid = d.id
    left join last_fix lf on lf.sid = d.id
   where ws.id = d.id
     -- Re-checked here: a rep's own end can land between the select and the
     -- write, and theirs is the one that stands.
     and ws.ended_at is null
  returning ws.id, ws.rep_id, ws.started_at, ws.ended_at, ws.distance_meters,
            coalesce(t.legs, 0);
$$;

comment on function public.auto_end_overdue_workdays(time) is
  'Closes every workday still open past p_cutoff (default 19:30) in its '
  'organisation''s timezone, as of that cut-off on the day it started. Run '
  'nightly by /api/workday/auto-end. Service role only.';

-- Nobody signed in may run this: it closes other people's days.
revoke all on function public.auto_end_overdue_workdays(time)
  from public, anon, authenticated;
grant execute on function public.auto_end_overdue_workdays(time) to service_role;
