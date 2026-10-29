-- A company without the warehouse module can still invoice its orders.
--
-- Owner, 29 Oct 2026: a company "that doesn't have the warehousing function,
-- the inventory function ... when they invoice and quote and stuff, they're
-- still able to do so, but they're not able to track inventory, but they're
-- just able to invoice".
--
-- Quotes, direct invoices, invoicing a quote, credit notes and statements
-- never touched stock and already worked. Orders did not: an order is invoiced
-- when it is confirmed (orders_invoice_follow, 20261013180000) or once it has
-- gone out (tax_invoice_issue), and confirming, dispatching and cancelling are
-- all warehouse functions. A company with orders and invoicing but no
-- warehouse could take an order and never invoice or cancel it.
--
-- ------------------------------------------------------------ what it does
--
-- order_invoice_without_stock: a new order is invoiced and finished in one
-- step. It ends `delivered`, not `confirmed`: for a company that tracks no
-- stock, invoicing is the last thing that happens to an order, and every
-- reader of order status (the board, the archive, the pipeline, the
-- dashboard, commissions, the rep app's "is their last order still on its
-- way") already treats `delivered` as finished and `confirmed` as waiting for
-- the warehouse. Each live line is recorded as sent and delivered in full,
-- which `order_lines_delivered_within_dispatched` needs and commissions read.
-- No stock is reserved, moved or counted, and no POD is asked for
-- (`pod_status` not_required).
--
-- The invoice is issued at the quantities ordered and the order's prices by
-- order_invoice_write, the writer the confirm trigger uses, before the status
-- changes, so orders_invoice_follow finds it and issues nothing more. An order
-- that already carries a QuickBooks number is finished without a second
-- invoice, as confirming one does in a company that keeps stock. A hold
-- (placed while the company still had the warehouse, which alone can release
-- one) is released by the same step.
--
-- If the invoice is voided later, the order is `delivered` with no invoice,
-- and tax_invoice_issue (the "Issue tax invoice" button) invoices it again.
-- A mistake on an invoiced order is a credit note, as it is everywhere.
--
-- order_cancel_without_stock: cancels a new order, with a reason, lines and
-- all, as order_cancel does for an order that holds no stock.
--
-- Both refuse when the warehouse module is on: a company that keeps stock has
-- one way to confirm an order (order_confirm, which reserves it) and one way
-- to cancel it (order_cancel, which puts the stock back). Both need the
-- Orders permission (`warehouse`, "Orders and warehouse"), which is what
-- gates /orders, the orders policies, order_confirm, order_cancel and
-- tax_invoice_issue; it is offered whenever the orders module is on.
--
-- -------------------------------------------------- the two rules it bends
--
-- orders_enforce_transition admits new -> delivered for this function only,
-- the way it admits a dispatched order back only through
-- order_return_undelivered: a transaction-local setting naming the order.
--
-- orders_fulfil_location_set lets such an order have no fulfilment location
-- (a company without the warehouse has no stock locations; none is made for
-- it). Only for a delivered order that was never dispatched, which before
-- this no order was: every other order keeps the rule exactly as it was.

create or replace function public.orders_enforce_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_legal boolean;
begin
  if new.status is not distinct from old.status then
    if new.org_id is distinct from old.org_id then
      raise exception 'An order cannot be moved to another organisation.'
        using errcode = '42501';
    end if;
    if new.store_id is distinct from old.store_id and old.status <> 'new' then
      raise exception 'Order % has been confirmed; it cannot be moved to another location.',
        old.order_number using errcode = '42501';
    end if;
    return new;
  end if;

  if old.on_hold and new.status <> 'cancelled' then
    raise exception 'Order % is on hold (%). Release the hold first.',
      old.order_number, coalesce(old.hold_reason, 'no reason given')
      using errcode = '42501';
  end if;

  v_legal := (old.status, new.status) in (
    ('new', 'confirmed'),       ('new', 'cancelled'),
    ('confirmed', 'picking'),   ('confirmed', 'cancelled'),
    ('picking', 'confirmed'),   ('picking', 'packed'),      ('picking', 'cancelled'),
    ('packed', 'picking'),      ('packed', 'dispatched'),   ('packed', 'cancelled'),
    ('dispatched', 'delivered'),('dispatched', 'cancelled'),('dispatched', 'packed')
  )
  -- Invoiced and finished in one step by order_invoice_without_stock, for a
  -- company that keeps no stock. Only through it.
  or ((old.status, new.status) = ('new', 'delivered')
      and coalesce(current_setting('app.finished_without_stock', true), '') = new.id::text);

  if not v_legal then
    raise exception 'An order cannot go from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  if old.status = 'dispatched' and new.status in ('cancelled', 'packed')
     and coalesce(current_setting('app.stock_returned', true), '') <> new.id::text then
    raise exception
      'Take a dispatched order back through order_return_undelivered(), so the stock comes with it.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

alter table public.orders drop constraint orders_fulfil_location_set;
alter table public.orders add constraint orders_fulfil_location_set
  check (status in ('new', 'cancelled')
         or fulfil_location_id is not null
         or (status = 'delivered' and dispatched_at is null));

create or replace function public.order_invoice_without_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  o public.orders;
  v_live integer;
  v_missing text;
  v_quotes text;
  v_invoice_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  v_org := public.current_org_id();

  if public.module_enabled('warehouse') then
    raise exception 'Your company keeps stock, so confirm the order with "Confirm and reserve", which takes the stock off the shelf.'
      using errcode = '42501';
  end if;
  if not public.has_permission('warehouse') then
    raise exception 'Invoicing an order needs the Orders permission.' using errcode = '42501';
  end if;

  -- As order_confirm: two people pressing the button must not both invoice it.
  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into o from public.orders where id = p_order_id and org_id = v_org for update;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  if o.status <> 'new' then
    raise exception 'Order % is already %.', o.order_number, o.status using errcode = '42501';
  end if;

  -- The lines too, so a change to a line saved while this runs waits for it.
  -- A line added or removed at the same moment is not held off (the same
  -- window order_confirm has).
  perform 1 from public.order_lines where order_id = o.id for update;

  select count(*),
         string_agg(p.name, ', ' order by p.name) filter (where ol.unit_price is null)
    into v_live, v_missing
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = o.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0;
  if v_live = 0 then
    raise exception 'Order % has nothing on it to invoice.', o.order_number using errcode = '22023';
  end if;
  -- A QuickBooks number means it was invoiced there: no second invoice, so
  -- no prices needed.
  if o.invoice_number is null and v_missing is not null then
    raise exception '% has products with no price: %. Price them before invoicing.', o.order_number, v_missing
      using errcode = '22023';
  end if;
  if exists (select 1 from public.tax_invoices t where t.order_id = o.id and t.status = 'issued') then
    raise exception '% already has a tax invoice.', o.order_number using errcode = '23505';
  end if;
  -- Made from a quote that was invoiced already (in full, or a deposit):
  -- invoicing the order too would bill the customer twice, the deposit not
  -- taken off. quote_convert does not stop that; for these companies this is
  -- the step that would issue the second invoice, so it stops here. The way
  -- on is the quote's own: its final balance (invoice_from_quote) bills what
  -- is left with the deposit taken off. A credit note would not clear this:
  -- a credited invoice is still issued.
  select string_agg(distinct q.quote_number || ' (' || t.invoice_number || ')', ', ')
    into v_quotes
    from public.quotes q
    join public.tax_invoices t on t.quote_id = q.id and t.status = 'issued'
   where q.converted_order_id = o.id;
  if v_quotes is not null then
    raise exception '% was made from a quote that is already invoiced: %. Invoice what is left from the quote instead, and cancel this order.',
      o.order_number, v_quotes using errcode = '23505';
  end if;

  -- Only the warehouse could release it, and there is none.
  if o.on_hold then
    update public.orders set on_hold = false, hold_reason = null, held_at = null, held_by = null
     where id = o.id;
  end if;

  if o.invoice_number is null then
    v_invoice_id := public.order_invoice_write(o.id);
  end if;

  update public.order_lines
     set qty_dispatched = qty_ordered,
         qty_delivered = qty_ordered,
         line_status = 'fulfilled'
   where order_id = o.id and line_status <> 'cancelled';

  perform set_config('app.finished_without_stock', o.id::text, true);
  update public.orders
     set status = 'delivered',
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         delivered_by = auth.uid(),
         delivered_at = now(),
         pod_status = 'not_required'
   where id = o.id;
  perform set_config('app.finished_without_stock', '', true);

  return jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'status', 'delivered',
    'invoice_id', v_invoice_id);
