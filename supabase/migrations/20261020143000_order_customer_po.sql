-- The customer's own purchase order number on an order, and on its invoice.
--
-- Asked for on 20 Oct 2026 with Choppies purchase order 1001160022257: a chain
-- pays an invoice only when it quotes the chain's PO number, and a PO lapses on
-- its expiry date (that one on 26 Oct), after which the chain will not take the
-- delivery. Until now the number lived in the order's notes at best, and the
-- printed invoice showed only our own order number.
--
-- The order carries the number, the PO's date and the day it expires. When the
-- order issues its invoice, the number and date are copied onto the invoice and
-- stay there: an invoice is a record of what was sent, so a later edit to the
-- order does not rewrite it. The expiry stays on the order, where the warehouse
-- needs it.

alter table public.orders
  add column if not exists customer_po_number text,
  add column if not exists customer_po_date date,
  add column if not exists customer_po_expires_on date;

alter table public.orders drop constraint if exists orders_customer_po_number_check;
alter table public.orders add constraint orders_customer_po_number_check
  check (customer_po_number is null or char_length(btrim(customer_po_number)) between 1 and 60);
alter table public.orders drop constraint if exists orders_customer_po_dates_check;
alter table public.orders add constraint orders_customer_po_dates_check
  check (customer_po_expires_on is null or customer_po_date is null or customer_po_expires_on >= customer_po_date);

comment on column public.orders.customer_po_number is
  'The customer''s own purchase order number, as they want it quoted on the invoice.';
comment on column public.orders.customer_po_date is 'The date on the customer''s purchase order.';
comment on column public.orders.customer_po_expires_on is
  'The last day the customer''s purchase order is valid; the customer may refuse a delivery after it.';

-- Office staff edit orders column by column (orders has no table-wide UPDATE).
grant update (customer_po_number, customer_po_date, customer_po_expires_on) on public.orders to authenticated;

alter table public.tax_invoices
  add column if not exists customer_po_number text,
  add column if not exists customer_po_date date;

comment on column public.tax_invoices.customer_po_number is
  'The customer''s purchase order number, copied from the order when the invoice was issued.';
comment on column public.tax_invoices.customer_po_date is
  'The date on the customer''s purchase order, copied from the order when the invoice was issued.';

-- The live order_invoice_write (md5 60451a9d4688e9967afb2bc7cd44c08e), plus the
-- two purchase order columns.
CREATE OR REPLACE FUNCTION public.order_invoice_write(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.orders;
  org public.organizations;
  s public.stores;
  v_id uuid;
  v_number text;
  v_date date;
  v_sum numeric;
  t record;
begin
  select * into o from public.orders where id = p_order_id for update;
  select * into org from public.organizations where id = o.org_id;
  select * into s from public.stores where id = o.store_id;
  v_date := (now() at time zone public.org_timezone(o.org_id))::date;
  v_number := public.next_document_number_internal(o.org_id, 'tax_invoice', org.invoice_prefix);

  insert into public.tax_invoices (
    org_id, invoice_number, order_id, order_number, store_id,
    seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,
    seller_registration_number, bank_details,
    customer_name, customer_address, footer,
    issue_date, due_date, vat_rate, subtotal, vat, total, created_by,
    customer_po_number, customer_po_date
  ) values (
    o.org_id, v_number, o.id, o.order_number, o.store_id,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,
    org.registration_number, org.bank_details,
    coalesce(s.name, 'Customer'),
    coalesce(nullif(o.delivery_address, ''), concat_ws(', ', s.address, s.city)),
    org.invoice_footer,
    v_date, v_date + org.invoice_terms_days, o.vat_rate, 0, 0, 0, auth.uid(),
    nullif(btrim(o.customer_po_number), ''), o.customer_po_date
  ) returning id into v_id;

  insert into public.tax_invoice_lines (invoice_id, position, product_id, order_line_id, description, sku, qty, unit_price, line_total)
  select v_id,
         row_number() over (order by p.name, ol.id),
         ol.product_id,
         ol.id,
         p.name || coalesce(' — ' || p.brand, ''),
         p.sku_code,
         ol.qty_ordered,
         ol.unit_price,
         round(ol.qty_ordered * ol.unit_price, 2)
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  where ol.order_id = o.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0;

  select coalesce(sum(line_total), 0) into v_sum from public.tax_invoice_lines where invoice_id = v_id;
  select * into t from public.money_totals(v_sum, o.vat_rate, false);
  update public.tax_invoices set subtotal = t.subtotal, vat = t.vat, total = t.total where id = v_id;

  update public.orders set invoice_number = v_number where id = o.id;
  return v_id;
end;
$function$;
