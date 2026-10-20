-- Failed delivery suite (20261020083000).
--
--   R1  A packed order goes out, does not arrive, and is cancelled: the order
--       and its line are cancelled with nothing held, picked or dispatched,
--       the allocation is released with nothing picked, the dispatch is
--       returned, and the stock is back in available.
--   R2  The same without cancelling: back to packed with its stock reserved
--       and still picked, and it can be dispatched again.
--   R3  A line split over two batches (two dispatch lines) is cancelled: each
--       batch's stock is back in available and nothing is left picked.
--   R4  On real data: a Gold Fortune order on the road returns and cancels
--       (skipped when none is dispatched).
--   R5  The deferred invoice follow-up (orders_invoice_follow) runs on all of
--       the above without error: forced with SET CONSTRAINTS ALL IMMEDIATE,
--       because the block never reaches commit.
--
-- Before 20261020083000, R1, R3 and R4 failed with order_lines_picked_within_held.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_wh uuid; v_loc uuid; v_store uuid; v_prod uuid; v_prod2 uuid; v_b1 uuid; v_b2 uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid;
  v_d uuid; v_real_dispatch uuid;
  j jsonb; r record; v_n int;
begin
  select id into v_wh from public.profiles
   where org_id = c_gf and role = 'warehouse' and is_active order by created_at limit 1;
  if v_wh is null then
    raise exception 'Fixtures missing: a Gold Fortune warehouse user is needed.';
  end if;

  insert into public.stock_locations (org_id, name, type)
  values (c_gf, 'ZZ return test', 'warehouse') returning id into v_loc;
  insert into public.products (org_id, name) values (c_gf, 'ZZ return product') returning id into v_prod;
  insert into public.products (org_id, name) values (c_gf, 'ZZ return batched') returning id into v_prod2;
  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod2, 'ZZ-B1', current_date + 30) returning id into v_b1;
  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod2, 'ZZ-B2', current_date + 60) returning id into v_b2;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ return store') returning id into v_store;
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, 50, v_loc, 'available', 'opening_stock', 'system');
  insert into public.stock_movements (org_id, product_id, batch_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod2, v_b1, 6, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_prod2, v_b2, 10, v_loc, 'available', 'opening_stock', 'system');

  -- Two packed orders of 10, picked in full; one packed order of 10 split 6 + 4 over two batches.
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-RET-1', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o1;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-RET-2', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o2;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-RET-3', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o3;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o1, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o2, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o3, v_prod2, 10, 10, 10, gen_random_uuid()) returning id into v_l3;
  insert into public.order_allocations (org_id, order_id, order_line_id, location_id, batch_id, qty_reserved, qty_picked, status)
  values (c_gf, v_o1, v_l1, v_loc, null, 10, 10, 'picked'),
         (c_gf, v_o2, v_l2, v_loc, null, 10, 10, 'picked'),
         (c_gf, v_o3, v_l3, v_loc, v_b1, 6, 6, 'picked'),
         (c_gf, v_o3, v_l3, v_loc, v_b2, 4, 4, 'picked');
  insert into public.stock_movements (org_id, product_id, batch_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type, source_doc_id)
  values (c_gf, v_prod, null, 20, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_o1),
         (c_gf, v_prod2, v_b1, 6, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_o3),
         (c_gf, v_prod2, v_b2, 4, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_o3);

  select d.id into v_real_dispatch
    from public.dispatches d join public.orders o on o.id = d.order_id
   where d.org_id = c_gf and d.status = 'in_transit' and o.status = 'dispatched'
   order by d.dispatched_at limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------- R1 return and cancel
  begin
    j := public.order_dispatch(p_order_id => v_o1, p_carrier_name => 'ZZ courier');
    v_d := (j->>'dispatch_id')::uuid;
    j := public.order_return_undelivered(v_d, 'Suite: shop closed for good', true);
    if j->>'status' <> 'cancelled' or (j->>'units_returned')::int <> 10 then
      v_fail := v_fail || 'R1 returned ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'R1 return and cancel failed: ' || sqlerrm || E'\n';
  end;
  select o.status, ol.qty_reserved, ol.qty_picked, ol.qty_dispatched, ol.line_status into r
    from public.orders o join public.order_lines ol on ol.order_id = o.id where o.id = v_o1;
  if (r.status, r.qty_reserved, r.qty_picked, r.qty_dispatched, r.line_status) <> ('cancelled', 0, 0, 0, 'cancelled') then
    v_fail := v_fail || format('R1 after: %s, held %s, picked %s, dispatched %s, line %s',
      r.status, r.qty_reserved, r.qty_picked, r.qty_dispatched, r.line_status) || E'\n';
  end if;
  select count(*) into v_n from public.order_allocations
   where order_id = v_o1 and (status <> 'released' or qty_reserved <> 0 or qty_picked <> 0 or qty_dispatched <> 0);
  if v_n <> 0 then
    v_fail := v_fail || 'R1 an allocation is still held, picked or dispatched' || E'\n';
  end if;
  if not exists (select 1 from public.dispatches where order_id = v_o1 and status = 'returned') then
    v_fail := v_fail || 'R1 the dispatch is not returned' || E'\n';
  end if;

  ---------------------------------------------------------- R2 return, keep the order
  begin
    j := public.order_dispatch(p_order_id => v_o2, p_carrier_name => 'ZZ courier');
    v_d := (j->>'dispatch_id')::uuid;
    j := public.order_return_undelivered(v_d, 'Suite: nobody there', false);
    if j->>'status' <> 'packed' then
      v_fail := v_fail || 'R2 returned ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'R2 return failed: ' || sqlerrm || E'\n';
  end;
  select o.status, ol.qty_reserved, ol.qty_picked, ol.qty_dispatched into r
    from public.orders o join public.order_lines ol on ol.order_id = o.id where o.id = v_o2;
  if (r.status, r.qty_reserved, r.qty_picked, r.qty_dispatched) <> ('packed', 10, 10, 0) then
    v_fail := v_fail || format('R2 after: %s, held %s, picked %s, dispatched %s',
      r.status, r.qty_reserved, r.qty_picked, r.qty_dispatched) || E'\n';
  end if;
  begin
    j := public.order_dispatch(p_order_id => v_o2, p_carrier_name => 'ZZ courier again');
  exception when others then
    v_fail := v_fail || 'R2 could not go out again: ' || sqlerrm || E'\n';
  end;
  select o.status, ol.qty_reserved, ol.qty_dispatched into r
    from public.orders o join public.order_lines ol on ol.order_id = o.id where o.id = v_o2;
  if (r.status, r.qty_reserved, r.qty_dispatched) <> ('dispatched', 0, 10) then
    v_fail := v_fail || format('R2 after going out again: %s, held %s, dispatched %s',
      r.status, r.qty_reserved, r.qty_dispatched) || E'\n';
  end if;

  ---------------------------------------------------------- R3 two batches, cancel
  begin
    j := public.order_dispatch(p_order_id => v_o3, p_carrier_name => 'ZZ courier');
    v_d := (j->>'dispatch_id')::uuid;
    select count(*) into v_n from public.dispatch_lines where dispatch_id = v_d;
    if v_n <> 2 then
      v_fail := v_fail || format('R3 expected 2 dispatch lines, got %s', v_n) || E'\n';
    end if;
    j := public.order_return_undelivered(v_d, 'Suite: refused', true);
  exception when others then
    v_fail := v_fail || 'R3 return and cancel over two batches failed: ' || sqlerrm || E'\n';
  end;
  select ol.qty_picked, ol.qty_dispatched, ol.line_status into r from public.order_lines ol where ol.id = v_l3;
  if (r.qty_picked, r.qty_dispatched, r.line_status) <> (0, 0, 'cancelled') then
    v_fail := v_fail || format('R3 line after: picked %s, dispatched %s, %s', r.qty_picked, r.qty_dispatched, r.line_status) || E'\n';
  end if;

  ---------------------------------------------------------- R4 real data
  if v_real_dispatch is not null then
    begin
      j := public.order_return_undelivered(v_real_dispatch, 'Suite: real order, rolled back', true);
      if j->>'status' <> 'cancelled' then
        v_fail := v_fail || 'R4 real order returned ' || j::text || E'\n';
      end if;
    exception when others then
      v_fail := v_fail || 'R4 a real order on the road could not be returned and cancelled: ' || sqlerrm || E'\n';
    end;
  end if;
  reset role;

  ---------------------------------------------------------- R5 invoice follow-up
  begin
    set constraints all immediate;
  exception when others then
    v_fail := v_fail || 'R5 the deferred invoice follow-up failed: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------- stock
  -- R1 back to available, R2 out again (in transit at the same location), R3 both batches back.
  select coalesce(sum(qty_available), 0) as a, coalesce(sum(qty_reserved), 0) as res into r
    from public.stock_balances where location_id = v_loc and product_id = v_prod;
  if (r.a, r.res) <> (40, 0) then
    v_fail := v_fail || format('R1/R2 plain stock: available %s, reserved %s (expected 40, 0)', r.a, r.res) || E'\n';
  end if;
  select count(*) into v_n from public.stock_balances
   where location_id = v_loc and product_id = v_prod2
     and ((batch_id = v_b1 and qty_available = 6 and qty_reserved = 0)
       or (batch_id = v_b2 and qty_available = 10 and qty_reserved = 0));
  if v_n <> 2 then
    v_fail := v_fail || 'R3 batch stock is not back in available (6 and 10)' || E'\n';
  end if;

  if v_fail = '' then
    raise exception E'failed delivery suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'failed delivery suite\n%FAILED (rolled back)', v_fail;
end $$;
