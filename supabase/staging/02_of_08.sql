-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 2 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260727141220_fix_dashboard_coverage_denominator.sql
--    .. through 20260727200143_create_rep_directory_rpc.sql
--
-- Run the chunks in order.
--
-- Wrapped in a transaction, so a statement that fails should take the
-- whole chunk back out with it. That is a *should*: supabase/README.md
-- records a 377 KB script that failed and had partly applied anyway,
-- so the editor cannot be assumed to honour it. The per-migration
-- stamps and 99_resume.sql are still the authority on what landed —
-- check them rather than re-running blind.
-- ──────────────────────────────────────────────────────────────────────────

begin;
-- ──────────────────────────────────────────────────────────────────────────
-- 17/76  20260727141220_fix_dashboard_coverage_denominator.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Coverage read 114% because the numerator counted every store with a visit
-- (including the deactivated Raleigh Costco) while the denominator counted only
-- active stores. Restrict the numerator to active stores so the two agree.
create or replace function public.dashboard_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           p_from as cur_from,
           p_to   as cur_to,
           p_from - (p_to - p_from) as prev_from
  ),
  scoped as materialized (
    select v.id, v.rep_id, v.store_id, v.status, v.route_id, v.duration_seconds,
           st.active as store_active,
           coalesce(v.checkin_at, r.scheduled_start_at) as occurred_at
    from visits v
    join stores st on st.id = v.store_id
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
      count(distinct store_id) filter (where status = 'checked_out' and store_active)
        as stores_covered,
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
      count(*) filter (where f.metric_key = 'planogram_ok' and r.value_boolean is true) as plano_ok_n,
      avg(r.value_number) filter (where f.metric_key = 'facings') as avg_facings
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
        'oos_rate',       case when fa.instock_n > 0 then round(fa.oos_n::numeric / fa.instock_n, 4) end,
        'planogram_rate', case when fa.plano_n   > 0 then round(fa.plano_ok_n::numeric / fa.plano_n, 4) end,
        'avg_facings',    round(fa.avg_facings, 2)
      ) as obj
    from (values ('current'), ('previous')) b(bucket)
    left join agg     a  on a.bucket  = b.bucket
    left join subagg  sa on sa.bucket = b.bucket
    left join formagg fa on fa.bucket = b.bucket
  ),
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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727141220', 'fix_dashboard_coverage_denominator')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 18/76  20260727144601_create_report_rpcs.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Reports engine. Four aggregation RPCs so the browser never pulls
-- form_responses rows (3,351 today and growing per visit).
-- All: security invoker, current_org_id() materialised into a CTE so the
-- planner sees a literal and can use visits_org_checkin_at_idx.
--
-- NOTE: form_report's number-bucket branch is corrected in the following
-- migration (20260727144746). This file is the record of what was applied.

