-- Rollback of 20261030160311_accounting_sync. Everything it made goes; the
-- catalogue row for the add-on (20261007112542) stays.

drop trigger if exists tax_invoices_accounting on public.tax_invoices;
drop trigger if exists credit_notes_accounting on public.credit_notes;
drop trigger if exists invoice_payments_accounting on public.invoice_payments;

drop function if exists public.accounting_after_invoice();
drop function if exists public.accounting_after_credit_note();
drop function if exists public.accounting_after_payment();
drop function if exists public.accounting_retry(uuid);
drop function if exists public.accounting_finish(uuid, boolean, bigint, text, boolean, integer, boolean, boolean);
drop function if exists public.accounting_claim(integer, integer, integer);
drop function if exists public.accounting_kind_rank(text);
drop function if exists public.accounting_queue_since(uuid);
drop function if exists public.accounting_invoice_going(uuid, uuid);
drop function if exists public.accounting_enqueue(uuid, text, uuid, text, bigint);
drop function if exists public.accounting_sync_on(uuid);

drop table if exists public.accounting_queue;
drop table if exists public.accounting_links;
drop table if exists public.accounting_secrets;
drop table if exists public.accounting_connections;

delete from public.module_assignments
 where (kind = 'table' and name in ('accounting_connections', 'accounting_secrets', 'accounting_links',
                                    'accounting_queue'))
    or (kind = 'function' and name = 'accounting_retry');

delete from public.module_dependencies where module_code = 'accounting_sync' and requires_code = 'invoicing';
