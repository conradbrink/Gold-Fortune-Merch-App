-- What the GPS trail actually shows, as opposed to what the phone reported.
--
-- `workday_sessions.distance_meters` is accumulated on the device between
-- 20-minute samples and written once, when the rep ends their day. It cannot be
-- audited, it reads 0 all day for a session still open, and it is lost entirely
-- if the app is killed before the day is ended. In the current data one session
-- claims 4,371 m of travel while holding **no pings at all** — there is nothing
-- on the server that could corroborate or refute it.
--
-- This derives the same quantity from `location_pings`, which is the evidence
-- itself. Same underlying samples, so it is no more precise — but it is
-- checkable, it works mid-day, and it can say how much of the day it did not
-- see, which is the part that decides whether the number means anything.
--
-- It does not replace the reported figure. Both are returned, because the gap
-- between them is information: it is how you find a rep whose app was killed,
-- or a phone that spent the afternoon with location services off.
--
-- Sums straight-line chords between consecutive fixes, so it is a floor on
-- road distance, never an estimate of it. Nothing here should be used to pay
-- anyone; see the Time & Mileage note in the handoff for why.
--
-- It is also, on the evidence, *more* accurate than the device's own figure.
-- The one session ever checked against a known route reported 4,965 m; its
-- pings describe a round trip of 4,959 m each way. The phone dropped the entire
-- outbound leg, because `recordIntervalPing` measures from the previous
-- *interval* ping and has none to measure from on the first one — it ignores
-- the `workday_start` fix sitting right there. This function starts the trail
-- at whichever fix came first, whatever its source, so the first leg survives.
create or replace function public.workday_trail(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  session_id       uuid,
  rep_id           uuid,
  rep_name         text,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_seconds int,
  reported_m       double precision,
  trail_m          double precision,
  legs             int,
  dropped_legs     int,
  max_gap_seconds  int,
  worst_accuracy_m double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  -- Each ping paired with the one before it, within its own session.
  steps as (
    select
      lp.workday_session_id as sid,
      public.haversine_m(
        lag(lp.lat) over w, lag(lp.lng) over w, lp.lat, lp.lng
      ) as leg_m,
      extract(epoch from lp.recorded_at - lag(lp.recorded_at) over w) as gap_s,
      greatest(lp.accuracy_m, lag(lp.accuracy_m) over w) as leg_accuracy_m
    from location_pings lp
    cross join cfg
    where lp.org_id = cfg.org
      and lp.workday_session_id is not null
    window w as (
      partition by lp.workday_session_id order by lp.recorded_at
    )
  ),
  -- Aggregated per session before anything is joined to it. Joining sessions
  -- to pings and aggregating afterwards fans out — the same trap that needed
  -- correcting twice already in the schedule and OOS reports.
  trail as (
    select
      s.sid,
      -- A leg implying more than 200 km/h is not a rep driving; it is a stale
      -- last-known fix, which `LocationService` returns rather than failing.
      -- Counted rather than silently included, because a single bogus leg can
      -- be larger than the rest of the day put together.
      coalesce(sum(s.leg_m) filter (
        where s.gap_s > 0 and (s.leg_m / s.gap_s) <= 55.6
      ), 0)::double precision as trail_m,
      count(*) filter (
        where s.leg_m is not null and s.gap_s > 0 and (s.leg_m / s.gap_s) <= 55.6
      )::int as legs,
      count(*) filter (
        where s.leg_m is not null and (s.gap_s is null or s.gap_s <= 0
              or (s.leg_m / s.gap_s) > 55.6)
      )::int as dropped_legs,
      -- The honesty column. Twenty-minute sampling with no background service
      -- means a long gap is a stretch of the day nobody observed, and a trail
      -- across it is a straight line drawn through the unknown.
      coalesce(max(s.gap_s), 0)::int as max_gap_seconds,
      max(s.leg_accuracy_m) as worst_accuracy_m
    from steps s
    group by s.sid
  )
  select
    ws.id,
    ws.rep_id,
    p.full_name,
    ws.started_at,
    ws.ended_at,
    ws.duration_seconds,
    ws.distance_meters,
    coalesce(t.trail_m, 0),
    coalesce(t.legs, 0),
    coalesce(t.dropped_legs, 0),
    coalesce(t.max_gap_seconds, 0),
    t.worst_accuracy_m
  from workday_sessions ws
  cross join cfg
  left join profiles p on p.id = ws.rep_id
  left join trail t on t.sid = ws.id
  where ws.org_id = cfg.org
    and ws.started_at >= p_from
    and ws.started_at < p_to
  order by ws.started_at desc;
$$;

comment on function public.workday_trail is
  'Per workday session: the distance the phone reported alongside the distance its own pings actually support, plus how much of the day went unobserved. Straight-line chords between fixes, so a floor on road distance and not a basis for payment.';

-- The review query is org-wide over a date range, which is this table's whole
-- access pattern and the one index it lacked. `visits` has had the equivalent
-- (visits_org_checkin_at_idx) since the assignments migration.
create index if not exists workday_sessions_org_started_at_idx
  on public.workday_sessions (org_id, started_at desc);
