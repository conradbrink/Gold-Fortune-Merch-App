-- Rollback of 20261020213700_revenue_is_invoiced: sales counted on delivered orders again.
-- The function bodies are production's before the migration (md5 of
-- pg_get_functiondef: dashboard_business 7aad67fb…, sales_target_progress 801b1ee2…, rep_performance_summary 2d7b2e90…, rep_performance_daily c925071e…, rep_performance_stores 7bcff028…, rep_performance_missed af801968…, store_health 5bb379a8…).

CREATE OR REPLACE FUNCTION public.dashboard_business(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_tz text := public.org_timezone(v_org);
  v_today date := (now() at time zone v_tz)::date;
  v_len interval := p_to - p_from;
  v_month0 date := date_trunc('month', now() at time zone v_tz)::date;
  result jsonb;
begin
  if v_org is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  with sold as (
    select o.id, o.store_id, o.delivered_at,
           sum((ol.qty_delivered - ol.qty_returned) * coalesce(ol.unit_price, 0)) as net
    from public.orders o
    join public.order_lines ol on ol.order_id = o.id
    where o.org_id = v_org
      and o.status = 'delivered'
      and o.delivered_at is not null
      and ol.qty_delivered - ol.qty_returned > 0
    group by o.id, o.store_id, o.delivered_at
  ),
  months as (
    select generate_series(v_month0 - interval '5 months', v_month0, interval '1 month')::date as m
  ),
  by_month as (
    select mo.m,
           coalesce(sum(s.net), 0) as net,
           count(s.id) as orders
    from months mo
    left join sold s
      on s.delivered_at >= (mo.m::timestamp at time zone v_tz)
     and s.delivered_at < ((mo.m + interval '1 month')::timestamp at time zone v_tz)
    group by mo.m
  ),
  open_orders as (
    select status, count(*) as n
    from public.orders
    where org_id = v_org and status in ('new', 'confirmed', 'picking', 'packed', 'dispatched')
    group by status
  ),
  -- One rule, in store_health: these counts and the lists the card opens
  -- can never disagree.
  health as (
    select * from public.store_health()
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'current', (select coalesce(sum(net), 0) from sold where delivered_at >= p_from and delivered_at < p_to),
      'previous', (select coalesce(sum(net), 0) from sold where delivered_at >= p_from - v_len and delivered_at < p_from),
      'orders', (select count(*) from sold where delivered_at >= p_from and delivered_at < p_to),
      'month_start', v_month0,
      'today', v_today,
      'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'net', round(net, 2), 'orders', orders) order by m), '[]'::jsonb) from by_month)
    ),
    'pipeline', jsonb_build_object(
      'new', coalesce((select n from open_orders where status = 'new'), 0),
      'confirmed', coalesce((select n from open_orders where status = 'confirmed'), 0),
      'picking', coalesce((select n from open_orders where status = 'picking'), 0),
      'packed', coalesce((select n from open_orders where status = 'packed'), 0),
      'dispatched', coalesce((select n from open_orders where status = 'dispatched'), 0),
      'pod_missing', (select count(*) from public.orders where org_id = v_org and status = 'delivered' and pod_status = 'outstanding'),
      'quotes_waiting', (select count(*) from public.quotes where org_id = v_org and status = 'sent'),
      'recurring_due_7d', (select count(*) from public.recurring_orders where org_id = v_org and status = 'active' and next_run <= v_today + 7),
      'low_stock', case when public.module_enabled('warehouse')
                        then (select count(distinct product_id) from public.low_stock_alerts(null))
                        else 0 end
    ),
    'money', jsonb_build_object(
      'invoiced', (select coalesce(sum(total), 0) from public.tax_invoices where org_id = v_org and status = 'issued' and issue_date >= (p_from at time zone v_tz)::date and issue_date::timestamp < (p_to at time zone v_tz)),
      'outstanding', (select coalesce(sum(b.outstanding), 0) from public.tax_invoices i join public.tax_invoice_balances b on b.invoice_id = i.id where i.org_id = v_org and i.status = 'issued'),
      'overdue', (select coalesce(sum(b.outstanding), 0) from public.tax_invoices i join public.tax_invoice_balances b on b.invoice_id = i.id where i.org_id = v_org and i.status = 'issued' and i.due_date < v_today and b.outstanding > 0),
      'commission_pending', (select coalesce(sum(amount), 0) from public.commissions where org_id = v_org and status = 'pending'),
      'commission_to_pay', (select coalesce(sum(amount), 0) from public.commissions where org_id = v_org and status = 'approved')
    ),
    'health', jsonb_build_object(
      'stores_active', (select count(*) from health),
      'ordered_30d', (select count(*) from health where last_order_at >= now() - interval '30 days'),
      'visited_no_order_30d', (select count(*) from health where status = 'no_order'),
      'not_visited_30d', (select count(*) from health where status = 'not_visited'),
      'lapsed_60d', (select count(*) from health where lapsed),
      'longest_unvisited', (
        select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select jsonb_build_object(
                   'id', store_id, 'name', store_name, 'city', city,
                   'days', days_since_visit
                 ) as x
          from health
          where status = 'not_visited'
          -- Never-visited first, then the longest gap: both are "go here first".
          -- store_health() returns its rows in this order, so these five head
          -- the list the card opens. The id settles two stores of one name.
          order by last_visit_at nulls first, store_name, store_id
          limit 5
        ) t
      )
    ),
    'field', jsonb_build_object(
      -- One rule, in offsite_checkins: this count and the list the card opens
      -- can never disagree.
      'flagged_checkins', (select count(*) from public.offsite_checkins(p_from, p_to)),
      'off_site_m', coalesce((public.company_setting('off_site_distance_m') #>> '{}')::numeric, 500)
    )
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_target_progress(p_month date)
 RETURNS TABLE(rep_id uuid, rep_name text, measure text, target numeric, orders bigint, units bigint, revenue_excl_vat numeric, gross_profit numeric, uncosted_units bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_tz text := public.org_timezone(v_org);
  v_month date := date_trunc('month', p_month)::date;
  v_all boolean := public.has_permission('insights');
begin
  perform public.require_module('distribution');
  if v_org is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  return query
  with sold as (
    select * from public.delivered_order_values(
      v_org,
      (v_month::timestamp at time zone v_tz),
      ((v_month + interval '1 month')::timestamp at time zone v_tz)
    )
  )
  select p.id, p.full_name, t.measure, t.target,
         count(s.order_id),
         coalesce(sum(s.units), 0)::bigint,
         coalesce(sum(s.revenue_excl_vat), 0),
         coalesce(sum(s.gross_profit), 0),
         coalesce(sum(s.uncosted_units), 0)::bigint
  from public.profiles p
  left join public.sales_targets t
    on t.rep_id = p.id and t.org_id = v_org and t.period_month = v_month
  left join sold s on s.rep_id = p.id
  where p.org_id = v_org
    and (p.role = 'rep' or t.id is not null)
    and (p.is_active or t.id is not null)
    and (v_all or p.id = auth.uid())
  group by p.id, p.full_name, t.measure, t.target
  order by p.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rep_performance_summary(p_rep_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_territory_id uuid)
 RETURNS TABLE(rep_id uuid, rep_name text, territories text, stores_assigned bigint, planned_visits bigint, completed_planned bigint, missed_visits bigint, stores_planned bigint, stores_visited bigint, completed_visits bigint, unplanned_visits bigint, sales_net numeric, sales_orders bigint, stores_with_sales bigint, visits_with_order bigint, zero_sales_visits bigint, days_worked bigint, avg_workday_start_seconds numeric, avg_first_checkin_seconds numeric, avg_last_checkout_seconds numeric, avg_visit_seconds numeric, gps_checked bigint, gps_verified_rate numeric, form_compliance_rate numeric, photo_visit_rate numeric, audits bigint, availability_pct numeric, planogram_pct numeric, price_pct numeric, condition_pct numeric, avg_facings numeric, prospects_visited bigint, prospects_converted bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.require_module('reports');
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           -- Raises before a single row is read. `cfg` is the one CTE every
           -- query below joins against, so the guard cannot be planned away.
           public.require_permission('insights') as allowed
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
    (select converted from prospects)
  -- The one row `cfg` holds, so this select cannot produce its row without
  -- evaluating the guard above. Every other function already joins `cfg`
  -- through its own CTEs; this one only reached it inside scalar subqueries.
  from cfg;
$function$;

CREATE OR REPLACE FUNCTION public.rep_performance_daily(p_rep_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_territory_id uuid)
 RETURNS TABLE(day date, planned bigint, completed bigint, visits bigint, sales_net numeric, sales_orders bigint, in_future boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.require_module('reports');
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           -- Raises before a single row is read. `cfg` is the one CTE every
           -- query below joins against, so the guard cannot be planned away.
           public.require_permission('insights') as allowed
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
$function$;

CREATE OR REPLACE FUNCTION public.rep_performance_stores(p_rep_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_territory_id uuid)
 RETURNS TABLE(store_id uuid, store_name text, store_group text, city text, planned bigint, completed bigint, missed bigint, visits bigint, sales_net numeric, sales_orders bigint, prior_sales_net numeric, oos_checked bigint, oos_visits bigint, merch_checks bigint, merch_ok bigint, last_visit_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.require_module('reports');
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           -- Raises before a single row is read. `cfg` is the one CTE every
           -- query below joins against, so the guard cannot be planned away.
           public.require_permission('insights') as allowed
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
$function$;

CREATE OR REPLACE FUNCTION public.rep_performance_missed(p_rep_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_territory_id uuid)
 RETURNS TABLE(route_id uuid, store_id uuid, store_name text, store_group text, city text, planned_date date, reason text, visited_at timestamp with time zone, last_visit_at timestamp with time zone, previous_sales numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.require_module('reports');
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           -- Raises before a single row is read. `cfg` is the one CTE every
           -- query below joins against, so the guard cannot be planned away.
           public.require_permission('insights') as allowed
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
         -- What the application recorded, and nothing inferred. `routes` holds
         -- no outcome, so this is the only thing the data can say.
         case
           when exists (select 1 from visits v
                         where v.route_id = m.id and v.status = 'checked_in')
             then 'Checked in, not checked out'
         end,
         -- The rep going back, as `route_catchups` credits it — one
         -- unscheduled visit to one missed round. Null is the row that
         -- matters: this one was never served.
         (select c.caught_up_at from public.route_catchups(p_from, p_to) c
           where c.route_id = m.id),
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
  -- Never caught up first, then by the money behind the shop. The list is not
  -- truncated and runs to a hundred rows on this data, so the ordering decides
  -- what a manager reads before their attention runs out — and a store nobody
  -- ever went back to outranks a valuable one that was served on Thursday.
  -- Column 8 is `visited_at`. An ordinal rather than a second copy of the
  -- subquery: the first version of this repeated the expression, which is two
  -- definitions of the same thing waiting to drift apart.
  order by 8 asc nulls first, 10 desc nulls last, m.scheduled_date desc, s.name;
$function$;

CREATE OR REPLACE FUNCTION public.store_health(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(store_id uuid, store_name text, city text, last_visit_at timestamp with time zone, last_order_at timestamp with time zone, orders_ever integer, days_since_visit integer, days_since_order integer, status text, lapsed boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           least(coalesce(p_since, now() - interval '30 days'), now()) as since
  ),
  last_visit as (
    select v.store_id, max(v.checkin_at) as at
    from public.visits v
    cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null
    group by v.store_id
  ),
  last_order as (
    select o.store_id, max(o.created_at) as at, count(*)::integer as ever
    from public.orders o
    cross join cfg
    where o.org_id = cfg.org and o.status <> 'cancelled'
    group by o.store_id
  )
  select s.id,
         s.name,
         s.city,
         lv.at,
         lo.at,
         coalesce(lo.ever, 0),
         -- Calendar days in the company's time, as the card has always shown
         -- them: a visit late yesterday is 1 day ago, not 0.
         (now() at time zone cfg.tz)::date - (lv.at at time zone cfg.tz)::date,
         (now() at time zone cfg.tz)::date - (lo.at at time zone cfg.tz)::date,
         case
           when lv.at is null or lv.at < cfg.since then 'not_visited'
           when lo.at >= cfg.since then 'ordering'
           else 'no_order'
         end,
         -- Twice the window: at the card's 30 days, nothing in 60.
         coalesce(lo.ever, 0) > 0 and lo.at < cfg.since - (now() - cfg.since)
  from public.stores s
  cross join cfg
  left join last_visit lv on lv.store_id = s.id
  left join last_order lo on lo.store_id = s.id
  where s.org_id = cfg.org and s.active
  -- "Go here first" order: never visited, then the longest since a visit. The
  -- list keeps it, and the card's five are the first five of it.
  order by lv.at nulls first, s.name, s.id
$function$;

delete from public.module_assignments
 where kind = 'function' and name in ('sales_lines', 'sales_documents');
drop function if exists public.sales_documents(timestamptz, timestamptz);
drop function if exists public.sales_lines(timestamptz, timestamptz);
