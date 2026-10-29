-- The receiver signs for a delivery on the phone (20261029181700).
--
--   G1  Signature only: the drop is recorded, the signature is kept on the
--       dispatch, filed as the order's POD (image/png, the name typed), and
--       pod_status turns received.
--   G2  Replaying the same call files nothing twice.
--   G3  Signature and photo: both filed as POD; the dispatch points at the
--       signature.
--   G4  Neither: refused, nothing recorded.
--   G5  A signature not uploaded yet: refused with its own message.
--   G6  A signature filed under another order: refused.
--   G7  A phone on the build before this one (photo only, five named
--       arguments) still records its drop, with no signature on the dispatch.
--   G8  Nobody signed in can write received_signature_path directly.
--   G9  anon cannot call delivery_confirm; the five-argument one is gone.
--   G10 Another rep is refused with the assignment message.
--   G11 The warehouse recorded the drop first: the phone's signature is still
--       filed and kept on the dispatch, and the warehouse's name stands.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives (the storage rows it writes included; no file is uploaded). The
-- last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_wh uuid; v_rep uuid; v_other uuid; v_loc uuid; v_store uuid; v_prod uuid;
  v_o uuid[] := '{}'; v_d uuid[] := '{}'; v_id uuid; v_line uuid;
  v_sig1 text; v_sig3 text; v_pod3 text; v_pod7 text; v_sig_away text; v_sig6 text;
  j jsonb; r record; v_n int; i int;
