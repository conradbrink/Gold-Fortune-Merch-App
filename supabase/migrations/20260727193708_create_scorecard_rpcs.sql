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
