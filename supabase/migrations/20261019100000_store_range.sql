-- Ranges: which products each store should carry, worked out by Tickd from the
-- company's own orders, and where the gaps are (owner, 19 Oct 2026).
--
-- The owner's two hard rules:
--   * "this plan must be in a way automatic … if a new business signs up, then
--     they add their products … this should then determine their range per
--     store". Nobody fills anything in. The office only overrides.
--   * "if they add new products — the system should be able to learn the new
--     product sales and analyse it and then give a result".
--
-- WHAT COUNTS AS AN ORDER
--   Tickd orders only (the owner chose not to read the QuickBooks history: half
--   its lines name no product). Not cancelled, not a back-order (the warehouse
--   finishing an earlier order, as store_reorder), lines not cancelled, less
--   what came back. Order lines are single units; a box is the product's
--   units_per_shrink. Days are the company's calendar days.
--
-- THE RULE (range_facts), worked out live on every read:
--   1. Store size, inside the store's group: a size set by hand wins; else a
--      store with range_size_min_orders orders in the history window is ranked
--      by order value (big = top range_big_pct %, medium = the next
--      range_medium_pct %, small = the rest, rounded up so a small group still
--      has a big store); else its visit frequency is the first guess (weekly
--      big, every two weeks medium, monthly small).
--   2. Similar stores: the same group (no group is a group of its own) and
--      size. Fewer than range_min_stores of them ordering, and it widens to the
--      group, then the company at that size, then the whole company. Fewer than
--      that in the whole company and Tickd is still learning: no range yet.
--   3. In range when range_share_pct % of the similar ordering stores take it,
--      or the store has ordered it itself on range_own_orders orders.
--   4. New products (range_product_results) are judged by the repeat order:
--      a proven one goes into the big stores of every group where it was tried
--      before the share rule could notice it; one that is not taking off stops
--      being a gap where it was never ordered.
--   5. Overrides, all optional: per group and product Always (from a size) or
--      Never (range_pins); per store and product Not for this store
--      (store_range_exclusions); a store's size (stores.size_override).
--   6. Each product in a store's range: have (ordered in the last
--      range_lapse_days), stopped (ordered before that in the history window
--      while the store still orders other things), gap (never), or quiet (the
--      store has ordered nothing at all lately: a question for "Stores due for
--      an order", not a gap). A product ordered outside the range is off_range.
--
-- Every number is a setting (README rule 5). range_lapse_days is the owner's;
-- the rest are Tickd's own (internal), changed by the operator.
--
-- SECURITY DEFINER, deliberately (README rule 1 is security invoker). The
-- answer is about every store, but orders are readable only by the warehouse
-- or the rep who took them (orders_select), and price lists only with
-- invoicing. As invoker every store would read as a gap to a manager with
-- insights. Each callable function names its module and permission first and
-- reads only the caller's company; money comes back only to someone who may
-- read invoices. The two internal functions take a company id and are not
-- callable by anyone.
--
-- Rollback: supabase/rollback/20261019100000_store_range.down.sql.

------------------------------------------------------------------ the settings

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, sort_order, audience)
values
  ('range_lapse_days', 'A product is on the shelf if ordered in the last (days)',
   'Tickd works out which products each store should have from your orders. A store that ordered a product in this many days counts as having it; one that has not is missing it.',
   'integer', '60', 14, 180, 1100, 'owner'),
  ('range_history_days', 'Ranges: orders read (days)',
   'How far back the range reads orders: sizes, shares, own orders and "stopped".',
   'integer', '180', 60, 730, 1101, 'internal'),
  ('range_big_pct', 'Ranges: big stores (% of a group)',
   'The top this-many percent of a group''s stores by order value are big.',
   'integer', '20', 5, 50, 1102, 'internal'),
  ('range_medium_pct', 'Ranges: medium stores (% of a group)',
   'The next this-many percent are medium; the rest are small.',
   'integer', '30', 5, 60, 1103, 'internal'),
  ('range_share_pct', 'Ranges: share of similar stores (%)',
   'A product is in a store''s range when this share of similar ordering stores (same group and size) take it.',
   'integer', '40', 10, 90, 1104, 'internal'),
  ('range_own_orders', 'Ranges: a store''s own orders',
   'A product a store has ordered on this many orders is in its range.',
   'integer', '2', 1, 10, 1105, 'internal'),
  ('range_size_min_orders', 'Ranges: orders before sizing by sales',
   'A store with fewer orders than this is sized from its visit frequency.',
   'integer', '3', 1, 20, 1106, 'internal'),
  ('range_min_stores', 'Ranges: similar stores needed',
   'Fewer similar ordering stores than this, and the comparison widens (group, then company).',
   'integer', '5', 2, 50, 1107, 'internal'),
  ('range_peer_min', 'Ranges: stores behind a gap''s estimate',
   'A gap''s "similar stores sell about" needs this many similar stores that have the product, else the whole company''s.',
   'integer', '3', 1, 20, 1108, 'internal'),
  ('range_new_days', 'Ranges: a product is new for (days)',
   'Days after its first order that a product is judged as new: by repeat orders, not by share.',
   'integer', '90', 30, 365, 1109, 'internal'),
  ('range_untried_days', 'Ranges: not ordered yet after (days)',
   'A product nobody has ordered this many days after it was added is called out.',
   'integer', '30', 7, 180, 1110, 'internal'),
  ('range_result_min_stores', 'Ranges: stores before a new product''s result',
   'Stores that must have had the chance to order a new product again before Tickd judges it.',
   'integer', '5', 2, 50, 1111, 'internal'),
  ('range_proven_repeat_pct', 'Ranges: proven when ordered again by (%)',
   'A new product is proven when this share of the stores that had the chance ordered it again.',
   'integer', '50', 10, 100, 1112, 'internal'),
  ('range_slow_repeat_pct', 'Ranges: not taking off below (%)',
   'Below this share ordering it again, a new product is not taking off.',
   'integer', '25', 0, 90, 1113, 'internal'),
  ('range_proven_ros_pct', 'Ranges: proven when it sells (% of similar products)',
   'A proven product also sells at least this share of similar products'' boxes per store per month.',
   'integer', '75', 10, 200, 1114, 'internal');

