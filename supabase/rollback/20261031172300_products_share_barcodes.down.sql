-- Rollback of 20261031172300_products_share_barcodes: a barcode belongs to one
-- product per company again.
--
-- Fails with "could not create unique index" while two products of one company
-- share a barcode. Find them first, and clear or change all but one:
--
--   select org_id, unit_barcode, array_agg(name) from public.products
--    where coalesce(unit_barcode, '') <> '' group by 1, 2 having count(*) > 1;
--   select org_id, shrink_barcode, array_agg(name) from public.products
--    where coalesce(shrink_barcode, '') <> '' group by 1, 2 having count(*) > 1;

create unique index if not exists products_org_unit_barcode_idx
  on public.products (org_id, unit_barcode)
  where unit_barcode is not null and unit_barcode <> '';
create unique index if not exists products_org_shrink_barcode_idx
  on public.products (org_id, shrink_barcode)
  where shrink_barcode is not null and shrink_barcode <> '';

comment on column public.products.unit_barcode is null;
comment on column public.products.shrink_barcode is null;