-- 1. Generic per-template form report. One row per field; the shape of `stats`
--    is determined by field_type, so adding a field type means extending this
--    CASE rather than rewriting the page.
create or replace function public.form_report(
  p_template_id uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_rep_ids     uuid[] default null,
  p_store_ids   uuid[] default null
)
returns table (
  field_id       uuid,
  label          text,
  field_type     text,
  metric_key     text,
  sort_order     int,
  response_count bigint,
  stats          jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  subs as materialized (
    select s.id, s.submitted_at
    from form_submissions s
    left join visits v on v.id = s.visit_id
    cross join cfg
    where s.org_id = cfg.org
      and s.form_template_id = p_template_id
      and s.submitted_at >= p_from
      and s.submitted_at <  p_to
      and (p_rep_ids   is null or s.rep_id   = any(p_rep_ids))
      and (p_store_ids is null or v.store_id = any(p_store_ids))
  ),
  resp as materialized (
    select r.form_field_id, r.value_text, r.value_number, r.value_boolean,
           r.photo_id, sb.id as sub_id, sb.submitted_at
    from form_responses r
    join subs sb on sb.id = r.form_submission_id
  )
  select
    f.id, f.label, f.field_type, f.metric_key, f.sort_order,
    (select count(*) from resp r where r.form_field_id = f.id) as response_count,
    case f.field_type

      when 'number' then (
        select jsonb_build_object(
          'min', min(r.value_number),
          'avg', round(avg(r.value_number), 2),
          'max', max(r.value_number),
          'sum', sum(r.value_number),
          'buckets', coalesce((
            select jsonb_agg(jsonb_build_object('value', d.v, 'count', d.n) order by d.v)
            from (
              select r2.value_number as v, count(*) as n
              from resp r2
              where r2.form_field_id = f.id and r2.value_number is not null
              group by 1 order by 1 limit 25
            ) d
          ), '[]'::jsonb)
        )
        from resp r
        where r.form_field_id = f.id and r.value_number is not null
      )

      when 'boolean' then (
        select jsonb_build_object(
          'yes', count(*) filter (where r.value_boolean),
          'no',  count(*) filter (where not r.value_boolean)
        )
        from resp r
        where r.form_field_id = f.id and r.value_boolean is not null
      )

      -- Options with zero responses must still appear, or "nobody ever picks
      -- Top shelf" becomes invisible instead of being the finding.
      when 'multiple_choice' then (
        select jsonb_build_object('options', coalesce(
          jsonb_agg(jsonb_build_object('option', o.opt, 'count', o.n) order by o.ord),
          '[]'::jsonb))
        from (
          select opt.value #>> '{}' as opt,
                 opt.ordinality     as ord,
                 (select count(*) from resp r
                   where r.form_field_id = f.id
                     and r.value_text = opt.value #>> '{}') as n
          from jsonb_array_elements(coalesce(f.options, '[]'::jsonb))
               with ordinality as opt(value, ordinality)
        ) o
      )

      when 'photo' then (
        select jsonb_build_object(
          'count', (select count(*) from resp r2
                     join photos p2 on p2.id = r2.photo_id
                     where r2.form_field_id = f.id),
          -- Capped: a 90-day range can hold hundreds, and each one costs a
          -- signed-URL slot on the client.
          'paths', coalesce((
            select jsonb_agg(t.storage_path)
            from (
              select p.storage_path
              from resp r join photos p on p.id = r.photo_id
              where r.form_field_id = f.id and p.storage_path is not null
              order by p.taken_at desc nulls last
              limit 60
            ) t
          ), '[]'::jsonb)
        )
      )

      when 'text' then (
        select jsonb_build_object('recent', coalesce(jsonb_agg(t.x), '[]'::jsonb))
        from (
          select jsonb_build_object(
                   'text', r.value_text,
                   'submitted_at', r.submitted_at
                 ) as x
          from resp r
          where r.form_field_id = f.id
            and nullif(btrim(r.value_text), '') is not null
          order by r.submitted_at desc
          limit 20
        ) t
      )
    end as stats
  from form_fields f
  where f.form_template_id = p_template_id
  order by f.sort_order;
$$;

-- 2. Which stores are being neglected. Never-visited stores sort first: they
--    are the largest gap, and a null last-visit must not sort as "recent".
create or replace function public.coverage_gaps(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id         uuid,
  store_name       text,
  store_group      text,
  city             text,
  state            text,
  last_visit_at    timestamptz,
  days_since       numeric,
  visits_in_period bigint,
  primary_rep_id   uuid,
  primary_rep_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  sc as (
    select s.id, s.name, s.city, s.state, g.name as grp
    from stores s
    left join store_groups g on g.id = s.store_group_id
    cross join cfg
    where s.org_id = cfg.org and s.active
  ),
  -- Deliberately over all history, not the filtered range: "last visited"
  -- means last visited, not last visited inside the window you happen to
  -- be looking at.
  lv as (
    select v.store_id, max(v.checkin_at) as last_visit_at
    from visits v cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null
    group by 1
  ),
  inper as (
    select v.store_id, count(*) as n
    from visits v cross join cfg
    where v.org_id = cfg.org
      and v.checkin_at >= p_from and v.checkin_at < p_to
      and v.status = 'checked_out'
    group by 1
  ),
  pr as (
    select a.store_id, a.rep_id, p.full_name
    from store_assignments a
    left join profiles p on p.id = a.rep_id
    cross join cfg
    where a.org_id = cfg.org and a.is_primary
  )
  select sc.id, sc.name, sc.grp, sc.city, sc.state,
         lv.last_visit_at,
         case when lv.last_visit_at is not null
              then round((extract(epoch from (p_to - lv.last_visit_at)) / 86400.0)::numeric, 1)
         end,
         coalesce(inper.n, 0),
         pr.rep_id, pr.full_name
  from sc
  left join lv    on lv.store_id    = sc.id
  left join inper on inper.store_id = sc.id
  left join pr    on pr.store_id    = sc.id
  order by lv.last_visit_at asc nulls first, sc.name;
$$;

-- 3. Per-rep performance. verified_rate is the share of check-ins that landed
--    inside the store's geofence — the same signal the Activities page shows
--    per event, aggregated per person.
create or replace function public.rep_scorecard(
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
  verified_rate        numeric
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
  )
  select v.rep_id,
         p.full_name,
         count(*),
         count(*) filter (where v.status = 'checked_out'),
         case when count(*) > 0
              then round((count(*) filter (where v.status = 'checked_out'))::numeric
                         / count(*), 4) end,
         round(avg(v.duration_seconds) filter (where v.status = 'checked_out'), 0),
         count(distinct v.store_id) filter (where v.status = 'checked_out'),
         coalesce(max(sub.n), 0),
         case when count(*) filter (where v.status = 'checked_out') > 0
              then round(coalesce(max(sub.n), 0)::numeric
                         / count(*) filter (where v.status = 'checked_out'), 4) end,
         -- Only visits with a fix count toward the denominator; a missing fix
         -- is "unknown", never a failure.
         case when count(*) filter (where v.dist is not null) > 0
              then round((count(*) filter (where v.dist is not null
                                             and v.dist <= v.geofence_radius_m))::numeric
                         / count(*) filter (where v.dist is not null), 4) end
  from v
  left join profiles p on p.id = v.rep_id
  left join sub      on sub.rep_id = v.rep_id
  group by v.rep_id, p.full_name
  order by count(*) filter (where v.status = 'checked_out') desc;
$$;

-- 4. Compliance metrics over time. Keys off form_fields.metric_key, never
--    labels — renaming a question must not silently break the chart.
create or replace function public.compliance_trends(
  p_from            timestamptz,
  p_to              timestamptz,
  p_bucket          text default 'day',
  p_store_group_id  uuid default null
)
returns table (
  bucket_start       timestamptz,
  submissions        bigint,
  oos_rate           numeric,
  planogram_rate     numeric,
  price_correct_rate numeric,
  avg_facings        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           case when p_bucket = 'week' then 'week' else 'day' end as unit
  ),
  s as materialized (
    select fs.id, date_trunc((select unit from cfg), fs.submitted_at) as bkt
    from form_submissions fs
    left join visits v  on v.id  = fs.visit_id
    left join stores st on st.id = v.store_id
    cross join cfg
    where fs.org_id = cfg.org
      and fs.submitted_at >= p_from
      and fs.submitted_at <  p_to
      and (p_store_group_id is null or st.store_group_id = p_store_group_id)
  ),
  r as (
    select s.bkt, f.metric_key, fr.value_boolean, fr.value_number, fr.value_text
    from form_responses fr
    join s on s.id = fr.form_submission_id
    join form_fields f on f.id = fr.form_field_id
    where f.metric_key is not null
  ),
  sc as (
    select bkt, count(*) as n from s group by 1
  ),
  mc as (
    select bkt,
      count(*) filter (where metric_key = 'in_stock')                             as instock_n,
      count(*) filter (where metric_key = 'in_stock' and value_boolean is false)  as oos_n,
      count(*) filter (where metric_key = 'planogram_ok')                         as plano_n,
      count(*) filter (where metric_key = 'planogram_ok' and value_boolean)       as plano_ok_n,
      count(*) filter (where metric_key = 'price_correct')                        as price_n,
      count(*) filter (where metric_key = 'price_correct' and value_text = 'Correct') as price_ok_n,
      avg(value_number) filter (where metric_key = 'facings')                     as avg_facings
    from r group by 1
  )
  select sc.bkt,
         sc.n,
         case when mc.instock_n > 0 then round(mc.oos_n::numeric      / mc.instock_n, 4) end,
         case when mc.plano_n   > 0 then round(mc.plano_ok_n::numeric / mc.plano_n,   4) end,
         case when mc.price_n   > 0 then round(mc.price_ok_n::numeric / mc.price_n,   4) end,
         round(mc.avg_facings, 2)
  from sc
  left join mc on mc.bkt = sc.bkt
  order by sc.bkt;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727144601', 'create_report_rpcs')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 19/76  20260727144746_fix_form_report_number_buckets.sql
-- ──────────────────────────────────────────────────────────────────────────

-- The first cut emitted one bucket per distinct value, capped at 25. That is
-- right for facings (integers 1–15) but wrong for a continuous measure: shelf
-- price has 262 distinct values, so the "distribution" was really just the 25
-- cheapest prices sorted ascending — a chart that looks plausible and means
-- nothing. Branch on cardinality: exact bars for low-cardinality integers,
-- equal-width range bins otherwise. Both shapes now use {label, count}.
create or replace function public.form_report(
  p_template_id uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_rep_ids     uuid[] default null,
  p_store_ids   uuid[] default null
)
returns table (
  field_id       uuid,
  label          text,
  field_type     text,
  metric_key     text,
  sort_order     int,
  response_count bigint,
  stats          jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  subs as materialized (
    select s.id, s.submitted_at
    from form_submissions s
    left join visits v on v.id = s.visit_id
    cross join cfg
    where s.org_id = cfg.org
      and s.form_template_id = p_template_id
      and s.submitted_at >= p_from
      and s.submitted_at <  p_to
      and (p_rep_ids   is null or s.rep_id   = any(p_rep_ids))
      and (p_store_ids is null or v.store_id = any(p_store_ids))
  ),
  resp as materialized (
    select r.form_field_id, r.value_text, r.value_number, r.value_boolean,
           r.photo_id, sb.id as sub_id, sb.submitted_at
    from form_responses r
    join subs sb on sb.id = r.form_submission_id
  )
  select
    f.id, f.label, f.field_type, f.metric_key, f.sort_order,
    (select count(*) from resp r where r.form_field_id = f.id) as response_count,
    case f.field_type

      when 'number' then (
        with vals as (
          select r.value_number as v
          from resp r
          where r.form_field_id = f.id and r.value_number is not null
        ),
        b as (
          select min(v) as mn, max(v) as mx, count(*) as n,
                 count(distinct v) as d, coalesce(bool_and(v = round(v)), false) as all_int
          from vals
        )
        select jsonb_build_object(
          'min', b.mn,
          'avg', (select round(avg(v), 2) from vals),
          'max', b.mx,
          'sum', (select sum(v) from vals),
          'buckets', case
            when b.n = 0 then '[]'::jsonb
            -- Discrete counts (facings): one bar per exact value.
            when b.all_int and b.d <= 25 then coalesce((
              select jsonb_agg(jsonb_build_object('label', t.v::text, 'count', t.c) order by t.v)
              from (select v, count(*) as c from vals group by v) t
            ), '[]'::jsonb)
            -- Continuous measures (price): ten equal-width range bins.
            when b.mx > b.mn then coalesce((
              select jsonb_agg(jsonb_build_object(
                       'label', round(b.mn + (i - 1) * s.step, 2)::text || ' – ' ||
                                round(b.mn + i * s.step, 2)::text,
                       'count', (select count(*) from vals
                                  where v >= b.mn + (i - 1) * s.step
                                    and (v < b.mn + i * s.step or i = 10))
                     ) order by i)
              from generate_series(1, 10) as i,
                   lateral (select (b.mx - b.mn) / 10.0 as step) s
            ), '[]'::jsonb)
            -- Every response identical: one bar, not a divide-by-zero.
            else jsonb_build_array(jsonb_build_object('label', b.mn::text, 'count', b.n))
          end
        )
        from b
      )

      when 'boolean' then (
        select jsonb_build_object(
          'yes', count(*) filter (where r.value_boolean),
          'no',  count(*) filter (where not r.value_boolean)
        )
        from resp r
        where r.form_field_id = f.id and r.value_boolean is not null
      )

      -- Options with zero responses must still appear, or "nobody ever picks
      -- Top shelf" becomes invisible instead of being the finding.
      when 'multiple_choice' then (
        select jsonb_build_object('options', coalesce(
          jsonb_agg(jsonb_build_object('option', o.opt, 'count', o.n) order by o.ord),
          '[]'::jsonb))
        from (
          select opt.value #>> '{}' as opt,
                 opt.ordinality     as ord,
                 (select count(*) from resp r
                   where r.form_field_id = f.id
                     and r.value_text = opt.value #>> '{}') as n
          from jsonb_array_elements(coalesce(f.options, '[]'::jsonb))
               with ordinality as opt(value, ordinality)
        ) o
      )

      when 'photo' then (
        select jsonb_build_object(
          'count', (select count(*) from resp r2
                     join photos p2 on p2.id = r2.photo_id
                     where r2.form_field_id = f.id),
          -- Capped: a 90-day range holds hundreds, and each path costs a
          -- signed-URL slot on the client.
          'paths', coalesce((
            select jsonb_agg(t.storage_path)
            from (
              select p.storage_path
              from resp r join photos p on p.id = r.photo_id
              where r.form_field_id = f.id and p.storage_path is not null
              order by p.taken_at desc nulls last
              limit 60
            ) t
          ), '[]'::jsonb)
        )
      )

      when 'text' then (
        select jsonb_build_object('recent', coalesce(jsonb_agg(t.x), '[]'::jsonb))
        from (
          select jsonb_build_object(
                   'text', r.value_text,
                   'submitted_at', r.submitted_at
                 ) as x
          from resp r
          where r.form_field_id = f.id
            and nullif(btrim(r.value_text), '') is not null
          order by r.submitted_at desc
          limit 20
        ) t
      )
    end as stats
  from form_fields f
  where f.form_template_id = p_template_id
  order by f.sort_order;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727144746', 'fix_form_report_number_buckets')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 20/76  20260727193617_add_oos_skus_and_pos_metric_keys.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Two audit questions carry real signal but had no metric_key, so the only way
-- to find them was by label — the exact fragility metric_key exists to avoid
-- (a manager renaming a question would silently break the report).
--
-- Matching on label is acceptable here precisely because it happens once, at
-- backfill time, the same way the original metric_key backfill did. All query
-- code keys off metric_key from now on.
alter table public.form_fields drop constraint form_fields_metric_key_check;

alter table public.form_fields add constraint form_fields_metric_key_check
  check (
    metric_key is null or metric_key = any (array[
      'in_stock', 'facings', 'shelf_position', 'planogram_ok', 'price_correct',
      'promo_display', 'damaged_expired', 'coupons',
      'oos_skus',      -- free-text list of out-of-stock SKUs
      'pos_materials'  -- point-of-sale material presence
    ])
  );

update public.form_fields
   set metric_key = 'oos_skus'
 where metric_key is null
   and field_type = 'text'
   and label ilike '%out of stock%';

update public.form_fields
   set metric_key = 'pos_materials'
 where metric_key is null
   and field_type = 'multiple_choice'
   and label ilike '%point-of-sale%';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727193617', 'add_oos_skus_and_pos_metric_keys')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 21/76  20260727193708_create_scorecard_rpcs.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Three reports that answer "which store do I fix first?" rather than
-- "what happened?". Same rules as the rest: security invoker, current_org_id()
-- materialised, keyed off metric_key and never off labels.
--
-- NOTE: oos_hotspots and schedule_adherence are each corrected in a following
-- migration (…193837 and …194019). This file records what was applied.

-- 1. Perfect Store score — the FMCG industry-standard composite. Four equally
--    weighted pillars collapse into one 0-100 index, ranked worst-first.
--
--    promo_display is deliberately NOT a pillar: it sits near 29% overall, which
--    reflects promos not always running rather than stores failing, so including
--    it would drag every score down for a reason nobody can act on.
create or replace function public.perfect_store_score(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id         uuid,
  store_name       text,
  store_group      text,
  audits           bigint,
  availability_pct numeric,
  planogram_pct    numeric,
  price_pct        numeric,
  condition_pct    numeric,
  score            numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  r as materialized (
    select v.store_id, f.metric_key, fr.value_boolean, fr.value_text,
           fs.id as sub_id
    from form_responses fr
    join form_fields f       on f.id  = fr.form_field_id
    join form_submissions fs on fs.id = fr.form_submission_id
    join visits v            on v.id  = fs.visit_id
    cross join cfg
    where fs.org_id = cfg.org
      and fs.submitted_at >= p_from
      and fs.submitted_at <  p_to
      and f.metric_key in ('in_stock', 'planogram_ok', 'price_correct', 'damaged_expired')
  ),
  agg as (
    select store_id,
      count(distinct sub_id) as audits,
      -- Each pillar is null when never measured, so it drops out of the average
      -- below. A store nobody price-checked must not score as having FAILED
      -- price compliance.
      case when count(*) filter (where metric_key = 'in_stock') > 0 then
        round(100.0 * count(*) filter (where metric_key = 'in_stock' and value_boolean)
              / count(*) filter (where metric_key = 'in_stock'), 1) end as availability_pct,
      case when count(*) filter (where metric_key = 'planogram_ok') > 0 then
        round(100.0 * count(*) filter (where metric_key = 'planogram_ok' and value_boolean)
              / count(*) filter (where metric_key = 'planogram_ok'), 1) end as planogram_pct,
      case when count(*) filter (where metric_key = 'price_correct') > 0 then
        round(100.0 * count(*) filter (where metric_key = 'price_correct' and value_text = 'Correct')
              / count(*) filter (where metric_key = 'price_correct'), 1) end as price_pct,
      -- Inverted: the ABSENCE of damaged/expired stock is the good outcome.
      case when count(*) filter (where metric_key = 'damaged_expired') > 0 then
        round(100.0 * count(*) filter (where metric_key = 'damaged_expired' and value_boolean is false)
              / count(*) filter (where metric_key = 'damaged_expired'), 1) end as condition_pct
    from r
    group by store_id
  )
  select s.id, s.name, g.name,
         coalesce(a.audits, 0),
         a.availability_pct, a.planogram_pct, a.price_pct, a.condition_pct,
         -- Mean of the pillars actually measured, not of four assumed pillars.
         round(
           (coalesce(a.availability_pct, 0) + coalesce(a.planogram_pct, 0)
            + coalesce(a.price_pct, 0) + coalesce(a.condition_pct, 0))
           / nullif((a.availability_pct is not null)::int + (a.planogram_pct is not null)::int
                    + (a.price_pct is not null)::int + (a.condition_pct is not null)::int, 0)
         , 1) as score
  from stores s
  left join store_groups g on g.id = s.store_group_id
  left join agg a          on a.store_id = s.id
  cross join cfg
  where s.org_id = cfg.org and s.active
  order by score asc nulls last, s.name;
$$;

-- 2. Out-of-stock hotspots. The existing trend line shows the rate over time but
--    cannot distinguish a chronic store from an unlucky one — max_consecutive_oos
--    is what separates them.
create or replace function public.oos_hotspots(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id            uuid,
  store_name          text,
  checks              bigint,
  oos_count           bigint,
  oos_rate            numeric,
  max_consecutive_oos int,
  last_oos_at         timestamptz,
  top_skus            jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  checks as materialized (
    select v.store_id,
           fs.submitted_at,
           (fr.value_boolean is false) as is_oos,
           fs.id as sub_id
    from form_responses fr
    join form_fields f       on f.id  = fr.form_field_id
    join form_submissions fs on fs.id = fr.form_submission_id
    join visits v            on v.id  = fs.visit_id
    cross join cfg
    where fs.org_id = cfg.org
      and fs.submitted_at >= p_from
      and fs.submitted_at <  p_to
      and f.metric_key = 'in_stock'
      and fr.value_boolean is not null
  ),
  -- Classic gaps-and-islands: subtracting a per-state row number from the
  -- overall row number yields a constant group id per unbroken run.
  numbered as (
    select store_id, submitted_at, is_oos,
           row_number() over (partition by store_id order by submitted_at) as rn,
           row_number() over (partition by store_id, is_oos order by submitted_at) as rn_state
    from checks
  ),
  runs as (
    select store_id, count(*) as run_len
    from numbered
    where is_oos
    group by store_id, (rn - rn_state)
  ),
  skus as (
    select v.store_id,
           jsonb_agg(jsonb_build_object('sku', t.sku, 'n', t.n) order by t.n desc) as top_skus
    from (
      select v2.store_id as sid, btrim(fr.value_text) as sku, count(*) as n
      from form_responses fr
      join form_fields f       on f.id  = fr.form_field_id
      join form_submissions fs on fs.id = fr.form_submission_id
      join visits v2           on v2.id = fs.visit_id
      cross join cfg
      where fs.org_id = cfg.org
        and fs.submitted_at >= p_from and fs.submitted_at < p_to
        and f.metric_key = 'oos_skus'
        and nullif(btrim(fr.value_text), '') is not null
      group by 1, 2
      order by 3 desc
      limit 200
    ) t
    join visits v on v.store_id = t.sid
    group by v.store_id
  ),
  totals as (
    select store_id,
           count(*) as checks,
           count(*) filter (where is_oos) as oos_count,
           max(submitted_at) filter (where is_oos) as last_oos_at
    from checks group by store_id
  )
  select t.store_id, s.name,
         t.checks, t.oos_count,
         round(t.oos_count::numeric / nullif(t.checks, 0), 4),
         coalesce((select max(run_len) from runs where runs.store_id = t.store_id), 0)::int,
         t.last_oos_at,
         coalesce((select sk.top_skus from skus sk where sk.store_id = t.store_id), '[]'::jsonb)
  from totals t
  join stores s on s.id = t.store_id
  where t.oos_count > 0
  order by t.oos_count::numeric / nullif(t.checks, 0) desc nulls last, t.oos_count desc;
$$;

-- 3. Schedule adherence: planned routes versus what actually happened.
create or replace function public.schedule_adherence(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id         uuid,
  rep_name       text,
  planned        bigint,
  completed      bigint,
  missed         bigint,
  adherence_rate numeric,
  missed_detail  jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, current_date as today
  ),
  r as materialized (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date, v.status
    from routes ro
    left join visits v on v.route_id = ro.id
    cross join cfg
    where ro.org_id = cfg.org
      and ro.scheduled_date >= p_from::date
      and ro.scheduled_date <  p_to::date
      -- A route scheduled for tomorrow is not "missed" — it simply hasn't
      -- happened yet. Counting it would make every rep look negligent.
      and ro.scheduled_date <= cfg.today
  )
  select r.rep_id,
         p.full_name,
         count(*),
         count(*) filter (where r.status = 'checked_out'),
         count(*) filter (where r.status is distinct from 'checked_out'),
         case when count(*) > 0
              then round((count(*) filter (where r.status = 'checked_out'))::numeric / count(*), 4)
         end,
         coalesce((
           select jsonb_agg(jsonb_build_object('store', st.name, 'date', r2.scheduled_date)
                            order by r2.scheduled_date desc)
           from (
             select * from r r3
             where r3.rep_id is not distinct from r.rep_id
               and r3.status is distinct from 'checked_out'
             order by r3.scheduled_date desc
             limit 10
           ) r2
           join stores st on st.id = r2.store_id
         ), '[]'::jsonb)
  from r
  left join profiles p on p.id = r.rep_id
  group by r.rep_id, p.full_name
  order by 6 asc nulls last;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727193708', 'create_scorecard_rpcs')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 22/76  20260727193837_fix_oos_hotspots_sku_fanout.sql
-- ──────────────────────────────────────────────────────────────────────────

-- The first cut joined `visits` back onto the per-store SKU tally, which fans
-- out one row per visit at that store and multiplies every count — it reported
-- 288-714 distinct out-of-stock SKUs per store against ~40 audits. The tally is
-- already grouped by store; the join was simply wrong. Rank per store instead
-- and keep the top 5.
create or replace function public.oos_hotspots(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id            uuid,
  store_name          text,
  checks              bigint,
  oos_count           bigint,
  oos_rate            numeric,
  max_consecutive_oos int,
  last_oos_at         timestamptz,
  top_skus            jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  checks as materialized (
    select v.store_id,
           fs.submitted_at,
           (fr.value_boolean is false) as is_oos
    from form_responses fr
    join form_fields f       on f.id  = fr.form_field_id
    join form_submissions fs on fs.id = fr.form_submission_id
    join visits v            on v.id  = fs.visit_id
    cross join cfg
    where fs.org_id = cfg.org
      and fs.submitted_at >= p_from
      and fs.submitted_at <  p_to
      and f.metric_key = 'in_stock'
      and fr.value_boolean is not null
  ),
  -- Classic gaps-and-islands: subtracting a per-state row number from the
  -- overall row number yields a constant group id per unbroken run.
  numbered as (
    select store_id, submitted_at, is_oos,
           row_number() over (partition by store_id order by submitted_at) as rn,
           row_number() over (partition by store_id, is_oos order by submitted_at) as rn_state
    from checks
  ),
  runs as (
    select store_id, count(*) as run_len
    from numbered
    where is_oos
    group by store_id, (rn - rn_state)
  ),
  sku_counts as (
    select v.store_id,
           btrim(fr.value_text) as sku,
           count(*) as n,
           row_number() over (
             partition by v.store_id
             order by count(*) desc, btrim(fr.value_text)
           ) as rnk
    from form_responses fr
    join form_fields f       on f.id  = fr.form_field_id
    join form_submissions fs on fs.id = fr.form_submission_id
    join visits v            on v.id  = fs.visit_id
    cross join cfg
    where fs.org_id = cfg.org
      and fs.submitted_at >= p_from
      and fs.submitted_at <  p_to
      and f.metric_key = 'oos_skus'
      and nullif(btrim(fr.value_text), '') is not null
    group by v.store_id, btrim(fr.value_text)
  ),
  skus as (
    select store_id,
           jsonb_agg(jsonb_build_object('sku', sku, 'n', n) order by n desc, sku) as top_skus
    from sku_counts
    where rnk <= 5
    group by store_id
  ),
  totals as (
    select store_id,
           count(*) as checks,
           count(*) filter (where is_oos) as oos_count,
           max(submitted_at) filter (where is_oos) as last_oos_at
    from checks group by store_id
  )
  select t.store_id, s.name,
         t.checks, t.oos_count,
         round(t.oos_count::numeric / nullif(t.checks, 0), 4),
         coalesce((select max(run_len) from runs where runs.store_id = t.store_id), 0)::int,
         t.last_oos_at,
         coalesce(sk.top_skus, '[]'::jsonb)
  from totals t
  join stores s on s.id = t.store_id
  left join skus sk on sk.store_id = t.store_id
  where t.oos_count > 0
  order by t.oos_count::numeric / nullif(t.checks, 0) desc nulls last, t.oos_count desc;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727193837', 'fix_oos_hotspots_sku_fanout')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 23/76  20260727194019_fix_schedule_adherence_route_fanout.sql
-- ──────────────────────────────────────────────────────────────────────────

-- `left join visits on v.route_id = ro.id` fans out when a route has more than
-- one linked visit, double-counting it in `planned`. One route in the current
-- data has two visits, which made the total read 121 against 120 actual routes.
--
-- EXISTS is both fan-out-proof and the correct semantic: a route was served if
-- ANY linked visit checked out. A rep who checked in twice still served it once.
create or replace function public.schedule_adherence(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id         uuid,
  rep_name       text,
  planned        bigint,
  completed      bigint,
  missed         bigint,
  adherence_rate numeric,
  missed_detail  jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, current_date as today
  ),
  r as materialized (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date,
           exists (
             select 1 from visits v
             where v.route_id = ro.id and v.status = 'checked_out'
           ) as done
    from routes ro
    cross join cfg
    where ro.org_id = cfg.org
      and ro.scheduled_date >= p_from::date
      and ro.scheduled_date <  p_to::date
      -- A route scheduled for tomorrow is not "missed" — it simply hasn't
      -- happened yet. Counting it would make every rep look negligent.
      and ro.scheduled_date <= cfg.today
  )
  select r.rep_id,
         p.full_name,
         count(*),
         count(*) filter (where r.done),
         count(*) filter (where not r.done),
         case when count(*) > 0
              then round((count(*) filter (where r.done))::numeric / count(*), 4)
         end,
         coalesce((
           select jsonb_agg(jsonb_build_object('store', st.name, 'date', r2.scheduled_date)
                            order by r2.scheduled_date desc)
           from (
             select r3.store_id, r3.scheduled_date
             from r r3
             where r3.rep_id is not distinct from r.rep_id and not r3.done
             order by r3.scheduled_date desc
             limit 10
           ) r2
           join stores st on st.id = r2.store_id
         ), '[]'::jsonb)
  from r
  left join profiles p on p.id = r.rep_id
  group by r.rep_id, p.full_name
  order by 6 asc nulls last;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727194019', 'fix_schedule_adherence_route_fanout')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 24/76  20260727195020_add_rep_score_to_scorecard.sql
-- ──────────────────────────────────────────────────────────────────────────

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727195020', 'add_rep_score_to_scorecard')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 25/76  20260727200143_create_rep_directory_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Rep directory for the Representatives page. One call rather than a query per
-- rep: with 11 reps the N+1 version would fire 34 requests from the browser.
create or replace function public.rep_directory()
returns table (
  rep_id          uuid,
  rep_name        text,
  email           text,
  assigned_stores bigint,
  primary_stores  bigint,
  last_active_at  timestamptz,
  visits_30d      bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, now() - interval '30 days' as since
  ),
  a as (
    select sa.rep_id,
           count(*) as assigned_stores,
           count(*) filter (where sa.is_primary) as primary_stores
    from store_assignments sa
    cross join cfg
    where sa.org_id = cfg.org
    group by sa.rep_id
  ),
  v as (
    select vi.rep_id,
           max(vi.checkin_at) as last_active_at,
           count(*) filter (where vi.checkin_at >= cfg.since
                              and vi.status = 'checked_out') as visits_30d
    from visits vi
    cross join cfg
    where vi.org_id = cfg.org and vi.checkin_at is not null
    group by vi.rep_id
  )
  select p.id, p.full_name, p.email,
         coalesce(a.assigned_stores, 0),
         coalesce(a.primary_stores, 0),
         v.last_active_at,
         coalesce(v.visits_30d, 0)
  from profiles p
  cross join cfg
  left join a on a.rep_id = p.id
  left join v on v.rep_id = p.id
  where p.org_id = cfg.org
    and p.role = 'rep'
  order by p.full_name;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727200143', 'create_rep_directory_rpc')
on conflict (version) do nothing;

commit;
