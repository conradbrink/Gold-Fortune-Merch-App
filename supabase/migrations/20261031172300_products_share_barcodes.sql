-- Two products can carry the same barcode (owner, 31 Oct 2026).
--
-- A client sells one item at a price that falls with the quantity: a 4 x 5L
-- pack is one price up to 6 packs, less for 7-12, less again from 13, 25 and
-- 63. They hold that as one product per band, "Aqua Blast Still 4 x 5L (7-12
-- units)" and so on, each with its own price. Every band is the same pack on
-- the shelf, so every band has the same barcode, and the unique indexes below
-- refused the second one with "duplicate key value violates unique constraint
-- products_org_shrink_barcode_idx".
--
-- The barcode indexes were unique so that a product import could match a row to
-- one product by its barcode (web/lib/import/products.ts). The import now says
-- so when a barcode belongs to several products and leaves that row for a
-- person; nothing in the database looks a product up by its barcode. The SKU
-- code stays unique: it is the company's own code for one line, and it is what
-- tells products that share a barcode apart in an import.
--
-- Rollback: supabase/rollback/20261031172300_products_share_barcodes.down.sql.

drop index if exists public.products_org_unit_barcode_idx;
drop index if exists public.products_org_shrink_barcode_idx;

comment on column public.products.unit_barcode is
  'Barcode on the single item a shopper picks up. Not unique: products priced by quantity band share it.';
comment on column public.products.shrink_barcode is
  'Barcode on the outer (shrink) the store receives. Not unique: products priced by quantity band share it.';
