-- 🔴 The out-of-stock reports have been counting the wrong field, and have been
-- wrong by an order of magnitude.
--
-- The Merchandising Conditions Audit asks about stock twice:
--
--   1. "Was our product in stock on the shelf?"  — boolean, metric_key in_stock
--   2. "Which SKUs were out of stock?"           — text,    metric_key oos_skus
--
-- `oos_hotspots` and `compliance_trends` both read **only the boolean**. In the
-- live data that boolean is false 9 times out of 285, across 7 stores. The text
-- field names real SKUs at **68 stores**.
--
-- The reps are not filling the form in wrongly. They answer "yes, in stock"
-- because *something* of ours was on the shelf, and then write what was missing
-- in the box that asks precisely that. The report then throws the answer away —
-- and the cruel detail is that `sku_counts` below already collected those SKU
-- names, and then dropped the store because the boolean had not been ticked.
-- The data has been in the query the whole time, one `where` clause from being
-- reported.
--
-- So a visit is out of stock when the boolean says so **or** the SKU field
-- names something. That is a change to what the number means, and it should be:
-- the old number was not a conservative estimate, it was a different question.
--
-- ⚠️ The free text has no controlled vocabulary, so `oos_names_skus` is an
-- interpretation and is written to be readable and arguable rather than clever.
-- The durable fix is a real multi-select of SKUs on the form, which needs a new
-- field type and therefore a Flutter release; this makes the existing months
-- reportable in the meantime.

/**
 * Does this free-text answer name something that was out of stock?
 *
 * A stop-list, not a parser. Every value in it was read off the live data:
 * `None`, `ok`, `0`, `fine`, `yes`, `no` are all things reps type to mean
 * "nothing was out". Anything else is treated as naming a SKU, which is the
 * safe direction to be wrong in — a new way of writing "nothing" shows up as a
 * spurious out-of-stock that somebody notices, whereas guessing the other way
 * hides a real one.
 *
 * `immutable` so it can be used in an index later, and so the planner can fold
 * it into the aggregate scans below.
 */
create or replace function public.oos_names_skus(p_text text)
returns boolean
language sql
immutable
as $$
  select case
    when p_text is null or btrim(p_text) = '' then false
    when lower(btrim(p_text)) = any (array[
      'none','none.','no','no.','nil','n/a','na','n.a.','nothing','nothing.',
      'ok','okay','fine','good','all good','yes','y',
      'all in stock','in stock','instock','full','stocked','-','.','x'
    ]) then false
    -- A bare one- or two-digit number is a count or a zero, never a SKU. The
    -- live data holds `0` (21), `1` (8) and `00` (1) meaning "nothing", against
    -- `12000` meaning the 12000-puff line — so the digit count is what
    -- separates them, and three digits or more is left alone deliberately
    -- (`800` is a product, not a quantity).
    when btrim(p_text) ~ '^[0-9]{1,2}$' then false
    else true
  end
$$;

revoke all on function public.oos_names_skus(text) from public, anon, authenticated;
grant execute on function public.oos_names_skus(text) to authenticated;

comment on function public.oos_names_skus is
  'Whether a free-text "which SKUs were out of stock?" answer names anything. A stop-list read off the live data, not a parser. Replaceable by a real multi-select field, which is the actual fix.';

-- ---------------------------------------------------------------------------
-- Hotspots
-- ---------------------------------------------------------------------------

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
  -- One row per submission, not per response. Both stock questions live on the
  -- same submission, and "was this visit an out-of-stock" is a question about
  -- the visit — counting responses would let a form with two stock questions
  -- weigh twice as much as one with a single question.
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
      -- Was `nullif(btrim(...), '') is not null`, which listed "None" and "ok"
      -- among a store's top out-of-stock SKUs. The same predicate that decides
      -- whether a visit counts now decides what gets named.
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

-- ---------------------------------------------------------------------------
-- The trend line, on the same definition
-- ---------------------------------------------------------------------------
--
-- Left disagreeing with the hotspots table this would be worse than either
-- being wrong alone: the same page would show a 3% out-of-stock trend above a
-- list of 68 stores that are out of stock.

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
  -- Out of stock is per submission and reads both stock questions, matching
  -- `oos_hotspots`. The other three metrics stay per response: a planogram
  -- question is asked once and answered once, and rewriting them would change
  -- numbers nobody has complained about.
  oos as (
    select s.bkt, fr.form_submission_id as sid,
           bool_or((f.metric_key = 'in_stock' and fr.value_boolean is false)
                or (f.metric_key = 'oos_skus' and public.oos_names_skus(fr.value_text)))
             as is_oos,
           bool_or((f.metric_key = 'in_stock' and fr.value_boolean is not null)
                or (f.metric_key = 'oos_skus' and nullif(btrim(fr.value_text), '') is not null))
             as answered
    from form_responses fr
    join s on s.id = fr.form_submission_id
    join form_fields f on f.id = fr.form_field_id
    where f.metric_key in ('in_stock', 'oos_skus')
    group by s.bkt, fr.form_submission_id
  ),
  oos_agg as (
    select bkt,
           count(*) filter (where answered)              as checked_n,
           count(*) filter (where answered and is_oos)   as oos_n
    from oos group by 1
  ),
  mc as (
    select bkt,
      count(*) filter (where metric_key = 'planogram_ok')                         as plano_n,
      count(*) filter (where metric_key = 'planogram_ok' and value_boolean)       as plano_ok_n,
      count(*) filter (where metric_key = 'price_correct')                        as price_n,
      count(*) filter (where metric_key = 'price_correct' and value_text = 'Correct') as price_ok_n,
      avg(value_number) filter (where metric_key = 'facings')                     as avg_facings
    from r group by 1
  )
  select sc.bkt,
         sc.n,
         case when oa.checked_n > 0 then round(oa.oos_n::numeric / oa.checked_n, 4) end,
         case when mc.plano_n   > 0 then round(mc.plano_ok_n::numeric / mc.plano_n,   4) end,
         case when mc.price_n   > 0 then round(mc.price_ok_n::numeric / mc.price_n,   4) end,
         round(mc.avg_facings, 2)
  from sc
  left join mc on mc.bkt = sc.bkt
  left join oos_agg oa on oa.bkt = sc.bkt
  order by sc.bkt;
$$;

comment on function public.oos_hotspots is
  'Stores by out-of-stock rate. A visit counts as out of stock when the in_stock boolean is false OR the oos_skus text names a SKU — reps routinely answer "in stock" and then list what was missing, and reading only the boolean under-reported this by roughly ten to one.';
