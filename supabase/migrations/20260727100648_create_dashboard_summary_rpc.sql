-- Replaces the dashboard's 7 sequential client queries with one call, two of
-- which pulled whole tables to the browser just to run count(distinct) in JS.
-- security invoker so RLS still applies: a rep calling this sees only their rows.
--
-- NOTE: superseded by 20260727141220_fix_dashboard_coverage_denominator.sql,
-- which corrects the coverage numerator. Kept here so the history replays.
create or replace function public.dashboard_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    -- Materialised so the planner sees a literal org_id and can actually use
    -- visits_org_checkin_at_idx rather than re-evaluating the helper per row.
    select public.current_org_id() as org,
           p_from as cur_from,
           p_to   as cur_to,
           p_from - (p_to - p_from) as prev_from
  ),
  -- Missed / not-started visits have no checkin_at, so fall back to the
  -- scheduled time or they'd vanish from every period filter.
  scoped as materialized (
    select v.id, v.rep_id, v.store_id, v.status, v.route_id, v.duration_seconds,
           coalesce(v.checkin_at, r.scheduled_start_at) as occurred_at
    from visits v
    left join routes r on r.id = v.route_id
    cross join cfg
    where v.org_id = cfg.org
      and coalesce(v.checkin_at, r.scheduled_start_at) >= cfg.prev_from
      and coalesce(v.checkin_at, r.scheduled_start_at) <  cfg.cur_to
  ),
  period as (
    select s.*, case when s.occurred_at >= cfg.cur_from then 'current' else 'previous' end as bucket
    from scoped s cross join cfg
  ),
  agg as (
    select bucket,
      count(*) as visits_total,
      count(*) filter (where status = 'checked_out') as visits_completed,
      count(*) filter (where status = 'missed') as visits_missed,
      count(*) filter (where route_id is null) as visits_unscheduled,
      count(distinct rep_id) filter (where status = 'checked_out') as active_reps,
      count(distinct store_id) filter (where status = 'checked_out') as stores_covered,
      avg(duration_seconds) filter (where status = 'checked_out') as avg_duration
    from period group by bucket
  ),
  subagg as (
    select case when s.submitted_at >= cfg.cur_from then 'current' else 'previous' end as bucket,
           count(*) as submissions
    from form_submissions s cross join cfg
    where s.org_id = cfg.org and s.submitted_at >= cfg.prev_from and s.submitted_at < cfg.cur_to
    group by 1
  ),
  formagg as (
    select case when s.submitted_at >= cfg.cur_from then 'current' else 'previous' end as bucket,
      count(*) filter (where f.metric_key = 'in_stock') as instock_n,
      count(*) filter (where f.metric_key = 'in_stock' and r.value_boolean is false) as oos_n,
      count(*) filter (where f.metric_key = 'planogram_ok') as plano_n,
      count(*) filter (where f.metric_key = 'planogram_ok' and r.value_boolean is true) as plano_ok_n
    from form_responses r
    join form_fields f on f.id = r.form_field_id
    join form_submissions s on s.id = r.form_submission_id
    cross join cfg
    where s.org_id = cfg.org and s.submitted_at >= cfg.prev_from and s.submitted_at < cfg.cur_to
    group by 1
  ),
  blocks as (
    select b.bucket, jsonb_build_object(
        'visits_total',       coalesce(a.visits_total, 0),
        'visits_completed',   coalesce(a.visits_completed, 0),
        'visits_missed',      coalesce(a.visits_missed, 0),
        'visits_unscheduled', coalesce(a.visits_unscheduled, 0),
        'active_reps',        coalesce(a.active_reps, 0),
        'stores_covered',     coalesce(a.stores_covered, 0),
        'avg_duration_seconds', round(coalesce(a.avg_duration, 0)),
        'submissions',        coalesce(sa.submissions, 0),
        -- null (not zero) when there is nothing to measure, so the UI can show
        -- an em dash instead of claiming a real 0%.
        'oos_rate',        case when fa.instock_n > 0 then round(fa.oos_n::numeric / fa.instock_n, 4) end,
        'planogram_rate',  case when fa.plano_n   > 0 then round(fa.plano_ok_n::numeric / fa.plano_n, 4) end
      ) as obj
    from (values ('current'), ('previous')) b(bucket)
    left join agg     a  on a.bucket  = b.bucket
    left join subagg  sa on sa.bucket = b.bucket
    left join formagg fa on fa.bucket = b.bucket
  ),
  -- generate_series so days with no activity return 0 rather than being absent,
  -- otherwise a sparse range renders as a broken-looking chart.
  series as (
    select to_char(d.day, 'YYYY-MM-DD') as day,
           count(p.id) filter (where p.status = 'checked_out') as completed,
           count(p.id) as total
    from cfg
    cross join lateral generate_series(cfg.cur_from::date,
                                       (cfg.cur_to - interval '1 second')::date,
                                       interval '1 day') as d(day)
    left join period p on p.bucket = 'current'
                      and (p.occurred_at at time zone 'UTC')::date = d.day::date
    group by d.day
  )
  select jsonb_build_object(
    'stores_active', (select count(*) from stores s, cfg where s.org_id = cfg.org and s.active),
    'current',       (select obj from blocks where bucket = 'current'),
    'previous',      (select obj from blocks where bucket = 'previous'),
    'series',        (select coalesce(jsonb_agg(jsonb_build_object(
                                'day', day, 'completed', completed, 'total', total
                              ) order by day), '[]'::jsonb) from series)
  );
$$;
