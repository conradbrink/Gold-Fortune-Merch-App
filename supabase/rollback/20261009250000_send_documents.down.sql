-- Rollback of 20261009250000_send_documents: the send functions, the link and
-- send records, and the accounts flag out again. Emails already queued stay in
-- the outbox (their links stop working).

delete from public.module_assignments
 where (kind = 'table' and name in ('document_links', 'document_sends'))
    or (kind = 'function' and name in ('client_overdue_invoices', 'send_invoice_email', 'send_quote_email',
                                       'send_statement_email', 'send_payment_reminder', 'document_sends_for',
                                       'document_send_summary'));

drop function if exists public.document_link_opened(uuid);
drop function if exists public.document_link_view(uuid);
drop function if exists public.document_send_summary(text);
drop function if exists public.document_sends_for(text, uuid, uuid, text);
drop function if exists public.send_payment_reminder(uuid, text, text[], text, text, boolean);
drop function if exists public.send_statement_email(uuid, text, date, date, text[], text, boolean);
drop function if exists public.send_quote_email(uuid, text[], text, boolean);
drop function if exists public.send_invoice_email(uuid, text[], text, boolean);
drop function if exists public.client_overdue_invoices(uuid, text);
drop function if exists public.statement_client_name(uuid, uuid, text);
drop function if exists public.client_overdue_invoices_for(uuid, uuid, text, date);
drop function if exists public.statement_client_ageing(uuid, uuid, text, date);
drop function if exists public.statement_rows(uuid, uuid, text, date, date);
drop function if exists public.ensure_document_link(uuid, text, uuid, uuid, uuid, text, date, date);
drop function if exists public.queue_document_email(uuid, text, text, text, jsonb, text, uuid, uuid, uuid, text);
drop function if exists public.document_recipients(text[], boolean);

drop table if exists public.document_sends;
drop table if exists public.document_links;

alter table public.site_contacts drop column if exists receives_accounts;
