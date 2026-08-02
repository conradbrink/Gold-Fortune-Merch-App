-- The numbers a manager asks for, and the ones a clerk works from.
--
-- Every function here is `security invoker` and `stable`, per supabase/README:
-- they read what the caller can already see, so RLS is the guard and there is
-- no bypass to reason about. That is the opposite of the transactional RPCs,
-- which must be definer because they write a table nobody has privileges on.
--
-- Each one materialises `current_org_id()` into a CTE and filters on it
-- explicitly, so the planner sees a literal and uses the org indexes rather
-- than re-evaluating a function per row.
--
-- ---------------------------------------------------------------- on cost
--
-- Valuation uses the **last cost paid** — the unit_cost on the most recent
-- posted goods receipt line for that product. Not a weighted average, and not
-- FIFO layers.
--
-- That is a deliberate simplification and it should be said out loud: in a
-- rising market last-cost overstates the value of older stock. It is chosen
-- because it is explainable to the person reading it, needs no cost layer to be
-- maintained alongside the quantity ledger, and this business buys the same
-- lines repeatedly at prices that move slowly. If the accounts ever need
-- weighted average, that is a real change: a cost column on the balance and a
-- recalculation on every receipt.

-- ------------------------------------------------------------ stock_on_hand

/**
 * Every bucket, per product, at one location or across all of them.
 *
 * The workhorse behind the inventory screen. `p_only_below_min` narrows it to
 * the lines that need attention, using the per-location override where one
 * exists and the product default otherwise.
 */
