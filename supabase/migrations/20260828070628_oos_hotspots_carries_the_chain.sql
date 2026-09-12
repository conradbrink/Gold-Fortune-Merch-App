-- The out-of-stock table needs to say which chain a store belongs to.
--
-- Every other store-level report already returns `store_group` — Perfect Store
-- and Coverage both do — and the Reports page filters those by chain in the
-- browser. That is exact rather than lazy: they return one row per store, so
-- selecting rows for a chain gives precisely the chain's rows, with no
-- aggregate to get wrong. `oos_hotspots` was the only store-level report that
-- could not join that party, because it did not carry the group.
--
-- The alternative was a `p_store_group_id` argument on all five report RPCs.
-- Adding a parameter means DROP and CREATE rather than CREATE OR REPLACE — a
-- defaulted argument makes an overload, and two candidates with the same name
-- is an ambiguity error at every existing call site. Five of those against
-- one added column, to reach two reports the client can already filter
-- exactly, is not a trade worth making. The two that genuinely need it are the
-- rep-level ones, which this does not pretend to solve.
--
-- Only the return type and the final join change. The out-of-stock definition
-- from `20260828093000` is untouched.

drop function if exists public.oos_hotspots(timestamptz, timestamptz);

create function public.oos_hotspots(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id            uuid,
  store_name          text,
  store_group         text,
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
  -- One row per submission, not per response. Both stock questions live on the
  -- same submission, and "was this visit an out-of-stock" is a question about
  -- the visit.
  checks as materialized (
    select fs.id as submission_id,
           v.store_id,
           fs.submitted_at,
           bool_or((f.metric_key = 'in_stock' and fr.value_boolean is false)
                or (f.metric_key = 'oos_skus' and public.oos_names_skus(fr.value_text)))
             as is_oos,
           bool_or((f.metric_key = 'in_stock' and fr.value_boolean is not null)
                or (f.metric_key = 'oos_skus' and nullif(btrim(fr.value_text), '') is not null))
             as answered
    from form_submissions fs
    join visits v          on v.id  = fs.visit_id
    join form_responses fr on fr.form_submission_id = fs.id
    join form_fields f     on f.id  = fr.form_field_id
    cross join cfg
    where fs.org_id = cfg.org
      and fs.submitted_at >= p_from
      and fs.submitted_at <  p_to
      and f.metric_key in ('in_stock', 'oos_skus')
    group by fs.id, v.store_id, fs.submitted_at
  ),
  answered as (
    select store_id, submitted_at, is_oos from checks where answered
  ),
  -- Classic gaps-and-islands: subtracting a per-state row number from the
  -- overall row number yields a constant group id per unbroken run.
  numbered as (
    select store_id, submitted_at, is_oos,
           row_number() over (partition by store_id order by submitted_at) as rn,
           row_number() over (partition by store_id, is_oos order by submitted_at) as rn_state
    from answered
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
      and public.oos_names_skus(fr.value_text)
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
    from answered group by store_id
  )
  select t.store_id, s.name, g.name,
         t.checks, t.oos_count,
         round(t.oos_count::numeric / nullif(t.checks, 0), 4),
         coalesce((select max(run_len) from runs where runs.store_id = t.store_id), 0)::int,
         t.last_oos_at,
         coalesce(sk.top_skus, '[]'::jsonb)
  from totals t
  join stores s            on s.id = t.store_id
  left join store_groups g on g.id = s.store_group_id
  left join skus sk        on sk.store_id = t.store_id
  where t.oos_count > 0
  order by t.oos_count::numeric / nullif(t.checks, 0) desc nulls last, t.oos_count desc;
$$;

comment on function public.oos_hotspots is
  'Stores by out-of-stock rate. A visit counts as out of stock when the in_stock boolean is false OR the oos_skus text names a SKU — reps routinely answer "in stock" and then list what was missing, and reading only the boolean under-reported this by roughly ten to one.';
