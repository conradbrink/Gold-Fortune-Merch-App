-- Two follow-ups from the review of `20260828120000`. Both are edge cases the
-- current data does not exercise, and both are one clause each.
--
-- 1. **`audits` could read 0 against a real availability figure.**
--    `perfect_store_score` counts audits from a scan of `in_stock`,
--    `planogram_ok`, `price_correct` and `damaged_expired`, while availability
--    now comes from `oos_visit_flags`, which reads `in_stock` OR `oos_skus`. A
--    template carrying the SKU question and none of the other four — which a
--    manager can build in the form editor today — produces a submission that
--    `oos_visit_flags` counts and the audit scan does not. The store would show
--    an availability percentage above an audit count of zero.
--
--    Adding `oos_skus` to the scan is the whole fix: `audits` is
--    `count(distinct sub_id)`, so a metric key can only ever bring in a
--    submission that genuinely reached the store.
--
-- 2. **The range bounds were cast to `date` in the session timezone.**
--    `schedule_adherence` compares `routes.scheduled_date` against
--    `p_from::date` and `p_to::date`. Those are `timestamptz`, and the cast
--    resolves in whatever the session's TimeZone is — UTC here, not Gaborone.
--    The web sends an exclusive upper bound at local midnight, which is 22:00Z
--    the previous day, so `p_to::date` landed a day early and the last day of
--    the selected range was dropped from `planned` entirely.
--
--    `20260828120000` fixed the `today` cutoff in this same function and left
--    the bounds alone, which fixed the two-hours-a-night case and missed the
--    all-day one. Both now resolve through `org_timezone`.

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
      -- `in_stock` and `oos_skus` are here for `audits` only — availability
      -- comes from `oos_visit_flags` below. Both stock keys have to be in this
      -- list or a template that asks only the SKU question yields an
      -- availability percentage above an audit count of zero.
      and f.metric_key in ('in_stock', 'oos_skus', 'planogram_ok',
                           'price_correct', 'damaged_expired')
  ),
  avail as materialized (
    select store_id,
           count(*) filter (where answered)                as checked,
           count(*) filter (where answered and not is_oos) as in_stock_n
      from public.oos_visit_flags(p_from, p_to)
     group by store_id
  ),
  agg as (
    select store_id,
      count(distinct sub_id) as audits,
      -- Each pillar is null when never measured, so it drops out of the average
      -- below. A store nobody price-checked must not score as having FAILED
      -- price compliance.
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
  ),
  scored as (
    select s.id, s.name, g.name as grp,
           coalesce(a.audits, 0) as audits,
           case when av.checked > 0
                then round(100.0 * av.in_stock_n / av.checked, 1) end as availability_pct,
           a.planogram_pct, a.price_pct, a.condition_pct
    from stores s
    left join store_groups g on g.id = s.store_group_id
    left join agg a          on a.store_id = s.id
    left join avail av       on av.store_id = s.id
    cross join cfg
    where s.org_id = cfg.org and s.active
  )
  select sc.id, sc.name, sc.grp, sc.audits,
         sc.availability_pct, sc.planogram_pct, sc.price_pct, sc.condition_pct,
         -- Mean of the pillars actually measured, not of four assumed pillars.
         round(
           (coalesce(sc.availability_pct, 0) + coalesce(sc.planogram_pct, 0)
            + coalesce(sc.price_pct, 0) + coalesce(sc.condition_pct, 0))
           / nullif((sc.availability_pct is not null)::int + (sc.planogram_pct is not null)::int
                    + (sc.price_pct is not null)::int + (sc.condition_pct is not null)::int, 0)
         , 1) as score
  from scored sc
  order by score asc nulls last, sc.name;
$$;

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
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz
  ),
  bounds as materialized (
    -- `scheduled_date` is a calendar date, so both bounds have to be resolved
    -- to a calendar date in the organisation's zone. `p_to::date` alone used
    -- the session's TimeZone: the web sends an exclusive bound at local
    -- midnight, which is 22:00Z the day before in Gaborone, so the cast landed
    -- a day early and dropped the last day of the range.
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  r as materialized (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date,
           exists (
             select 1 from visits v
             where v.route_id = ro.id and v.status = 'checked_out'
           ) as done
    from routes ro
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      -- A route scheduled for tomorrow is not "missed" — it simply hasn't
      -- happened yet. Counting it would make every rep look negligent.
      and ro.scheduled_date <= b.today
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
