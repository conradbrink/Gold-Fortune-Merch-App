-- Rollback of 20261031090000_invoice_paper: the setting goes, and every
-- company's invoices print on A4 again (the app reads a missing setting as A4).

delete from public.company_settings where key = 'invoice_paper';
delete from public.setting_definitions where key = 'invoice_paper';
