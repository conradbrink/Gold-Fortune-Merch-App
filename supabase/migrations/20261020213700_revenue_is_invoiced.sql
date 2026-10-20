-- Sales are counted on the invoice, not the delivery (owner, 20 Oct 2026).
--
-- The dashboard's revenue was a fraction of what had been invoiced over the
-- same days. It counted only orders somebody had marked delivered, so it left
-- out:
--   * orders invoiced and still on the road or waiting for their proof of
--     delivery, and a large purchase order invoiced but not delivered yet;
--   * every invoice brought over from QuickBooks with no order behind it, so
--     the sales chart started when orders did, not when the history does.
-- Asked what Revenue should count, the owner chose "Invoiced": every issued
-- invoice on its invoice date, excluding VAT, less credit notes on theirs.
--
-- One rule, which every sales figure reads:
--
-- * sales_lines(from, to): each invoice line, and each credit-note line as a
--   negative, excluding VAT, plus a balancing row when a document's lines do
--   not add up to its subtotal (a rebate credit note has no lines). Units are
--   the line's own, times the pack when it is sold by the box ("box of 10" is
--   10). Cost comes from the order line it was invoiced from, so gross profit
--   is known for what Tickd invoiced and not for QuickBooks history. A company
--   without the invoicing module still counts delivered orders, the old rule,
--   so it does not drop to zero.
-- * sales_documents(from, to): the same, one row per invoice, credit note or
--   delivered order, with the rep on the order behind it.
--
-- Both are security invoker: a person sees the sales their own access reads
-- (invoices need invoicing or warehouse), and a definer caller sees the
-- company's. A day is the company's day and `to` is exclusive, as the
-- dashboard's invoiced figure has taken it since 20261010215000.
--
-- Moved onto them: dashboard_business (the revenue tile, the 30 days before,
-- the count, the six months), sales_target_progress (targets),
-- rep_performance_summary, _daily, _stores and _missed (the rep report), and
-- the web's Sales page and the AI Manager's sales answers. store_health also
-- counts an issued invoice as an order on its day, so "stopped ordering" sees
-- the QuickBooks history: a store that bought only on those invoices, and not
-- for 60 days, has stopped; one invoiced since has not.
-- delivered_order_values stays for anything else that wants deliveries.
--
-- The JSON keys stay the same ('orders' now counts invoices), so the web that
-- is live when this is applied keeps working until its words catch up.
--
-- The seven replaced bodies are production's own (pg_get_functiondef on 20
-- Oct 2026) with only the sales parts changed.
--
-- Rollback: supabase/rollback/20261020213700_revenue_is_invoiced.down.sql.

-- ---------------------------------------------------------------- the rule

