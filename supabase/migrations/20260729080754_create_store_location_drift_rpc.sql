-- Does the store still seem to be where we think it is?
--
-- Once a rep has set a location on site, nothing overwrites it — not another
-- rep, not a geocoder. That is deliberate, but it means a mistaken first
-- capture would be wrong for ever unless something watched. This is the watch.
--
-- Every check-in already records `checkin_distance_from_store_m`. A store whose
-- visits keep landing hundreds of metres away is telling you something, and
-- which of the two possible things it is telling you matters:
--
--   * the stored point is wrong — visits cluster somewhere else, consistently,
--     across more than one rep;
--   * the reps are not going in — visits are scattered, or it is one rep.
--
-- The difference is in the spread. A tight cluster far from the point is a
-- wrong point; a loose scatter is behaviour. So this reports both the typical
-- distance and how much the check-ins agree with each other, and leaves the
-- judgement to a person. It moves nothing.
--
-- Deliberately median, not mean: one check-in recorded from the car park on the
-- way past should not drag an otherwise consistent store into the report, and
-- one wild fix should not create a false alarm.
create or replace function public.store_location_drift(
  p_min_visits int default 3,
  p_min_median_m double precision default 150
)
returns table (
  store_id          uuid,
  store_name        text,
  city              text,
  visits_considered int,
  reps_involved     int,
  median_offset_m   double precision,
  spread_m          double precision,
  cluster_lat       double precision,
  cluster_lng       double precision,
  cluster_offset_m  double precision,
  geofence_radius_m int,
  location_source   text,
  last_visit_at     timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  -- Only check-ins that carry a position and a distance. A visit with no fix
  -- says nothing either way and must not be counted as agreement.
  recent as (
    select v.store_id, v.rep_id, v.checkin_at, v.checkin_lat, v.checkin_lng,
           v.checkin_distance_from_store_m as offset_m
    from visits v
    cross join cfg
    where v.org_id = cfg.org
      and v.checkin_at is not null
      and v.checkin_lat is not null
      and v.checkin_lng is not null
      and v.checkin_distance_from_store_m is not null
  ),
  -- Aggregated per store before joining to stores, so the store row cannot
  -- fan out across its visits — the same trap that needed correcting in the
  -- schedule and OOS reports.
  agg as (
    select
      r.store_id,
      count(*)::int as visits_considered,
      count(distinct r.rep_id)::int as reps_involved,
      percentile_cont(0.5) within group (order by r.offset_m) as median_offset_m,
      -- How much the check-ins agree with each other. Half the gap between the
      -- quartiles: small means they keep landing in the same wrong place.
      (percentile_cont(0.75) within group (order by r.offset_m)
       - percentile_cont(0.25) within group (order by r.offset_m)) / 2 as spread_m,
      avg(r.checkin_lat) as cluster_lat,
      avg(r.checkin_lng) as cluster_lng,
      max(r.checkin_at) as last_visit_at
    from recent r
    group by r.store_id
  )
  select
    s.id,
    s.name,
    s.city,
    a.visits_considered,
    a.reps_involved,
    round(a.median_offset_m::numeric, 1)::double precision,
    round(a.spread_m::numeric, 1)::double precision,
    a.cluster_lat,
    a.cluster_lng,
    -- Where the check-ins actually cluster, and how far that is from the point
    -- on file. This is the suggestion a manager would act on — never applied
    -- automatically, because the centroid of a few fixes is not a shopfront.
    public.haversine_m(s.lat, s.lng, a.cluster_lat, a.cluster_lng)::double precision,
    s.geofence_radius_m,
    s.geocode_source,
    a.last_visit_at
  from agg a
  join stores s on s.id = a.store_id
  cross join cfg
  where s.org_id = cfg.org
    and s.active
    and s.lat is not null
    and a.visits_considered >= p_min_visits
    -- Judged against the store's own geofence as well as the flat threshold: a
    -- large site legitimately has people checking in further from its centre.
    and a.median_offset_m >= greatest(p_min_median_m, s.geofence_radius_m)
  order by a.median_offset_m desc;
$$;

comment on function public.store_location_drift is
  'Stores whose check-ins keep landing far from the recorded position. Reports the typical offset, how tightly the check-ins agree, and where they cluster. Read spread_m first: a small spread with a large median means the stored point is wrong and cluster_lat/lng is worth offering as a correction; a large spread means the visits are scattered and the cluster is a meaningless average of them — do not offer it. Suggests, never moves.';

-- The drift query reads every check-in in the org with a position. That is the
-- fastest-growing table here and this will run on a dashboard.
create index if not exists visits_org_store_checkin_idx
  on public.visits (org_id, store_id, checkin_at desc)
  where checkin_lat is not null;
