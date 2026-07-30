-- Sales visits in the activity feed.
--
-- A call on a prospect is field activity like any other — the manager watching
-- this page wants to see that the rep was out working, not only the stops that
-- happened to be on a store list. The feed was built to take new event kinds
-- here rather than by merging streams in the client, so this is a third branch
-- of the same union.
--
-- Two shapes had to give:
--
--   * The store join becomes a LEFT JOIN. A prospect is by definition not a
--     store, so an inner join silently dropped every one of these rows.
--   * A new verdict, 'prospect'. Reusing 'unknown' would have been a lie —
--     that means "a position was expected and we could not get one", whereas
--     here there is a position and nothing to measure it against, because the
--     shop is not on the estate and has no geofence.
--
-- The summary strip deliberately excludes them: it answers "were they where
-- they said they were", and a prospect visit cannot answer that. Leaving them
-- in would have made the tiles stop adding up to the total.

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
             when e.distance_m > 500              then 'off_site'
             when e.distance_m > s.geofence_radius_m then 'nearby'
             else 'at_store'
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

-- Counts for the summary strip, across the whole range rather than one page.
--
-- Prospects are excluded here on purpose. This strip is the geofence verdict —
-- "were they where they said they were" — and a call on a shop with no
-- geofence has no answer to give. Counting them would inflate the total past
-- what the tiles below it add up to.
create or replace function public.activity_feed_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_rep_ids   uuid[] default null,
  p_store_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(verdict, n) || jsonb_build_object('total', sum(n)),
    '{"total": 0}'::jsonb
  )
  from (
    select verdict, count(*) as n
    from public.activity_feed(p_from, p_to, p_rep_ids, p_store_ids,
                              false, 1000000, 0)
    where verdict <> 'prospect'
    group by verdict
  ) x;
$$;