create or replace function public.sales_lines(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  line_id      uuid,
  doc_id       uuid,
  doc_kind     text,
  doc_number   text,
  invoice_id   uuid,
  order_id     uuid,
  rep_id       uuid,
  rep_name     text,
  store_id     uuid,
  store_name   text,
  store_city   text,
  issued_on    date,
  product_id   uuid,
  product_name text,
  units        numeric,
  net          numeric,
  cost         numeric,
  doc_gross    numeric
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           public.module_enabled('invoicing') as invoices
  ),
  -- The company's days: from the day `p_from` falls on, up to `p_to`
  -- (exclusive). A null end is open.
  win as materialized (
    select cfg.org, cfg.tz, cfg.invoices,
           (p_from at time zone cfg.tz)::date as from_day,
           (p_to at time zone cfg.tz) as to_local
    from cfg
  ),
  inv as materialized (
    select i.id, i.invoice_number, i.order_id, i.store_id, i.issue_date,
           i.subtotal, i.total, i.prices_include_vat, i.vat_rate
    from public.tax_invoices i
    cross join win w
    where w.invoices
      and i.org_id = w.org
      and i.status = 'issued'
      and (w.from_day is null or i.issue_date >= w.from_day)
      and (w.to_local is null or i.issue_date::timestamp < w.to_local)
  ),
  -- A credit note counts on its own date, against an invoice that still
  -- stands: a voided invoice is already out, and its credit with it.
  cn as materialized (
    select c.id, c.credit_number, c.invoice_id, i.order_id, i.store_id, c.issue_date,
           c.subtotal, c.total, i.prices_include_vat, i.vat_rate
    from public.credit_notes c
    join public.tax_invoices i on i.id = c.invoice_id
    cross join win w
    where w.invoices
      and c.org_id = w.org
      and i.status = 'issued'
      and (w.from_day is null or c.issue_date >= w.from_day)
      and (w.to_local is null or c.issue_date::timestamp < w.to_local)
  ),
  -- Each invoice line once: what it sold, how many units make one of its
  -- quantity ("box of 10" is 10), and one unit's cost from the order line it
  -- was invoiced from. QuickBooks history has no order line, so no cost.
  il as materialized (
    select l.id, l.invoice_id, l.qty, l.line_total, l.product_id,
           coalesce(p.name, l.description) as product_name,
           coalesce((regexp_match(l.unit, '^box of ([0-9]+)$', 'i'))[1]::numeric, 1) as pack,
           ol.unit_cost_excl_vat as unit_cost
    from public.tax_invoice_lines l
    left join public.products p on p.id = l.product_id
    left join public.order_lines ol on ol.id = l.order_line_id
    where l.invoice_id in (select id from inv union select invoice_id from cn)
  ),
  lines as (
    -- Invoice lines, excluding VAT.
    select x.id as line_id, i.id as doc_id, 'invoice'::text as doc_kind, i.invoice_number as doc_number,
           i.id as invoice_id, i.order_id, i.store_id, i.issue_date as issued_on,
           x.product_id, x.product_name,
           x.qty * x.pack as units,
           case when i.prices_include_vat then x.line_total / (1 + i.vat_rate / 100)
                else x.line_total end as net,
           x.qty * x.pack * x.unit_cost as cost,
           i.total as doc_gross
    from inv i
    join il x on x.invoice_id = i.id

    union all
    -- What a line misses: a document whose lines do not add up to its
    -- subtotal (rounding when prices include VAT) carries the difference on a
    -- row of its own, so a document's rows always add up to its subtotal.
    select i.id, i.id, 'invoice', i.invoice_number, i.id, i.order_id, i.store_id, i.issue_date,
           null, null, 0, i.subtotal - coalesce(s.net, 0), null, i.total
    from inv i
    left join lateral (
      select sum(case when i.prices_include_vat then l.line_total / (1 + i.vat_rate / 100)
                      else l.line_total end) as net
      from public.tax_invoice_lines l where l.invoice_id = i.id
    ) s on true
    where i.subtotal <> coalesce(s.net, 0)

    union all
    -- Credit-note lines, as negatives of the invoice lines they reduce.
    select cl.id, c.id, 'credit_note', c.credit_number, c.invoice_id, c.order_id, c.store_id, c.issue_date,
           x.product_id, x.product_name,
           -(cl.qty * x.pack),
           -(case when c.prices_include_vat then cl.line_total / (1 + c.vat_rate / 100)
                  else cl.line_total end),
           -(cl.qty * x.pack * x.unit_cost),
           -c.total
    from cn c
    join public.credit_note_lines cl on cl.credit_note_id = c.id
    join il x on x.id = cl.invoice_line_id

    union all
    -- A credit note's difference, and the whole of one with no lines (a rebate).
    select c.id, c.id, 'credit_note', c.credit_number, c.invoice_id, c.order_id, c.store_id, c.issue_date,
           null, null, 0, -(c.subtotal - coalesce(s.net, 0)), null, -c.total
    from cn c
    left join lateral (
      select sum(case when c.prices_include_vat then cl.line_total / (1 + c.vat_rate / 100)
                      else cl.line_total end) as net
      from public.credit_note_lines cl where cl.credit_note_id = c.id
    ) s on true
    where c.subtotal <> coalesce(s.net, 0)

    union all
    -- A company that does not invoice in Tickd: delivered orders, the rule
    -- before this one, valued on what arrived less what came back.
    select ol.id, o.id, 'order', o.order_number, null, o.id, o.store_id,
           (o.delivered_at at time zone w.tz)::date,
           ol.product_id, p.name,
           (ol.qty_delivered - ol.qty_returned)::numeric,
           (ol.qty_delivered - ol.qty_returned) * coalesce(ol.unit_price, 0),
           (ol.qty_delivered - ol.qty_returned) * ol.unit_cost_excl_vat,
           round(sum((ol.qty_delivered - ol.qty_returned) * coalesce(ol.unit_price, 0))
                   over (partition by o.id) * (1 + o.vat_rate / 100), 2)
    from public.orders o
    cross join win w
    join public.order_lines ol
      on ol.order_id = o.id and ol.qty_delivered - ol.qty_returned > 0
    left join public.products p on p.id = ol.product_id
    where not w.invoices
      and o.org_id = w.org
      and o.status = 'delivered'
      and o.delivered_at is not null
      and (p_from is null or o.delivered_at >= p_from)
      and (p_to is null or o.delivered_at < p_to)
  )
  -- The rep is the one on the order behind the document; QuickBooks history
  -- with no order has none.
  select l.line_id, l.doc_id, l.doc_kind, l.doc_number, l.invoice_id, l.order_id,
         o.rep_id, r.full_name, l.store_id, s.name, s.city, l.issued_on,
         l.product_id, l.product_name, l.units, l.net, l.cost, l.doc_gross
  from lines l
  left join public.orders o on o.id = l.order_id
  left join public.profiles r on r.id = o.rep_id
  left join public.stores s on s.id = l.store_id
