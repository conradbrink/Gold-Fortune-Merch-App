-- What the Print button on an invoice prints on (owner, 31 Oct): an A4 page,
-- as every company has printed until now, or an 80 mm till slip for a
-- receipt printer at the counter (a client prints on an Epson TM-T20II).
--
-- Only the Print button follows it. The PDF button and the invoice emailed to
-- a client stay A4, the document the client files.
--
-- The company's own choice (audience 'owner'): it is their printer. Settings >
-- Business shows it, and the Control Centre can set it up for them.
--
-- Rollback: supabase/rollback/20261031090000_invoice_paper.down.sql.

insert into public.setting_definitions (key, label, description, value_type, default_value, pattern, sort_order, audience) values
  ('invoice_paper', 'Invoice printer',
   'What the Print button on an invoice prints on: an A4 page, or an 80 mm till slip on a receipt printer.',
   'text', '"a4"', '^(a4|slip_80)$', 993, 'owner');

-- Every company has every setting written down (as create_company does).
insert into public.company_settings (org_id, key, value)
select o.id, 'invoice_paper', '"a4"'::jsonb
  from public.organizations o
on conflict (org_id, key) do nothing;
