-- A delivery vehicle's empty stock lines are not "out of stock".
--
-- Dispatching an order on one of the company's own vehicles moves the stock
-- from the warehouse into that vehicle's stock location (type `vehicle`,
-- created on first use by order_dispatch), in its in_transit bucket; the
-- delivery takes it out again. Every product a van has ever carried keeps a
-- stock_balances row there, at zero once the van is back. A rep's stock
-- location (type `rep`, samples carried) ends the same way.
--
-- stock_on_hand judged every one of those rows against the product's minimum,
-- like a warehouse shelf. A van's stock is never `available` (it is in
-- transit until delivered), so every van row came out "out of stock", loaded
-- or empty, and below its minimum. From there:
--
--   * low_stock_alerts listed them, so the Warehouse page's "Needs ordering"
--     said "0 left" for products the warehouse had plenty of, and the
--     dashboard counted them among the products below their reorder point;
--   * stock_position_summary counted them in the Warehouse page's
--     "Out of stock" and "Below minimum" tiles, once per van;
--   * the Inventory page's "Only below minimum", with All locations, listed
--     every "Vehicle …" row with a "below …" badge, and every empty van row
--     cluttered the table.
--
-- After every delivery run, a warehouse manager was told to buy stock they had.
--
-- ------------------------------------------------------------- the rule
--
-- Only a warehouse is kept to a level. A minimum, a reorder point, "out of
-- stock" and "below minimum" are judged at each warehouse in use (type
-- `warehouse`, active) against that warehouse's own level, the per-location
-- override first and the product's default otherwise, exactly as before. A
-- vehicle or a rep location carries what was sent out on it and is emptied by
-- the delivery or the visit; it has no level, so its lines carry no minimum
-- and no reorder point, are never out of stock or below minimum, and never
-- raise an alert. The stock on them still counts in every total (the tiles,
-- the valuation, the velocity report), because it is still the company's.
--
-- A warehouse switched off in Settings (`active` false) is not in use: it is
-- judged like a vehicle, so the zero lines left when it was emptied and closed
-- stop asking to be reordered.
--
-- A vehicle, rep or closed-warehouse line that holds nothing (nothing on
-- hand, nothing in transit) is left out of stock_on_hand altogether: it is the
-- trace of a finished run, not stock. A van with stock aboard still shows, and
-- so does a line at zero in a warehouse in use, which is a real "out of
-- stock".
--
-- stock_position_summary now counts products, not lines, as its column names
-- say: a product out of stock at two warehouses is one product out of stock.
--
-- Every return type is unchanged, so `create or replace` keeps the grants,
-- and each function keeps require_module('warehouse') as its first
-- statement (20261007112638_enforce_modules).
--
-- Rollback: supabase/rollback/20261029235300_vans_never_need_ordering.down.sql.
-- Suite: supabase/tests/low_stock_locations.sql.

-- ------------------------------------------------------------ stock_on_hand

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
  select public.require_module('warehouse');
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
  ),
  judged as (
    select
      r.*,
      p.name as product_name, p.brand, p.sku_code,
      l.name as location_name,
      -- Only a warehouse in use is kept to a level; a vehicle or a rep
      -- carries what was sent out on it. See the header of 20261029235300.
      (l.type = 'warehouse' and l.active) as keeps_level,
      case when l.type = 'warehouse' and l.active
           then coalesce(pls.min_stock_level, p.min_stock_level) end as min_level,
      case when l.type = 'warehouse' and l.active
           then coalesce(pls.reorder_point, p.reorder_point) end as reorder_level
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
      -- An empty van or rep line is what a finished run leaves behind, and an
      -- empty line at a warehouse no longer in use is what closing it did.
      and ((l.type = 'warehouse' and l.active) or r.qty_on_hand > 0 or r.qty_in_transit > 0)
  )
  select
    j.product_id, j.product_name, j.brand, j.sku_code,
    j.location_id, j.location_name,
    j.qty_available, j.qty_reserved, j.qty_damaged, j.qty_expired,
    j.qty_in_transit, j.qty_promotional, j.qty_on_hand,
    j.min_level,
    j.reorder_level,
    j.min_level is not null and j.qty_available < j.min_level,
    j.keeps_level and j.qty_available = 0
  from judged j
  where not p_only_below_min
     or (j.keeps_level and j.qty_available = 0)
     or (j.min_level is not null and j.qty_available < j.min_level)
  order by j.product_name, j.location_name;
$$;

comment on function public.stock_on_hand(uuid, text, boolean) is
  'All seven stock buckets per product, optionally at one location, optionally only what is below its minimum. Only a warehouse in use has a minimum or can be out of stock; a vehicle, rep or closed-warehouse line holding nothing is left out.';

-- --------------------------------------------------- stock_position_summary

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
  select public.require_module('warehouse');
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
    -- Products, not lines: one product short at two warehouses is one product.
    count(distinct l.product_id)::bigint,
    count(distinct l.product_id) filter (where l.is_out_of_stock)::bigint,
    count(distinct l.product_id) filter (where l.is_below_min)::bigint
  from lines l cross join cfg;
$$;

comment on function public.stock_position_summary(uuid) is
  'One row of stock totals across every location, or at one. The three product counts are distinct products; out of stock and below minimum are judged at warehouses only.';

-- ---------------------------------------------------------- low_stock_alerts

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
  select public.require_module('warehouse');
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
      when l.is_out_of_stock then 'out_of_stock'
      when l.is_below_min then 'below_minimum'
      else 'at_reorder_point'
    end
  from lines l
  cross join cfg
  join public.products p on p.id = l.product_id
  left join public.product_location_settings pls
    on pls.product_id = l.product_id and pls.location_id = l.location_id
   and pls.org_id = cfg.org
  -- stock_on_hand gives a vehicle, rep or closed-warehouse line no levels and
  -- never marks it out of stock, so only a warehouse in use can meet these.
  where l.is_out_of_stock
     or l.is_below_min
     or (l.reorder_point is not null and l.qty_available <= l.reorder_point)
  order by
    case when l.is_out_of_stock then 0 when l.is_below_min then 1 else 2 end,
    l.product_name;
$$;

comment on function public.low_stock_alerts(uuid) is
  'Products at or below their reorder point at a warehouse, with a recommended order quantity. Out of stock first. A vehicle or rep location never raises one.';
