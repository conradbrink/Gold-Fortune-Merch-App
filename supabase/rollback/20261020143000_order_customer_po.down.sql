-- Rollback of 20261020143000_order_customer_po: order_invoice_write as it was on
-- production before (pg_get_functiondef md5 60451a9d4688e9967afb2bc7cd44c08e),
-- and the purchase order columns dropped. Refuses while any order or invoice
-- holds a purchase order number, so a rollback never quietly loses one.

do $guard$
begin
  if exists (select 1 from public.orders where customer_po_number is not null)
     or exists (select 1 from public.tax_invoices where customer_po_number is not null) then
    raise exception 'Orders or invoices hold customer purchase order numbers; clear them first if this rollback is really wanted.';
  end if;
end $guard$;

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
    issue_date, due_date, vat_rate, subtotal, vat, total, created_by
  ) values (
    o.org_id, v_number, o.id, o.order_number, o.store_id,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,
    org.registration_number, org.bank_details,
    coalesce(s.name, 'Customer'),
    coalesce(nullif(o.delivery_address, ''), concat_ws(', ', s.address, s.city)),
    org.invoice_footer,
    v_date, v_date + org.invoice_terms_days, o.vat_rate, 0, 0, 0, auth.uid()
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

revoke update (customer_po_number, customer_po_date, customer_po_expires_on) on public.orders from authenticated;
alter table public.orders drop constraint if exists orders_customer_po_number_check;
alter table public.orders drop constraint if exists orders_customer_po_dates_check;
alter table public.orders
  drop column if exists customer_po_number,
  drop column if exists customer_po_date,
  drop column if exists customer_po_expires_on;
alter table public.tax_invoices
  drop column if exists customer_po_number,
  drop column if exists customer_po_date;
