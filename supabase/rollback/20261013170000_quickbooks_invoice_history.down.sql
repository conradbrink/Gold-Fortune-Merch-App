-- Rollback of 20261013170000_quickbooks_invoice_history. Refuses while any
-- imported QuickBooks invoice exists: delete the import first (it is data, and
-- the constraints below cannot hold while it is there).

do $$
begin
  if exists (select 1 from public.tax_invoices where source = 'quickbooks') then
    raise exception 'Imported QuickBooks invoices exist; remove them before rolling this back.';
  end if;
end;
$$;

alter table public.tax_invoices drop constraint tax_invoices_source_link;
alter table public.tax_invoices add constraint tax_invoices_source_link check (
  ((source = 'order') = (order_id is not null))
  and (source <> 'order' or order_number is not null)
  and ((source = 'quote') = (quote_id is not null))
  and (kind = 'standard' or source = 'quote'));

alter table public.tax_invoices drop constraint tax_invoices_source_check;
alter table public.tax_invoices add constraint tax_invoices_source_check
  check (source in ('order', 'quote', 'jobs', 'direct', 'contract'));
