-- A standing cost per product, so stock can be valued before it has ever been
-- received through a goods receipt.
--
-- ------------------------------------------------------------------ why
--
-- `stock_valuation` values stock at the last `unit_cost` on a posted goods
-- receipt line. That is the right number when it exists — it is what was
-- actually paid — but it is the *only* source of cost in the system, and after
-- the 03.08 recount there are no posted receipts at all: every product values
-- as null, which the function deliberately reports as "we do not know" rather
-- than zero. The opening position was keyed as a stocktake, and a stocktake
-- carries no money.
--
-- So there is no way to answer "what is this warehouse worth" without first
-- inventing a receipt, which would post stock movements and double-count
-- against the opening position. These columns are the way to say what a unit
-- cost without pretending it arrived.
--
-- ------------------------------------------------------- the unit it is in
--
-- **Per sellable unit, not per shrink.** This is the trap the price columns
-- already carry a warning about: `shrink_price_excl_vat` is named for the
-- shrink because it is a shrink's price, and confusing the two misvalues a
-- pack of ten by a factor of ten. `goods_receipt_lines.unit_cost` is per
-- *receiving* unit, which is why `stock_valuation` divides it by the pack
-- factor frozen onto the line; these columns skip that step by being stated in
-- the same unit the quantities are.
--
-- Both sides of VAT are stored, exactly as the selling prices are, and for the
-- same reason: the invoice shows one and the accounts want the other, and
-- deriving either from the org's current `vat_rate` would silently restate
-- historic costs the day the rate changes. Valuation uses the **excl** figure —
-- VAT paid to a supplier is reclaimed, so it is not part of what the stock is
-- worth.
--
-- No policy change: `products_write` is `for all` and manager-only, so the new
-- columns inherit exactly the access every other product column has.

alter table public.products
  add column if not exists unit_cost_excl_vat numeric(12, 2),
  add column if not exists unit_cost_incl_vat numeric(12, 2);

comment on column public.products.unit_cost_excl_vat is
  'Standing cost of one sellable unit, excluding VAT. The fallback used by stock_valuation when a product has never been received through a posted goods receipt. Per unit, NOT per shrink — see shrink_price_excl_vat for the other convention.';
comment on column public.products.unit_cost_incl_vat is
  'Standing cost of one sellable unit, including VAT. Recorded alongside the excl figure for invoice reconciliation; stock is valued on the excl figure, because supplier VAT is reclaimed.';

-- A cost cannot be negative. Nullable throughout: a product whose cost nobody
-- has established must stay unknown, because a zero here would quietly value
-- real stock at nothing and the whole point of the null is to be visible.
alter table public.products drop constraint if exists products_unit_cost_excl_vat_check;
alter table public.products add constraint products_unit_cost_excl_vat_check
  check (unit_cost_excl_vat is null or unit_cost_excl_vat >= 0);
alter table public.products drop constraint if exists products_unit_cost_incl_vat_check;
alter table public.products add constraint products_unit_cost_incl_vat_check
  check (unit_cost_incl_vat is null or unit_cost_incl_vat >= 0);

-- ------------------------------------------------------------ stock_valuation
--
-- Unchanged in shape, in rounding and in row order. The only difference is
-- where a cost may come from: a posted receipt still wins, because what was
-- actually paid beats what someone typed, and the standing cost is consulted
-- only where the receipt cost is absent — which today is everywhere.
--
-- `last_unit_cost` therefore now means "the cost we are valuing at". The column
-- keeps its name so the return shape, and every generated type over it, is
-- untouched.

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
  ),
  costed as (
    select r.*, coalesce(lc.unit_cost, p.unit_cost_excl_vat) as unit_cost
    from rolled r
    left join last_cost lc on lc.product_id = r.product_id
    -- Left, not inner: `rolled` comes from `stock_on_hand`, which is already
    -- org-scoped, and a line must not vanish from the valuation just because
    -- its product row could not be read.
    left join public.products p on p.id = r.product_id
  )
  select
    c.product_id, c.product_name, c.qty_on_hand, c.qty_available,
    round(c.unit_cost, 4),
    round(c.unit_cost * c.qty_on_hand, 2)
  from costed c
  order by (c.unit_cost * c.qty_on_hand) desc nulls last, c.product_name;
$$;

revoke all on function public.stock_valuation(uuid) from public, anon;
grant execute on function public.stock_valuation(uuid) to authenticated;
