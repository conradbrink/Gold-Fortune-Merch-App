-- Manager signature on orders, and the driver's POD (20261027201700).
--
--   S1  A rep's order arrives with its signature: the three columns are
--       written through orders_insert, as the phone's sync does.
--   S2  Half a signature (a picture with no name) is refused, and so is a
--       picture outside the company's folder.
--   S3  Nobody can change a signature afterwards: authenticated has no UPDATE
--       on the columns, the warehouse included.
--   S4  Storage: a rep uploads only into their own folder; the picture is read
--       by whoever can read the order (the rep, the warehouse) and not by
--       another rep.
--   D1  The warehouse's order_mark_delivered still records a delivery; a rep
--       calling it is still refused with its own message.
--   D2  Nobody signed in can call order_mark_delivered_unchecked.
--   D3  The assigned rep can put a photo in the order's folder of
--       fulfilment-docs; another rep cannot.
--   D4  delivery_confirm refuses before the photo is in storage, and a photo
--       filed under another order.
--   D5  The assigned rep records the drop: dispatch and order delivered by
--       them, everything delivered and nothing back, the stock gone from
--       in-transit, the photo filed as the POD with the name typed, and
--       pod_status received.
--   D6  Replaying the same call files nothing twice and moves no more stock.
--   D7  Another rep is refused with the assignment message.
--   D8  A phone clock running fast is held to now, not refused as the future.
--   D9  The warehouse recorded the drop first: the phone's photo is filed and
--       the warehouse's received-by name stands.
--   D10 A dispatch the warehouse returned is refused, and no POD is filed.
--   D11 anon and PUBLIC cannot call delivery_confirm.
--   D12 The deferred invoice follow-up runs on all of the above (forced with
--       SET CONSTRAINTS ALL IMMEDIATE, because the block never commits).
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives (the storage rows it writes included; no file is uploaded). The
-- last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  c_refusal constant text := 'That delivery is not assigned to you.';
  v_fail text := '';
  v_wh uuid; v_rep uuid; v_other uuid; v_loc uuid; v_store uuid; v_prod uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid;
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_d4 uuid;
  v_sig_order uuid; v_sig_path text; v_pod1 text; v_pod2 text; v_pod3 text; v_pod4 text;
  j jsonb; r record; v_n int; v_ok boolean; v_when timestamptz;
