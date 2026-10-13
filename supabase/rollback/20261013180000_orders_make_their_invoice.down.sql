-- Rollback of 20261013180000_orders_make_their_invoice: orders stop making
-- their invoices. Invoices and credit notes already issued stay (they are tax
-- documents); they only lose the order line each of their lines came from.
-- Gold Fortune's invoice counter is left where it is, so no number is reused.

drop trigger orders_invoice_follow on public.orders;
drop trigger orders_invoice_ready on public.orders;
drop function public.orders_invoice_follow();
drop function public.orders_invoice_ready();
drop function public.credit_note_write(uuid, text, jsonb);
drop function public.order_invoice_write(uuid);
drop function public.order_invoices_on(uuid);

do $$
declare
  def text := pg_get_functiondef('public.tax_invoice_issue(uuid,date)'::regprocedure);
  old_text constant text :=
    E'insert into public.tax_invoice_lines (invoice_id, position, product_id, order_line_id, description, sku, qty, unit_price, line_total)\n'
    || E'  select v_id,\n'
    || E'         row_number() over (order by p.name, ol.id),\n'
    || E'         ol.product_id,\n'
    || E'         ol.id,\n';
  new_text constant text :=
    E'insert into public.tax_invoice_lines (invoice_id, position, product_id, description, sku, qty, unit_price, line_total)\n'
    || E'  select v_id,\n'
    || E'         row_number() over (order by p.name, ol.id),\n'
    || E'         ol.product_id,\n';
begin
  if (length(def) - length(replace(def, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'tax_invoice_issue: expected 1 of the anchor';
  end if;
  execute replace(def, old_text, new_text);
end;
$$;

drop index public.tax_invoice_lines_order_line_idx;
alter table public.tax_invoice_lines drop column order_line_id;

delete from public.company_settings where key = 'money_invoice_orders';
delete from public.template_settings where setting_key = 'money_invoice_orders';
delete from public.setting_definitions where key = 'money_invoice_orders';
