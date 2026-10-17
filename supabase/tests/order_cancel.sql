-- Order cancel suite (20261017120000).
--
--   C1  A packed order (picked and set aside) is cancelled by warehouse staff:
--       the order and its lines are cancelled, nothing is left held or
--       picked, and the stock is back in available.
--   C2  A confirmed order that was never picked still cancels as before.
--   C3  On real data, while it is still packed: SO-000139, the duplicate the
--       owner could not cancel on 17 Oct 2026, cancels. Its QuickBooks invoice
--       is left alone.
--   C4  A dispatched order is still refused.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_wh uuid; v_loc uuid; v_store uuid; v_prod uuid;
  v_packed uuid; v_confirmed uuid; v_line uuid; v_line2 uuid;
  v_real uuid; v_dispatched uuid;
  j jsonb; r record; v_n int;
begin
  select id into v_wh from public.profiles
   where org_id = c_gf and role = 'warehouse' and is_active order by created_at limit 1;
  if v_wh is null then
    raise exception 'Fixtures missing: a Gold Fortune warehouse user is needed.';
  end if;

  insert into public.stock_locations (org_id, name, type)
  values (c_gf, 'ZZ cancel test', 'warehouse') returning id into v_loc;
  insert into public.products (org_id, name) values (c_gf, 'ZZ cancel product') returning id into v_prod;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ cancel store') returning id into v_store;
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, 50, v_loc, 'available', 'opening_stock', 'system');

  -- A packed order: 10 set aside and picked.
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-CAN-1', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed')
  returning id into v_packed;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_packed, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_line;
  insert into public.order_allocations (org_id, order_id, order_line_id, location_id, qty_reserved, qty_picked, status)
  values (c_gf, v_packed, v_line, v_loc, 10, 10, 'picked');
  -- A confirmed order: 5 set aside, not picked.
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-CAN-2', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'confirmed')
  returning id into v_confirmed;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, client_generated_id)
  values (c_gf, v_confirmed, v_prod, 5, 5, gen_random_uuid()) returning id into v_line2;
  insert into public.order_allocations (org_id, order_id, order_line_id, location_id, qty_reserved, status)
  values (c_gf, v_confirmed, v_line2, v_loc, 5, 'reserved');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type, source_doc_id)
  values (c_gf, v_prod, 15, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_packed);

  select id into v_real from public.orders where org_id = c_gf and order_number = 'SO-000139' and status = 'packed';
  select id into v_dispatched from public.orders where org_id = c_gf and status = 'dispatched' limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------- C1 packed
  begin
    j := public.order_cancel(v_packed, 'Suite: duplicate');
  exception when others then
    v_fail := v_fail || 'C1 a packed order could not be cancelled: ' || sqlerrm || E'\n';
  end;
  select o.status, ol.qty_reserved, ol.qty_picked, ol.line_status into r
    from public.orders o join public.order_lines ol on ol.order_id = o.id where o.id = v_packed;
  if (r.status, r.qty_reserved, r.qty_picked, r.line_status) <> ('cancelled', 0, 0, 'cancelled') then
    v_fail := v_fail || format('C1 after cancel: %s, held %s, picked %s, line %s',
      r.status, r.qty_reserved, r.qty_picked, r.line_status) || E'\n';
  end if;
  select count(*) into v_n from public.order_allocations
   where order_id = v_packed and (status <> 'released' or qty_reserved <> 0 or qty_picked <> 0);
  if v_n <> 0 then
    v_fail := v_fail || 'C1 an allocation is still held or picked' || E'\n';
  end if;

  ---------------------------------------------------------- C2 confirmed
  begin
    j := public.order_cancel(v_confirmed, 'Suite: not wanted');
  exception when others then
    v_fail := v_fail || 'C2 a confirmed order could not be cancelled: ' || sqlerrm || E'\n';
  end;
  reset role;
  select qty_available, qty_reserved into r from public.stock_balances
   where location_id = v_loc and product_id = v_prod;
  if (r.qty_available, r.qty_reserved) <> (50, 0) then
    v_fail := v_fail || format('C1/C2 stock after both cancels: available %s, reserved %s (expected 50, 0)',
      r.qty_available, r.qty_reserved) || E'\n';
  end if;
  set local role authenticated;

  ---------------------------------------------------------- C3 SO-000139
  -- Once SO-000139 has really been cancelled there is nothing left to prove on
  -- it; C1 covers the same path on a fixture.
  if v_real is not null then
    begin
      j := public.order_cancel(v_real, 'Suite: duplicated');
      if j->>'status' <> 'cancelled' or (j->>'units_released')::int <> 20 then
        v_fail := v_fail || 'C3 SO-000139 cancel returned ' || j::text || E'\n';
      end if;
    exception when others then
      v_fail := v_fail || 'C3 SO-000139 could not be cancelled: ' || sqlerrm || E'\n';
    end;
    reset role;
    if exists (select 1 from public.tax_invoices
                where order_id = v_real and invoice_number = '1812' and status <> 'issued') then
      v_fail := v_fail || 'C3 the QuickBooks invoice 1812 was changed by the cancel' || E'\n';
    end if;
    set local role authenticated;
  end if;

  ---------------------------------------------------------- C4 dispatched
  if v_dispatched is not null then
    begin
      perform public.order_cancel(v_dispatched, 'Suite');
      v_fail := v_fail || 'C4 a dispatched order was cancelled' || E'\n';
    exception when insufficient_privilege then null;
    end;
  end if;
  reset role;

  if v_fail = '' then
    raise exception E'order cancel suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'order cancel suite\n%FAILED (rolled back)', v_fail;
end $$;