-- Every company has every setting written down (as create_company does).
insert into public.company_settings (org_id, key, value)
select o.id, d.key, d.default_value
  from public.organizations o
 cross join public.setting_definitions d
 where d.key like 'range\_%'
on conflict (org_id, key) do nothing;

------------------------------------------------------------------ the tables

-- Always / Never for one product in one group. Sparse: no row is "Tickd
-- decides". Written only by range_pin_set / range_pin_clear.
create table public.range_pins (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  store_group_id uuid not null references public.store_groups(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  rule           text not null check (rule in ('always', 'never')),
  -- Always: the smallest size that carries it (small = every store).
  min_size       text check (min_size in ('small', 'medium', 'big')),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (store_group_id, product_id),
  check ((rule = 'always') = (min_size is not null))
);
comment on table public.range_pins is
  'The office''s override of the range Tickd works out from orders: a product is Always in a group''s range from a size up (min_size small = every store), or Never (e.g. not listed at head office). No row: Tickd decides.';
create index range_pins_org_idx on public.range_pins (org_id);
create index range_pins_product_idx on public.range_pins (product_id);

-- "Not for this store", with why. Written only by store_range_exclude /
-- store_range_include.
create table public.store_range_exclusions (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  store_id   uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  reason     text not null check (length(btrim(reason)) between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (store_id, product_id)
);
comment on table public.store_range_exclusions is
  'A product that is not for one store whatever the range says (e.g. the branch may not sell vapes), and why. It is left out of that store''s range and its gaps until it is taken off.';
create index store_range_exclusions_org_idx on public.store_range_exclusions (org_id);
create index store_range_exclusions_product_idx on public.store_range_exclusions (product_id);

alter table public.stores
  add column size_override text check (size_override in ('small', 'medium', 'big'));
comment on column public.stores.size_override is
  'The store''s size for its range, set by hand. Null: Tickd sizes it inside its group from its orders (or its visit frequency until it has some).';

alter table public.range_pins enable row level security;
create policy range_pins_select on public.range_pins for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('insights'))
              or (select public.has_permission('sales_coverage'))
              or (select public.has_permission('resources'))));
create policy module_gate on public.range_pins as restrictive for all
  using ((select public.module_enabled('distribution'))) with check ((select public.module_enabled('distribution')));
revoke all on public.range_pins from anon, authenticated;
grant select on public.range_pins to authenticated;

alter table public.store_range_exclusions enable row level security;
create policy store_range_exclusions_select on public.store_range_exclusions for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('insights'))
              or (select public.has_permission('sales_coverage'))
              or (select public.has_permission('resources'))));
create policy module_gate on public.store_range_exclusions as restrictive for all
  using ((select public.module_enabled('distribution'))) with check ((select public.module_enabled('distribution')));
revoke all on public.store_range_exclusions from anon, authenticated;
grant select on public.store_range_exclusions to authenticated;

