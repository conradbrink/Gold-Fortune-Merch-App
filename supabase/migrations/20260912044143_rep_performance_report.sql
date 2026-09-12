-- The Rep Performance Report — one rep, one period, on one sheet of A4.
--
-- Five functions. Nothing here invents a number: every figure is an aggregate
-- of rows that already exist, and every figure that cannot be computed comes
-- back null so the page can say "not tracked" rather than print a nought.
--
-- ---------------------------------------------------------------------------
-- The definitions, written down once
-- ---------------------------------------------------------------------------
--
-- **A planned visit** is a row in `routes`. It is *completed* when a visit
--   carrying that `route_id` reached `checked_out` — the same test
--   `schedule_adherence` makes, deliberately, so the two reports cannot
--   disagree about how many visits a rep missed. Routes dated after today are
--   excluded: tomorrow's round has not been missed yet.
--
-- **A sale** is a delivered order attributed to the rep, valued on
--   `qty_delivered - qty_returned` at `unit_price`, excluding VAT, counted on
--   `delivered_at`. That is `lib/sales.ts`'s definition word for word, and this
--   report must agree with the Sales page or one of them is lying.
--
-- **An order taken on a visit** is a different thing and is used for exactly
--   one KPI — zero-sales visits. An order has no `visit_id`, so the link is
--   rep + store + local calendar day. On the live data every one of the 15
--   orders captured in the rep app (`source = 'rep_app'`) matches a visit that
--   way and none of the warehouse-captured ones do, which is the answer you
--   would want: a phone order taken from the depot is not something the rep
--   achieved by standing in the shop.
--
-- **Local** means the organisation's timezone via `org_timezone`, never the
--   session's. `routes.scheduled_date` is a calendar date and Gaborone is two
--   hours ahead of UTC, so a range whose exclusive end is local midnight lands
--   on the previous UTC day — the bug `20260828140000` fixed in
--   `schedule_adherence`, avoided here by resolving both bounds the same way.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- **Targets.** There is no target, quota or budget table in this schema, so
-- "sales vs target" has no answer and the report says "Target not set". The
-- score's sales pillar is excluded and the remaining pillars re-weighted, in
-- `lib/rep-report.ts`, where a manager can see the arithmetic.
--
-- **A reason for a missed visit.** `routes` records no outcome, so a reason is
-- only ever *derived* from what else is on file: a visit opened and never
-- closed, or the store served on the day outside the plan. Everything else
-- reads "Reason not recorded". On the live data that is 318 of 341.
--
-- **The score itself.** It is weighted presentation, computed in TypeScript
-- from the rates below so it can be shown broken down and checked without a
-- database. These functions return the ingredients, not the verdict.

-- ---------------------------------------------------------------------------
-- Territory subtree
-- ---------------------------------------------------------------------------

/**
 * A territory and everything beneath it.
 *
 * Stores sit in the deepest tier, but the report's territory filter offers
 * every tier: choosing the region "Greater Gaborone" has to reach the stores
 * in each of its territories. Recursive rather than two joins because the
 * table is country → region → territory today and nothing stops a fourth tier
 * tomorrow.
 *
 * Org-scoped at the root so a territory id guessed from another organisation
 * returns nothing rather than walking that organisation's tree. RLS would
 * refuse the rows anyway; this refuses the question.
 */
