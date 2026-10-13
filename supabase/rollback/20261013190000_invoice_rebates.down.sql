-- Rollback of 20261013190000_invoice_rebates. Rebates already recorded stay:
-- they are credit notes.

delete from public.module_assignments where kind = 'function' and name = 'invoice_rebate';
drop function public.invoice_rebate(uuid, numeric, date, text);
