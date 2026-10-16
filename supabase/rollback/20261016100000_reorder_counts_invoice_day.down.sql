-- Rollback of 20261016100000_reorder_counts_invoice_day: store_reorder() goes
-- back to 20261015200000's definition, where a Tickd order counts on the day it
-- was taken whatever day it was invoiced. Same columns, so create or replace
-- keeps the grants.

create or replace function public.store_reorder()
returns table (
  store_id uuid,
  store_name text,
  city text,
  last_order_on date,
  last_order_ref text,
  last_order_status text,
  order_days_year integer,
  usual_days integer,
  due_after_days integer,
  due_on date,
  -- [{"product_id": …, "shrinks": n}, …]: what the phone can fill in.
  last_lines jsonb,
  -- Lines of the last order the phone cannot fill in: a QuickBooks line with
  -- no product in Tickd, or a product the phone cannot order (not active, not
  -- stock-tracked, or no shrink size on record).
  last_lines_missing integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');

  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           (now() at time zone public.org_timezone(public.current_org_id()))::date as today,
           coalesce((public.org_setting(public.current_org_id(), 'reorder_after_days') #>> '{}')::integer, 30) as rule
  ),
  ev as (
    -- Tickd's own orders, whoever took them.
    select o.store_id,
           (o.created_at at time zone cfg.tz)::date as on_day,
           o.created_at as at,
           o.order_number as ref,
           o.status,
           o.id as order_id,
           null::uuid as invoice_id
      from public.orders o
     cross join cfg
     where o.org_id = cfg.org
       and o.status <> 'cancelled'
       and o.parent_order_id is null
       and o.store_id is not null
    union all
    -- The QuickBooks history, where it is not already one of the orders above.
    select t.store_id,
           t.issue_date,
           t.issue_date::timestamp at time zone cfg.tz,
           t.invoice_number,
           'invoiced',
           null::uuid,
           t.id
      from public.tax_invoices t
     cross join cfg
     where t.org_id = cfg.org
       and t.source = 'quickbooks'
       and t.status <> 'void'
       and t.order_id is null
       and t.store_id is not null
  ),
  latest as (
    -- On a day with an order and an invoice, the order (it has a time).
    select distinct on (ev.store_id) ev.store_id, ev.on_day, ev.ref, ev.status, ev.order_id, ev.invoice_id
      from ev
     order by ev.store_id, ev.on_day desc, ev.at desc, ev.ref desc
  ),
  last_raw as (
    -- Each line of the last order, in shrinks (fractions kept until the sum).
    --
    -- A Tickd order line is in single units; a cancelled line was not sent.
    select l.store_id, ol.product_id, ol.id as line_id,
           ol.qty_ordered::numeric / nullif(p.units_per_shrink, 0) as shrinks,
           true as is_product
      from latest l
      join public.order_lines ol on ol.order_id = l.order_id
      left join public.products p on p.id = ol.product_id
     where ol.line_status <> 'cancelled'
    union all
    -- A QuickBooks line is usually in shrinks, priced per shrink. Some were
    -- invoiced per single item instead ("Mango Ice", 10 at P140): a unit price
    -- under half the shrink price says so, and the quantity is converted. A
    -- line with no price or no quantity is a note ("As invoiced in
    -- QuickBooks") or a discount, not a product, so it is not counted as left
    -- out either.
    select l.store_id, il.product_id, il.id,
           case when p.units_per_shrink > 0
                 and p.shrink_price_excl_vat > 0
                 and il.unit_price > 0
                 and il.unit_price < p.shrink_price_excl_vat / 2
                then il.qty / p.units_per_shrink
                else il.qty end,
           il.unit_price > 0 and il.qty > 0
      from latest l
      join public.tax_invoice_lines il on il.invoice_id = l.invoice_id
      left join public.products p on p.id = il.product_id
  ),
  last_grouped as (
    -- One entry per product; a line with no product stays on its own, so each
    -- one is counted.
    select r.store_id, r.product_id, sum(r.shrinks) as shrinks, bool_or(r.is_product) as is_product
      from last_raw r
     group by r.store_id, r.product_id, case when r.product_id is null then r.line_id end
  ),
  last_fill as (
    select g.store_id,
           jsonb_agg(jsonb_build_object('product_id', g.product_id,
                                        'shrinks', greatest(1, ceil(g.shrinks))::integer)
                     order by p.name)
             filter (where p.id is not null) as lines,
           (count(*) filter (where p.id is null and g.is_product))::integer as missing
      from last_grouped g
      -- Only what the phone can order: active, stock-tracked, a shrink size.
      left join public.products p
        on p.id = g.product_id
       and p.active
       and p.is_stock_tracked
       and coalesce(p.units_per_shrink, 0) > 0
     group by g.store_id
  ),
  days as (
    select distinct ev.store_id, ev.on_day
      from ev
     cross join cfg
     where ev.on_day > cfg.today - 365
       and ev.on_day <= cfg.today
  ),
  gaps as (
    select d.store_id,
           d.on_day - lag(d.on_day) over (partition by d.store_id order by d.on_day) as gap
      from days d
  ),
  rhythm as (
    select g.store_id,
           count(*)::integer as order_days,
           -- Three order days make two gaps: the least that says "usually".
           case when count(*) >= 3
                then percentile_disc(0.5) within group (order by g.gap)
                       filter (where g.gap is not null) end as usual
      from gaps g
     group by g.store_id
  )
  select s.id,
         s.name,
         s.city,
         l.on_day,
         l.ref,
         l.status,
         coalesce(r.order_days, 0),
         r.usual,
         least(coalesce(r.usual, cfg.rule), cfg.rule),
         l.on_day + least(coalesce(r.usual, cfg.rule), cfg.rule),
         coalesce(f.lines, '[]'::jsonb),
         coalesce(f.missing, 0)
    from public.stores s
   cross join cfg
    left join latest l on l.store_id = s.id
    left join rhythm r on r.store_id = s.id
    left join last_fill f on f.store_id = s.id
   where s.org_id = cfg.org
     and s.active
   order by s.name, s.id
$$;

comment on function public.store_reorder() is
  'Each active store: its last order day (Tickd orders, not back-orders, and QuickBooks invoices with no order), that order''s number and status, its products and shrinks (last_lines) and how many lines cannot be filled in (last_lines_missing), its order days in the last year, its usual gap between orders (3+ order days), and when it is due to order again: the usual gap or reorder_after_days, whichever is sooner. Security definer: reps see the store''s last order whoever took it, but no amounts and no names.';
