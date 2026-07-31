-- A check-in inside the geofence must never read as off-site.
--
-- The verdict tested `distance_m > 500` before `distance_m > geofence_radius_m`.
-- For any store whose radius reaches 500 m — a mall, a depot — a check-in
-- *inside* the geofence returned 'off_site', and p_only_flagged plus
-- activity_feed_summary then presented compliant visits as exceptions. The
-- radius is per-store and configurable, so this was one settings change away
-- from firing; today every store sits at the default 100 m and no stored
-- verdict is affected (verdicts are computed at read time, so history heals
-- itself the moment this applies).
--
-- activity_feed_summary needs no change: it aggregates this function.
create or replace function public.activity_feed(
  p_from         timestamptz,
  p_to           timestamptz,
  p_rep_ids      uuid[]  default null,
  p_store_ids    uuid[]  default null,
  p_only_flagged boolean default false,
  p_limit        int     default 50,
  p_offset       int     default 0
)
returns table (
  event_id          text,
  kind              text,
  occurred_at       timestamptz,
  visit_id          uuid,
  rep_id            uuid,
  rep_name          text,
  store_id          uuid,
  store_name        text,
  distance_m        numeric,
  accuracy_m        numeric,
  geofence_radius_m int,
  verdict           text,
  submission_id     uuid,
  total_count       bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  events as (
    select v.id::text || ':in' as event_id,
           'check_in'::text    as kind,
           v.checkin_at        as occurred_at,
           v.id as visit_id, v.rep_id, v.store_id,
           null::text as company_name,
           v.checkin_distance_from_store_m::numeric as distance_m,
           v.checkin_gps_accuracy_m::numeric        as accuracy_m
    from visits v cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null

    union all

    -- No checkout_distance_from_store_m column exists, so derive it the same
    -- way the check-in distance was derived.
    select v.id::text || ':out',
           'check_out',
           v.checkout_at,
           v.id, v.rep_id, v.store_id,
           null::text,
           case when v.checkout_lat is not null and s.lat is not null then
             round((6371000 * 2 * asin(sqrt(
               power(sin(radians(s.lat - v.checkout_lat) / 2), 2)
               + cos(radians(v.checkout_lat)) * cos(radians(s.lat))
               * power(sin(radians(s.lng - v.checkout_lng) / 2), 2)
             )))::numeric, 1)
           end,
           null::numeric
    from visits v
    join stores s on s.id = v.store_id
    cross join cfg
    where v.org_id = cfg.org and v.checkout_at is not null

    union all

    -- One row per sales call, at the moment it started. Not two: a check-in
    -- and a check-out bracket time spent in a shop that is being audited,
    -- whereas what matters about a prospect is that it happened and what came
    -- of it — which the Leads board carries in full.
    select l.id::text || ':sales',
           'sales_visit',
           l.started_at,
           null::uuid, l.rep_id, null::uuid,
           l.company_name,
           null::numeric,
           null::numeric
    from leads l cross join cfg
    where l.org_id = cfg.org
  ),
  enriched as (
    select e.event_id, e.kind, e.occurred_at, e.visit_id, e.rep_id, e.store_id,
           e.distance_m, e.accuracy_m,
           -- A prospect has no store row; its name is the company the rep called on.
           coalesce(s.name, e.company_name) as store_name,
           s.geofence_radius_m,
           p.full_name as rep_name,
           case
             when e.kind = 'sales_visit'          then 'prospect'
             when e.distance_m is null            then 'unknown'
             -- Beyond 5km is a corrupt reading, not behaviour. Never present
             -- it as fact; it destroys trust in every other number here.
             when e.distance_m > 5000             then 'invalid_gps'
             -- The store's own radius decides first. It is configurable per
             -- store, and with the old order a radius past 500 m turned its
             -- own compliant check-ins into off_site: the flat literal was
             -- tested before the per-store bound, so the wider the geofence,
             -- the more of it counted as an exception. Latent until now —
             -- every store is at the default 100 m — and found in review.
             when e.distance_m <= s.geofence_radius_m then 'at_store'
             when e.distance_m > 500              then 'off_site'
             else 'nearby'
           end as verdict,
           (select fs.id from form_submissions fs
             where fs.visit_id = e.visit_id
             order by fs.submitted_at limit 1) as submission_id
    from events e
    -- LEFT, so a prospect survives having no store.
    left join stores s on s.id = e.store_id
    left join profiles p on p.id = e.rep_id
  ),
  filtered as (
    select * from enriched
    where occurred_at >= p_from
      and occurred_at <  p_to
      and (p_rep_ids   is null or rep_id   = any(p_rep_ids))
      -- Filtering by store excludes prospects, correctly: they are not in any
      -- store's history.
      and (p_store_ids is null or store_id = any(p_store_ids))
      and (not p_only_flagged or verdict in ('off_site', 'invalid_gps'))
  )
  select event_id, kind, occurred_at, visit_id, rep_id, rep_name,
         store_id, store_name, distance_m, accuracy_m, geofence_radius_m,
         verdict, submission_id,
         count(*) over () as total_count
  from filtered
  -- event_id tiebreaks so paging can't duplicate or skip rows sharing a timestamp.
  order by occurred_at desc, event_id
  limit p_limit offset p_offset;
$$;
