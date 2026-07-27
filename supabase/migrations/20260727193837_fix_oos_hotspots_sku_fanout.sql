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