create or replace function public.territory_subtree(p_territory_id uuid)
returns table (territory_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive t as (
    select id from territories
     where id = p_territory_id and org_id = public.current_org_id()
    union all
    select c.id from territories c join t on c.parent_id = t.id
  )
  select id from t;
$$;

revoke all on function public.territory_subtree(uuid) from public, anon;
grant execute on function public.territory_subtree(uuid) to authenticated;

comment on function public.territory_subtree is
  'A territory id and every descendant id, so a filter set at region level reaches the stores in its territories.';

-- ---------------------------------------------------------------------------
-- 1. The scorecard — one row
-- ---------------------------------------------------------------------------

create or replace function public.rep_performance_summary(
  p_rep_id       uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_territory_id uuid
)
returns table (
  rep_id                     uuid,
  rep_name                   text,
  territories                text,
  stores_assigned            bigint,
  planned_visits             bigint,
  completed_planned          bigint,
  missed_visits              bigint,
  stores_planned             bigint,
  stores_visited             bigint,
  completed_visits           bigint,
  unplanned_visits           bigint,
  sales_net                  numeric,
  sales_orders               bigint,
  stores_with_sales          bigint,
  visits_with_order          bigint,
  zero_sales_visits          bigint,
  days_worked                bigint,
  avg_workday_start_seconds  numeric,
  avg_first_checkin_seconds  numeric,
  avg_last_checkout_seconds  numeric,
  avg_visit_seconds          numeric,
  gps_checked                bigint,
  gps_verified_rate          numeric,
  form_compliance_rate       numeric,
  photo_visit_rate           numeric,
  audits                     bigint,
  availability_pct           numeric,
  planogram_pct              numeric,
  price_pct                  numeric,
  condition_pct              numeric,
  avg_facings                numeric,
  prospects_visited          bigint,
  prospects_converted        bigint
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
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  terr as materialized (
    select t.territory_id from public.territory_subtree(p_territory_id) t
  ),
  -- Every store the filter allows. Written once and joined against, so the
  -- territory rule cannot be spelled five slightly different ways below.
  st as materialized (
    select s.id, s.geofence_radius_m
    from stores s
    cross join cfg
    where s.org_id = cfg.org
      and (p_territory_id is null
           or s.territory_id in (select territory_id from terr))
  ),
  planned as materialized (
    select ro.id, ro.store_id,
           exists (select 1 from visits v
                    where v.route_id = ro.id and v.status = 'checked_out') as done
    from routes ro
    join st on st.id = ro.store_id
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.rep_id = p_rep_id
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      -- Not yet due is not missed.
      and ro.scheduled_date <= b.today
  ),
  vis as materialized (
    select v.id, v.store_id, v.status, v.duration_seconds,
           v.checkin_at, v.checkout_at, v.route_id,
           v.checkin_distance_from_store_m as dist,
           st.geofence_radius_m,
           (v.checkin_at at time zone cfg.tz)::date as local_day
    from visits v
    join st on st.id = v.store_id
    cross join cfg
    where v.org_id = cfg.org
      and v.rep_id = p_rep_id
      and v.checkin_at >= p_from
      and v.checkin_at <  p_to
  ),
  -- Delivered orders: the money. `greatest(…, 0)` mirrors the web's
  -- `if (qty <= 0) continue` — a line returned in full is not negative revenue.
  sold as materialized (
    select o.id, o.store_id,
           (select coalesce(sum(greatest(ol.qty_delivered - ol.qty_returned, 0)
                                * coalesce(ol.unit_price, 0)), 0)
              from order_lines ol where ol.order_id = o.id) as net
    from orders o
    join st on st.id = o.store_id
    cross join cfg
    where o.org_id = cfg.org
      and o.rep_id = p_rep_id
      and o.status = 'delivered'
      and o.delivered_at >= p_from
      and o.delivered_at <  p_to
  ),
  -- Orders *taken* in the period, for the zero-sales-visit test only. Keyed by
  -- store and local day because an order carries no visit id.
  taken as materialized (
    select distinct o.store_id,
           (o.created_at at time zone cfg.tz)::date as local_day
    from orders o
    join st on st.id = o.store_id
    cross join cfg
    where o.org_id = cfg.org
      and o.rep_id = p_rep_id
      and o.status <> 'cancelled'
      and o.created_at >= p_from
      and o.created_at <  p_to
  ),
  -- One row per local day the rep was out, for the attendance block. First
  -- check-in and last check-out are the shop-floor bookends; the workday start
  -- is the rep pressing Start, which is a different act and often a different
  -- time, so the two are averaged separately rather than merged.
  day_visits as (
    select local_day,
           min(checkin_at) as first_in,
           max(checkout_at) filter (where status = 'checked_out') as last_out
    from vis
    group by local_day
  ),
  day_workday as (
    select (w.started_at at time zone cfg.tz)::date as local_day,
           min(w.started_at) as opened
    from workday_sessions w
    cross join cfg
    where w.org_id = cfg.org
      and w.rep_id = p_rep_id
      and w.started_at >= p_from
      and w.started_at <  p_to
    group by 1
  ),
  -- Form work, counted per VISIT and only over closed visits — the denominator
  -- `rep_scorecard` had to be corrected to, after a numerator counting visits
  -- of any status put compliance at 115%.
  subs as (
    select count(distinct fs.visit_id) as n
    from form_submissions fs
    join vis on vis.id = fs.visit_id
    where vis.status = 'checked_out'
  ),
  pics as (
    select count(distinct ph.visit_id) as n
    from photos ph
    join vis on vis.id = ph.visit_id
    where vis.status = 'checked_out'
  ),
  -- Merchandising. Availability comes from `oos_visit_flags`, the one shared
  -- definition of "was this visit out of stock", narrowed to this rep's visits
  -- by submission id. The other pillars are per response, exactly as
  -- `perfect_store_score` reads them.
  avail as materialized (
    select count(*) filter (where f.answered)                  as checked,
           count(*) filter (where f.answered and not f.is_oos) as in_stock_n
    from public.oos_visit_flags(p_from, p_to) f
    where f.submission_id in (
      select fs.id from form_submissions fs join vis on vis.id = fs.visit_id
    )
  ),
  responses as materialized (
    select fr.value_boolean, fr.value_text, fr.value_number,
           ff.metric_key, fs.id as sub_id
    from form_responses fr
    join form_fields ff      on ff.id = fr.form_field_id
    join form_submissions fs on fs.id = fr.form_submission_id
    join vis                 on vis.id = fs.visit_id
    where ff.metric_key in ('in_stock', 'oos_skus', 'planogram_ok',
                            'price_correct', 'damaged_expired', 'facings')
  ),
  merch as (
    select count(distinct sub_id) filter (
             where metric_key <> 'facings') as audits,
           case when count(*) filter (where metric_key = 'planogram_ok') > 0 then
             round(100.0 * count(*) filter (where metric_key = 'planogram_ok' and value_boolean)
                   / count(*) filter (where metric_key = 'planogram_ok'), 1) end as planogram_pct,
           case when count(*) filter (where metric_key = 'price_correct') > 0 then
             round(100.0 * count(*) filter (where metric_key = 'price_correct' and value_text = 'Correct')
                   / count(*) filter (where metric_key = 'price_correct'), 1) end as price_pct,
           -- Inverted: finding no damage is the good outcome.
           case when count(*) filter (where metric_key = 'damaged_expired') > 0 then
             round(100.0 * count(*) filter (where metric_key = 'damaged_expired' and value_boolean is false)
                   / count(*) filter (where metric_key = 'damaged_expired'), 1) end as condition_pct,
           round(avg(value_number) filter (where metric_key = 'facings'), 1) as avg_facings
    from responses
  ),
  -- Prospect calls. A lead is a shop that is not yet a store, so this answers
  -- "new stores visited" honestly without pretending a prospect is a customer.
  prospects as (
    select count(*) as visited,
           count(*) filter (where l.stage = 'converted') as converted
    from leads l
    cross join cfg
    where l.org_id = cfg.org
      and l.rep_id = p_rep_id
      and l.started_at >= p_from
      and l.started_at <  p_to
  )
  select
    p_rep_id,
    (select pr.full_name from profiles pr where pr.id = p_rep_id),
    -- The rep's geography, from the stores they are assigned. `territory_reps`
    -- exists and is empty, so assignments are the only record of it.
    (select string_agg(distinct t.name, ', ' order by t.name)
       from store_assignments sa
       join stores s2    on s2.id = sa.store_id
       join territories t on t.id = s2.territory_id
       join st            on st.id = s2.id
      where sa.rep_id = p_rep_id),
    (select count(*) from store_assignments sa
      join st on st.id = sa.store_id where sa.rep_id = p_rep_id),
    (select count(*) from planned),
    (select count(*) filter (where done) from planned),
    (select count(*) filter (where not done) from planned),
    (select count(distinct store_id) from planned),
    (select count(distinct store_id) filter (where status = 'checked_out') from vis),
    (select count(*) filter (where status = 'checked_out') from vis),
    (select count(*) filter (where status = 'checked_out' and route_id is null) from vis),
    (select coalesce(round(sum(net), 2), 0) from sold),
    (select count(*) from sold),
    (select count(distinct store_id) from sold where net > 0),
    (select count(*) from vis where status = 'checked_out'
        and exists (select 1 from taken tk
                     where tk.store_id = vis.store_id and tk.local_day = vis.local_day)),
    (select count(*) from vis where status = 'checked_out'
        and not exists (select 1 from taken tk
                         where tk.store_id = vis.store_id and tk.local_day = vis.local_day)),
    (select count(*) from day_visits),
    (select round(avg(extract(epoch from ((opened at time zone cfg.tz)::time))), 0)
       from day_workday cross join cfg),
    (select round(avg(extract(epoch from ((first_in at time zone cfg.tz)::time))), 0)
       from day_visits cross join cfg),
    (select round(avg(extract(epoch from ((last_out at time zone cfg.tz)::time))), 0)
       from day_visits cross join cfg where last_out is not null),
    (select round(avg(duration_seconds) filter (where status = 'checked_out'), 0) from vis),
    (select count(*) filter (where dist is not null) from vis),
    -- A visit with no fix is unknown, never a failure: it stays out of both
    -- halves of the rate.
    (select case when count(*) filter (where dist is not null) > 0
                 then round((count(*) filter (where dist is not null
                                                and dist <= geofence_radius_m))::numeric
                            / count(*) filter (where dist is not null), 4) end
       from vis),
    (select case when count(*) filter (where status = 'checked_out') > 0
                 then round((select n from subs)::numeric
                            / count(*) filter (where status = 'checked_out'), 4) end
       from vis),
    (select case when count(*) filter (where status = 'checked_out') > 0
                 then round((select n from pics)::numeric
                            / count(*) filter (where status = 'checked_out'), 4) end
       from vis),
    (select audits from merch),
    (select case when a.checked > 0
                 then round(100.0 * a.in_stock_n / a.checked, 1) end from avail a),
    (select planogram_pct from merch),
    (select price_pct from merch),
    (select condition_pct from merch),
    (select avg_facings from merch),
    (select visited from prospects),
    (select converted from prospects);
$$;

revoke all on function public.rep_performance_summary(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.rep_performance_summary(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.rep_performance_summary is
  'One rep, one period: the KPI scorecard behind the Rep Performance Report. Every rate is null when nothing measured it.';

-- ---------------------------------------------------------------------------
-- 2. Day by day — the two graphs
-- ---------------------------------------------------------------------------

/**
 * Every calendar day in the range, including the empty ones.
 *
 * `generate_series` rather than a group-by over the rows, because the point of
 * the graph is the days on which nothing happened. A chart drawn from the rows
 * that exist has no Wednesday on it, and "no visits on Wednesday" is the
 * finding a manager opened the report for.
 */
create or replace function public.rep_performance_daily(
  p_rep_id       uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_territory_id uuid
)
returns table (
  day         date,
  planned     bigint,
  completed   bigint,
  visits      bigint,
  sales_net   numeric,
  sales_orders bigint,
  in_future   boolean
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
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  terr as materialized (
    select t.territory_id from public.territory_subtree(p_territory_id) t
  ),
  st as materialized (
    select s.id
    from stores s cross join cfg
    where s.org_id = cfg.org
      and (p_territory_id is null
           or s.territory_id in (select territory_id from terr))
  ),
  days as (
    select d::date as day
    from bounds b,
         generate_series(b.from_date, b.to_date - 1, interval '1 day') d
  ),
  planned as (
    select ro.scheduled_date as day,
           count(*) as planned,
           count(*) filter (where exists (
             select 1 from visits v where v.route_id = ro.id and v.status = 'checked_out'
           )) as completed
    from routes ro
    join st on st.id = ro.store_id
    cross join cfg
    where ro.org_id = cfg.org and ro.rep_id = p_rep_id
      and ro.scheduled_date >= (select from_date from bounds)
      and ro.scheduled_date <  (select to_date from bounds)
    group by ro.scheduled_date
  ),
  visited as (
    select (v.checkin_at at time zone cfg.tz)::date as day, count(*) as n
    from visits v
    join st on st.id = v.store_id
    cross join cfg
    where v.org_id = cfg.org and v.rep_id = p_rep_id
      and v.status = 'checked_out'
      and v.checkin_at >= p_from and v.checkin_at < p_to
    group by 1
  ),
  sold as (
    select (o.delivered_at at time zone cfg.tz)::date as day,
           count(*) as n,
           sum((select coalesce(sum(greatest(ol.qty_delivered - ol.qty_returned, 0)
                                    * coalesce(ol.unit_price, 0)), 0)
                  from order_lines ol where ol.order_id = o.id)) as net
    from orders o
    join st on st.id = o.store_id
    cross join cfg
    where o.org_id = cfg.org and o.rep_id = p_rep_id
      and o.status = 'delivered'
      and o.delivered_at >= p_from and o.delivered_at < p_to
    group by 1
  )
  select d.day,
         coalesce(p.planned, 0),
         coalesce(p.completed, 0),
         coalesce(v.n, 0),
         coalesce(round(s.net, 2), 0),
         coalesce(s.n, 0),
         -- A day the round is scheduled for but which has not happened yet is
         -- drawn differently: an empty bar for next Tuesday is not a miss.
         d.day > (select today from bounds)
  from days d
  left join planned p on p.day = d.day
  left join visited v on v.day = d.day
  left join sold    s on s.day = d.day
  order by d.day;
$$;

revoke all on function public.rep_performance_daily(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.rep_performance_daily(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.rep_performance_daily is
  'Planned vs completed visits and delivered sales for every calendar day in the range, empty days included.';

-- ---------------------------------------------------------------------------
-- 3. Missed visits — every one of them
-- ---------------------------------------------------------------------------

create or replace function public.rep_performance_missed(
  p_rep_id       uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_territory_id uuid
)
returns table (
  route_id       uuid,
  store_id       uuid,
  store_name     text,
  store_group    text,
  city           text,
  planned_date   date,
  reason         text,
  last_visit_at  timestamptz,
  previous_sales numeric
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
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  terr as materialized (
    select t.territory_id from public.territory_subtree(p_territory_id) t
  ),
  missed as materialized (
    select ro.id, ro.store_id, ro.scheduled_date
    from routes ro
    join stores s on s.id = ro.store_id
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.rep_id = p_rep_id
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      and ro.scheduled_date <= b.today
      and (p_territory_id is null
           or s.territory_id in (select territory_id from terr))
      and not exists (select 1 from visits v
                       where v.route_id = ro.id and v.status = 'checked_out')
  )
  select m.id,
         m.store_id,
         s.name,
         g.name,
         s.city,
         m.scheduled_date,
         -- Derived from what is on file, never guessed. `routes` records no
         -- outcome, so these are the only two things the data can say.
         case
           when exists (select 1 from visits v
                         where v.route_id = m.id and v.status = 'checked_in')
             then 'Checked in, not checked out'
           when exists (select 1 from visits v cross join cfg c2
                         where v.rep_id = p_rep_id
                           and v.store_id = m.store_id
                           and v.status = 'checked_out'
                           and (v.checkin_at at time zone c2.tz)::date = m.scheduled_date)
             then 'Visited off-schedule'
         end,
         -- The last time anybody closed a visit at this store before the day it
         -- was missed. Any rep, not only this one: management is asking how
         -- long the shop has gone unserved, which is not a question about who.
         (select max(v.checkout_at) from visits v
           where v.org_id = cfg.org
             and v.store_id = m.store_id
             and v.status = 'checked_out'
             and v.checkout_at < (m.scheduled_date::timestamp at time zone cfg.tz)),
         -- The most recent delivered order at the store before that day, valued
         -- the same way as everything else here.
         --
         -- Shaped as "the newest order, then its value" rather than "the value
         -- of the newest order's lines": summing `order_lines` against an order
         -- id that came back null matches no rows, and `coalesce(sum(…), 0)`
         -- over no rows is 0 — a store that has never bought anything would
         -- print P0.00 where the truth is that there is nothing to show. This
         -- way the outer select returns no row, the column is null, and the
         -- page prints an em dash.
         (select (select coalesce(sum(greatest(ol.qty_delivered - ol.qty_returned, 0)
                                      * coalesce(ol.unit_price, 0)), 0)
                    from order_lines ol where ol.order_id = o.id)
            from orders o
           where o.org_id = cfg.org
             and o.store_id = m.store_id
             and o.status = 'delivered'
             and o.delivered_at < (m.scheduled_date::timestamp at time zone cfg.tz)
           order by o.delivered_at desc
           limit 1)
  from missed m
  join stores s on s.id = m.store_id
  left join store_groups g on g.id = s.store_group_id
  cross join cfg
  -- Highest previous sales first. The list is not truncated and on this data
  -- it can run to a hundred rows, so the ordering decides what a manager reads
  -- before their attention runs out — and that should be the shops with money
  -- behind them.
  order by 9 desc nulls last, m.scheduled_date desc, s.name;
$$;

revoke all on function public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.rep_performance_missed is
  'Every planned visit the rep did not complete in the period, with the store''s last visit and last delivered order before that date.';

-- ---------------------------------------------------------------------------
-- 4. Store by store — top performers and the ones needing attention
-- ---------------------------------------------------------------------------

create or replace function public.rep_performance_stores(
  p_rep_id       uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_territory_id uuid
)
returns table (
  store_id        uuid,
  store_name      text,
  store_group     text,
  city            text,
  planned         bigint,
  completed       bigint,
  missed          bigint,
  visits          bigint,
  sales_net       numeric,
  sales_orders    bigint,
  prior_sales_net numeric,
  oos_checked     bigint,
  oos_visits      bigint,
  merch_checks    bigint,
  merch_ok        bigint,
  last_visit_at   timestamptz
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
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today,
           -- The period immediately before this one, the same length, for the
           -- sales-decline rule. Equal length matters: "down on last month" is
           -- meaningless if last month was longer.
           p_from - (p_to - p_from) as prior_from
    from cfg c
  ),
  terr as materialized (
    select t.territory_id from public.territory_subtree(p_territory_id) t
  ),
  st as materialized (
    select s.id
    from stores s cross join cfg
    where s.org_id = cfg.org
      and (p_territory_id is null
           or s.territory_id in (select territory_id from terr))
  ),
  planned as (
    select ro.store_id,
           count(*) as planned,
           count(*) filter (where exists (
             select 1 from visits v where v.route_id = ro.id and v.status = 'checked_out'
           )) as completed
    from routes ro
    join st on st.id = ro.store_id
    cross join cfg cross join bounds b
    where ro.org_id = cfg.org and ro.rep_id = p_rep_id
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      and ro.scheduled_date <= b.today
    group by ro.store_id
  ),
  vis as materialized (
    select v.id, v.store_id, v.checkout_at
    from visits v
    join st on st.id = v.store_id
    cross join cfg
    where v.org_id = cfg.org and v.rep_id = p_rep_id
      and v.status = 'checked_out'
      and v.checkin_at >= p_from and v.checkin_at < p_to
  ),
  visited as (
    select store_id, count(*) as n, max(checkout_at) as last_at from vis group by store_id
  ),
  sold as (
    select o.store_id, count(*) as n,
           sum((select coalesce(sum(greatest(ol.qty_delivered - ol.qty_returned, 0)
                                    * coalesce(ol.unit_price, 0)), 0)
                  from order_lines ol where ol.order_id = o.id)) as net
    from orders o
    join st on st.id = o.store_id
    cross join cfg
    where o.org_id = cfg.org and o.rep_id = p_rep_id and o.status = 'delivered'
      and o.delivered_at >= p_from and o.delivered_at < p_to
    group by o.store_id
  ),
  -- The same figure for the period before, so "declining" is a comparison
  -- rather than an adjective.
  prior as (
    select o.store_id,
           sum((select coalesce(sum(greatest(ol.qty_delivered - ol.qty_returned, 0)
                                    * coalesce(ol.unit_price, 0)), 0)
                  from order_lines ol where ol.order_id = o.id)) as net
    from orders o
    join st on st.id = o.store_id
    cross join cfg cross join bounds b
    where o.org_id = cfg.org and o.rep_id = p_rep_id and o.status = 'delivered'
      and o.delivered_at >= b.prior_from and o.delivered_at < p_from
    group by o.store_id
  ),
  oos as (
    select f.store_id,
           count(*) filter (where f.answered) as checked,
           count(*) filter (where f.answered and f.is_oos) as oos_n
    from public.oos_visit_flags(p_from, p_to) f
    where f.submission_id in (
      select fs.id from form_submissions fs join vis on vis.id = fs.visit_id
    )
    group by f.store_id
  ),
  -- Planogram and price together: one "merchandising checks passed" pair per
  -- store, which is what the attention rule needs. The report's headline
  -- compliance figure is computed from the summary's pillars, not from this.
  merch as (
    select v2.store_id,
           count(*) as checks,
           count(*) filter (
             where (ff.metric_key = 'planogram_ok'  and fr.value_boolean)
                or (ff.metric_key = 'price_correct' and fr.value_text = 'Correct')
                or (ff.metric_key = 'damaged_expired' and fr.value_boolean is false)
           ) as ok
    from form_responses fr
    join form_fields ff      on ff.id = fr.form_field_id
    join form_submissions fs on fs.id = fr.form_submission_id
    join vis v2              on v2.id = fs.visit_id
    where ff.metric_key in ('planogram_ok', 'price_correct', 'damaged_expired')
      -- Only answered checks count, and each key is answered in its own column.
      -- Written as one bracketed disjunction because `and`/`or` at this depth
      -- without brackets binds the wrong way round and quietly counts every
      -- price response as a pass.
      and (
        (ff.metric_key in ('planogram_ok', 'damaged_expired')
           and fr.value_boolean is not null)
        or (ff.metric_key = 'price_correct'
           and nullif(btrim(fr.value_text), '') is not null)
      )
    group by v2.store_id
  ),
  ids as (
    select store_id from planned
    union select store_id from visited
    union select store_id from sold
  )
  select i.store_id, s.name, g.name, s.city,
         coalesce(p.planned, 0),
         coalesce(p.completed, 0),
         coalesce(p.planned, 0) - coalesce(p.completed, 0),
         coalesce(v.n, 0),
         coalesce(round(so.net, 2), 0),
         coalesce(so.n, 0),
         coalesce(round(pr.net, 2), 0),
         coalesce(o.checked, 0),
         coalesce(o.oos_n, 0),
         coalesce(m.checks, 0),
         coalesce(m.ok, 0),
         v.last_at
  from ids i
  join stores s on s.id = i.store_id
  left join store_groups g on g.id = s.store_group_id
  left join planned p on p.store_id = i.store_id
  left join visited v on v.store_id = i.store_id
  left join sold   so on so.store_id = i.store_id
  left join prior  pr on pr.store_id = i.store_id
  left join oos     o on o.store_id = i.store_id
  left join merch   m on m.store_id = i.store_id
  order by coalesce(so.net, 0) desc, s.name;
$$;

revoke all on function public.rep_performance_stores(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.rep_performance_stores(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.rep_performance_stores is
  'One row per store the rep planned, visited or sold to in the period, with the prior period''s sales for the decline rule.';
