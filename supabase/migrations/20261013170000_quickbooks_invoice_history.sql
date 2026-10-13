-- Invoices brought over from QuickBooks (13 Oct 2026).
--
-- Gold Fortune invoiced in QuickBooks until Tickd took over. Its history —
-- every invoice, with its lines, the payments received and the credit notes —
-- is imported so each store's account, "Who owes you", statements and the
-- dashboard start from the truth rather than from zero.
--
-- An imported invoice is `source = 'quickbooks'`. It keeps its QuickBooks
-- number (1006, 1834 …) and is linked to its store, and to the order that
-- carried that number where there is one. Like every invoice it is never
-- edited; Tickd's automatic credits and voids (20261013180000) leave it alone.
--
-- The import itself is data, run once at switch-over from QuickBooks' own
-- exports; it is not in this repository (the files are the company's customer
-- records). This migration only lets such an invoice exist: until now an
-- invoice linked to an order had to be one Tickd made from it.

alter table public.tax_invoices drop constraint tax_invoices_source_check;
alter table public.tax_invoices add constraint tax_invoices_source_check
  check (source in ('order', 'quote', 'jobs', 'direct', 'contract', 'quickbooks'));

-- As before, an order invoice has its order and a quote invoice its quote, and
-- only a quote's invoices are deposits or finals. New: an invoice from
-- QuickBooks may also name the order it was for.
alter table public.tax_invoices drop constraint tax_invoices_source_link;
alter table public.tax_invoices add constraint tax_invoices_source_link check (
  (source <> 'order' or (order_id is not null and order_number is not null))
  and (order_id is null or source in ('order', 'quickbooks'))
  and ((source = 'quote') = (quote_id is not null))
  and (kind = 'standard' or source = 'quote'));
