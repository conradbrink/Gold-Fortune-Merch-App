-- A driver login (20261029161700).
--
--   T1  Every company has one built-in Driver job role, with no permissions,
--       and re-running provision_organization adds no second one.
--   T2  A driver profile created without a job role is put on the Driver
--       template and holds no permission (not Field Staff's workday).
--   T3  A driver takes a place, as a rep does (owner, 29 Oct 2026; was "no
--       place" until 20261029223700): billing_seats_used counts them, a pilot
--       with one place left lets one driver in, and a second is refused.
--   T4  The warehouse gives a dispatch to a driver; a manager login is still
--       refused, with the new message.
--   T5  The driver sees the dispatch given to them, its lines, its order and
--       its contents, and nothing given to somebody else: not the other
--       dispatch, not its order, and no order lines (prices) at all.
--   T6  The driver files the POD photo and records the drop; the same photo
--       under the other dispatch's order is refused, and so is recording it.
--   T7  The driver cannot place an order (orders_insert is for reps), and holds
--       neither the warehouse nor the workday permission.
--   T8  An administrator can make a custom job role on the driver base role;
--       an unknown base role is still refused.
--   T9  profiles.role still refuses a value that is not a role.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives (the auth user, the storage rows and the orders included; no file
-- is uploaded). The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_wh uuid; v_rep uuid; v_mgr uuid; v_admin uuid; v_driver uuid := gen_random_uuid(); v_driver2 uuid := gen_random_uuid();
  v_loc uuid; v_store uuid; v_prod uuid;
  v_o1 uuid; v_o2 uuid; v_l1 uuid; v_l2 uuid; v_d1 uuid; v_d2 uuid;
  v_pod1 text; v_pod2 text; v_seats int; v_reps int; v_n int; v_ok boolean; v_msg text;
  v_template uuid; j jsonb; r record;
begin
  select id into v_wh from public.profiles
   where org_id = c_gf and role in ('warehouse', 'manager') and is_active
   order by (role = 'warehouse') desc, created_at, id limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by full_name, id limit 1;
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at, id limit 1;
  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'admin'
   where p.org_id = c_gf and p.is_active order by p.created_at, p.id limit 1;
  if v_wh is null or v_rep is null or v_mgr is null or v_admin is null then
    raise exception 'Fixtures missing: warehouse %, rep %, manager %, admin %', v_wh, v_rep, v_mgr, v_admin;
  end if;

  ---------------------------------------------------------------- T1 the template
  select count(*) into v_n from public.organizations o
   where (select count(*) from public.job_roles jr
           where jr.org_id = o.id and jr.code = 'driver' and jr.is_system and jr.base_role = 'driver') <> 1;
  if v_n > 0 then
    v_fail := v_fail || format('T1 %s companies do not have exactly one Driver template', v_n) || E'\n';
  end if;
  if exists (select 1 from public.job_role_permissions jrp
               join public.job_roles jr on jr.id = jrp.job_role_id
              where jr.code = 'driver' and jr.is_system) then
    v_fail := v_fail || 'T1 a Driver template carries a permission' || E'\n';
  end if;
  perform public.provision_organization(c_gf);
  select count(*) into v_n from public.job_roles where org_id = c_gf and code = 'driver';
  if v_n <> 1 then
    v_fail := v_fail || format('T1 provisioning again left %s Driver templates', v_n) || E'\n';
  end if;
  select id into v_template from public.job_roles where org_id = c_gf and code = 'driver';

  ---------------------------------------------------------------- T2 a new driver
  select count(*) into v_reps from public.profiles where org_id = c_gf and is_active and role = 'rep';
  v_seats := public.billing_seats_used(c_gf, public.billing_plan(1, '{}'::jsonb));
  -- On a pilot with exactly one place left (T3): the reps it has now, and one.
  update public.company_account set status = 'trial', plan = null, trial_ends_at = now() + interval '10 days'
   where org_id = c_gf;
  update public.platform_settings set value = to_jsonb(v_reps + 1) where key = 'trial_user_limit';

  insert into auth.users (id) values (v_driver);
  begin
    insert into public.profiles (id, org_id, role, full_name, email, is_active)
    values (v_driver, c_gf, 'driver', 'ZZ Driver', 'zz.driver@example.invalid', true);
  exception when others then
    v_fail := v_fail || 'T3 a driver could not take the last place on a pilot: ' || sqlerrm || E'\n';
    raise exception E'driver role suite\n%FAILED (rolled back)', v_fail;
  end;
  select job_role_id into r from public.profiles where id = v_driver;
  if r.job_role_id is distinct from v_template then
    v_fail := v_fail || 'T2 the driver was not put on the Driver template' || E'\n';
  end if;
  select count(*) into v_n from public.profile_permissions where profile_id = v_driver;
  if v_n <> 0 then
    v_fail := v_fail || format('T2 the driver holds %s permissions', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- T3 a place taken
  if public.billing_seats_used(c_gf, public.billing_plan(1, '{}'::jsonb)) <> v_seats + 1 then
    v_fail := v_fail || 'T3 the driver did not take a place' || E'\n';
  end if;
  -- The pilot is full now: a second driver is refused, as a rep would be.
  insert into auth.users (id) values (v_driver2);
  begin
    insert into public.profiles (id, org_id, role, full_name, email, is_active)
    values (v_driver2, c_gf, 'driver', 'ZZ Driver Two', 'zz.driver2@example.invalid', true);
    v_fail := v_fail || 'T3 a second driver was let onto a full pilot' || E'\n';
  exception when others then
    if sqlerrm not like 'All % places on your plan are taken.' then
      v_fail := v_fail || 'T3 the second driver was refused for another reason: ' || sqlerrm || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- fixtures: two dispatches
  insert into public.stock_locations (org_id, name, type)
  values (c_gf, 'ZZ driver test', 'warehouse') returning id into v_loc;
  insert into public.products (org_id, name) values (c_gf, 'ZZ driver product') returning id into v_prod;
  insert into public.stores (org_id, name, city) values (c_gf, 'ZZ driver store', 'ZZ Town') returning id into v_store;
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, 100, v_loc, 'available', 'opening_stock', 'system');
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-DRV-1', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o1;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-DRV-2', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'packed') returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o1, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, qty_picked, client_generated_id)
  values (c_gf, v_o2, v_prod, 10, 10, 10, gen_random_uuid()) returning id into v_l2;
  insert into public.order_allocations (org_id, order_id, order_line_id, location_id, batch_id, qty_reserved, qty_picked, status)
  values (c_gf, v_o1, v_l1, v_loc, null, 10, 10, 'picked'),
         (c_gf, v_o2, v_l2, v_loc, null, 10, 10, 'picked');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type, source_doc_id)
  values (c_gf, v_prod, 20, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_o1);

  ---------------------------------------------------------------- T4 the warehouse assigns
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_d1 := (public.order_dispatch(p_order_id => v_o1, p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  v_d2 := (public.order_dispatch(p_order_id => v_o2, p_carrier_name => 'ZZ van')->>'dispatch_id')::uuid;
  begin
    perform public.assign_dispatch_rep(v_d1, v_driver);
  exception when others then
    v_fail := v_fail || 'T4 the warehouse could not give a delivery to a driver: ' || sqlerrm || E'\n';
  end;
  begin
    perform public.assign_dispatch_rep(v_d2, v_rep);
  exception when others then
    v_fail := v_fail || 'T4 the warehouse could not give a delivery to a rep: ' || sqlerrm || E'\n';
  end;
  begin
    perform public.assign_dispatch_rep(v_d2, v_mgr);
    v_fail := v_fail || 'T4 a delivery was given to a manager' || E'\n';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%only field staff and drivers use the app.' then
      v_fail := v_fail || 'T4 a manager refused as: ' || v_msg || E'\n';
    end if;
  end;
  reset role;
  if (select assigned_rep_id from public.dispatches where id = v_d1) is distinct from v_driver
     or (select assigned_rep_id from public.dispatches where id = v_d2) is distinct from v_rep then
    v_fail := v_fail || 'T4 the assignments did not stick' || E'\n';
  end if;
  -- Out since yesterday, so a drop pressed now is after it.
  update public.dispatches set dispatched_at = now() - interval '1 day' where id in (v_d1, v_d2);

  v_pod1 := c_gf || '/' || v_o1 || '/' || gen_random_uuid() || '.jpg';
  v_pod2 := c_gf || '/' || v_o2 || '/' || gen_random_uuid() || '.jpg';

  ---------------------------------------------------------------- T5 what the driver sees
  perform set_config('request.jwt.claims', json_build_object('sub', v_driver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.current_role() is distinct from 'driver' then
    v_fail := v_fail || 'T5 current_role() is ' || coalesce(public.current_role(), 'null') || E'\n';
  end if;
  select count(*) into v_n from public.dispatches where id in (v_d1, v_d2);
  if v_n <> 1 or not exists (select 1 from public.dispatches where id = v_d1) then
    v_fail := v_fail || format('T5 the driver sees %s of the two dispatches', v_n) || E'\n';
  end if;
  if not exists (select 1 from public.dispatch_lines where dispatch_id = v_d1)
     or exists (select 1 from public.dispatch_lines where dispatch_id = v_d2) then
    v_fail := v_fail || 'T5 dispatch lines: the driver''s are hidden or the other''s show' || E'\n';
  end if;
  if not exists (select 1 from public.orders where id = v_o1)
     or exists (select 1 from public.orders where id = v_o2) then
    v_fail := v_fail || 'T5 orders: the driver''s is hidden or the other''s shows' || E'\n';
  end if;
  if exists (select 1 from public.order_lines where order_id in (v_o1, v_o2)) then
    v_fail := v_fail || 'T5 the driver reads order lines (prices)' || E'\n';
  end if;
  if not exists (select 1 from public.stores where id = v_store and city = 'ZZ Town') then
    v_fail := v_fail || 'T5 the driver cannot read the store''s town' || E'\n';
  end if;
  begin
    select count(*) into v_n from public.delivery_contents(v_d1);
    if v_n <> 1 then
      v_fail := v_fail || format('T5 delivery_contents gave %s lines', v_n) || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'T5 delivery_contents refused the driver: ' || sqlerrm || E'\n';
  end;
  begin
    perform public.delivery_contents(v_d2);
    v_fail := v_fail || 'T5 the driver read the contents of somebody else''s delivery' || E'\n';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------- T6 the drop
  begin
    insert into storage.objects (bucket_id, name, owner) values ('fulfilment-docs', v_pod2, v_driver);
    v_fail := v_fail || 'T6 the driver filed a photo under somebody else''s order' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('fulfilment-docs', v_pod1, v_driver);
  exception when others then
    v_fail := v_fail || 'T6 the driver could not file the POD photo: ' || sqlerrm || E'\n';
  end;
  begin
    j := public.delivery_confirm(v_d1, 'Shop manager', now(), v_pod1, 1000);
    if j->>'status' <> 'delivered' then
      v_fail := v_fail || 'T6 answered ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'T6 the driver could not record the drop: ' || sqlerrm || E'\n';
  end;
  begin
    perform public.delivery_confirm(v_d2, 'Shop manager', now(), v_pod2, 1000);
    v_fail := v_fail || 'T6 the driver recorded somebody else''s delivery' || E'\n';
  exception when others then
    if sqlerrm <> 'That delivery is not assigned to you.' then
      v_fail := v_fail || 'T6 the other delivery refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- T7 nothing else
  begin
    insert into public.orders (org_id, order_number, store_id, rep_id, source, client_generated_id)
    values (c_gf, 'ZZ-DRV-3', v_store, v_driver, 'rep_app', gen_random_uuid());
    v_fail := v_fail || 'T7 the driver placed an order' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if public.has_permission('warehouse') or public.has_permission('workday') then
    v_fail := v_fail || 'T7 the driver holds the warehouse or workday permission' || E'\n';
  end if;
  reset role;
  select d.status, d.delivered_by, o.status as ostatus, o.pod_status into r
    from public.dispatches d join public.orders o on o.id = d.order_id where d.id = v_d1;
  if (r.status, r.delivered_by, r.ostatus, r.pod_status)
     is distinct from ('delivered', v_driver, 'delivered', 'received') then
    v_fail := v_fail || 'T6 after: ' || row_to_json(r)::text || E'\n';
  end if;
  if (select status from public.dispatches where id = v_d2) <> 'in_transit' then
    v_fail := v_fail || 'T6 the other delivery moved' || E'\n';
  end if;

  ---------------------------------------------------------------- T8 custom driver roles
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.save_job_role(null, 'ZZ Relief driver', null, 'driver', true, '{}');
  exception when others then
    v_fail := v_fail || 'T8 an administrator could not make a driver job role: ' || sqlerrm || E'\n';
  end;
  begin
    perform public.save_job_role(null, 'ZZ Nonsense', null, 'pilot', true, '{}');
    v_fail := v_fail || 'T8 an unknown base role was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  reset role;

  ---------------------------------------------------------------- T9 the check
  begin
    update public.profiles set role = 'pilot' where id = v_driver;
    v_fail := v_fail || 'T9 profiles.role took a value that is not a role' || E'\n';
  exception when check_violation then null;
  end;

  -- The deferred invoice follow-up on the drop, as in driver_pod D12.
  begin
    set constraints all immediate;
  exception when others then
    v_fail := v_fail || 'T6 the deferred invoice follow-up failed: ' || sqlerrm || E'\n';
  end;

  if v_fail = '' then
    raise exception E'driver role suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'driver role suite\n%FAILED (rolled back)', v_fail;
end $$;