$$;

comment on function public.sales_lines(timestamptz, timestamptz) is
  'Every sale, line by line (line_id is the invoice, credit-note or order line, or the document for its balancing row): issued invoice lines on the invoice date and credit-note lines (negative) on theirs, excluding VAT, with a balancing row per document so its rows add up to its subtotal. A company without invoicing counts delivered orders. The one rule every sales figure reads (20261020213700). Security invoker.';

create or replace function public.sales_documents(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  doc_id           uuid,
  doc_kind         text,
  doc_number       text,
  invoice_id       uuid,
  order_id         uuid,
  rep_id           uuid,
  rep_name         text,
  store_id         uuid,
  store_name       text,
  store_city       text,
  issued_on        date,
  issued_at        timestamptz,
  units            numeric,
  revenue_excl_vat numeric,
  revenue_incl_vat numeric,
  gross_profit     numeric,
  uncosted_units   numeric
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select l.doc_id, l.doc_kind, l.doc_number, l.invoice_id, l.order_id,
         l.rep_id, l.rep_name, l.store_id, l.store_name, l.store_city,
         l.issued_on,
         -- Midday of that day in the company's time, for code that places a
         -- sale by a time: it cannot slip into the day before or after.
         (l.issued_on + time '12:00') at time zone z.tz,
         sum(l.units),
         round(sum(l.net), 2),
         max(l.doc_gross),
         -- Unknown cost counts as none, as delivered_order_values did, and
         -- the units it covers are reported beside it.
         round(sum(l.net) - sum(coalesce(l.cost, 0)), 2),
         coalesce(sum(l.units) filter (where l.cost is null), 0)
  from public.sales_lines(p_from, p_to) l
  cross join (select public.org_timezone(public.current_org_id()) as tz) z
  group by l.doc_id, l.doc_kind, l.doc_number, l.invoice_id, l.order_id,
           l.rep_id, l.rep_name, l.store_id, l.store_name, l.store_city,
           l.issued_on, z.tz
$$;

comment on function public.sales_documents(timestamptz, timestamptz) is
  'Every sale, one row per invoice, credit note (negative) or, for a company without invoicing, delivered order: sales_lines added up. Revenue excluding and including VAT, gross profit where the cost is known, and the rep on the order behind it. Security invoker.';

revoke all on function public.sales_lines(timestamptz, timestamptz) from public, anon;
revoke all on function public.sales_documents(timestamptz, timestamptz) from public, anon;
grant execute on function public.sales_lines(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.sales_documents(timestamptz, timestamptz) to authenticated, service_role;

-- README rule 4: every authenticated-callable function belongs to a module.
-- Core, as dashboard_business is: the invoices and orders they read keep
-- their own module gates.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'sales_lines', 'core'),
       ('function', 'sales_documents', 'core')
on conflict do nothing;

-- ----------------------------------------------------- the figures that read it

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

  -- Sales are invoices on their date, less credit notes (owner, 20 Oct 2026):
  -- the one rule in sales_documents. 'orders' below counts the invoices, so
  -- the keys the web reads are unchanged.
  with sold as (
    select s.doc_id, s.doc_kind, s.issued_on, s.revenue_excl_vat as net
    from public.sales_documents((v_month0 - interval '5 months')::timestamp at time zone v_tz, null) s
  ),
  months as (
    select generate_series(v_month0 - interval '5 months', v_month0, interval '1 month')::date as m
  ),
  by_month as (
    select mo.m,
           coalesce(sum(s.net), 0) as net,
           count(s.doc_id) filter (where s.doc_kind <> 'credit_note') as orders
    from months mo
    left join sold s
      on s.issued_on >= mo.m
     and s.issued_on < (mo.m + interval '1 month')::date
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
      'current', (select coalesce(sum(revenue_excl_vat), 0) from public.sales_documents(p_from, p_to)),
      'previous', (select coalesce(sum(revenue_excl_vat), 0) from public.sales_documents(p_from - v_len, p_from)),
      'orders', (select count(*) from public.sales_documents(p_from, p_to) where doc_kind <> 'credit_note'),
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
  -- The month's sales: invoices less credit notes, the one rule in
  -- sales_documents. A rep's are the invoices for the orders they took.
  with sold as (
    select * from public.sales_documents(
      (v_month::timestamp at time zone v_tz),
      ((v_month + interval '1 month')::timestamp at time zone v_tz)
    )
  )
  select p.id, p.full_name, t.measure, t.target,
         count(s.doc_id) filter (where s.doc_kind <> 'credit_note'),
         coalesce(round(sum(s.units)), 0)::bigint,
         coalesce(sum(s.revenue_excl_vat), 0),
         coalesce(sum(s.gross_profit), 0),
         coalesce(round(sum(s.uncosted_units)), 0)::bigint
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
  -- The money: invoices on their date less credit notes, the one rule in
  -- sales_documents (20261020213700). A rep's are the invoices for the
  -- orders they took.
  sold as materialized (
    select s.doc_id as id, s.doc_kind, s.store_id, s.revenue_excl_vat as net
    from public.sales_documents(p_from, p_to) s
    join st on st.id = s.store_id
    cross join cfg
    where s.rep_id = p_rep_id
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
    (select count(*) from sold where doc_kind <> 'credit_note'),
    -- A store whose credit notes cancel its invoices has no sales.
    (select count(*) from (select store_id from sold group by store_id having sum(net) > 0) x),
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
  -- Invoices on their date less credit notes (sales_documents).
  sold as (
    select s.issued_on as day,
           count(*) filter (where s.doc_kind <> 'credit_note') as n,
           sum(s.revenue_excl_vat) as net
    from public.sales_documents(p_from, p_to) s
    join st on st.id = s.store_id
    cross join cfg
    where s.rep_id = p_rep_id
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
  -- Invoices on their date less credit notes (sales_documents).
  sold as (
    select s.store_id,
           count(*) filter (where s.doc_kind <> 'credit_note') as n,
           sum(s.revenue_excl_vat) as net
    from public.sales_documents(p_from, p_to) s
    join st on st.id = s.store_id
    cross join cfg
    where s.rep_id = p_rep_id
    group by s.store_id
  ),
  -- The same figure for the period before, so "declining" is a comparison
  -- rather than an adjective.
  prior as (
    select s.store_id, sum(s.revenue_excl_vat) as net
    from bounds b
    cross join lateral public.sales_documents(b.prior_from, p_from) s
    join st on st.id = s.store_id
    cross join cfg
    where s.rep_id = p_rep_id
    group by s.store_id
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
  ),
  -- Every sale at these stores up to the end of the period, on the one rule
  -- (sales_documents): an invoice less the credit notes against it.
  docs as materialized (
    select s.doc_id, s.doc_kind, s.doc_number, s.invoice_id, s.store_id,
           s.issued_on, s.revenue_excl_vat
    from public.sales_documents(null, p_to) s
    where s.store_id in (select store_id from missed)
  ),
  bought as materialized (
    select d.store_id, d.issued_on, d.doc_number,
           d.revenue_excl_vat
             + coalesce((select sum(c.revenue_excl_vat) from docs c
                          where c.doc_kind = 'credit_note' and c.invoice_id = d.doc_id), 0) as net
    from docs d
    where d.doc_kind <> 'credit_note'
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
         -- The most recent sale at the store before that day: an invoice less
         -- its credit notes, valued the same way as everything else here.
         -- A store that has never bought anything has no row, so the column
         -- is null and the page prints a dash rather than P0.00.
         (select b.net from bought b
           where b.store_id = m.store_id
             and b.issued_on < m.scheduled_date
           order by b.issued_on desc, b.doc_number desc
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
  -- An order, or an issued invoice: either way the store bought that day.
  -- Invoices bring in the QuickBooks history and anything raised straight
  -- from a job, so "stopped ordering" sees every purchase (20261020213700).
  last_order as (
    select x.store_id, max(x.at) as at, count(*)::integer as ever
    from (
      select o.store_id, o.created_at as at
      from public.orders o
      cross join cfg
      where o.org_id = cfg.org and o.status <> 'cancelled'
      union all
      select i.store_id, i.issue_date::timestamp at time zone cfg.tz
      from public.tax_invoices i
      cross join cfg
      where i.org_id = cfg.org and i.status = 'issued' and i.store_id is not null
    ) x
    group by x.store_id
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
