-- Road distance for a finished workday, alongside the straight-line figure.
--
-- `distance_meters` is accumulated on the phone from the gaps between pings. It
-- is free, works with no signal, and is a **lower bound**: five-minute sampling
-- gives the chord between two points, not the road between them, so a rep who
-- drove a bend is credited with the shortcut. Fine for "was this a big day or a
-- small one", wrong for anything anyone is paid on.
--
-- `road_distance_meters` is what the road network actually says, computed after
-- the day ends by asking Google to route through that day's pings.
--
-- Deliberately a **second column rather than a correction of the first**:
--
--   * The phone's figure is available live and offline; this one needs a server,
--     a network and a paid API. Overwriting would mean a number that exists
--     during the day and vanishes if the settle step fails.
--   * Keeping both makes the settle step auditable. If the road figure ever comes
--     back wildly under the straight-line one, something snapped to the wrong
--     road, and only having both makes that visible.
--
-- **Null means not computed, never zero.** A day with no road distance yet and a
-- day the rep genuinely did not drive are different facts, and a zero would make
-- them the same one — the same rule the planner follows for a missing coordinate.

alter table public.workday_sessions
  add column if not exists road_distance_meters numeric,
  add column if not exists road_distance_at timestamptz,
  -- What the settle step could not do, in words, so a day that never gets a road
  -- figure can say why instead of sitting blank forever.
  add column if not exists road_distance_error text;

alter table public.workday_sessions
  drop constraint if exists workday_sessions_road_distance_nonneg;
alter table public.workday_sessions
  add constraint workday_sessions_road_distance_nonneg
  check (road_distance_meters is null or road_distance_meters >= 0);

comment on column public.workday_sessions.road_distance_meters is
  'Driving distance along roads for the day, from the Routes API. Null until settled; never 0 as a placeholder. Compare against distance_meters, which is straight-line and a lower bound.';
comment on column public.workday_sessions.road_distance_at is
  'When the road figure was computed. Also the marker for "already settled" — the job skips a session that has one.';
comment on column public.workday_sessions.road_distance_error is
  'Why the road figure is missing, when it is. Null on success and on sessions not yet attempted.';
