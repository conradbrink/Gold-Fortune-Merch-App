-- An overall 0-100 rep score, the people-side counterpart to perfect_store_score.
--
-- Three equally weighted pillars, all already computed here:
--   completion       — did the planned visit happen at all
--   form compliance  — was the audit actually submitted
--   location verified— was the rep demonstrably at the store
--
-- Location verification is not dropped by this change, it is folded in: it is a
-- genuine integrity signal and belongs in the score rather than beside it.
--
-- As with Perfect Store, a null pillar is EXCLUDED from the mean rather than
-- counted as zero. A rep whose visits recorded no GPS fix has not failed
-- verification — a flat battery must not read as dishonesty.
--
-- Return type changes, so the function has to be dropped rather than replaced.
drop function if exists public.rep_scorecard(timestamptz, timestamptz);

create function public.rep_scorecard(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id               uuid,
  rep_name             text,
  visits_total         bigint,
  visits_completed     bigint,
  completion_rate      numeric,
  avg_duration_seconds numeric,
  stores_covered       bigint,
  submissions          bigint,
  form_compliance_rate numeric,
  verified_rate        numeric,
  score                numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  v as materialized (
    select vi.id, vi.rep_id, vi.store_id, vi.status, vi.duration_seconds,
           vi.checkin_distance_from_store_m as dist,
           st.geofence_radius_m
    from visits vi
    join stores st on st.id = vi.store_id
    left join routes ro on ro.id = vi.route_id
    cross join cfg
    where vi.org_id = cfg.org
      and coalesce(vi.checkin_at, ro.scheduled_start_at) >= p_from
      and coalesce(vi.checkin_at, ro.scheduled_start_at) <  p_to
  ),
  -- distinct visits, not raw submissions, so compliance can never exceed 100%
  sub as (
    select v.rep_id, count(distinct fs.visit_id) as n
    from form_submissions fs
    join v on v.id = fs.visit_id
    group by 1
  ),
  base as (
    select v.rep_id,
           p.full_name,
           count(*) as visits_total,
           count(*) filter (where v.status = 'checked_out') as visits_completed,
           case when count(*) > 0
                then round((count(*) filter (where v.status = 'checked_out'))::numeric
                           / count(*), 4) end as completion_rate,
           round(avg(v.duration_seconds) filter (where v.status = 'checked_out'), 0) as avg_duration_seconds,
           count(distinct v.store_id) filter (where v.status = 'checked_out') as stores_covered,
           coalesce(max(sub.n), 0) as submissions,
           case when count(*) filter (where v.status = 'checked_out') > 0
                then round(coalesce(max(sub.n), 0)::numeric
                           / count(*) filter (where v.status = 'checked_out'), 4) end as form_compliance_rate,
           -- Only visits with a fix count toward the denominator; a missing fix
           -- is "unknown", never a failure.
           case when count(*) filter (where v.dist is not null) > 0
                then round((count(*) filter (where v.dist is not null
                                               and v.dist <= v.geofence_radius_m))::numeric
                           / count(*) filter (where v.dist is not null), 4) end as verified_rate
    from v
    left join profiles p on p.id = v.rep_id
    left join sub      on sub.rep_id = v.rep_id
    group by v.rep_id, p.full_name
  )
  select b.rep_id, b.full_name, b.visits_total, b.visits_completed,
         b.completion_rate, b.avg_duration_seconds, b.stores_covered,
         b.submissions, b.form_compliance_rate, b.verified_rate,
         round(
           100.0 * (coalesce(b.completion_rate, 0) + coalesce(b.form_compliance_rate, 0)
                    + coalesce(b.verified_rate, 0))
           / nullif((b.completion_rate is not null)::int
                    + (b.form_compliance_rate is not null)::int
                    + (b.verified_rate is not null)::int, 0)
         , 1) as score
  from base b
  order by score desc nulls last, b.visits_completed desc;
$$;
