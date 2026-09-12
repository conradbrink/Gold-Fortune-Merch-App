-- Three report bugs found by auditing every tab, and one definition finally
-- shared instead of re-implemented.
--
-- ---------------------------------------------------------------------------
-- 1. 🔴 Form compliance was over 100%
-- ---------------------------------------------------------------------------
--
-- `rep_scorecard` carried the comment "distinct visits, not raw submissions, so
-- compliance can never exceed 100%" directly above the bug. Counting distinct
-- visits fixed double-counting two submissions on one visit, which is what the
-- comment is about — but the numerator counted visits of ANY status while the
-- denominator counted only `checked_out`. A rep who filled the audit and never
-- closed the visit therefore scored above 100%.
--
-- On the live data: 115.0% and 104.8% for two reps. The third read exactly
-- 100.0% while genuinely being 123 of 124 — so the bug also *hid* a real miss,
-- which is the worse half. `score` averages this pillar, so every rep score was
-- inflated too.
--
-- The fix is to make the numerator count the same population as the
-- denominator. A form submitted against a visit that was never checked out is a
-- real problem, but it is an unclosed-visit problem, and inflating a compliance
-- rate is not how anyone should find out about it.
--
-- ---------------------------------------------------------------------------
-- 2. 🔴 Perfect Store's availability pillar had the out-of-stock blind spot
-- ---------------------------------------------------------------------------
--
-- `20260828093000` fixed `oos_hotspots` and `compliance_trends` to read both
-- stock signals — the `in_stock` boolean AND the `oos_skus` text — because reps
-- answer "yes, in stock" and then list what was missing. `perfect_store_score`
-- was the third place with the same blind spot and was missed.
--
-- It reads 96.8% availability where the SKU text says 52.2%. Availability is
-- one of four pillars, so every store's Perfect Store score has been inflated,
-- and the same page has been showing a 97%-available estate above a list of 70
-- stores that are out of stock.
--
-- ⚠️ **Perfect Store scores will drop when this is applied.** That is the
-- correction, not a regression.
--
-- The definition now lives in `oos_visit_flags` and is called from all three
-- reports, so the next person to fix it fixes it once. Re-implementing it a
-- fourth time is how it came to be wrong in three places.
--
-- ---------------------------------------------------------------------------
-- 3. ⚠️ Schedule adherence used the server's date, not the organisation's
-- ---------------------------------------------------------------------------
--
-- `current_date` is UTC. Gaborone is UTC+2, so between 22:00 and midnight UTC —
-- midnight to 02:00 locally — the cutoff that stops tomorrow's routes counting
-- as "missed" is a day behind, and silently drops the current day's routes from
-- `planned`. `org_timezone(org)` exists and this was one of the places the
-- timezone work did not reach.

-- ---------------------------------------------------------------------------
-- The shared definition
-- ---------------------------------------------------------------------------

/**
 * Per submission: was this visit out of stock, and did it answer the question?
 *
 * One row per form submission that answered either stock question. Exists so
 * that "out of stock" has exactly one definition — it was written out by hand
 * in `oos_hotspots` and `compliance_trends`, and a third, different, wrong
 * version lived in `perfect_store_score`.
 *
 * A set-returning function rather than a view because it takes the date bounds:
 * every caller has them, and pushing them in lets the scans stay indexed
 * instead of materialising every submission the organisation has ever taken.
 */
create or replace function public.oos_visit_flags(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  submission_id uuid,
  store_id      uuid,
  submitted_at  timestamptz,
  is_oos        boolean,
  answered      boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select fs.id,
         v.store_id,
         fs.submitted_at,
         bool_or((f.metric_key = 'in_stock' and fr.value_boolean is false)
              or (f.metric_key = 'oos_skus' and public.oos_names_skus(fr.value_text))),
         bool_or((f.metric_key = 'in_stock' and fr.value_boolean is not null)
              or (f.metric_key = 'oos_skus' and nullif(btrim(fr.value_text), '') is not null))
    from form_submissions fs
    join visits v          on v.id  = fs.visit_id
    join form_responses fr on fr.form_submission_id = fs.id
    join form_fields f     on f.id  = fr.form_field_id
   where fs.org_id = public.current_org_id()
     and fs.submitted_at >= p_from
     and fs.submitted_at <  p_to
     and f.metric_key in ('in_stock', 'oos_skus')
   group by fs.id, v.store_id, fs.submitted_at
$$;

revoke all on function public.oos_visit_flags(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.oos_visit_flags(timestamptz, timestamptz) to authenticated;

comment on function public.oos_visit_flags is
  'One row per submission that answered either stock question, with the single definition of "was this visit out of stock". Called by oos_hotspots, compliance_trends and perfect_store_score so the three cannot disagree again.';

-- ---------------------------------------------------------------------------
-- Perfect Store, availability on the shared definition
-- ---------------------------------------------------------------------------

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
      -- `in_stock` stays in this scan even though availability no longer comes
      -- from it, because `audits` counts the distinct submissions that reached
      -- the store and dropping a metric key would quietly change that count.
      and f.metric_key in ('in_stock', 'planogram_ok', 'price_correct', 'damaged_expired')
  ),
  -- Availability is per SUBMISSION and reads both stock questions. The other
  -- three pillars stay per response: each is asked once and answered once, and
  -- rewriting them would move numbers nobody has questioned.
  avail as materialized (
    select store_id,
           count(*) filter (where answered)                as checked,
           count(*) filter (where answered and not is_oos) as in_stock_n
      from public.oos_visit_flags(p_from, p_to)
     group by store_id
  ),
  -- Unchanged from the original except that availability is gone from it: the
  -- three remaining pillars are per response, grouped exactly as before.
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

comment on function public.perfect_store_score is
  'Store scorecard. Availability reads both stock questions via oos_visit_flags — it previously read only the in_stock boolean and scored 96.8% against a real 52.2%.';

-- ---------------------------------------------------------------------------
-- Rep scorecard: a rate that cannot exceed 1
-- ---------------------------------------------------------------------------

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
  -- Distinct visits, so two submissions on one visit count once — AND only
  -- checked-out visits, because that is the denominator. Counting a form
  -- against a visit the rep never closed put this rate at 115%, and made a rep
  -- who missed one audit in 124 read as a clean 100%.
  sub as (
    select v.rep_id, count(distinct fs.visit_id) as n
    from form_submissions fs
    join v on v.id = fs.visit_id
    where v.status = 'checked_out'
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

comment on function public.rep_scorecard is
  'Rep scorecard. form_compliance_rate counts checked-out visits with a submission over checked-out visits — the numerator previously included visits of any status and produced rates above 100%.';

-- ---------------------------------------------------------------------------
-- Schedule adherence: the organisation's today, not the server's
-- ---------------------------------------------------------------------------

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
    -- Was `current_date`, which is UTC. Gaborone is UTC+2, so for the two hours
    -- after local midnight the cutoff below sat a day in the past and dropped
    -- the current day's routes out of `planned` entirely.
    select public.current_org_id() as org,
           (now() at time zone public.org_timezone(public.current_org_id()))::date as today
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
