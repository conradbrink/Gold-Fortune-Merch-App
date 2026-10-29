-- Rollback of 20261029235300_vans_never_need_ordering: the three stock
-- functions as they were (pg_get_functiondef md5: stock_on_hand
-- 2d8ede1f46578987b613954fe3d5e813, stock_position_summary
-- e79dfa8b957ee97c7c0a3ef8d0741240, low_stock_alerts
-- bfd68abed9077f7545243cf6bfeaa846). Return types are unchanged, so the
-- grants stay as they are. Vehicle and rep lines are judged against the
-- product's minimum again.

CREATE OR REPLACE FUNCTION public.stock_on_hand(p_location_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_only_below_min boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, product_name text, brand text, sku_code text, location_id uuid, location_name text, qty_available integer, qty_reserved integer, qty_damaged integer, qty_expired integer, qty_in_transit integer, qty_promotional integer, qty_on_hand integer, min_stock_level integer, reorder_point integer, is_below_min boolean, is_out_of_stock boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.stock_position_summary(p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(qty_available bigint, qty_reserved bigint, qty_damaged bigint, qty_expired bigint, qty_in_transit bigint, qty_promotional bigint, qty_on_hand bigint, products_stocked bigint, products_out_of_stock bigint, products_below_min bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    count(*)::bigint,
    count(*) filter (where l.is_out_of_stock)::bigint,
    count(*) filter (where l.is_below_min)::bigint
  from lines l cross join cfg;
$function$
;

CREATE OR REPLACE FUNCTION public.low_stock_alerts(p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, brand text, location_id uuid, location_name text, qty_available integer, min_stock_level integer, reorder_point integer, recommended_order_qty integer, severity text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

comment on function public.stock_on_hand(uuid, text, boolean) is
  'All seven stock buckets per product, optionally at one location, optionally only what is below its minimum.';
comment on function public.stock_position_summary(uuid) is null;
comment on function public.low_stock_alerts(uuid) is
  'Products at or below their reorder point, with a recommended order quantity. Out of stock first.';
