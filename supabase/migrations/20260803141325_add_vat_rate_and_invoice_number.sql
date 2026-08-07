-- One VAT rate per organisation, and a copy of it on every order.
--
-- ------------------------------------------------------------ where it lives
--
-- `organizations.vat_rate` is the setting. Managers own it: `organizations` has
-- a table-level UPDATE grant, so a new column is writable by default, and the
-- only thing standing between a clerk and the tax rate is
-- `organizations_update`, which already requires `current_role() = 'manager'`.
-- Checked before adding the column rather than assumed.
--
-- Default 0. An organisation that has never opened Settings charges no VAT,
-- which is visibly wrong rather than quietly wrong — a rate invented on its
-- behalf would produce plausible totals that nobody chose.
--
-- ------------------------------------------- why the order carries a copy too
--
-- `orders.vat_rate` is stamped when the order is captured and never read from
-- the organisation again.
--
-- Without it, changing the rate would restate the tax on every order ever
-- taken, including ones already delivered, invoiced and paid. Last month's
-- order would quietly start reporting a different total from the invoice the
-- customer is holding. This is the same freeze the goods-receipt lines already
-- do with `units_per_uom`, for the same reason: a document records what was
-- true when it was written.
--
-- The trigger sets it unconditionally rather than defaulting it, so a client
-- that supplies its own `vat_rate` on insert cannot choose the tax on its own
-- order. Nothing in the app sends one; the rep app posts orders through the
-- outbox and a future caller should not be able to either.
--
-- Updating it afterwards is already impossible: `20260802164130_create_orders`
-- revoked UPDATE on `orders` and granted it back column by column, and this
-- column is not on that list.
--
-- --------------------------------------------------------- what is not taxed
--
-- Nothing is stored per line and no line is exempt. Every product is at the
-- organisation's single rate, which is the arrangement described. Zero-rating a
-- customer or a product is a different feature and would need the rate per line
-- rather than per order, so it is deliberately not half-built here.
--
-- Line prices stay VAT-exclusive, matching `products.shrink_price_excl_vat`,
-- which is what the capture screen already prefills from. Subtotal, VAT and
-- total are arithmetic on top rather than three stored numbers that can
-- disagree with each other.

alter table public.organizations
  add column if not exists vat_rate numeric(6,3) not null default 0;

alter table public.organizations drop constraint if exists organizations_vat_rate_check;
alter table public.organizations add constraint organizations_vat_rate_check
  check (vat_rate >= 0 and vat_rate <= 100);

comment on column public.organizations.vat_rate is
  'VAT percentage applied to every order, e.g. 14 for 14%. 0 means no VAT is charged. Copied onto each order when it is captured, so changing it never restates an existing order.';

alter table public.orders
  add column if not exists vat_rate numeric(6,3) not null default 0;

alter table public.orders drop constraint if exists orders_vat_rate_check;
alter table public.orders add constraint orders_vat_rate_check
  check (vat_rate >= 0 and vat_rate <= 100);

comment on column public.orders.vat_rate is
  'The organisation VAT percentage as it stood when this order was captured. Frozen on purpose: a later rate change must not restate an order already invoiced.';

/**
 * Stamps the organisation's VAT rate onto a new order.
 *
 * Assigns rather than defaults, so a caller supplying its own `vat_rate`
 * cannot decide the tax on its own order.
 */
create or replace function public.orders_stamp_vat_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select coalesce(o.vat_rate, 0) into new.vat_rate
  from public.organizations o
  where o.id = new.org_id;

  new.vat_rate := coalesce(new.vat_rate, 0);
  return new;
end;
$$;

revoke all on function public.orders_stamp_vat_rate() from public, anon, authenticated;

drop trigger if exists orders_stamp_vat on public.orders;
create trigger orders_stamp_vat
  before insert on public.orders
  for each row execute function public.orders_stamp_vat_rate();

-- ------------------------------------------------------------ invoice number
--
-- The sales invoice this order became in QuickBooks. Free text, because it is
-- somebody else's numbering scheme and this system does not get to have an
-- opinion about its shape.
--
-- Nullable and stays nullable: the invoice is usually raised after the order is
-- captured, so requiring it at capture would mean inventing one.

alter table public.orders
  add column if not exists invoice_number text;

comment on column public.orders.invoice_number is
  'The sales invoice number in the accounting system, e.g. QuickBooks. Entered by hand, usually after capture.';

create index if not exists orders_invoice_number_idx
  on public.orders (org_id, invoice_number) where invoice_number is not null;

-- ------------------------------------------------- extending the update grant
--
-- `20260802164130_create_orders.sql` revoked UPDATE on `orders` and granted it
-- back column by column, so that a clerk cannot PATCH a status and move stock
-- without the ledger noticing. A new column is not in that list and is
-- therefore read-only until it is named here.
--
-- `invoice_number` and `rep_id` are both things a manager legitimately edits
-- after the fact — the invoice arrives later, and an order taken over the phone
-- gets attributed to whichever rep owns the account. Neither moves stock.
--
-- `vat_rate` is deliberately NOT added. It is frozen at capture, and the only
-- writer is the trigger above.

grant update (invoice_number, rep_id) on public.orders to authenticated;
