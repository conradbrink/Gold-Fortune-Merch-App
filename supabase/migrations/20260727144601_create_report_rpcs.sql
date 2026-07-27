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
