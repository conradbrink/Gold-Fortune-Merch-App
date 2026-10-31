-- Products sharing a barcode suite (20261031172300, 31 Oct 2026): one item
-- priced by quantity band is held as one product per band, all with the same
-- barcode.
--
--   B1  A manager can add a second product with the same shrink barcode, and
--       a second with the same unit barcode.
--   B2  An existing product can be changed to a barcode another one has.
--   B3  The SKU code is still one product's: a second product with the same
--       code is refused.
--   B4  The barcode indexes are gone; the SKU index is still unique.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_mgr uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at limit 1;
  if v_mgr is null then
    raise exception 'Fixtures missing: a Gold Fortune manager is needed.';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ----------------------------------------------------------- B1 same barcode
  insert into public.products (org_id, name, unit_barcode, shrink_barcode, units_per_shrink, shrink_price_excl_vat, sku_code)
  values (c_gf, 'ZZ band 4 x 5L (up to 6)', 'ZZ0000000001', 'ZZ0000000002', 4, 62, 'ZZ-BAND-1')
  returning id into v_p1;
  begin
    insert into public.products (org_id, name, unit_barcode, shrink_barcode, units_per_shrink, shrink_price_excl_vat)
    values (c_gf, 'ZZ band 4 x 5L (7-12)', 'ZZ0000000001', 'ZZ0000000002', 4, 58)
    returning id into v_p2;
  exception when unique_violation then
    v_fail := v_fail || 'B1 a second product with the same barcodes was refused: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.products (org_id, name, shrink_barcode, units_per_shrink)
    values (c_gf, 'ZZ band shrink only', 'ZZ0000000002', 4);
  exception when unique_violation then
    v_fail := v_fail || 'B1 a third product with the same shrink barcode was refused: ' || sqlerrm || E'\n';
  end;
  if (select count(*) from public.products where org_id = c_gf and shrink_barcode = 'ZZ0000000002') <> 3 then
    v_fail := v_fail || 'B1 three products should share the shrink barcode' || E'\n';
  end if;

  ------------------------------------------------- B2 change to a used barcode
  insert into public.products (org_id, name, units_per_shrink)
  values (c_gf, 'ZZ band 4 x 5L (13-24)', 4) returning id into v_p3;
  begin
    update public.products set unit_barcode = 'ZZ0000000001', shrink_barcode = 'ZZ0000000002'
     where id = v_p3;
  exception when unique_violation then
    v_fail := v_fail || 'B2 changing a product to a used barcode was refused: ' || sqlerrm || E'\n';
  end;
  if not exists (select 1 from public.products where id = v_p3 and shrink_barcode = 'ZZ0000000002') then
    v_fail := v_fail || 'B2 the barcode did not save' || E'\n';
  end if;

  ------------------------------------------------------- B3 SKU still unique
  begin
    insert into public.products (org_id, name, sku_code)
    values (c_gf, 'ZZ band same SKU', 'ZZ-BAND-1') returning id into v_p4;
    v_fail := v_fail || 'B3 a second product with the same SKU code was let in' || E'\n';
  exception when unique_violation then
    if sqlerrm not like '%products_org_sku_code_idx%' then
      v_fail := v_fail || 'B3 refused for another reason: ' || sqlerrm || E'\n';
    end if;
  end;
  reset role;

  --------------------------------------------------------------- B4 indexes
  if exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'products'
              and indexname in ('products_org_unit_barcode_idx', 'products_org_shrink_barcode_idx')) then
    v_fail := v_fail || 'B4 a barcode index is still there' || E'\n';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'products'
                  and indexname = 'products_org_sku_code_idx' and indexdef like 'CREATE UNIQUE INDEX%') then
    v_fail := v_fail || 'B4 the SKU code index is no longer unique' || E'\n';
  end if;

  raise exception '%', case when v_fail = ''
    then 'ALL SHARED BARCODE CHECKS PASSED'
    else E'SHARED BARCODE SUITE FAILED\n' || v_fail end;
end;
$$;
