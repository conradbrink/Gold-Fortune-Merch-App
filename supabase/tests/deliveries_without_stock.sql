-- Deliveries without stock: 20261029224700_deliveries_in_the_plan.
--
-- Run on Gold Fortune with Stock control (`warehouse`) switched off inside the
-- block and Deliveries on: a distributor on the normal plan, no add-on.
--
--   D1  Invoicing a new order confirms it: one invoice, no location, nothing
--       sent yet, nothing reserved, no POD asked for.
--   D2  Dispatching it (a courier; no driver row needed) sends every live line
--       in full: a dispatch with no locations, lines with no allocation or
--       batch, the order dispatched, no stock moved, no credit note. A
--       cancelled line stays behind.
--   D3  Given to a rep, the rep reads what is in it and records the drop on
--       the phone with a signature: delivered, POD received, each line
--       fulfilled, nothing moved, the invoice untouched.
--   D4  A failed delivery puts the order back to confirmed (nothing reserved,
--       nothing sent); it goes out again; a second failure with "cancel"
--       cancels it and voids its invoice.
--   D5  The office records a delivery short: the line is partial, what came
--       back is recorded, nothing is moved, and the invoice is credited.
--   D6  Cancelling: a confirmed order is cancelled and its invoice voided,
--       with "Invoice every order" on (the follow trigger) and off (the
--       cancel itself); off, an invoice with a payment is refused; an order
--       out for delivery is refused with its own message.
--   D7  The rules stay shut: a stock order cannot skip picking, nor drop its
--       location to do so; nothing comes
--       back to confirmed but through order_return_undelivered; an order with
--       no location cannot be picked; a new order cannot be dispatched.
--   D8  Deliveries off: dispatching is refused with the plan message, and
--       invoicing finishes the order as delivered (#234's one step).
--   D9  The catalogue: Deliveries is an edition module needing Distribution;
--       Stock control needs Deliveries; every company with Distribution has it
--       on; the Distribution template brings Deliveries, not Stock control; the
--       add-on is called Stock control.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives (the storage rows it writes
-- included). `set constraints all immediate` fires the deferred invoice
-- trigger at each statement, as at each commit.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_info text := '';
  v_checks int := 0;
  v_admin uuid; v_rep uuid; v_store uuid; v_p1 uuid; v_p2 uuid; v_loc uuid;
  v_o uuid[] := '{}'; v_l uuid[] := '{}'; v_id uuid; v_line uuid; v_dsp uuid; v_dsp2 uuid;
  v_res jsonb; v_err text; v_sig text; v_n int; v_movements int; i int;
  r record;
  v_tag text := 'ZZ-DL-' || left(md5(random()::text), 5);
begin
  set constraints all immediate;

  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
     and not exists (select 1 from public.profile_permissions pp
                      where pp.profile_id = p.id and pp.permission_code in ('admin', 'warehouse'))
   order by p.created_at, p.id limit 1;
  select s.id into v_store from public.stores s where s.org_id = c_gf and s.active order by s.created_at limit 1;
  if v_admin is null or v_rep is null or v_store is null then
    raise exception 'Fixtures missing: admin %, rep %, store %', v_admin, v_rep, v_store;
  end if;

  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'warehouse';
  get diagnostics v_n = row_count;
  if v_n <> 1 or not exists (select 1 from public.company_modules
                              where org_id = c_gf and module_code = 'deliveries' and enabled) then
    raise exception 'Fixtures broken: Gold Fortune needs a warehouse row to switch off and Deliveries on';
  end if;
  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_invoice_orders';
  select count(*) into v_movements from public.stock_movements where org_id = c_gf;

  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, v_tag || ' product one', 1, 10) returning id into v_p1;
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, v_tag || ' product two', 1, 20) returning id into v_p2;

  -- Seven orders of 10 x p1 at 12.50; the first also has a cancelled line.
  for i in 1..7 loop
    insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, client_generated_id)
    values (c_gf, v_tag || '-' || i, v_store, v_rep, 'warehouse_manual', 'other', gen_random_uuid())
    returning id into v_id;
    insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
    values (c_gf, v_id, v_p1, 10, 12.50, gen_random_uuid()) returning id into v_line;
    v_o := v_o || v_id;
    v_l := v_l || v_line;
  end loop;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id, line_status)
  values (c_gf, v_o[1], v_p2, 3, 7, gen_random_uuid(), 'cancelled');

  ---------------------------------------------------------------- D1 invoiced, confirmed
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..6 loop
    begin
      v_res := public.order_invoice_without_stock(v_o[i]);
      if v_res->>'status' <> 'confirmed' then
        v_fail := v_fail || format('D1 order %s came back %s', i, v_res->>'status') || E'\n';
      end if;
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_fail := v_fail || format('D1 order %s could not be invoiced: %s', i, v_err) || E'\n';
    end;
  end loop;
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.orders where id = v_o[1];
  if (r.status, r.confirmed_by, r.pod_status) is distinct from ('confirmed', v_admin, 'not_required')
     or r.fulfil_location_id is not null or r.dispatched_at is not null or r.delivered_at is not null
     or r.invoice_number is null then
    v_fail := v_fail || format('D1 the order is %s by %s, POD %s, location %s, invoice %s',
      r.status, r.confirmed_by, r.pod_status, r.fulfil_location_id, r.invoice_number) || E'\n';
  end if;
  v_checks := v_checks + 1;
  if (select count(*) from public.tax_invoices where order_id = v_o[1] and status = 'issued') <> 1
     or (select sum(qty) from public.tax_invoice_lines tl join public.tax_invoices t on t.id = tl.invoice_id
          where t.order_id = v_o[1] and t.status = 'issued') <> 10
     or exists (select 1 from public.order_lines where order_id = v_o[1]
                 and (qty_dispatched, qty_delivered, qty_reserved) <> (0, 0, 0))
     or exists (select 1 from public.order_allocations where order_id = any (v_o)) then
    v_fail := v_fail || 'D1 not one invoice of 10, or a line was sent or reserved' || E'\n';
  end if;

  ---------------------------------------------------------------- D2 dispatched
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_res := public.order_dispatch(p_order_id => v_o[1], p_carrier_name => v_tag || ' courier');
    v_dsp := (v_res->>'dispatch_id')::uuid;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D2 the order could not be dispatched: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.dispatches where id = v_dsp;
  if r.id is null or r.status <> 'in_transit' or r.dispatch_location_id is not null
     or r.transit_location_id is not null
     or (v_res->>'lines')::int <> 1 or (v_res->>'units')::int <> 10 then
    v_fail := v_fail || format('D2 dispatch %s, from %s via %s, %s lines %s units',
      r.status, r.dispatch_location_id, r.transit_location_id, v_res->>'lines', v_res->>'units') || E'\n';
  end if;
  v_checks := v_checks + 1;
  if (select status from public.orders where id = v_o[1]) <> 'dispatched'
     or (select count(*) from public.dispatch_lines
          where dispatch_id = v_dsp and order_line_id = v_l[1] and qty = 10
            and order_allocation_id is null and batch_id is null) <> 1
     or (select count(*) from public.dispatch_lines where dispatch_id = v_dsp) <> 1
     or (select qty_dispatched from public.order_lines where id = v_l[1]) <> 10
     or exists (select 1 from public.order_lines where order_id = v_o[1] and line_status = 'cancelled' and qty_dispatched <> 0)
     or exists (select 1 from public.credit_notes c join public.tax_invoices t on t.id = c.invoice_id where t.order_id = v_o[1]) then
    v_fail := v_fail || 'D2 the order, its lines or its invoice are not as sent in full' || E'\n';
  end if;

  ---------------------------------------------------------------- D3 delivered on the phone
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.assign_dispatch_rep(v_dsp, v_rep);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D3 the delivery could not be given to the rep: ' || v_err || E'\n';
  end;
  reset role;
  v_sig := c_gf || '/' || v_o[1] || '/' || gen_random_uuid() || '.png';
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    select count(*), sum(qty) into v_n, i from public.delivery_contents(v_dsp);
    if v_n <> 1 or i <> 10 then
      v_fail := v_fail || format('D3 the rep reads %s lines, %s units', v_n, i) || E'\n';
    end if;
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('fulfilment-docs', v_sig, v_rep, '{"size": 2048}');
    v_res := public.delivery_confirm(v_dsp, 'Shop manager', now(), p_signature_path => v_sig);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D3 the rep could not record the drop: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.orders where id = v_o[1];
  if (r.status, r.pod_status) is distinct from ('delivered', 'received')
     or (select (status, received_signature_path, received_by_name) from public.dispatches where id = v_dsp)
        is distinct from ('delivered'::text, v_sig, 'Shop manager'::text)
     or (select (qty_delivered, qty_returned, line_status) from public.order_lines where id = v_l[1])
        is distinct from (10, 0, 'fulfilled'::text) then
    v_fail := v_fail || format('D3 the order is %s, POD %s, or its dispatch or line is not delivered in full',
      r.status, r.pod_status) || E'\n';
  end if;
  v_checks := v_checks + 1;
  if exists (select 1 from public.credit_notes c join public.tax_invoices t on t.id = c.invoice_id where t.order_id = v_o[1])
     or (select count(*) from public.tax_invoices where order_id = v_o[1] and status = 'issued') <> 1 then
    v_fail := v_fail || 'D3 the invoice was credited or voided on a full delivery' || E'\n';
  end if;

  ---------------------------------------------------------------- D4 failed, again, cancelled
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_dsp := (public.order_dispatch(p_order_id => v_o[2], p_carrier_name => 'ZZ courier')->>'dispatch_id')::uuid;
    v_res := public.order_return_undelivered(v_dsp, 'Shop was closed');
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D4 the failed delivery could not be recorded: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  if v_res->>'status' <> 'confirmed'
     or (select status from public.orders where id = v_o[2]) <> 'confirmed'
     or (select dispatched_at from public.orders where id = v_o[2]) is not null
     or (select (status, failure_reason) from public.dispatches where id = v_dsp) is distinct from ('returned'::text, 'Shop was closed'::text)
     or (select (qty_dispatched, qty_reserved, qty_picked, line_status) from public.order_lines where id = v_l[2])
        is distinct from (0, 0, 0, 'open'::text)
     or exists (select 1 from public.credit_notes c join public.tax_invoices t on t.id = c.invoice_id where t.order_id = v_o[2]) then
    v_fail := v_fail || format('D4 after the failure the order is %s; its line or invoice moved', v_res->>'status') || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_dsp2 := (public.order_dispatch(p_order_id => v_o[2], p_carrier_name => 'ZZ courier')->>'dispatch_id')::uuid;
    v_res := public.order_return_undelivered(v_dsp2, 'Shop closed down', true);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D4 the second dispatch or the cancel failed: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  if v_res->>'status' <> 'cancelled'
     or (select (status, cancel_reason) from public.orders where id = v_o[2]) is distinct from ('cancelled'::text, 'Shop closed down'::text)
     or (select (qty_dispatched, qty_reserved, line_status) from public.order_lines where id = v_l[2])
        is distinct from (0, 0, 'cancelled'::text)
     or exists (select 1 from public.tax_invoices where order_id = v_o[2] and status = 'issued') then
    v_fail := v_fail || 'D4 the order was not cancelled with its line, or its invoice still stands' || E'\n';
  end if;

  ---------------------------------------------------------------- D5 delivered short
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_dsp := (public.order_dispatch(p_order_id => v_o[3], p_carrier_name => 'ZZ courier')->>'dispatch_id')::uuid;
    select id into v_id from public.dispatch_lines where dispatch_id = v_dsp;
    v_res := public.order_mark_delivered(v_dsp, 'Office', null,
               jsonb_build_array(jsonb_build_object('dispatch_line_id', v_id, 'qty_delivered', 8)));
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D5 the short delivery could not be recorded: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  if (select (status, pod_status) from public.orders where id = v_o[3]) is distinct from ('delivered'::text, 'outstanding'::text)
     or (select (qty_delivered, qty_returned, line_status) from public.order_lines where id = v_l[3])
        is distinct from (8, 2, 'partial'::text)
     or not exists (select 1 from public.credit_notes c join public.tax_invoices t on t.id = c.invoice_id
                     where t.order_id = v_o[3]) then
    v_fail := v_fail || 'D5 the short delivery is not recorded, or the invoice was not credited' || E'\n';
  end if;
  -- How much was credited for 2 not taken. Reported, not judged: the follow
  -- trigger's rule for a delivered order predates this migration.
  select sum(cl.qty) into v_n from public.credit_note_lines cl
    join public.credit_notes c on c.id = cl.credit_note_id
    join public.tax_invoices t on t.id = c.invoice_id where t.order_id = v_o[3];
  v_info := v_info || format('  D5 credited %s of the 2 not delivered', v_n) || E'\n';

  ---------------------------------------------------------------- D6 cancelling
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o[4], 'Customer changed their mind');
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D6 a confirmed order could not be cancelled: ' || v_err || E'\n';
  end;
  reset role;
  if (select status from public.orders where id = v_o[4]) <> 'cancelled'
     or exists (select 1 from public.tax_invoices where order_id = v_o[4] and status = 'issued')
     or not exists (select 1 from public.tax_invoices where order_id = v_o[4] and status = 'void') then
    v_fail := v_fail || 'D6 (setting on) not cancelled, or its invoice not voided' || E'\n';
  end if;

  update public.company_settings set value = 'false'::jsonb where org_id = c_gf and key = 'money_invoice_orders';
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on)
  select c_gf, t.id, 1, current_date from public.tax_invoices t where t.order_id = v_o[6] and t.status = 'issued';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o[5], 'Wrong shop');
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D6 (setting off) a confirmed order could not be cancelled: ' || v_err || E'\n';
  end;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o[6], 'Wrong shop');
    v_fail := v_fail || 'D6 (setting off) an order with a paid invoice was cancelled' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '% has payments or credit notes against it.%' then
      v_fail := v_fail || 'D6 paid invoice refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  begin
    v_dsp := (public.order_dispatch(p_order_id => v_o[6], p_carrier_name => 'ZZ courier')->>'dispatch_id')::uuid;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D6 the paid order could not be dispatched: ' || v_err || E'\n';
  end;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o[6], 'Wrong shop');
    v_fail := v_fail || 'D6 an order out for delivery was cancelled' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Order % is out for delivery. Record the delivery as failed, and cancel it there.' then
      v_fail := v_fail || 'D6 out for delivery refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  if (select status from public.orders where id = v_o[5]) <> 'cancelled'
     or (select invoice_number from public.orders where id = v_o[5]) is not null
     or exists (select 1 from public.tax_invoices where order_id = v_o[5] and status = 'issued') then
    v_fail := v_fail || 'D6 (setting off) not cancelled, or its invoice not voided' || E'\n';
  end if;
  if (select status from public.orders where id = v_o[6]) <> 'dispatched' then
    v_fail := v_fail || 'D6 a refused cancel changed the order out for delivery' || E'\n';
  end if;
  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_invoice_orders';

  ---------------------------------------------------------------- D7 the rules
  insert into public.stock_locations (org_id, name, type) values (c_gf, v_tag || ' shelf', 'warehouse')
  returning id into v_loc;
  v_checks := v_checks + 1;
  begin
    -- A stock order, confirmed with a location, cannot go straight out.
    update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_o[7];
    update public.orders set status = 'dispatched' where id = v_o[7];
    v_fail := v_fail || 'D7 an order with a location skipped picking and packing' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'An order cannot go from confirmed to dispatched.' then
      v_fail := v_fail || 'D7 skipping picking refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    -- Nor by losing its location in the same statement.
    update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_o[7];
    update public.orders set status = 'dispatched', fulfil_location_id = null where id = v_o[7];
    v_fail := v_fail || 'D7 a stock order dropped its location and skipped picking' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'An order cannot go from confirmed to dispatched.' then
      v_fail := v_fail || 'D7 dropping the location refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    update public.orders set status = 'confirmed' where id = v_o[6];
    v_fail := v_fail || 'D7 an order came back from dispatched without order_return_undelivered' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Take a dispatched order back through order_return_undelivered()%' then
      v_fail := v_fail || 'D7 coming back refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    update public.orders set status = 'confirmed' where id = v_o[7] and status = 'new';
    update public.orders set status = 'picking' where id = v_o[7];
    v_fail := v_fail || 'D7 an order with no location was picked' || E'\n';
  exception
    when check_violation then null;
    when others then
      get stacked diagnostics v_err = message_text;
      v_fail := v_fail || 'D7 picking with no location refused for another reason: ' || v_err || E'\n';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_dispatch(p_order_id => v_o[7], p_carrier_name => 'ZZ courier');
    v_fail := v_fail || 'D7 a new order was dispatched' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Order % is new, not invoiced and ready to go.' then
      v_fail := v_fail || 'D7 dispatching a new order refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;

  ---------------------------------------------------------------- D8 deliveries off
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'deliveries';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_dispatch(p_order_id => v_o[7], p_carrier_name => 'ZZ courier');
    v_fail := v_fail || 'D8 dispatched with Deliveries off' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%not enabled for your company''s plan' then
      v_fail := v_fail || 'D8 dispatch refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    v_res := public.order_invoice_without_stock(v_o[7]);
    if v_res->>'status' <> 'delivered'
       or (select (status, pod_status) from public.orders where id = v_o[7]) is distinct from ('delivered'::text, 'not_required'::text) then
      v_fail := v_fail || 'D8 with Deliveries off the order was not finished as delivered' || E'\n';
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'D8 with Deliveries off the order could not be invoiced: ' || v_err || E'\n';
  end;
  reset role;
  update public.company_modules set enabled = true where org_id = c_gf and module_code = 'deliveries';

  -- Not one stock movement anywhere in the company, from any of it.
  v_checks := v_checks + 1;
  if (select count(*) from public.stock_movements where org_id = c_gf) <> v_movements then
    v_fail := v_fail || 'D2-D8 stock was moved' || E'\n';
  end if;

  ---------------------------------------------------------------- D9 the catalogue
  v_checks := v_checks + 1;
  if (select (plan_type, is_built) from public.modules where code = 'deliveries') is distinct from ('edition'::text, true)
     or (select name from public.modules where code = 'warehouse') <> 'Stock control'
     or not exists (select 1 from public.module_dependencies where module_code = 'deliveries' and requires_code = 'distribution')
     or not exists (select 1 from public.module_dependencies where module_code = 'warehouse' and requires_code = 'deliveries')
     or exists (select 1 from public.company_modules d where d.module_code = 'distribution' and d.enabled
                 and not exists (select 1 from public.company_modules x
                                  where x.org_id = d.org_id and x.module_code = 'deliveries'))
     or not exists (select 1 from public.template_modules where template_code = 'distribution' and module_code = 'deliveries')
     or exists (select 1 from public.template_modules where template_code = 'distribution' and module_code = 'warehouse')
     or exists (select 1 from public.price_list where code = 'warehouse' and label not like 'Stock control%') then
    v_fail := v_fail || 'D9 the catalogue, the switches, the template or the price list are not as described' || E'\n';
  end if;

  if v_fail = '' then
    raise exception E'deliveries_without_stock: ALL PASS (% checks)\n%', v_checks, v_info;
  end if;
  raise exception E'deliveries_without_stock: FAIL\n%\n%', v_fail, v_info;
end;
$$;