begin
  -- Warehouse staff, else a manager (who holds every permission): a smaller
  -- company may have nobody with the warehouse role.
  select id into v_wh from public.profiles
   where org_id = c_gf and role in ('warehouse', 'manager') and is_active
   order by (role = 'warehouse') desc, created_at, id limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by full_name, id limit 1;
  select id into v_other from public.profiles
   where org_id = c_gf and role = 'rep' and is_active and id <> v_rep order by full_name, id limit 1;
  if v_wh is null or v_rep is null or v_other is null then
    raise exception 'Fixtures missing: warehouse %, rep %, other rep %', v_wh, v_rep, v_other;
  end if;

  insert into public.stock_locations (org_id, name, type)
  values (c_gf, 'ZZ pod test', 'warehouse') returning id into v_loc;
  insert into public.products (org_id, name) values (c_gf, 'ZZ pod product') returning id into v_prod;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ pod store') returning id into v_store;
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, 100, v_loc, 'available', 'opening_stock', 'system');

  -- Four packed orders of 10, taken by somebody else (the warehouse), picked in full.
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-POD-1', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o1;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-POD-2', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o2;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-POD-3', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o3;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-POD-4', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o4;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o1, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o2, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o3, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l3;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o4, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l4;
  insert into public.order_allocations (org_id, order_id, order_line_id, location_id, batch_id, qty_reserved, qty_picked, status)
  values (c_gf, v_o1, v_l1, v_loc, null, 10, 10, 'picked'),
         (c_gf, v_o2, v_l2, v_loc, null, 10, 10, 'picked'),
         (c_gf, v_o3, v_l3, v_loc, null, 10, 10, 'picked'),
         (c_gf, v_o4, v_l4, v_loc, null, 10, 10, 'picked');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type, source_doc_id)
  values (c_gf, v_prod, 40, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_o1);

  -- The warehouse sends all four out.
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_d1 := (public.order_dispatch(p_order_id => v_o1, p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  v_d2 := (public.order_dispatch(p_order_id => v_o2, p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  v_d3 := (public.order_dispatch(p_order_id => v_o3, p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  v_d4 := (public.order_dispatch(p_order_id => v_o4, p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  reset role;
  -- ...and gives them to the rep. As the warehouse page does; set directly
  -- here because the column write is not what is under test.
  -- Out since yesterday, so a drop pressed two hours ago is after it.
  update public.dispatches set assigned_rep_id = v_rep, dispatched_at = now() - interval '1 day'
   where id in (v_d1, v_d2, v_d3, v_d4);

  v_pod1 := c_gf || '/' || v_o1 || '/' || gen_random_uuid() || '.jpg';
  v_pod2 := c_gf || '/' || v_o2 || '/' || gen_random_uuid() || '.jpg';
  v_pod3 := c_gf || '/' || v_o3 || '/' || gen_random_uuid() || '.jpg';
  v_pod4 := c_gf || '/' || v_o4 || '/' || gen_random_uuid() || '.jpg';

  ---------------------------------------------------------------- S1 signed order
  v_sig_path := c_gf || '/' || v_rep || '/' || gen_random_uuid() || '.png';
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via,
                               client_generated_id, signature_path, signed_by_name, signed_at)
    values (c_gf, 'ZZ-SIG-1', v_store, v_rep, 'rep_app', 'rep_visit',
            gen_random_uuid(), v_sig_path, 'Thabo Manager', now())
    returning id into v_sig_order;
  exception when others then
    v_fail := v_fail || 'S1 the rep could not save a signed order: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- S2 half a signature
  begin
    insert into public.orders (org_id, order_number, store_id, rep_id, source, client_generated_id,
                               signature_path, signed_at)
    values (c_gf, 'ZZ-SIG-2', v_store, v_rep, 'rep_app', gen_random_uuid(), v_sig_path || 'x', now());
    v_fail := v_fail || 'S2 a signature with no name was saved' || E'\n';
  exception when check_violation then
    if sqlerrm not like '%orders_signature_complete%' then
      v_fail := v_fail || 'S2 refused by the wrong check: ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.orders (org_id, order_number, store_id, rep_id, source, client_generated_id,
                               signature_path, signed_by_name, signed_at)
    values (c_gf, 'ZZ-SIG-3', v_store, v_rep, 'rep_app', gen_random_uuid(),
            gen_random_uuid() || '/x.png', 'Somebody', now());
    v_fail := v_fail || 'S2 a signature outside the company folder was saved' || E'\n';
  exception when check_violation then
    if sqlerrm not like '%orders_signature_path_org%' then
      v_fail := v_fail || 'S2 refused by the wrong check: ' || sqlerrm || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- S4 storage, the rep
  begin
    insert into storage.objects (bucket_id, name, owner) values ('order-signatures', v_sig_path, v_rep);
  exception when others then
    v_fail := v_fail || 'S4 the rep could not upload into their own folder: ' || sqlerrm || E'\n';
  end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('order-signatures', c_gf || '/' || v_other || '/zz.png', v_rep);
    v_fail := v_fail || 'S4 the rep uploaded into another rep''s folder' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from storage.objects where bucket_id = 'order-signatures' and name = v_sig_path) then
    v_fail := v_fail || 'S4 the rep cannot read their own order''s signature' || E'\n';
  end if;

  ---------------------------------------------------------------- S3 no changing it
  begin
    update public.orders set signed_by_name = 'Someone else' where id = v_sig_order;
    v_fail := v_fail || 'S3 the rep changed the signer''s name' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.orders set signature_path = null, signed_by_name = null, signed_at = null where id = v_sig_order;
    v_fail := v_fail || 'S3 the warehouse cleared a signature' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from storage.objects where bucket_id = 'order-signatures' and name = v_sig_path) then
    v_fail := v_fail || 'S4 the warehouse cannot read the signature' || E'\n';
  end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'order-signatures' and name = v_sig_path) then
    v_fail := v_fail || 'S4 another rep can read the signature' || E'\n';
  end if;

  ---------------------------------------------------------------- D3 storage, the other rep
  begin
    insert into storage.objects (bucket_id, name, owner) values ('fulfilment-docs', v_pod1, v_other);
    v_fail := v_fail || 'D3 a rep not assigned the delivery uploaded its POD' || E'\n';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------- D7 another rep
  begin
    perform public.delivery_confirm(v_d1, 'Shop manager', now(), v_pod1, 1000);
    v_fail := v_fail || 'D7 another rep recorded the delivery' || E'\n';
  -- Any error, not 42501 alone: with the check gone the next guard (no photo)
  -- would refuse instead, and that must read as a failure, not a crash.
  exception when others then
    if sqlerrm <> c_refusal then
      v_fail := v_fail || 'D7 refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  reset role;

  ---------------------------------------------------------------- D1 / D2 as the assigned rep
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.order_mark_delivered(v_d1, 'Shop manager', null, null);
    v_fail := v_fail || 'D1 a rep recorded a delivery through order_mark_delivered' || E'\n';
  exception when insufficient_privilege then
    if sqlerrm <> 'Only warehouse staff can record a delivery.' then
      v_fail := v_fail || 'D1 refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    perform public.order_mark_delivered_unchecked(v_d1, 'Shop manager', null, null);
    v_fail := v_fail || 'D2 a rep called order_mark_delivered_unchecked' || E'\n';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------- D4 no photo yet / wrong folder
  begin
    perform public.delivery_confirm(v_d1, 'Shop manager', now(), v_pod1, 1000);
    v_fail := v_fail || 'D4 a drop was recorded before its photo arrived' || E'\n';
  exception when no_data_found then
    if sqlerrm <> 'The proof of delivery photo has not arrived yet.' then
      v_fail := v_fail || 'D4 refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    perform public.delivery_confirm(v_d1, 'Shop manager', now(), v_pod2, 1000);
    v_fail := v_fail || 'D4 a photo under another order was accepted' || E'\n';
  exception when insufficient_privilege then
    if sqlerrm <> 'The proof of delivery must be filed under this order.' then
      v_fail := v_fail || 'D4 wrong folder refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- D3 the assigned rep uploads
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('fulfilment-docs', v_pod1, v_rep), ('fulfilment-docs', v_pod2, v_rep),
           ('fulfilment-docs', v_pod3, v_rep), ('fulfilment-docs', v_pod4, v_rep);
  exception when others then
    v_fail := v_fail || 'D3 the assigned rep could not upload the POD photos: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- D5 the drop
  v_when := now() - interval '2 hours';
  begin
    j := public.delivery_confirm(v_d1, '  Shop manager  ', v_when, v_pod1, 123456);
    if j->>'status' <> 'delivered' or j->>'pod_status' <> 'received' then
      v_fail := v_fail || 'D5 answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'D5 the assigned rep could not record the drop: ' || sqlerrm || E'\n';
  end;
  reset role;
  select d.status, d.delivered_by, d.received_by_name, d.delivered_at, o.status as ostatus,
         o.pod_status, o.delivered_by as odel, ol.qty_delivered, ol.qty_returned, ol.line_status
    into r
    from public.dispatches d join public.orders o on o.id = d.order_id
    join public.order_lines ol on ol.order_id = o.id
   where d.id = v_d1;
  if (r.status, r.delivered_by, r.received_by_name, r.ostatus, r.pod_status, r.odel,
      r.qty_delivered, r.qty_returned, r.line_status)
     is distinct from ('delivered', v_rep, 'Shop manager', 'delivered', 'received', v_rep, 10, 0, 'fulfilled') then
    v_fail := v_fail || 'D5 after: ' || row_to_json(r)::text || E'\n';
  end if;
  if r.delivered_at is distinct from v_when then
    v_fail := v_fail || format('D5 delivered at %s, pressed at %s', r.delivered_at, v_when) || E'\n';
  end if;
  select count(*) into v_n from public.delivery_documents
   where dispatch_id = v_d1 and doc_type = 'pod' and storage_path = v_pod1
     and signed_by_name = 'Shop manager' and uploaded_by = v_rep and mime_type = 'image/jpeg'
     and size_bytes = 123456;
  if v_n <> 1 then
    v_fail := v_fail || format('D5 %s POD documents filed as expected (want 1)', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- D6 replay
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    j := public.delivery_confirm(v_d1, 'Shop manager', v_when, v_pod1, 123456);
    if coalesce((j->>'already_filed')::boolean, false) is not true then
      v_fail := v_fail || 'D6 replay answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'D6 the replay failed: ' || sqlerrm || E'\n';
  end;
  reset role;
  select count(*) into v_n from public.delivery_documents where dispatch_id = v_d1;
  if v_n <> 1 then
    v_fail := v_fail || format('D6 %s documents after the replay (want 1)', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.stock_movements
   where source_doc_type = 'dispatch' and source_doc_id = v_d1 and reason = 'order_delivery';
  if v_n <> 1 then
    v_fail := v_fail || format('D6 %s delivery movements (want 1)', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- D8 fast clock
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delivery_confirm(v_d2, 'Shop manager', now() + interval '3 hours', v_pod2, null);
  exception when others then
    v_fail := v_fail || 'D8 a fast phone clock was refused: ' || sqlerrm || E'\n';
  end;
  reset role;
  if (select delivered_at from public.dispatches where id = v_d2) is distinct from now() then
    v_fail := v_fail || 'D8 not held to now: ' || (select delivered_at from public.dispatches where id = v_d2) || E'\n';
  end if;

  ---------------------------------------------------------------- D9 the warehouse got there first
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.order_mark_delivered(v_d3, 'Recorded at the office', null, null);
  exception when others then
    v_fail := v_fail || 'D1 the warehouse could not record a delivery: ' || sqlerrm || E'\n';
  end;
  -- ...and D10's dispatch comes back.
  begin
    perform public.order_return_undelivered(v_d4, 'Suite: shop shut', false);
  exception when others then
    v_fail := v_fail || 'D10 fixture: could not return the dispatch: ' || sqlerrm || E'\n';
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    j := public.delivery_confirm(v_d3, 'Shop manager', now(), v_pod3, null);
    if coalesce((j->>'already_delivered')::boolean, false) is not true then
      v_fail := v_fail || 'D9 answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'D9 the photo was not filed after the warehouse''s record: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- D10 returned
  begin
    perform public.delivery_confirm(v_d4, 'Shop manager', now(), v_pod4, null);
    v_fail := v_fail || 'D10 a returned dispatch was recorded as delivered' || E'\n';
  exception when insufficient_privilege then
    if sqlerrm not like 'Dispatch % was marked returned by the warehouse%' then
      v_fail := v_fail || 'D10 refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  reset role;
  select d.received_by_name, o.pod_status into r
    from public.dispatches d join public.orders o on o.id = d.order_id where d.id = v_d3;
  if (r.received_by_name, r.pod_status) is distinct from ('Recorded at the office', 'received') then
    v_fail := v_fail || 'D9 after: ' || row_to_json(r)::text || E'\n';
  end if;
  if exists (select 1 from public.delivery_documents where dispatch_id = v_d4) then
    v_fail := v_fail || 'D10 a POD was filed for the returned dispatch' || E'\n';
  end if;

  ---------------------------------------------------------------- stock
  -- 30 delivered (D5, D8, D9); D10's 10 back on the shelf, still held for its
  -- order (returned without cancelling); nothing left in transit.
  select coalesce(sum(qty_available), 0) as a, coalesce(sum(qty_reserved), 0) as res,
         coalesce(sum(qty_in_transit), 0) as t into r
    from public.stock_balances where product_id = v_prod;
  if (r.a, r.res, r.t) <> (60, 10, 0) then
    v_fail := v_fail || format('stock: available %s, reserved %s, in transit %s (want 60, 10, 0)', r.a, r.res, r.t) || E'\n';
  end if;

  ---------------------------------------------------------------- D11 grants
  if has_function_privilege('anon', 'public.delivery_confirm(uuid,text,timestamptz,text,bigint,text)', 'EXECUTE') then
    v_fail := v_fail || 'D11 anon can call delivery_confirm' || E'\n';
  end if;
  if has_function_privilege('authenticated', 'public.order_mark_delivered_unchecked(uuid,text,timestamptz,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.order_mark_delivered_unchecked(uuid,text,timestamptz,jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'D2 order_mark_delivered_unchecked is executable by a client role' || E'\n';
  end if;
  select exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid in ('public.delivery_confirm(uuid,text,timestamptz,text,bigint,text)'::regprocedure,
                     'public.order_mark_delivered_unchecked(uuid,text,timestamptz,jsonb)'::regprocedure)
       and a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_ok;
  if v_ok then
    v_fail := v_fail || 'D11 PUBLIC can call one of the new functions' || E'\n';
  end if;

  ---------------------------------------------------------------- D12 invoice follow-up
  begin
    set constraints all immediate;
  exception when others then
    v_fail := v_fail || 'D12 the deferred invoice follow-up failed: ' || sqlerrm || E'\n';
  end;

  if v_fail = '' then
    raise exception E'driver POD + order signature suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'driver POD + order signature suite\n%FAILED (rolled back)', v_fail;
end $$;
