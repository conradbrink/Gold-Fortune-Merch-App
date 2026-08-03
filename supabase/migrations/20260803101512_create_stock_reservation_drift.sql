-- What the orders think they are holding, against what the ledger says is held.
--
-- -------------------------------------------------------- the gap this fills
--
-- `stock_balance_drift()` proves `stock_balances` still equals the sum of
-- `stock_movements`. That is this module's core invariant, and on its own it is
-- not enough: it only ever compares the ledger with itself.
--
-- `order_allocations` is the third number. It records which batch, at which
-- location, is held for which order line, and it is *maintained alongside* the
-- ledger by `order_confirm`, `order_record_pick`, `order_dispatch`,
-- `order_cancel` and `order_return_undelivered` rather than derived from it.
-- Two writers agreeing by convention — the arrangement the ledger's own header
-- rejected for balances, and it is no safer here. The day one path gets the
-- pair out of step, the ledger still balances perfectly and drift() reports
-- nothing at all.
--
-- The concrete case is already written down in
-- 20260802164852_create_order_fulfilment_rpcs.sql: a *partial* batch
-- substitution at pick time. The picker takes 4 of a 10-unit allocation from a
-- different lot, the reallocation movements are posted for those 4, and the
-- allocation row is updated to name the substitute batch for all 10. Total
-- reserved stock is unchanged, so the balance still reconciles to the ledger
-- exactly — while the picking list and the dispatch are both wrong about which
-- lot is going out, and the customer gets the wrong expiry date.
--
-- `order_record_pick` refuses that today: a substitution has to cover the whole
-- allocation. This function is the net beneath that guard rather than a
-- replacement for it. It is what would notice if the guard were relaxed —
-- splitting an allocation in two is the proper fix and is the obvious next
-- change in this area — or if any future writer of either table drifted.
--
-- ------------------------------------------------------------- the invariant
--
-- For every (org, location, product, batch): the quantity the allocations are
-- holding equals `stock_balances.qty_reserved`. Zero rows means it holds.
--
-- It is a closed system. Nothing outside the order chain writes the `reserved`
-- bucket — goods receipts land in available and damaged, transfers move
-- available through in_transit, stocktake variances adjust available — so every
-- unit sitting in `reserved` was put there by a reservation and is owned by an
-- allocation row.
--
-- --------------------------------------------------------- which side is wrong
--
-- Run `stock_balance_drift()` first. If it is clean, the balance agrees with the
-- ledger and the *allocations* are what is wrong: they are the working set, and
-- they are reconstructible from `stock_movements` where source_doc_type =
-- 'order'. Never "correct" a balance to agree with an allocation. If drift() is
-- dirty too, repair that first — a row here may be nothing more than its shadow.
--
-- ---------------------------------------------- why status is not filtered on
--
-- `qty_reserved` is summed over every allocation row of the organisation, not
-- only those whose status is 'reserved' or 'picked'.
--
-- Every path that closes an allocation zeroes the quantity in the same
-- statement that sets the status — dispatch and cancel both do, and so does a
-- cancelling return. So the closed rows contribute nothing when the system is
-- healthy, and including them catches one more way for it not to be: a
-- 'released' or 'dispatched' allocation still carrying a reservation. Filtering
-- on status would hide precisely that row, which is the sort of thing this
-- function exists to find.
--
-- ---------------------------------------------------------- one honest false hit
--
-- An adjustment *can* be keyed against the `reserved` bucket. The bucket lists
-- on `stock_adjustment_lines` permit it, even though none of the six reasons the
-- UI offers produce it. Approving such a line takes stock out from under a live
-- reservation, and this function will report it.
--
-- That is not a defect in the reconciliation. The order really is holding stock
-- that is no longer there, and its dispatch will fail on
-- `stock_balances_non_negative` when it is attempted. Read a row here as "these
-- two disagree"; the movement history for that product says which of the two is
-- the surprise.

/**
 * Every place the order allocations and the reserved balance disagree.
 *
 * Returns zero rows when healthy, one row per (location, product, batch) that
 * does not reconcile. `drift` is allocated minus reserved, so a positive number
 * means the orders are claiming to hold more than the ledger has put aside.
 *
 * Manager-only, on the same reasoning as `stock_balance_drift()`: a diagnostic
 * about the integrity of the system, not a number anyone works from. The role
 * test sits in the WHERE clauses of both legs, so a non-manager gets an empty
 * comparison rather than a partial one.
 */
drop function if exists public.stock_reservation_drift();
create or replace function public.stock_reservation_drift()
returns table (
  location_id uuid,
  product_id uuid,
  batch_id uuid,
  qty_allocated bigint,
  qty_reserved bigint,
  drift bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, public."current_role"() as role
  ),
  from_allocations as (
    -- The join to order_lines is only for the product: an allocation names a
    -- line, and the line names the product. Inner, because order_line_id is
    -- not null and carries a foreign key, so it cannot drop a row.
    select a.location_id, ol.product_id, a.batch_id,
           sum(a.qty_reserved)::bigint as qty
      from public.order_allocations a
      cross join cfg
      join public.order_lines ol on ol.id = a.order_line_id
     where a.org_id = cfg.org and cfg.role = 'manager'
     group by 1, 2, 3
  ),
  from_balances as (
    select b.location_id, b.product_id, b.batch_id,
           b.qty_reserved::bigint as qty
      from public.stock_balances b cross join cfg
     where b.org_id = cfg.org and cfg.role = 'manager'
  )
  select coalesce(a.location_id, b.location_id),
         coalesce(a.product_id,  b.product_id),
         coalesce(a.batch_id,    b.batch_id),
         coalesce(a.qty, 0),
         coalesce(b.qty, 0),
         coalesce(a.qty, 0) - coalesce(b.qty, 0)
    from from_allocations a
    full join from_balances b
      on  b.location_id = a.location_id
      and b.product_id  = a.product_id
      -- `is not distinct from`, never `=`. Every untracked product holds its
      -- stock on a single null-batch row, and `null = null` is not true, so a
      -- plain equality never matches those two sides to each other.
      --
      -- In a full join that does not hide them, it doubles them: each healthy
      -- untracked product would come back as two rows that fail to reconcile —
      -- one claiming the whole reservation is unbacked, one claiming the whole
      -- balance is unheld. The invariant would look broken everywhere it is
      -- fine, and a real discrepancy would be lost in the noise.
      and b.batch_id is not distinct from a.batch_id
   where coalesce(a.qty, 0) is distinct from coalesce(b.qty, 0);
$$;

comment on function public.stock_reservation_drift() is
  'Reconciles order_allocations against stock_balances.qty_reserved. Must return zero rows; a row means an order is holding a different quantity or batch than the ledger reserved for it. Check stock_balance_drift() first — if that is clean, the allocations are what is wrong.';

revoke all on function public.stock_reservation_drift() from public, anon;
grant execute on function public.stock_reservation_drift() to authenticated;
