-- The figures behind the redesigned dashboard: sales, the orders pipeline,
-- money owed, store health and flagged check-ins, in one call.
--
-- ------------------------------------------------------------- the rules
--
-- **Security invoker, on purpose.** Every table read here already has row-level
-- security that says who may see what: orders to the warehouse permission and a
-- rep's own, visits and location data to the manager role, invoices to the
-- warehouse permission, commissions to insights. Run as the caller, a manager
-- gets the whole picture and anyone else gets exactly the slice they could
-- already read row by row — never more. (A definer function here would have
-- needed every one of those rules restated, and the first one forgotten would be
-- a leak.) A section the caller cannot see comes back as zeros, and the page
-- only shows the dashboard to the `dashboard` permission anyway.
--
-- **Same definitions as everywhere else.** Revenue is the Sales page's: an
-- order with status 'delivered', counted on `delivered_at` in the
-- organisation's timezone, valued on `qty_delivered - qty_returned` at the
-- line's net `unit_price`, excluding VAT, lines with nothing left skipped.
--
-- **Module.** Registered as `core`, like dashboard_summary and
-- dashboard_operations. The distribution tables it reads carry the restrictive
-- `module_gate` policy, so for a company with that module switched off those
-- sections simply read as zero.

create or replace function public.dashboard_business(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
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
  stores_active as (
    select id, name, city from public.stores where org_id = v_org and active
  ),
  last_visit as (
    select v.store_id, max(v.checkin_at) as at
    from public.visits v
    where v.org_id = v_org and v.checkin_at is not null
    group by v.store_id
  ),
  last_order as (
    select o.store_id, max(o.created_at) as at, count(*) as ever
    from public.orders o
    where o.org_id = v_org and o.status <> 'cancelled'
    group by o.store_id
  ),
  health as (
    select sa.id, sa.name, sa.city, lv.at as visited_at, lo.at as ordered_at, coalesce(lo.ever, 0) as ever_ordered
    from stores_active sa
    left join last_visit lv on lv.store_id = sa.id
    left join last_order lo on lo.store_id = sa.id
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
      'low_stock', (select count(distinct product_id) from public.low_stock_alerts(null))
    ),
    'money', jsonb_build_object(
      'invoiced', (select coalesce(sum(total), 0) from public.tax_invoices where org_id = v_org and status = 'issued' and issue_date >= (p_from at time zone v_tz)::date and issue_date < (p_to at time zone v_tz)::date + 1),
      'outstanding', (select coalesce(sum(b.outstanding), 0) from public.tax_invoices i join public.tax_invoice_balances b on b.invoice_id = i.id where i.org_id = v_org and i.status = 'issued'),
      'overdue', (select coalesce(sum(b.outstanding), 0) from public.tax_invoices i join public.tax_invoice_balances b on b.invoice_id = i.id where i.org_id = v_org and i.status = 'issued' and i.due_date < v_today and b.outstanding > 0),
      'commission_pending', (select coalesce(sum(amount), 0) from public.commissions where org_id = v_org and status = 'pending'),
      'commission_to_pay', (select coalesce(sum(amount), 0) from public.commissions where org_id = v_org and status = 'approved')
    ),
    'health', jsonb_build_object(
      'stores_active', (select count(*) from health),
      'ordered_30d', (select count(*) from health where ordered_at >= now() - interval '30 days'),
      'visited_no_order_30d', (select count(*) from health where visited_at >= now() - interval '30 days' and (ordered_at is null or ordered_at < now() - interval '30 days')),
      'not_visited_30d', (select count(*) from health where visited_at is null or visited_at < now() - interval '30 days'),
      'lapsed_60d', (select count(*) from health where ever_ordered > 0 and ordered_at < now() - interval '60 days'),
      'longest_unvisited', (
        select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select jsonb_build_object(
                   'id', id, 'name', name, 'city', city,
                   'days', case when visited_at is null then null
                                else (v_today - (visited_at at time zone v_tz)::date) end
                 ) as x
          from health
          where visited_at is null or visited_at < now() - interval '30 days'
          -- Never-visited first, then the longest gap: both are "go here first".
          order by visited_at nulls first, name
          limit 5
        ) t
      )
    ),
    'field', jsonb_build_object(
      'flagged_checkins', (
        select count(*)
        from public.visits v
        join public.stores s on s.id = v.store_id
        where v.org_id = v_org
          and v.checkin_at >= p_from and v.checkin_at < p_to
          and v.checkin_distance_from_store_m is not null
          and v.checkin_distance_from_store_m > coalesce(s.geofence_radius_m, 150)
      )
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.dashboard_business(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_business(timestamptz, timestamptz) to authenticated;

comment on function public.dashboard_business(timestamptz, timestamptz) is
  'Sales, pipeline, money, store health and flagged check-ins for the dashboard. Security invoker: each section is only what the caller can already read.';

-- README rule 4 (stage2-modules-settings): every authenticated-callable function
-- belongs to a module. The dashboard is core, as dashboard_summary is.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'dashboard_business', 'core')
on conflict do nothing;
