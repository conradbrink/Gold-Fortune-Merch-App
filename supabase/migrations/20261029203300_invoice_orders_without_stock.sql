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
-- Two functions for exactly that company. Both refuse when the warehouse
-- module is on, so a company that keeps stock has one way to confirm an order
-- (order_confirm, which reserves it) and one way to cancel it (order_cancel,
-- which puts the stock back).
--
--   order_invoice_without_stock  new -> confirmed, issuing the invoice at the
--     quantities ordered and the order's prices (order_invoice_write, the
--     same writer the confirm trigger uses). Nothing is reserved, moved or
--     counted. The invoice is written before the status changes, so the
--     triggers see the order already invoiced: orders_invoice_ready skips its
--     price check (done here first) and orders_invoice_follow issues nothing
--     more and has nothing to credit.
--
--   order_cancel_without_stock  new -> cancelled, with a reason. Only while
--     new: once invoiced, a correction is a credit note on the invoice.
--
-- Invoicing an order is the invoicing permission's job here, as issuing any
-- other invoice is; there is no warehouse permission to give in a company
-- without the warehouse.
--
-- A confirmed order may now have no fulfilment location. A company without
-- the warehouse has no stock locations at all (none is made for it), and
-- `orders_fulfil_location_set` refused a confirmed order without one.
-- order_confirm always sets the location, so a company that keeps stock is
-- unchanged; picking, packing and dispatching still need one, so an order
-- confirmed without stock can never slip into those steps.

alter table public.orders drop constraint orders_fulfil_location_set;
alter table public.orders add constraint orders_fulfil_location_set
  check (status in ('new', 'confirmed', 'cancelled') or fulfil_location_id is not null);

create or replace function public.order_invoice_without_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  o public.orders;
  v_missing text;
  v_invoice public.tax_invoices;
  v_invoice_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  v_org := public.current_org_id();

  if public.module_enabled('warehouse') then
    raise exception 'Your company keeps stock, so confirm the order with "Confirm and reserve". That issues its invoice and takes the stock off the shelf.'
      using errcode = '42501';
  end if;
  if not public.has_permission('invoicing') then
    raise exception 'Only someone who can issue invoices can invoice an order.' using errcode = '42501';
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
  if o.on_hold then
    raise exception 'Order % is on hold (%). Release the hold first.',
      o.order_number, coalesce(o.hold_reason, 'no reason given') using errcode = '42501';
  end if;
  -- Invoiced in QuickBooks before the app issued invoices: refuse, never
  -- overwrite, as tax_invoice_issue does.
  if o.invoice_number is not null then
    raise exception '% was already invoiced outside the app as %. Clear that number on the order first if it was wrong.',
      o.order_number, o.invoice_number using errcode = '23505';
  end if;
  if exists (select 1 from public.tax_invoices t where t.order_id = o.id and t.status = 'issued') then
    raise exception '% already has a tax invoice.', o.order_number using errcode = '23505';
  end if;

  if not exists (select 1 from public.order_lines ol
                  where ol.order_id = o.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0) then
    raise exception 'Order % has nothing on it to invoice.', o.order_number using errcode = '22023';
  end if;
  select string_agg(p.name, ', ' order by p.name) into v_missing
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = o.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0
     and ol.unit_price is null;
  if v_missing is not null then
    raise exception '% has products with no price: %. Price them before invoicing.', o.order_number, v_missing
      using errcode = '22023';
  end if;

  v_invoice_id := public.order_invoice_write(o.id);

  update public.orders
     set status = 'confirmed',
         confirmed_by = auth.uid(),
         confirmed_at = now()
   where id = o.id;

  select * into v_invoice from public.tax_invoices where id = v_invoice_id;
  return jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'status', 'confirmed',
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'total', v_invoice.total);
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
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  v_org := public.current_org_id();

  if public.module_enabled('warehouse') then
    raise exception 'Your company keeps stock, so cancel the order with "Cancel". That also puts any reserved stock back.'
      using errcode = '42501';
  end if;
  if not (public.has_permission('invoicing') or public."current_role"() = 'manager') then
    raise exception 'Only a manager or someone who can issue invoices can cancel an order.' using errcode = '42501';
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
  if o.status <> 'new' then
    raise exception 'Order % has been invoiced, so it cannot be cancelled. Issue a credit note on its invoice instead.',
      o.order_number using errcode = '42501';
  end if;

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
  'For a company without the warehouse module: confirms a new order and issues its invoice at the quantities ordered. No stock is touched. Refuses when the warehouse module is on.';
comment on function public.order_cancel_without_stock(uuid, text) is
  'For a company without the warehouse module: cancels a new order, with a reason. Refuses when the warehouse module is on, and once the order is invoiced.';

insert into public.module_assignments (kind, name, module_code)
values ('function', 'order_invoice_without_stock', 'distribution'),
       ('function', 'order_cancel_without_stock', 'distribution')
on conflict do nothing;
