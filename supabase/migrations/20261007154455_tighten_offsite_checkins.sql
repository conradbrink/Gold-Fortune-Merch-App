-- Tightens the dashboard's "check-ins far from store" (20261007152340), at the
-- owner's request after it read 55 for a month.
--
-- The old rule flagged any check-in outside the store's 100 m check-in radius.
-- Measured on the 30 days to 7 Oct 2026, of 56 flagged:
--   9 were at stores whose position is only a Places guess — the pin, not the
--     rep, is the likelier fault;
--   7 were more than 5 km away, which the company already treats as invalid GPS;
--   9 were within 500 m once the phone's own GPS error was allowed for;
--   31 were on a confirmed store position, 500 m – 5 km away beyond GPS error.
-- Those 31 are what is now counted. The phones were accurate (median 17 m), so
-- this was never GPS noise; it was the rule.
--
-- The distances are the company's own settings (off_site_distance_m,
-- invalid_gps_distance_m via company_setting), not literals, and the threshold
-- is returned so the card can say it. Everything else in the function is
-- unchanged; it stays security invoker and module core.

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
  -- Company settings, not literals: the same thresholds the visit screens use.
  v_off_site_m numeric := coalesce((public.company_setting('off_site_distance_m') #>> '{}')::numeric, 500);
  v_invalid_m numeric := coalesce((public.company_setting('invalid_gps_distance_m') #>> '{}')::numeric, 5000);
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
      -- Off site: a confirmed store position (a guessed pin being wrong is
      -- the likelier story otherwise), further than the company's off-site
      -- distance even after allowing for the phone's own GPS error, and not
      -- so far that the company already calls the fix invalid.
      'flagged_checkins', (
        select count(*)
        from public.visits v
        join public.stores s on s.id = v.store_id
        where v.org_id = v_org
          and v.checkin_at >= p_from and v.checkin_at < p_to
          and v.checkin_distance_from_store_m is not null
          and s.location_confirmed_at is not null
          and v.checkin_distance_from_store_m - coalesce(v.checkin_gps_accuracy_m, 0) > v_off_site_m
          and v.checkin_distance_from_store_m <= v_invalid_m
      ),
      'off_site_m', v_off_site_m
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.dashboard_business(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_business(timestamptz, timestamptz) to authenticated;