drop function if exists public.stock_on_hand(uuid, text, boolean);
create or replace function public.stock_on_hand(
  p_location_id uuid default null,
  p_search text default null,
  p_only_below_min boolean default false
)
returns table (
  product_id uuid,
  product_name text,
  brand text,
  sku_code text,
  location_id uuid,
  location_name text,
  qty_available integer,
  qty_reserved integer,
  qty_damaged integer,
  qty_expired integer,
  qty_in_transit integer,
  qty_promotional integer,
  qty_on_hand integer,
  min_stock_level integer,
  reorder_point integer,
  is_below_min boolean,
  is_out_of_stock boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  rolled as (
    select
      b.product_id, b.location_id,
      sum(b.qty_available)::integer   as qty_available,
      sum(b.qty_reserved)::integer    as qty_reserved,
      sum(b.qty_damaged)::integer     as qty_damaged,
      sum(b.qty_expired)::integer     as qty_expired,
      sum(b.qty_in_transit)::integer  as qty_in_transit,
      sum(b.qty_promotional)::integer as qty_promotional,
      sum(b.qty_on_hand)::integer     as qty_on_hand
    from public.stock_balances b
    cross join cfg
    where b.org_id = cfg.org
      and (p_location_id is null or b.location_id = p_location_id)
    -- Batches are summed away here. The batch detail is what
    -- stock_movement_history and expiring_stock are for; this is the
    -- "how many have we got" screen.
    group by b.product_id, b.location_id
  )
  select
    r.product_id, p.name, p.brand, p.sku_code,
    r.location_id, l.name,
    r.qty_available, r.qty_reserved, r.qty_damaged, r.qty_expired,
    r.qty_in_transit, r.qty_promotional, r.qty_on_hand,
    coalesce(pls.min_stock_level, p.min_stock_level),
    coalesce(pls.reorder_point, p.reorder_point),
    coalesce(pls.min_stock_level, p.min_stock_level) is not null
      and r.qty_available < coalesce(pls.min_stock_level, p.min_stock_level),
    r.qty_available = 0
  from rolled r
  cross join cfg
  join public.products p on p.id = r.product_id
  join public.stock_locations l on l.id = r.location_id
  left join public.product_location_settings pls
    on pls.product_id = r.product_id and pls.location_id = r.location_id
   and pls.org_id = cfg.org
  where (
      p_search is null or btrim(p_search) = ''
      or p.name ilike '%' || btrim(p_search) || '%'
      or coalesce(p.sku_code, '') ilike '%' || btrim(p_search) || '%'
      or coalesce(p.brand, '') ilike '%' || btrim(p_search) || '%'
    )
    and (
      not p_only_below_min
      or r.qty_available = 0
      or (coalesce(pls.min_stock_level, p.min_stock_level) is not null
          and r.qty_available < coalesce(pls.min_stock_level, p.min_stock_level))
    )
  order by p.name, l.name;
$$;

comment on function public.stock_on_hand(uuid, text, boolean) is
  'All seven stock buckets per product, optionally at one location, optionally only what is below its minimum.';

-- --------------------------------------------------- stock_position_summary

/**
 * One row of totals: the tiles across the top of the inventory screen.
 */
drop function if exists public.stock_position_summary(uuid);
create or replace function public.stock_position_summary(p_location_id uuid default null)
returns table (
  qty_available bigint,
  qty_reserved bigint,
  qty_damaged bigint,
  qty_expired bigint,
  qty_in_transit bigint,
  qty_promotional bigint,
  qty_on_hand bigint,
  products_stocked bigint,
  products_out_of_stock bigint,
  products_below_min bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  lines as (
    select * from public.stock_on_hand(p_location_id, null, false)
  )
  select
    coalesce(sum(l.qty_available), 0)::bigint,
    coalesce(sum(l.qty_reserved), 0)::bigint,
    coalesce(sum(l.qty_damaged), 0)::bigint,
    coalesce(sum(l.qty_expired), 0)::bigint,
    coalesce(sum(l.qty_in_transit), 0)::bigint,
    coalesce(sum(l.qty_promotional), 0)::bigint,
    coalesce(sum(l.qty_on_hand), 0)::bigint,
    count(*)::bigint,
    count(*) filter (where l.is_out_of_stock)::bigint,
    count(*) filter (where l.is_below_min)::bigint
  from lines l cross join cfg;
$$;

-- ---------------------------------------------------------- low_stock_alerts

/**
 * What to buy, and how much. Ordered by how badly it is needed.
 */
drop function if exists public.low_stock_alerts(uuid);
create or replace function public.low_stock_alerts(p_location_id uuid default null)
returns table (
  product_id uuid,
  product_name text,
  brand text,
  location_id uuid,
  location_name text,
  qty_available integer,
  min_stock_level integer,
  reorder_point integer,
  recommended_order_qty integer,
  severity text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  lines as (select * from public.stock_on_hand(p_location_id, null, false))
  select
    l.product_id, l.product_name, l.brand, l.location_id, l.location_name,
    l.qty_available, l.min_stock_level, l.reorder_point,
    -- Enough to reach the reorder point, or the product's stated reorder
    -- quantity, whichever is larger. Ordering exactly up to the floor leaves
    -- you back here next week.
    greatest(
      coalesce(pls.reorder_qty, p.reorder_qty, 0),
      coalesce(l.reorder_point, l.min_stock_level, 0) - l.qty_available
    )::integer,
    case
      when l.qty_available = 0 then 'out_of_stock'
      when l.is_below_min then 'below_minimum'
      else 'at_reorder_point'
    end
  from lines l
  cross join cfg
  join public.products p on p.id = l.product_id
  left join public.product_location_settings pls
    on pls.product_id = l.product_id and pls.location_id = l.location_id
   and pls.org_id = cfg.org
  where l.qty_available = 0
     or l.is_below_min
     or (l.reorder_point is not null and l.qty_available <= l.reorder_point)
  order by
    case when l.qty_available = 0 then 0 when l.is_below_min then 1 else 2 end,
    l.product_name;
$$;

comment on function public.low_stock_alerts(uuid) is
  'Products at or below their reorder point, with a recommended order quantity. Out of stock first.';

-- ------------------------------------------------------------ expiring_stock

/**
 * Batches going off, soonest first. Anything already past its date is included
 * with a negative day count rather than hidden — expired stock on the shelf is
 * the thing you most want to know about.
 */
drop function if exists public.expiring_stock(integer, uuid);
create or replace function public.expiring_stock(
  p_within_days integer default 90,
  p_location_id uuid default null
)
returns table (
  product_id uuid,
  product_name text,
  batch_id uuid,
  batch_number text,
  expiry_date date,
  days_until_expiry integer,
  location_id uuid,
  location_name text,
  qty_on_hand integer,
  already_expired boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org)
  select
    b.product_id, p.name, b.batch_id, pb.batch_number, pb.expiry_date,
    (pb.expiry_date - current_date)::integer,
    b.location_id, l.name, b.qty_on_hand,
    pb.expiry_date < current_date
  from public.stock_balances b
  cross join cfg
  join public.product_batches pb on pb.id = b.batch_id
  join public.products p on p.id = b.product_id
  join public.stock_locations l on l.id = b.location_id
  where b.org_id = cfg.org
    and b.qty_on_hand > 0
    and pb.expiry_date is not null
    and pb.expiry_date <= current_date + greatest(p_within_days, 0)
    and (p_location_id is null or b.location_id = p_location_id)
  order by pb.expiry_date, p.name;
$$;

-- --------------------------------------------------------------- stock_ageing

/**
 * How long stock has been sitting, by the age of its batch.
 *
 * Untracked stock has no batch and therefore no arrival date, so it lands in
 * an `unknown` bucket rather than being guessed at or silently dropped.
 */
drop function if exists public.stock_ageing(uuid);
create or replace function public.stock_ageing(p_location_id uuid default null)
returns table (
  age_band text,
  products bigint,
  qty_on_hand bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  aged as (
    select
      b.product_id, b.qty_on_hand,
      case
        when pb.first_received_at is null then 'unknown'
        when pb.first_received_at > now() - interval '30 days'  then '0-30 days'
        when pb.first_received_at > now() - interval '60 days'  then '31-60 days'
        when pb.first_received_at > now() - interval '90 days'  then '61-90 days'
        when pb.first_received_at > now() - interval '180 days' then '91-180 days'
        else 'over 180 days'
      end as band
    from public.stock_balances b
    cross join cfg
    left join public.product_batches pb on pb.id = b.batch_id
    where b.org_id = cfg.org
      and b.qty_on_hand > 0
      and (p_location_id is null or b.location_id = p_location_id)
  )
  select
    a.band,
    count(distinct a.product_id)::bigint,
    sum(a.qty_on_hand)::bigint
  from aged a
  group by a.band
  order by case a.band
    when '0-30 days' then 1 when '31-60 days' then 2 when '61-90 days' then 3
    when '91-180 days' then 4 when 'over 180 days' then 5 else 6 end;
$$;

-- ----------------------------------------------------------- stock_valuation

/**
 * What the stock is worth, at the last price paid for each product.
 *
 * See the header for why last-cost and not weighted average. Products never
 * bought through a goods receipt have no cost and are reported with a null
 * value rather than a zero, so "we do not know" is distinguishable from
 * "it is worth nothing".
 */
drop function if exists public.stock_valuation(uuid);
create or replace function public.stock_valuation(p_location_id uuid default null)
returns table (
  product_id uuid,
  product_name text,
  qty_on_hand integer,
  qty_available integer,
  last_unit_cost numeric,
  value_at_cost numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  lines as (select * from public.stock_on_hand(p_location_id, null, false)),
  rolled as (
    select l.product_id, l.product_name,
           sum(l.qty_on_hand)::integer as qty_on_hand,
           sum(l.qty_available)::integer as qty_available
    from lines l group by l.product_id, l.product_name
  ),
  last_cost as (
    select distinct on (grl.product_id)
      grl.product_id,
      -- The cost is per receiving unit, so it has to be divided by the pack
      -- factor that was frozen onto that line to get a per-base-unit cost.
      -- Using the raw figure would value a shrink of twelve as twelve shrinks.
      case when coalesce(grl.units_per_uom, 1) > 0
           then grl.unit_cost / coalesce(grl.units_per_uom, 1) end as unit_cost
    from public.goods_receipt_lines grl
    cross join cfg
    join public.goods_receipts gr on gr.id = grl.goods_receipt_id
    where grl.org_id = cfg.org
      and gr.status = 'posted'
      and grl.unit_cost is not null
    order by grl.product_id, gr.received_at desc, grl.id desc
  )
  select
    r.product_id, r.product_name, r.qty_on_hand, r.qty_available,
    round(lc.unit_cost, 4),
    round(lc.unit_cost * r.qty_on_hand, 2)
  from rolled r
  left join last_cost lc on lc.product_id = r.product_id
  order by (lc.unit_cost * r.qty_on_hand) desc nulls last, r.product_name;
$$;

-- ------------------------------------------------------ stock_movement_summary

/**
 * Where the stock went, over a period: received, sold, returned, adjusted,
 * lost. The "stock received, sold, returned and adjusted" report.
 */
drop function if exists public.stock_movement_summary(timestamptz, timestamptz, uuid);
create or replace function public.stock_movement_summary(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_location_id uuid default null
)
returns table (
  category text,
  movements bigint,
  units bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  scoped as (
    select m.*,
      case m.reason
        when 'goods_receipt' then 'Received'
        when 'opening_stock' then 'Opening stock'
        when 'customer_return' then 'Customer returns'
        when 'order_delivery' then 'Delivered to customers'
        when 'grn_correction' then 'Receipt corrections'
        when 'transfer_loss' then 'Lost in transfer'
        when 'adjustment_damage' then 'Damaged'
        when 'adjustment_expiry' then 'Expired'
        when 'adjustment_promotional' then 'Promotional'
        when 'adjustment_missing' then 'Missing'
        when 'adjustment_found' then 'Found'
        when 'adjustment_write_off' then 'Written off'
        when 'adjustment_other' then 'Other adjustments'
        when 'stocktake_variance_increase' then 'Stocktake gains'
        when 'stocktake_variance_decrease' then 'Stocktake losses'
        when 'order_return_undelivered' then 'Returned undelivered'
        else null
      end as category
    from public.stock_movements m
    cross join cfg
    where m.org_id = cfg.org
      and m.occurred_at >= p_from and m.occurred_at < p_to
      and (p_location_id is null
           or m.from_location_id = p_location_id
           or m.to_location_id = p_location_id)
  )
  -- Reservations, picks and dispatches are deliberately excluded: they move
  -- stock between buckets in the same building and would inflate every total
  -- with the same units counted three times on their way out of the door.
  select s.category, count(*)::bigint, sum(s.qty)::bigint
  from scoped s
  where s.category is not null
  group by s.category
  order by sum(s.qty) desc;
$$;

-- ----------------------------------------------------- orders_pipeline_summary

/**
 * The order board: how many are sitting at each status, how old the oldest is,
 * and what they are worth.
 */
drop function if exists public.orders_pipeline_summary(timestamptz, timestamptz);
create or replace function public.orders_pipeline_summary(
  p_from timestamptz default now() - interval '90 days',
  p_to timestamptz default now()
)
returns table (
  status text,
  orders bigint,
  units bigint,
  value_excl_vat numeric,
  oldest_created_at timestamptz,
  hours_waiting numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  scoped as (
    select o.id, o.status, o.created_at
    from public.orders o cross join cfg
    where o.org_id = cfg.org
      and o.created_at >= p_from and o.created_at < p_to
  ),
  lines as (
    select s.status, s.id, s.created_at,
           sum(ol.qty_ordered) as units,
           sum(ol.qty_ordered * coalesce(ol.unit_price, 0)) as value
    from scoped s
    left join public.order_lines ol on ol.order_id = s.id
    group by s.status, s.id, s.created_at
  )
  select
    l.status, count(*)::bigint,
    coalesce(sum(l.units), 0)::bigint,
    round(coalesce(sum(l.value), 0), 2),
    min(l.created_at),
    -- Only meaningful for the statuses that are a queue. A delivered order has
    -- not been "waiting" since it was created.
    case when l.status in ('new','confirmed','picking','packed')
         then round(extract(epoch from (now() - min(l.created_at))) / 3600.0, 1) end
  from lines l
  group by l.status
  order by case l.status
    when 'new' then 1 when 'confirmed' then 2 when 'picking' then 3
    when 'packed' then 4 when 'dispatched' then 5 when 'delivered' then 6
    else 7 end;
$$;

-- ----------------------------------------------------- warehouse_performance

/**
 * How well the warehouse is running, sliced by whatever the manager is asking
 * about: overall, per staff member, per driver, per delivery area, or per day.
 *
 * Fulfilment time is confirm → dispatch, because that is the part the warehouse
 * controls. Delivery time is dispatch → delivered, which is the driver's.
 * Lumping them together produces a number nobody can act on.
 *
 * Accuracy is delivered units over ordered units, on delivered orders only.
 */
drop function if exists public.warehouse_performance(timestamptz, timestamptz, text);
create or replace function public.warehouse_performance(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_group_by text default 'overall'
)
returns table (
  bucket text,
  orders_delivered bigint,
  avg_fulfilment_hours numeric,
  avg_delivery_hours numeric,
  late_deliveries bigint,
  units_ordered bigint,
  units_delivered bigint,
  fulfilment_accuracy numeric,
  outstanding_pods bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  base as (
    select
      o.id, o.status, o.pod_status, o.confirmed_at, o.dispatched_at, o.delivered_at,
      d.driver_id, d.expected_delivery_on,
      coalesce(dr.full_name, d.carrier_name, 'Unassigned') as driver_name,
      coalesce(pk.full_name, 'Unknown') as packer_name,
      coalesce(t.name, 'No territory') as area_name,
      o.delivered_at::date as delivered_on
    from public.orders o
    cross join cfg
    left join lateral (
      select * from public.dispatches x
      where x.order_id = o.id order by x.dispatched_at desc limit 1
    ) d on true
    left join public.drivers dr on dr.id = d.driver_id
    left join public.profiles pk on pk.id = o.packed_by
    left join public.stores st on st.id = o.store_id
    left join public.territories t on t.id = st.territory_id
    where o.org_id = cfg.org
      and o.delivered_at is not null
      and o.delivered_at >= p_from and o.delivered_at < p_to
  ),
  qty as (
    select ol.order_id,
           sum(ol.qty_ordered)::bigint as ordered,
           sum(ol.qty_delivered)::bigint as delivered
    from public.order_lines ol
    join base b on b.id = ol.order_id
    group by ol.order_id
  ),
  labelled as (
    select
      case p_group_by
        when 'driver' then b.driver_name
        when 'staff' then b.packer_name
        when 'area' then b.area_name
        when 'date' then to_char(b.delivered_on, 'YYYY-MM-DD')
        else 'Overall'
      end as bucket,
      b.*, q.ordered, q.delivered
    from base b left join qty q on q.order_id = b.id
  )
  select
    l.bucket,
    count(*)::bigint,
    round(avg(extract(epoch from (l.dispatched_at - l.confirmed_at)) / 3600.0)::numeric, 1),
    round(avg(extract(epoch from (l.delivered_at - l.dispatched_at)) / 3600.0)::numeric, 1),
    count(*) filter (
      where l.expected_delivery_on is not null
        and l.delivered_at::date > l.expected_delivery_on
    )::bigint,
    coalesce(sum(l.ordered), 0)::bigint,
    coalesce(sum(l.delivered), 0)::bigint,
    case when coalesce(sum(l.ordered), 0) > 0
         then round(100.0 * sum(l.delivered) / sum(l.ordered), 1) end,
    count(*) filter (where l.pod_status = 'outstanding')::bigint
  from labelled l
  group by l.bucket
  order by l.bucket;
$$;

comment on function public.warehouse_performance(timestamptz, timestamptz, text) is
  'Fulfilment and delivery performance over a period. p_group_by is overall | staff | driver | area | date.';

-- --------------------------------------------------------- product_velocity

/**
 * What is selling, what is not, and how long the shelf will last.
 *
 * "Sold" is units that left on a delivery, not units ordered — an order that
 * was cancelled did not consume any stock and should not make a line look
 * fast-moving.
 *
 * `days_of_stock_remaining` is null when nothing has sold in the window, which
 * is the honest answer: a line with no sales does not have "infinite" days of
 * cover, it has an unknown number, and showing a large number would rank it
 * as healthy when it is the opposite.
 */
drop function if exists public.product_velocity(integer, uuid);
create or replace function public.product_velocity(
  p_days integer default 30,
  p_location_id uuid default null
)
returns table (
  product_id uuid,
  product_name text,
  brand text,
  units_sold bigint,
  avg_units_per_day numeric,
  qty_available integer,
  days_of_stock_remaining numeric,
  times_backordered bigint,
  movement_class text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  window_days as (select greatest(p_days, 1) as d),
  sold as (
    select m.product_id, sum(m.qty)::bigint as units
    from public.stock_movements m
    cross join cfg cross join window_days w
    where m.org_id = cfg.org
      and m.reason = 'order_delivery'
      and m.occurred_at >= now() - make_interval(days => w.d)
      and (p_location_id is null or m.from_location_id = p_location_id)
    group by m.product_id
  ),
  backorders as (
    select ol.product_id, count(*)::bigint as times
    from public.order_lines ol
    cross join cfg cross join window_days w
    join public.orders o on o.id = ol.order_id
    where ol.org_id = cfg.org
      and ol.line_status = 'backordered'
      and o.created_at >= now() - make_interval(days => w.d)
    group by ol.product_id
  ),
  stock as (
    select l.product_id, sum(l.qty_available)::integer as qty_available
    from public.stock_on_hand(p_location_id, null, false) l
    group by l.product_id
  )
  select
    p.id, p.name, p.brand,
    coalesce(s.units, 0),
    round(coalesce(s.units, 0)::numeric / w.d, 2),
    coalesce(st.qty_available, 0),
    case when coalesce(s.units, 0) > 0
         then round(coalesce(st.qty_available, 0)::numeric / (s.units::numeric / w.d), 1) end,
    coalesce(bo.times, 0),
    case
      when coalesce(s.units, 0) = 0 then 'no_movement'
      when s.units::numeric / w.d >= 5 then 'fast'
      when s.units::numeric / w.d >= 1 then 'steady'
      else 'slow'
    end
  from public.products p
  cross join cfg cross join window_days w
  left join sold s on s.product_id = p.id
  left join backorders bo on bo.product_id = p.id
  left join stock st on st.product_id = p.id
  where p.org_id = cfg.org and p.active and p.is_stock_tracked
  order by coalesce(s.units, 0) desc, p.name;
$$;

comment on function public.product_velocity(integer, uuid) is
  'Units sold, daily rate, days of cover and back-order frequency per product. Days of cover is null when nothing sold.';

-- ---------------------------------------------------- stock_movement_history

/**
 * Every movement of one product, with a running balance, so a disagreement can
 * be walked back to the entry that caused it.
 */
drop function if exists public.stock_movement_history(uuid, uuid, timestamptz, timestamptz);
create or replace function public.stock_movement_history(
  p_product_id uuid,
  p_location_id uuid default null,
  p_from timestamptz default now() - interval '90 days',
  p_to timestamptz default now()
)
returns table (
  movement_id bigint,
  occurred_at timestamptz,
  reason text,
  reference text,
  note text,
  batch_number text,
  from_location text,
  from_bucket text,
  to_location text,
  to_bucket text,
  qty integer,
  net_change integer,
  running_balance bigint,
  actor_name text,
  approved_by_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  scoped as (
    select
      m.*,
      -- Net effect on physical stock at the location being looked at. A move
      -- between two buckets in the same building nets to zero, which is what
      -- makes the running balance track what is actually there.
      (case when m.to_location_id is not null
              and (p_location_id is null or m.to_location_id = p_location_id)
              and m.to_bucket <> 'in_transit' then m.qty else 0 end)
      -
      (case when m.from_location_id is not null
              and (p_location_id is null or m.from_location_id = p_location_id)
              and m.from_bucket <> 'in_transit' then m.qty else 0 end) as net
    from public.stock_movements m
    cross join cfg
    where m.org_id = cfg.org
      and m.product_id = p_product_id
      and m.occurred_at >= p_from and m.occurred_at < p_to
      and (p_location_id is null
           or m.from_location_id = p_location_id
           or m.to_location_id = p_location_id)
  )
  select
    s.id, s.occurred_at, s.reason, s.reference, s.note,
    pb.batch_number, fl.name, s.from_bucket, tl.name, s.to_bucket,
    s.qty, s.net,
    sum(s.net) over (order by s.occurred_at, s.id
                     rows between unbounded preceding and current row)::bigint,
    ap.full_name, mp.full_name
  from scoped s
  left join public.product_batches pb on pb.id = s.batch_id
  left join public.stock_locations fl on fl.id = s.from_location_id
  left join public.stock_locations tl on tl.id = s.to_location_id
  left join public.profiles ap on ap.id = s.actor_id
  left join public.profiles mp on mp.id = s.approved_by
  order by s.occurred_at, s.id;
$$;

comment on function public.stock_movement_history(uuid, uuid, timestamptz, timestamptz) is
  'Complete movement history for one product with a running balance. Bucket-to-bucket moves net to zero.';

-- ------------------------------------------------------------------- grants

revoke all on function public.stock_on_hand(uuid, text, boolean) from public, anon;
grant execute on function public.stock_on_hand(uuid, text, boolean) to authenticated;
revoke all on function public.stock_position_summary(uuid) from public, anon;
grant execute on function public.stock_position_summary(uuid) to authenticated;
revoke all on function public.low_stock_alerts(uuid) from public, anon;
grant execute on function public.low_stock_alerts(uuid) to authenticated;
revoke all on function public.expiring_stock(integer, uuid) from public, anon;
grant execute on function public.expiring_stock(integer, uuid) to authenticated;
revoke all on function public.stock_ageing(uuid) from public, anon;
grant execute on function public.stock_ageing(uuid) to authenticated;
revoke all on function public.stock_valuation(uuid) from public, anon;
grant execute on function public.stock_valuation(uuid) to authenticated;
revoke all on function public.stock_movement_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.stock_movement_summary(timestamptz, timestamptz, uuid) to authenticated;
revoke all on function public.orders_pipeline_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.orders_pipeline_summary(timestamptz, timestamptz) to authenticated;
revoke all on function public.warehouse_performance(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.warehouse_performance(timestamptz, timestamptz, text) to authenticated;
revoke all on function public.product_velocity(integer, uuid) from public, anon;
grant execute on function public.product_velocity(integer, uuid) to authenticated;
revoke all on function public.stock_movement_history(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.stock_movement_history(uuid, uuid, timestamptz, timestamptz) to authenticated;