end;
$function$;

create or replace function public.order_cancel_without_stock(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  o public.orders;
  -- Any run of white space, tabs and new lines included, counts as one space.
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  v_org := public.current_org_id();

  if public.module_enabled('warehouse') then
    raise exception 'Your company keeps stock, so cancel the order with "Cancel", which also puts any reserved stock back.'
      using errcode = '42501';
  end if;
  if not public.has_permission('warehouse') then
    raise exception 'Cancelling an order needs the Orders permission.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Say why the order is being cancelled.' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'), hashtext(p_order_id::text));

  select * into o from public.orders where id = p_order_id and org_id = v_org for update;
  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;
  if o.status = 'cancelled' then
    raise exception 'Order % is already cancelled.', o.order_number using errcode = '42501';
  end if;
  if o.status = 'delivered' then
    -- Delivered through the warehouse once, or finished here: either way a
    -- correction is a credit note, when there is an invoice to credit.
    raise exception 'Order % is delivered, so it cannot be cancelled. If it was invoiced, issue a credit note on its invoice instead.',
      o.order_number using errcode = '42501';
  end if;
  if o.status <> 'new' then
    -- Moved on through the warehouse before the company dropped it.
    raise exception 'Order % is %, which only the warehouse steps can undo.', o.order_number, o.status
      using errcode = '42501';
  end if;

  -- Lines first, then the order, as order_cancel does.
  update public.order_lines set line_status = 'cancelled'
   where order_id = o.id and line_status <> 'cancelled';
  update public.orders
     set status = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by = auth.uid(),
         cancelled_at = now()
   where id = o.id;

  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'status', 'cancelled');
end;
$function$;

revoke all on function public.order_invoice_without_stock(uuid) from public, anon;
grant execute on function public.order_invoice_without_stock(uuid) to authenticated, service_role;
revoke all on function public.order_cancel_without_stock(uuid, text) from public, anon;
grant execute on function public.order_cancel_without_stock(uuid, text) to authenticated, service_role;

comment on function public.order_invoice_without_stock(uuid) is
  'For a company without the warehouse module: invoices a new order at the quantities ordered and finishes it (delivered, no POD). No stock is touched. Refuses when the warehouse module is on.';
comment on function public.order_cancel_without_stock(uuid, text) is
  'For a company without the warehouse module: cancels a new order, with a reason. Refuses when the warehouse module is on, and once the order is invoiced.';

insert into public.module_assignments (kind, name, module_code)
values ('function', 'order_invoice_without_stock', 'distribution'),
       ('function', 'order_cancel_without_stock', 'distribution')
on conflict do nothing;