begin
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
  values (c_gf, 'ZZ sig test', 'warehouse') returning id into v_loc;
  insert into public.products (org_id, name) values (c_gf, 'ZZ sig product') returning id into v_prod;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ sig store') returning id into v_store;
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, 100, v_loc, 'available', 'opening_stock', 'system');

  -- Six packed orders of 10, picked in full.
  for i in 1..6 loop
    insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
    values (c_gf, 'ZZ-SIG-' || i, v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_id;
    insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
    values (c_gf, v_id, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_line;
    insert into public.order_allocations (org_id, order_id, order_line_id, location_id, batch_id, qty_reserved, qty_picked, status)
    values (c_gf, v_id, v_line, v_loc, null, 10, 10, 'picked');
    v_o := v_o || v_id;
  end loop;
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type, source_doc_id)
  values (c_gf, v_prod, 60, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_o[1]);

  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..6 loop
    v_d := v_d || (public.order_dispatch(p_order_id => v_o[i], p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  end loop;
  reset role;
  update public.dispatches set assigned_rep_id = v_rep, dispatched_at = now() - interval '1 day'
   where id = any (v_d);
  -- G11: the warehouse records the sixth one itself, before the phone's call.
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.order_mark_delivered(v_d[6], 'Warehouse name', null, null);
  reset role;
  v_sig6 := c_gf || '/' || v_o[6] || '/' || gen_random_uuid() || '.png';

  v_sig1 := c_gf || '/' || v_o[1] || '/' || gen_random_uuid() || '.png';
  v_sig3 := c_gf || '/' || v_o[3] || '/' || gen_random_uuid() || '.png';
  v_pod3 := c_gf || '/' || v_o[3] || '/' || gen_random_uuid() || '.jpg';
  v_pod7 := c_gf || '/' || v_o[4] || '/' || gen_random_uuid() || '.jpg';
  -- Order 1's folder, used for order 2's dispatch in G6.
  v_sig_away := c_gf || '/' || v_o[1] || '/' || gen_random_uuid() || '.png';

  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('fulfilment-docs', v_sig1, v_rep, '{"size": 2048}'),
           ('fulfilment-docs', v_sig3, v_rep, '{"size": 2048}'),
           ('fulfilment-docs', v_pod3, v_rep, null),
           ('fulfilment-docs', v_pod7, v_rep, null),
           ('fulfilment-docs', v_sig_away, v_rep, '{"size": 2048}'),
           ('fulfilment-docs', v_sig6, v_rep, '{"size": 2048}');
  exception when others then
    v_fail := v_fail || 'fixture: the assigned rep could not upload: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- G10 another rep
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delivery_confirm(v_d[1], 'Shop manager', now(), p_signature_path => v_sig1);
    v_fail := v_fail || 'G10 another rep recorded the delivery' || E'\n';
  exception when others then
    if sqlerrm <> 'That delivery is not assigned to you.' then
      v_fail := v_fail || 'G10 refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- G4 neither
  begin
    perform public.delivery_confirm(v_d[5], 'Shop manager', now());
    v_fail := v_fail || 'G4 a drop with no signature and no photo was recorded' || E'\n';
  exception when sqlstate '22023' then
    if sqlerrm not like '%signature is needed%' then
      v_fail := v_fail || 'G4 refused as: ' || sqlerrm || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- G5 not uploaded
  begin
    perform public.delivery_confirm(v_d[5], 'Shop manager', now(),
      p_signature_path => c_gf || '/' || v_o[5] || '/' || gen_random_uuid() || '.png');
    v_fail := v_fail || 'G5 a signature that never arrived was accepted' || E'\n';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'The receiver''s signature has not arrived yet.' then
      v_fail := v_fail || 'G5 refused as: ' || sqlerrm || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- G6 another order's folder
  begin
    perform public.delivery_confirm(v_d[2], 'Shop manager', now(), p_signature_path => v_sig_away);
    v_fail := v_fail || 'G6 a signature from another order''s folder was accepted' || E'\n';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------- G1 signature only
  begin
    j := public.delivery_confirm(v_d[1], '  Shop manager  ', now(), p_signature_path => v_sig1);
    if j->>'status' <> 'delivered' or (j->>'signed')::boolean is distinct from true then
      v_fail := v_fail || 'G1 answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'G1 the signature-only drop failed: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- G2 replay
  begin
    j := public.delivery_confirm(v_d[1], 'Shop manager', now(), p_signature_path => v_sig1);
    if (j->>'already_filed')::boolean is distinct from true then
      v_fail := v_fail || 'G2 the replay answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'G2 the replay failed: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- G3 both
  begin
    perform public.delivery_confirm(v_d[3], 'Receiving clerk', now(), v_pod3, 5000, v_sig3);
  exception when others then
    v_fail := v_fail || 'G3 signature and photo failed: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- G7 an older phone
  begin
    j := public.delivery_confirm(p_dispatch_id => v_d[4], p_received_by_name => 'Old phone',
                                 p_delivered_at => now(), p_pod_path => v_pod7, p_size_bytes => 4000);
  exception when others then
    v_fail := v_fail || 'G7 a photo-only drop from an older phone failed: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- G11 warehouse first
  begin
    j := public.delivery_confirm(v_d[6], 'Phone name', now(), p_signature_path => v_sig6);
    if (j->>'already_delivered')::boolean is distinct from true then
      v_fail := v_fail || 'G11 answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'G11 the signature after the warehouse failed: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------------- G8 no direct write
  begin
    update public.dispatches set received_signature_path = v_sig1 where id = v_d[5];
    v_fail := v_fail || 'G8 a rep wrote received_signature_path' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- G1 / G2 after
  select d.status, d.received_signature_path, d.received_by_name, o.pod_status into r
    from public.dispatches d join public.orders o on o.id = d.order_id where d.id = v_d[1];
  if (r.status, r.received_signature_path, r.received_by_name, r.pod_status)
     is distinct from ('delivered', v_sig1, 'Shop manager', 'received') then
    v_fail := v_fail || 'G1 after: ' || row_to_json(r)::text || E'\n';
  end if;
  select count(*) into v_n from public.delivery_documents
   where dispatch_id = v_d[1] and doc_type = 'pod' and mime_type = 'image/png'
     and storage_path = v_sig1 and signed_by_name = 'Shop manager' and size_bytes = 2048;
  if v_n <> 1 then
    v_fail := v_fail || format('G1/G2 %s signature documents filed, expected 1', v_n) || E'\n';
  end if;
  -- G3 after
  select count(*) into v_n from public.delivery_documents where dispatch_id = v_d[3] and doc_type = 'pod';
  if v_n <> 2 or (select received_signature_path from public.dispatches where id = v_d[3]) is distinct from v_sig3 then
    v_fail := v_fail || format('G3 %s documents, signature %s', v_n,
      (select received_signature_path from public.dispatches where id = v_d[3])) || E'\n';
  end if;
  -- G7 after
  select d.status, d.received_signature_path into r from public.dispatches d where d.id = v_d[4];
  if (r.status, r.received_signature_path) is distinct from ('delivered', null) then
    v_fail := v_fail || 'G7 after: ' || row_to_json(r)::text || E'\n';
  end if;
  -- G11 after
  select d.received_signature_path, d.received_by_name into r from public.dispatches d where d.id = v_d[6];
  if (r.received_signature_path, r.received_by_name) is distinct from (v_sig6, 'Warehouse name')
     or not exists (select 1 from public.delivery_documents where storage_path = v_sig6 and doc_type = 'pod') then
    v_fail := v_fail || 'G11 after: ' || row_to_json(r)::text || E'\n';
  end if;
  -- G4-G6 left the last ones alone
  if (select count(*) from public.dispatches where id in (v_d[2], v_d[5]) and status = 'in_transit') <> 2 then
    v_fail := v_fail || 'G4-G6 a refused call moved a delivery' || E'\n';
  end if;

  ---------------------------------------------------------------- G9 grants
  if has_function_privilege('anon', 'public.delivery_confirm(uuid,text,timestamptz,text,bigint,text)', 'EXECUTE') then
    v_fail := v_fail || 'G9 anon can call delivery_confirm' || E'\n';
  end if;
  if to_regprocedure('public.delivery_confirm(uuid,text,timestamptz,text,bigint)') is not null then
    v_fail := v_fail || 'G9 the five-argument delivery_confirm is still there' || E'\n';
  end if;

  begin
    set constraints all immediate;
  exception when others then
    v_fail := v_fail || 'the deferred invoice follow-up failed: ' || sqlerrm || E'\n';
  end;

  if v_fail = '' then
    raise exception E'delivery signature suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'delivery signature suite\n%FAILED (rolled back)', v_fail;
end $$;
