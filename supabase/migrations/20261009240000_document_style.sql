-- Three looks for the company's invoices, credit notes, quotes and
-- statements (owner, 9 Oct): `classic` (the layout they have always had, and
-- the default, so nothing changes until a company chooses), `bold` and
-- `clean`. The colours of the two new looks are the company's own brand
-- colours (brand_primary_color, brand_accent_color), already in Settings.
--
-- Only a definition: a company without a row reads the default, as every
-- other setting does (my_company_config falls back to default_value).
--
-- Rollback: supabase/rollback/20261009240000_document_style.down.sql.

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('document_style', 'Document style',
   'How invoices, credit notes, quotes and statements look: classic, bold or clean.',
   'text', '"classic"', null, null, '^(classic|bold|clean)$', 992);