-- The billing gate, where it exists (production), as for every table a
-- company writes.
do $migration$
declare
  t text;
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  foreach t in array array['range_pins', 'store_range_exclusions'] loop
    execute format('create policy billing_gate_insert on public.%I as restrictive for insert to authenticated
                      with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_update on public.%I as restrictive for update to authenticated
                      using ((select public.company_writable())) with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_delete on public.%I as restrictive for delete to authenticated
                      using ((select public.company_writable()))', t);
  end loop;
end;
$migration$;

-------------------------------------------------- new products: the result

-- One row per active product the phone can order: where it is in its life and
-- what Tickd makes of it.
--
--   stage    not_ordered | new (its first order within range_new_days) |
--            established
--   result   waiting (not ordered yet, recently added) | untried (not ordered
--            range_untried_days after it was added) | trying (fewer than
--            range_result_min_stores stores have had the chance to order it
--            again) | proven | slow | not_taking
--
-- A store "had the chance" when, after the day it first ordered the product,
-- it ordered anything on a later day; it "ordered again" when it ordered the
-- product on a later day. Rate of sale is boxes per store that tried it, per
-- month since its first order there (a month at least), against the median of
-- the products of its category that have been ordered (all products when the
-- category has fewer than 3). Every order ever, not the history window: a
-- product's launch is its first order.
create function public.range_product_results(p_org uuid)
returns table (
  product_id uuid,
  stage text,
  result text,
  added_on date,
  launch_on date,
  tried integer,
  chances integer,
  repeats integer,
  repeat_pct integer,
  ros numeric,
  similar_ros numeric,
  groups_tried text[],
  -- The stores that must have had the chance before a result: "3 more".
  min_chances integer,
  -- Days after it was added before a product nobody ordered is "untried".
  untried_days integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');

  with cfg as materialized (
    select p_org as org,
           public.org_timezone(p_org) as tz,
           (now() at time zone public.org_timezone(p_org))::date as today,
           coalesce((public.org_setting(p_org, 'range_new_days') #>> '{}')::integer, 90) as new_days,
           coalesce((public.org_setting(p_org, 'range_untried_days') #>> '{}')::integer, 30) as untried_days,
           coalesce((public.org_setting(p_org, 'range_result_min_stores') #>> '{}')::integer, 5) as min_stores,
           coalesce((public.org_setting(p_org, 'range_proven_repeat_pct') #>> '{}')::integer, 50) as proven_pct,
           coalesce((public.org_setting(p_org, 'range_slow_repeat_pct') #>> '{}')::integer, 25) as slow_pct,
           coalesce((public.org_setting(p_org, 'range_proven_ros_pct') #>> '{}')::integer, 75) as ros_pct
  ),
  prod as (
    select p.id, p.units_per_shrink::numeric as ups,
           lower(btrim(coalesce(p.category, ''))) as cat,
           (p.created_at at time zone cfg.tz)::date as added_on
      from public.products p
     cross join cfg
     where p.org_id = cfg.org
       and p.active
       and p.is_stock_tracked
       and coalesce(p.units_per_shrink, 0) > 0
  ),
  ln as (
    select o.store_id, (o.created_at at time zone cfg.tz)::date as d, ol.product_id,
           (ol.qty_ordered - coalesce(ol.qty_returned, 0))::numeric as qty
      from public.orders o
      join public.order_lines ol on ol.order_id = o.id
     cross join cfg
     where o.org_id = cfg.org
       and o.status <> 'cancelled'
       and o.parent_order_id is null
       and o.store_id is not null
       and ol.line_status <> 'cancelled'
       and ol.qty_ordered - coalesce(ol.qty_returned, 0) > 0
  ),
  store_last as (
    select ln.store_id, max(ln.d) as last_d from ln group by ln.store_id
  ),
  sp as (
    -- Each store that tried each product.
    select ln.product_id, ln.store_id,
           min(ln.d) as first_d,
           max(ln.d) as last_d,
           sum(ln.qty) as qty
      from ln
     group by ln.product_id, ln.store_id
  ),
  per as (
    select sp.product_id,
           min(sp.first_d) as launch_on,
           count(*)::integer as tried,
           (count(*) filter (where sl.last_d > sp.first_d))::integer as chances,
           (count(*) filter (where sp.last_d > sp.first_d))::integer as repeats,
           sum(sp.qty / prod.ups)
             / sum(greatest(cfg.today - sp.first_d, 30)::numeric / 30.4) as ros,
           array_agg(distinct coalesce(s.store_group_id::text, 'none')) as groups_tried
      from sp
      join prod on prod.id = sp.product_id
      join store_last sl on sl.store_id = sp.store_id
      join public.stores s on s.id = sp.store_id
     cross join cfg
     group by sp.product_id
  ),
  cat_median as (
    select prod.cat, count(*) as n,
           percentile_cont(0.5) within group (order by per.ros) as med
      from per join prod on prod.id = per.product_id
     group by prod.cat
  ),
  all_median as (
    select percentile_cont(0.5) within group (order by per.ros) as med from per
  ),
  judged as (
    select prod.id, prod.added_on, per.launch_on,
           coalesce(per.tried, 0) as tried,
           coalesce(per.chances, 0) as chances,
           coalesce(per.repeats, 0) as repeats,
           case when per.chances > 0 then round(100.0 * per.repeats / per.chances)::integer end as repeat_pct,
           round(per.ros, 3) as ros,
           round((case when cm.n >= 3 then cm.med else am.med end)::numeric, 3) as similar_ros,
           per.groups_tried
      from prod
      left join per on per.product_id = prod.id
      left join cat_median cm on cm.cat = prod.cat
     cross join all_median am
  )
  select j.id,
         case when j.launch_on is null then 'not_ordered'
              when j.launch_on > cfg.today - cfg.new_days then 'new'
              else 'established' end,
         case when j.launch_on is null then
                case when j.added_on <= cfg.today - cfg.untried_days then 'untried' else 'waiting' end
              when j.chances < cfg.min_stores then 'trying'
              when j.repeat_pct >= cfg.proven_pct
               and (j.similar_ros is null or j.ros >= j.similar_ros * cfg.ros_pct / 100.0) then 'proven'
              when j.repeat_pct < cfg.slow_pct then 'not_taking'
              else 'slow' end,
         j.added_on,
         j.launch_on,
         j.tried,
         j.chances,
         j.repeats,
         j.repeat_pct,
         j.ros,
         j.similar_ros,
         coalesce(j.groups_tried, '{}'),
         cfg.min_stores,
         cfg.untried_days
    from judged j
   cross join cfg
$$;

revoke all on function public.range_product_results(uuid) from public, anon, authenticated;
comment on function public.range_product_results(uuid) is
  'Internal (not callable): each active orderable product''s stage (not_ordered, new, established) and result (waiting, untried, trying, proven, slow, not_taking) from the repeat order: stores that tried it, had the chance to order it again, did; its boxes per store per month against similar products; the groups that tried it. Read by range_facts and range_products.';

------------------------------------------------------------- the one rule

-- One row per active store and orderable product, with everything the screens
-- say about it. Internal: callers pass their own company.
create function public.range_facts(p_org uuid, p_lapse integer default null)
returns table (
  store_id uuid,
  store_group_id uuid,
  group_key text,
  size text,
  size_source text,
  level integer,
  recent boolean,
  product_id uuid,
  cluster_stores integer,
  takers integer,
  share numeric,
  own_orders integer,
  last_ordered date,
  boxes_recent numeric,
  value_recent numeric,
  pin_rule text,
  pin_min_size text,
  exclusion_reason text,
  stage text,
  result text,
  cluster_in boolean,
  cluster_reason text,
  in_range boolean,
  reason text,
  status text,
  est_boxes_month numeric,
  case_price numeric,
  company_stores integer,
  min_stores integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');

  with cfg as materialized (
    select p_org as org,
           public.org_timezone(p_org) as tz,
           (now() at time zone public.org_timezone(p_org))::date as today,
           least(365, greatest(7, coalesce(p_lapse, (public.org_setting(p_org, 'range_lapse_days') #>> '{}')::integer, 60))) as lapse,
           greatest(least(365, greatest(7, coalesce(p_lapse, (public.org_setting(p_org, 'range_lapse_days') #>> '{}')::integer, 60))),
                    coalesce((public.org_setting(p_org, 'range_history_days') #>> '{}')::integer, 180)) as history,
           coalesce((public.org_setting(p_org, 'range_big_pct') #>> '{}')::integer, 20) as big_pct,
           coalesce((public.org_setting(p_org, 'range_medium_pct') #>> '{}')::integer, 30) as medium_pct,
           coalesce((public.org_setting(p_org, 'range_share_pct') #>> '{}')::integer, 40) as share_pct,
           coalesce((public.org_setting(p_org, 'range_own_orders') #>> '{}')::integer, 2) as own_orders,
           coalesce((public.org_setting(p_org, 'range_size_min_orders') #>> '{}')::integer, 3) as size_min_orders,
           coalesce((public.org_setting(p_org, 'range_min_stores') #>> '{}')::integer, 5) as min_stores,
           coalesce((public.org_setting(p_org, 'range_peer_min') #>> '{}')::integer, 3) as peer_min
  ),
  prod as (
    select p.id, p.units_per_shrink::numeric as ups, p.shrink_price_excl_vat as price
      from public.products p
     cross join cfg
     where p.org_id = cfg.org
       and p.active
       and p.is_stock_tracked
       and coalesce(p.units_per_shrink, 0) > 0
  ),
  st as (
    select s.id, s.store_group_id, coalesce(s.store_group_id::text, 'none') as gk,
           s.visit_frequency, s.size_override, g.price_list_id
      from public.stores s
      left join public.store_groups g on g.id = s.store_group_id
     cross join cfg
     where s.org_id = cfg.org
       and s.active
  ),
  ln as (
    -- Every order line in the history window, less what came back.
    select o.store_id, o.id as order_id, (o.created_at at time zone cfg.tz)::date as d,
           ol.product_id,
           (ol.qty_ordered - coalesce(ol.qty_returned, 0))::numeric as qty,
           coalesce(ol.unit_price, 0) as unit_price
      from public.orders o
      join public.order_lines ol on ol.order_id = o.id
     cross join cfg
     where o.org_id = cfg.org
       and o.status <> 'cancelled'
       and o.parent_order_id is null
       and o.store_id is not null
       and ol.line_status <> 'cancelled'
       and ol.qty_ordered - coalesce(ol.qty_returned, 0) > 0
       and o.created_at >= ((cfg.today - cfg.history + 1)::timestamp at time zone cfg.tz)
  ),
  store_tot as (
    select ln.store_id,
           count(distinct ln.order_id) as n_orders,
           sum(ln.qty * ln.unit_price) as value,
           bool_or(ln.d > cfg.today - cfg.lapse) as recent
      from ln cross join cfg
     group by ln.store_id
  ),
  ranked as (
    select st.id,
           row_number() over (partition by st.gk order by t.value desc, st.id) as rk,
           count(*) over (partition by st.gk) as n
      from st
      join store_tot t on t.store_id = st.id
     cross join cfg
     where t.n_orders >= cfg.size_min_orders
  ),
  sized as (
    select st.id, st.store_group_id, st.gk, st.price_list_id,
           case when st.size_override is not null then st.size_override
                when r.id is not null then
                  case when r.rk <= ceil(r.n * cfg.big_pct / 100.0) then 'big'
                       when r.rk <= ceil(r.n * (cfg.big_pct + cfg.medium_pct) / 100.0) then 'medium'
                       else 'small' end
                when st.visit_frequency = 'weekly' then 'big'
                when st.visit_frequency = 'biweekly' then 'medium'
                else 'small' end as size,
           case when st.size_override is not null then 'set'
                when r.id is not null then 'sales'
                else 'visits' end as size_source,
           t.store_id is not null as buys,
           coalesce(t.recent, false) as recent
      from st
     cross join cfg
      left join ranked r on r.id = st.id
      left join store_tot t on t.store_id = st.id
  ),
  sp as (
    -- What each store ordered of each product in the history window.
    select ln.store_id, ln.product_id,
           count(distinct ln.order_id)::integer as n_orders,
           max(ln.d) as last_d,
           sum(ln.qty) filter (where ln.d > cfg.today - cfg.lapse) as qty_recent,
           sum(ln.qty * ln.unit_price) filter (where ln.d > cfg.today - cfg.lapse) as value_recent
      from ln cross join cfg
     group by ln.store_id, ln.product_id
  ),
  -- Ordering stores, and the ones taking each product, at each level of
  -- likeness. gk and size are never null in `sized`, so a null here is the
  -- level rolled up.
  nc as (
    select s.gk, s.size, count(*)::integer as n
      from sized s
     where s.buys
     group by grouping sets ((s.gk, s.size), (s.gk), (s.size), ())
  ),
  kc as (
    select s.gk, s.size, sp.product_id, count(*)::integer as k
      from sized s
      join sp on sp.store_id = s.id
     group by grouping sets ((s.gk, s.size, sp.product_id), (s.gk, sp.product_id), (s.size, sp.product_id), (sp.product_id))
  ),
  pc as (
    -- Stores that have it now, and how much they took: the gap's estimate.
    select s.gk, s.size, sp.product_id, count(*)::integer as k, sum(sp.qty_recent) as qty
      from sized s
      join sp on sp.store_id = s.id
     where sp.qty_recent > 0
     group by grouping sets ((s.gk, s.size, sp.product_id), (s.gk, sp.product_id), (s.size, sp.product_id), (sp.product_id))
  ),
  lv as (
    select s.id as store_id, x.level,
           case when x.level in (1, 2) then s.gk end as kgk,
           case when x.level in (1, 3) then s.size end as ksize,
           case x.level when 1 then n1.n when 2 then n2.n when 3 then n3.n when 4 then n4.n end as n,
           coalesce(n4.n, 0) as n4
      from sized s
     cross join cfg
      left join nc n1 on n1.gk = s.gk and n1.size = s.size
      left join nc n2 on n2.gk = s.gk and n2.size is null
      left join nc n3 on n3.gk is null and n3.size = s.size
      left join nc n4 on n4.gk is null and n4.size is null
     cross join lateral (
       select case when n1.n >= cfg.min_stores then 1
                   when n2.n >= cfg.min_stores then 2
                   when n3.n >= cfg.min_stores then 3
                   when n4.n >= cfg.min_stores then 4
                   else 0 end as level
     ) x
  ),
  pr as materialized (
    select r.* from cfg cross join lateral public.range_product_results(cfg.org) r
  ),
  base as (
    select s.id as store_id, s.store_group_id, s.gk, s.size, s.size_source, s.recent,
           l.level, l.n as cluster_n, l.n4 as company_n,
           p.id as product_id, p.ups,
           coalesce(li.shrink_price_excl_vat, p.price) as case_price,
           case when l.level > 0 then coalesce(k.k, 0) end as takers,
           coalesce(sp.n_orders, 0) as n_orders,
           sp.last_d, sp.qty_recent, sp.value_recent,
           pin.rule as pin_rule, pin.min_size as pin_min_size,
           ex.reason as exclusion_reason,
           pr.stage, pr.result, pr.groups_tried,
           case when coalesce(pk.k, 0) >= cfg.peer_min then pk.k else p4.k end as peers,
           case when coalesce(pk.k, 0) >= cfg.peer_min then pk.qty else p4.qty end as peer_qty,
           case s.size when 'big' then 3 when 'medium' then 2 else 1 end as size_rank,
           case pin.min_size when 'big' then 3 when 'medium' then 2 when 'small' then 1 end as pin_rank
      from sized s
     cross join prod p
     cross join cfg
      join lv l on l.store_id = s.id
      left join kc k
        on k.product_id = p.id and k.gk is not distinct from l.kgk and k.size is not distinct from l.ksize
      left join pc pk
        on l.level > 0 and pk.product_id = p.id and pk.gk is not distinct from l.kgk and pk.size is not distinct from l.ksize
      left join pc p4
        on p4.product_id = p.id and p4.gk is null and p4.size is null
      left join sp on sp.store_id = s.id and sp.product_id = p.id
      left join public.range_pins pin
        on pin.org_id = cfg.org and pin.store_group_id = s.store_group_id and pin.product_id = p.id
      left join public.store_range_exclusions ex
        on ex.org_id = cfg.org and ex.store_id = s.id and ex.product_id = p.id
      left join public.customer_price_list_items li
        on li.price_list_id = s.price_list_id and li.product_id = p.id
      left join pr on pr.product_id = p.id
  ),
  decided as (
    -- The group-and-size answer first (every store of this group and size gets
    -- it), then the store's own.
    select b.*,
           case when b.level > 0 and b.cluster_n > 0 then round(100.0 * b.takers / b.cluster_n, 1) end as share,
           case when b.pin_rule = 'never' then 'pin_never'
                -- Always from a size up; a smaller store is left to the rules below.
                when b.pin_rule = 'always' and b.size_rank >= b.pin_rank then 'pin'
                when b.stage = 'new' and b.result = 'proven' and b.size = 'big' and b.gk = any (b.groups_tried) then 'launch'
                when b.stage = 'new' and b.result = 'not_taking' then 'not_taking'
                when b.level > 0 and 100.0 * b.takers / nullif(b.cluster_n, 0) >= cfg.share_pct then 'share'
           end as cluster_reason
      from base b
     cross join cfg
  ),
  placed as (
    select d.*,
           coalesce(d.cluster_reason in ('pin', 'launch', 'share'), false) as cluster_in,
           case when d.exclusion_reason is not null then 'excluded'
                when d.cluster_reason = 'pin_never' then 'pin_never'
                when d.cluster_reason = 'pin' then 'pin'
                when d.n_orders >= cfg.own_orders then 'own'
                when d.cluster_reason in ('launch', 'share') then d.cluster_reason
                when d.cluster_reason = 'not_taking' then 'not_taking'
           end as reason
      from decided d
     cross join cfg
  )
  select p.store_id,
         p.store_group_id,
         p.gk,
         p.size,
         p.size_source,
         p.level,
         p.recent,
         p.product_id,
         p.cluster_n,
         p.takers,
         p.share,
         p.n_orders,
         p.last_d,
         round(p.qty_recent / p.ups, 2),
         round(p.value_recent, 2),
         p.pin_rule,
         p.pin_min_size,
         p.exclusion_reason,
         p.stage,
         p.result,
         p.cluster_in,
         p.cluster_reason,
         coalesce(p.reason in ('pin', 'own', 'launch', 'share'), false),
         p.reason,
         case when p.reason in ('pin', 'own', 'launch', 'share') then
                case when p.qty_recent > 0 then 'have'
                     when not p.recent then 'quiet'
                     when p.last_d is not null then 'stopped'
                     else 'gap' end
              when p.qty_recent > 0 then 'off_range'
         end,
         case when p.peers > 0 then round(p.peer_qty / p.ups / p.peers / (cfg.lapse / 30.4), 2) end,
         p.case_price,
         p.company_n,
         cfg.min_stores
    from placed p
   cross join cfg
$$;

revoke all on function public.range_facts(uuid, integer) from public, anon, authenticated;
comment on function public.range_facts(uuid, integer) is
  'Internal (not callable): one row per active store and orderable product of a company: the store''s size and why, the similar stores compared and the share of them taking it, the store''s own orders, pins and exclusions, the new-product result, whether it is in the store''s range and why (pin, own, launch, share; or pin_never, not_taking, excluded), and its status (have, gap, stopped, quiet, off_range) over the last p_lapse days (range_lapse_days when null). The one rule behind range_status, range_products and range_grid.';

---------------------------------------------------------- what the screens read

-- Each active store, with the products in its range or ordered lately.
-- Money (value, estimate) only for someone who may read invoices.
create function public.range_status(p_days integer default null)
returns table (
  store_id uuid,
  store_name text,
  city text,
  store_group_id uuid,
  size text,
  size_source text,
  -- Which stores it was compared with: 1 its group and size, 2 its group,
  -- 3 the company's stores of its size, 4 every store; 0 still learning.
  level integer,
  learning boolean,
  quiet boolean,
  -- The company's stores that ordered in the history window, and how many it
  -- takes before Tickd compares stores: "2 of 5 stores have ordered".
  ordering_stores integer,
  min_stores integer,
  lines jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');
  select public.require_permission('insights');

  with cfg as materialized (
    select public.current_org_id() as org,
           public.has_permission('invoicing') as money
  )
  select f.store_id,
         s.name,
         s.city,
         f.store_group_id,
         f.size,
         f.size_source,
         max(f.level),
         bool_and(f.level = 0),
         bool_and(not f.recent),
         max(f.company_stores),
         max(f.min_stores),
         coalesce(
           jsonb_agg(jsonb_build_object(
             'product_id', f.product_id,
             'status', f.status,
             'in_range', f.in_range,
             'reason', f.reason,
             'share', f.share,
             'cluster_stores', f.cluster_stores,
             'own_orders', f.own_orders,
             'last_ordered', f.last_ordered,
             'boxes', f.boxes_recent,
             'value', case when cfg.money then f.value_recent end,
             'est_boxes_month', f.est_boxes_month,
             'est_value_month', case when cfg.money then round(f.est_boxes_month * f.case_price, 2) end,
             'excluded', f.exclusion_reason
           ) order by f.product_id)
             filter (where f.in_range or f.status is not null or f.exclusion_reason is not null),
           '[]'::jsonb)
    from cfg
   cross join lateral public.range_facts(cfg.org, p_days) f
    join public.stores s on s.id = f.store_id
   group by f.store_id, s.name, s.city, f.store_group_id, f.size, f.size_source
   order by f.store_id
$$;

revoke all on function public.range_status(integer) from public, anon;
grant execute on function public.range_status(integer) to authenticated;
comment on function public.range_status(integer) is
  'Each active store, its name and town: its size and why, whether Tickd is still learning (and the ordering stores against the stores it needs), whether it has ordered lately, and its range: every product in it or ordered in the last p_days (range_lapse_days when null), with its status, why it is in the range, and what similar stores sell. Insights; money only with invoicing. Security definer over every order (see 20261019100000).';

-- Each orderable product's new-product result. The spread (stores with it,
-- missing, stopped) the screens count from range_status's rows, so this does
-- not run the store rule again.
create function public.range_products()
returns table (
  product_id uuid,
  stage text,
  result text,
  added_on date,
  launch_on date,
  tried integer,
  chances integer,
  repeats integer,
  repeat_pct integer,
  ros numeric,
  similar_ros numeric,
  groups_tried text[],
  min_chances integer,
  untried_days integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');
  select public.require_permission('insights');

  select r.product_id, r.stage, r.result, r.added_on, r.launch_on, r.tried, r.chances, r.repeats,
         r.repeat_pct, r.ros, r.similar_ros, r.groups_tried, r.min_chances, r.untried_days
    from public.range_product_results(public.current_org_id()) r
   order by r.product_id
$$;

revoke all on function public.range_products() from public, anon;
grant execute on function public.range_products() to authenticated;
comment on function public.range_products() is
  'Each orderable product: its stage and new-product result (stores tried, had the chance, ordered again; boxes per store a month against similar products; groups tried; the stores a result needs; the days before "not ordered yet"). Insights. The spread across stores is range_status''s.';

-- One group (null: the stores with no group), product by size: what Tickd
-- decided for that group and size, on what evidence, and the office's pin.
create function public.range_grid(p_group_id uuid default null)
returns table (
  product_id uuid,
  size text,
  stores integer,
  level integer,
  cluster_stores integer,
  takers integer,
  share numeric,
  cluster_in boolean,
  cluster_reason text,
  own_in integer,
  pin_rule text,
  pin_min_size text,
  stage text,
  result text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');
  select public.require_permission('resources');

  with cfg as materialized (
    select public.current_org_id() as org
  )
  select f.product_id,
         f.size,
         count(*)::integer,
         max(f.level),
         max(f.cluster_stores),
         max(f.takers),
         max(f.share),
         bool_or(f.cluster_in),
         max(f.cluster_reason),
         (count(*) filter (where f.reason = 'own' and not f.cluster_in))::integer,
         max(f.pin_rule),
         max(f.pin_min_size),
         max(f.stage),
         max(f.result)
    from cfg
   cross join lateral public.range_facts(cfg.org, null) f
   where f.store_group_id is not distinct from p_group_id
   group by f.product_id, f.size
   order by f.product_id, f.size
$$;

revoke all on function public.range_grid(uuid) from public, anon;
grant execute on function public.range_grid(uuid) to authenticated;
comment on function public.range_grid(uuid) is
  'One store group (null: stores with no group), product by size: the stores of that size, the similar stores compared and the share taking it, whether Tickd puts it in their range and why (share, launch, pin; or not_taking, pin_never), how many more stores have it in range from their own orders, the pin, and the product''s stage and result. Resources (the Products pages).';

------------------------------------------------------------- the overrides

-- Always (from p_min_size) or Never, for one product in one group, or in
-- every group of the company when p_group_id is null.
create function public.range_pin_set(p_group_id uuid, p_product_id uuid, p_rule text, p_min_size text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.require_module('distribution');
  perform public.require_permission('resources');

  if p_rule is null or p_rule not in ('always', 'never') then
    raise exception 'Choose Always or Never.' using errcode = '22023';
  end if;
  if p_rule = 'always' and (p_min_size is null or p_min_size not in ('small', 'medium', 'big')) then
    raise exception 'Choose which stores always carry it: big, medium and big, or all.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.org_id = v_org) then
    raise exception 'That product is not yours.' using errcode = '22023';
  end if;
  if p_group_id is not null
     and not exists (select 1 from public.store_groups g where g.id = p_group_id and g.org_id = v_org) then
    raise exception 'That group is not yours.' using errcode = '22023';
  end if;

  insert into public.range_pins (org_id, store_group_id, product_id, rule, min_size, created_by)
  select v_org, g.id, p_product_id, p_rule, case when p_rule = 'always' then p_min_size end, auth.uid()
    from public.store_groups g
   where g.org_id = v_org
     and (p_group_id is null or g.id = p_group_id)
  on conflict (store_group_id, product_id) do update
     set rule = excluded.rule, min_size = excluded.min_size,
         created_by = excluded.created_by, created_at = now();
end;
$$;
revoke all on function public.range_pin_set(uuid, uuid, text, text) from public, anon;
grant execute on function public.range_pin_set(uuid, uuid, text, text) to authenticated;
comment on function public.range_pin_set(uuid, uuid, text, text) is
  'Pins one product in one group''s range (every group when p_group_id is null): always from p_min_size (small = every store) up, or never. Resources.';

-- Back to "Tickd decides".
create function public.range_pin_clear(p_group_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_module('distribution');
  perform public.require_permission('resources');

  delete from public.range_pins
   where org_id = public.current_org_id()
     and product_id = p_product_id
     and (p_group_id is null or store_group_id = p_group_id);
end;
$$;
revoke all on function public.range_pin_clear(uuid, uuid) from public, anon;
grant execute on function public.range_pin_clear(uuid, uuid) to authenticated;
comment on function public.range_pin_clear(uuid, uuid) is
  'Takes the pin off one product in one group (every group when p_group_id is null): Tickd decides again. Resources.';

-- "Not for this store", with why: products left out of one store's range.
create function public.store_range_exclude(p_store_id uuid, p_product_ids uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid := public.current_org_id();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.require_module('distribution');
  perform public.require_permission('sales_coverage');

  if v_reason = '' or length(v_reason) > 200 then
    raise exception 'Say why, in up to 200 characters.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_product_ids), 0) = 0 then
    raise exception 'Choose at least one product.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.org_id = v_org) then
    raise exception 'That store is not yours.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_product_ids) pid
              where not exists (select 1 from public.products p where p.id = pid and p.org_id = v_org)) then
    raise exception 'One of those products is not yours.' using errcode = '22023';
  end if;

  insert into public.store_range_exclusions (org_id, store_id, product_id, reason, created_by)
  select distinct v_org, p_store_id, pid, v_reason, auth.uid()
    from unnest(p_product_ids) pid
  on conflict (store_id, product_id) do update
     set reason = excluded.reason, created_by = excluded.created_by, created_at = now();
end;
$$;
revoke all on function public.store_range_exclude(uuid, uuid[], text) from public, anon;
grant execute on function public.store_range_exclude(uuid, uuid[], text) to authenticated;
comment on function public.store_range_exclude(uuid, uuid[], text) is
  'Marks products "Not for this store", with why: left out of that store''s range and gaps. Sales coverage.';

create function public.store_range_include(p_store_id uuid, p_product_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_module('distribution');
  perform public.require_permission('sales_coverage');

  delete from public.store_range_exclusions
   where org_id = public.current_org_id()
     and store_id = p_store_id
     and product_id = any (coalesce(p_product_ids, '{}'));
end;
$$;
revoke all on function public.store_range_include(uuid, uuid[]) from public, anon;
grant execute on function public.store_range_include(uuid, uuid[]) to authenticated;
comment on function public.store_range_include(uuid, uuid[]) is
  'Undoes "Not for this store" for those products: Tickd decides again. Sales coverage.';

------------------------------------------------------------------ modules

-- range_facts and range_product_results are not registered: nobody can call
-- them (like store_unit_price), so there is nothing for the module to refuse.
-- They still name the module first, for the functions that call them.

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'range_pins', 'distribution'),
  ('table', 'store_range_exclusions', 'distribution'),
  ('function', 'range_status', 'distribution'),
  ('function', 'range_products', 'distribution'),
  ('function', 'range_grid', 'distribution'),
  ('function', 'range_pin_set', 'distribution'),
  ('function', 'range_pin_clear', 'distribution'),
  ('function', 'store_range_exclude', 'distribution'),
  ('function', 'store_range_include', 'distribution')
on conflict do nothing;

------------------------------------------------------- the dashboard card

-- "Range" sits after "Stores due for an order" on the distribution dashboard:
-- in the trade's default and for every company still on it.
update public.template_settings
   set value = to_jsonb(regexp_replace(value #>> '{}', '(^|,)store_reorder(,|$)', '\1store_reorder,store_range\2'))
 where setting_key = 'dashboard_layout'
   and 'store_reorder' = any (string_to_array(value #>> '{}', ','))
   and not 'store_range' = any (string_to_array(value #>> '{}', ','));

update public.company_settings
   set value = to_jsonb(regexp_replace(value #>> '{}', '(^|,)store_reorder(,|$)', '\1store_reorder,store_range\2'))
 where key = 'dashboard_layout'
   and 'store_reorder' = any (string_to_array(value #>> '{}', ','))
   and not 'store_range' = any (string_to_array(value #>> '{}', ','));
