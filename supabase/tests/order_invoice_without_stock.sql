-- Orders without the warehouse module: 20261029203300_invoice_orders_without_stock.
--
-- Run on Gold Fortune with its warehouse module switched off inside the block
-- (the company in question: orders and invoicing, no stock).
--
--   W1  Someone without the Orders permission cannot invoice an order.
--   W2  The administrator invoices a new order and it is finished: delivered
--       by them, no POD asked for, no location, never dispatched; each live
--       line sent and delivered in full (a cancelled line untouched); one
--       invoice from the order, linked both ways, at the quantities ordered
--       and its prices, totals at the order's VAT rate; no stock reserved or
--       moved; no credit note. With a rule that applies, commission is due.
--   W3  A second press is refused and issues nothing more.
--   W4  Refused, changing nothing: an unpriced line, an order with nothing
--       live on it.
--   W5  An order with a QuickBooks number is finished with no second invoice.
--   W6  A held order is finished, its hold released.
--   W7  With "Invoice every order" off, it still invoices, exactly once.
--   W8  Its invoice voided, the order is invoiced again by tax_invoice_issue.
--   W9  Cancelling: white space is no reason; a new order is cancelled with
--       its reason tidied and its lines cancelled; an invoiced one is refused
--       with the credit-note message; a rep without the Orders permission
--       cannot cancel.
--   W10 With the warehouse module on, both are refused with the "keeps stock"
--       message, changing nothing.
--   W11 The rules it bends stay shut to everything else: new -> delivered
--       without the function is refused, and a confirmed order still needs a
--       location.
--   W12 Both functions keep their security: definer, a fixed search_path, no
--       execute for anon or PUBLIC, and a Distribution module row each.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. `set constraints all immediate`
-- fires the deferred invoice trigger at each statement, as at each commit.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_admin uuid; v_rep uuid; v_store uuid; v_p0 uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_order uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid; v_o2 uuid; v_n int;
  v_res jsonb; v_err text; v_inv public.tax_invoices; t record; r record;
  v_tag text := 'ZZ-NS-' || left(md5(random()::text), 5);
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
  select p.id into v_p1 from public.products p where p.org_id = c_gf order by p.created_at, p.id limit 1;
  select p.id into v_p2 from public.products p where p.org_id = c_gf and p.id <> v_p1 order by p.created_at, p.id limit 1;
  select p.id into v_p3 from public.products p where p.org_id = c_gf and p.id not in (v_p1, v_p2) order by p.created_at, p.id limit 1;
  if v_admin is null or v_rep is null or v_store is null or v_p3 is null then
    raise exception 'Fixtures missing: admin %, rep %, store %, product %', v_admin, v_rep, v_store, v_p3;
  end if;

  -- The company in question: no warehouse. Anything depending on it goes
  -- off first, or the dependency guard refuses.
  update public.company_modules cm set enabled = false
    from public.module_dependencies d
   where cm.org_id = c_gf and cm.module_code = d.module_code and d.requires_code = 'warehouse' and cm.enabled;
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'warehouse';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Fixtures broken: Gold Fortune has no warehouse module row to switch off';
  end if;
  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_invoice_orders';

  -- A product with no price anywhere: a line saved with no price takes the
  -- store's (20261015210000), so only a product with none stays unpriced.
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, v_tag || ' unpriced product', 10, null) returning id into v_p0;

  insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, client_generated_id)
  values (c_gf, v_tag || '-1', v_store, v_rep, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_order;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p1, 10, 12.50, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, discount_pct, client_generated_id)
  values (c_gf, v_order, v_p2, 4, 100, 10, gen_random_uuid()) returning id into v_l2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p3, 3, 7, gen_random_uuid()) returning id into v_l3;
  update public.order_lines set line_status = 'cancelled' where id = v_l3;

  ---------------------------------------------------------------- W1 no permission
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_invoice_without_stock(v_order);
    v_fail := v_fail || 'W1 a rep without the Orders permission invoiced an order' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'Invoicing an order needs the Orders permission.' then
      v_fail := v_fail || 'W1 refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;

  ---------------------------------------------------------------- W2 invoiced and finished
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_res := public.order_invoice_without_stock(v_order);
  exception when others then
    get stacked diagnostics v_err = message_text;
    -- Reported, not raised: the rest of the suite still says what else broke.
    v_fail := v_fail || 'W2 the administrator could not invoice the order: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.orders where id = v_order;
  if (r.status, r.delivered_by, r.confirmed_by, r.pod_status) is distinct from ('delivered', v_admin, v_admin, 'not_required')
     or r.delivered_at is null or r.fulfil_location_id is not null or r.dispatched_at is not null or r.on_hold then
    v_fail := v_fail || format('W2 the order is %s, delivered by %s, POD %s, location %s, dispatched %s',
      r.status, r.delivered_by, r.pod_status, r.fulfil_location_id, r.dispatched_at) || E'\n';
  end if;
  select count(*) filter (where id in (v_l1, v_l2) and qty_dispatched = qty_ordered and qty_delivered = qty_ordered
                                and line_status = 'fulfilled') as done,
         count(*) filter (where id = v_l3 and line_status = 'cancelled' and qty_dispatched = 0 and qty_delivered = 0) as left_alone
    into t from public.order_lines where order_id = v_order;
  if (t.done, t.left_alone) is distinct from (2::bigint, 1::bigint) then
    v_fail := v_fail || format('W2 lines: %s finished in full, cancelled one untouched %s', t.done, t.left_alone) || E'\n';
  end if;
  select * into v_inv from public.tax_invoices where order_id = v_order and status = 'issued';
  if v_inv.id is null or v_inv.source <> 'order' or r.invoice_number is distinct from v_inv.invoice_number
     or (v_res->>'invoice_id')::uuid is distinct from v_inv.id
     or (select count(*) from public.tax_invoices where order_id = v_order) <> 1 then
    v_fail := v_fail || 'W2 not exactly one invoice from the order, linked both ways: ' || coalesce(v_res::text, 'no answer') || E'\n';
  end if;
  select count(*) as n,
         count(*) filter (where order_line_id = v_l1 and qty = 10 and unit_price = 12.50) as a,
         count(*) filter (where order_line_id = v_l2 and qty = 4) as b,
         count(*) filter (where order_line_id = v_l3) as c,
         sum(line_total) as total
    into t from public.tax_invoice_lines where invoice_id = v_inv.id;
  if (t.n, t.a, t.b, t.c) is distinct from (2::bigint, 1::bigint, 1::bigint, 0::bigint) then
    v_fail := v_fail || format('W2 invoice lines: %s lines, l1 %s, l2 %s, cancelled %s', t.n, t.a, t.b, t.c) || E'\n';
  end if;
  select * into r from public.money_totals(coalesce(t.total, 0), (select vat_rate from public.orders where id = v_order), false);
  if (v_inv.subtotal, v_inv.vat, v_inv.total) is distinct from (r.subtotal, r.vat, r.total) then
    v_fail := v_fail || format('W2 totals %s/%s/%s, expected %s/%s/%s',
      v_inv.subtotal, v_inv.vat, v_inv.total, r.subtotal, r.vat, r.total) || E'\n';
  end if;
  if exists (select 1 from public.stock_movements where source_doc_id = v_order)
     or exists (select 1 from public.order_allocations where order_id = v_order)
     or exists (select 1 from public.order_lines where order_id = v_order and qty_reserved <> 0)
     or exists (select 1 from public.credit_notes where invoice_id = v_inv.id) then
    v_fail := v_fail || 'W2 stock was reserved or moved, or a credit note was written' || E'\n';
  end if;
  -- Commission is worked out on delivered orders; with a rule that applies to
  -- this rep, there is a row for this order.
  if exists (select 1 from public.commission_rules cr where cr.org_id = c_gf and cr.active
               and (cr.rep_id is null or cr.rep_id = v_rep) and cr.store_id is null) then
    v_checks := v_checks + 1;
    if not exists (select 1 from public.commissions where order_id = v_order) then
      v_fail := v_fail || 'W2 a commission rule applies but no commission was worked out' || E'\n';
    end if;
  end if;

  ---------------------------------------------------------------- W3 twice
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_invoice_without_stock(v_order);
    v_fail := v_fail || 'W3 a second press was accepted' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Order % is already delivered.' then
      v_fail := v_fail || 'W3 refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  if (select count(*) from public.tax_invoices where order_id = v_order) <> 1 then
    v_fail := v_fail || 'W3 a second invoice was issued' || E'\n';
  end if;

  ---------------------------------------------------------------- W4 refusals
  for r in
    select * from (values
      ('unpriced', '% has products with no price: %. Price them before invoicing.'),
      ('empty', 'Order % has nothing on it to invoice.')
    ) x(label, expect)
  loop
    insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
    values (c_gf, v_tag || '-' || r.label, v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o2;
    if r.label = 'unpriced' then
      insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
      values (c_gf, v_o2, v_p0, 2, null, gen_random_uuid());
      if (select unit_price from public.order_lines where order_id = v_o2) is not null then
        raise exception 'Fixtures broken: the unpriced line was given a price.';
      end if;
    end if;
    v_checks := v_checks + 1;
    set local role authenticated;
    begin
      perform public.order_invoice_without_stock(v_o2);
      v_fail := v_fail || 'W4 ' || r.label || ' was invoiced' || E'\n';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like r.expect then
        v_fail := v_fail || 'W4 ' || r.label || ' refused for another reason: ' || v_err || E'\n';
      end if;
    end;
    reset role;
    if (select status from public.orders where id = v_o2) <> 'new'
       or exists (select 1 from public.tax_invoices where order_id = v_o2) then
      v_fail := v_fail || 'W4 ' || r.label || ' changed the order or issued an invoice' || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- W5 QuickBooks number
  insert into public.orders (org_id, order_number, store_id, source, received_via, invoice_number, client_generated_id)
  values (c_gf, v_tag || '-qb', v_store, 'warehouse_manual', 'other', 'QB-' || v_tag, gen_random_uuid()) returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 2, 5, gen_random_uuid());
  set local role authenticated;
  begin
    perform public.order_invoice_without_stock(v_o2);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'W5 a QuickBooks-numbered order was refused: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.orders where id = v_o2;
  if r.status <> 'delivered' or r.invoice_number <> 'QB-' || v_tag
     or exists (select 1 from public.tax_invoices where order_id = v_o2) then
    v_fail := v_fail || format('W5 the QuickBooks order is %s, number %s', r.status, r.invoice_number) || E'\n';
  end if;

  ---------------------------------------------------------------- W6 held
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, v_tag || '-held', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 2, 5, gen_random_uuid());
  update public.orders set on_hold = true, hold_reason = 'stock count', held_at = now() where id = v_o2;
  set local role authenticated;
  begin
    perform public.order_invoice_without_stock(v_o2);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'W6 a held order was refused: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.orders where id = v_o2;
  if r.status <> 'delivered' or r.on_hold or r.hold_reason is not null
     or (select count(*) from public.tax_invoices where order_id = v_o2 and status = 'issued') <> 1 then
    v_fail := v_fail || format('W6 the held order is %s, on hold %s', r.status, r.on_hold) || E'\n';
  end if;

  ---------------------------------------------------------------- W7 setting off
  update public.company_settings set value = 'false'::jsonb where org_id = c_gf and key = 'money_invoice_orders';
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, v_tag || '-off', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 3, 9, gen_random_uuid());
  set local role authenticated;
  begin
    perform public.order_invoice_without_stock(v_o2);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'W7 with the setting off it was refused: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  if (select count(*) from public.tax_invoices where order_id = v_o2 and status = 'issued') <> 1
     or (select status from public.orders where id = v_o2) <> 'delivered' then
    v_fail := v_fail || 'W7 with the setting off it did not invoice exactly once' || E'\n';
  end if;

  ---------------------------------------------------------------- W8 void, invoice again
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.tax_invoice_void((select id from public.tax_invoices where order_id = v_o2 and status = 'issued'),
                                    'Wrong price');
    perform public.tax_invoice_issue(v_o2, null);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'W8 the order could not be invoiced again after a void: ' || v_err || E'\n';
  end;
  reset role;
  if (select count(*) from public.tax_invoices where order_id = v_o2 and status = 'issued') <> 1
     or (select count(*) from public.tax_invoices where order_id = v_o2 and status = 'void') <> 1 then
    v_fail := v_fail || 'W8 after the void there is not exactly one void and one live invoice' || E'\n';
  end if;
  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_invoice_orders';

  ---------------------------------------------------------------- W9 cancel
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, v_tag || '-cancel', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 1, 5, gen_random_uuid());
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o2, E' \t\n ');
    v_fail := v_fail || 'W9 cancelled with no reason' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'Say why the order is being cancelled.' then
      v_fail := v_fail || 'W9 no reason refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  begin
    perform public.order_cancel_without_stock(v_o2, E' Shop  closed\ndown ');
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'W9 the cancel was refused: ' || v_err || E'\n';
  end;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_order, 'Changed their mind');
    v_fail := v_fail || 'W9 an invoiced order was cancelled' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Order % has been invoiced, so it cannot be cancelled. Issue a credit note on its invoice instead.' then
      v_fail := v_fail || 'W9 invoiced order refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  select * into r from public.orders where id = v_o2;
  if (r.status, r.cancel_reason, r.cancelled_by) is distinct from ('cancelled', 'Shop closed down', v_admin)
     or exists (select 1 from public.order_lines where order_id = v_o2 and line_status <> 'cancelled') then
    v_fail := v_fail || format('W9 the order is %s (%s, by %s), or a line was left open', r.status, r.cancel_reason, r.cancelled_by) || E'\n';
  end if;
  if (select status from public.orders where id = v_order) <> 'delivered' then
    v_fail := v_fail || 'W9 the refused cancel changed the invoiced order' || E'\n';
  end if;
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, v_tag || '-who', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o2, 'Wrong shop');
    v_fail := v_fail || 'W9 a rep without the Orders permission cancelled an order' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'Cancelling an order needs the Orders permission.' then
      v_fail := v_fail || 'W9 rep refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  ---------------------------------------------------------------- W10 warehouse on
  update public.company_modules set enabled = true where org_id = c_gf and module_code = 'warehouse';
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, v_tag || '-stock', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 1, 5, gen_random_uuid());
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_invoice_without_stock(v_o2);
    v_fail := v_fail || 'W10 invoiced without stock while the warehouse is on' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Your company keeps stock, so confirm the order with%' then
      v_fail := v_fail || 'W10 invoice refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o2, 'No');
    v_fail := v_fail || 'W10 cancelled without stock while the warehouse is on' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Your company keeps stock, so cancel the order with%' then
      v_fail := v_fail || 'W10 cancel refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  if (select status from public.orders where id = v_o2) <> 'new'
     or exists (select 1 from public.tax_invoices where order_id = v_o2) then
    v_fail := v_fail || 'W10 a refusal changed the order' || E'\n';
  end if;

  ---------------------------------------------------------------- W11 the bent rules
  v_checks := v_checks + 1;
  begin
    update public.order_lines set qty_dispatched = qty_ordered, qty_delivered = qty_ordered where order_id = v_o2;
    update public.orders set status = 'delivered', delivered_at = now() where id = v_o2;
    v_fail := v_fail || 'W11 an order went from new to delivered without the function' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'An order cannot go from new to delivered.' then
      v_fail := v_fail || 'W11 new to delivered refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    update public.orders set status = 'confirmed', fulfil_location_id = null where id = v_o2;
    v_fail := v_fail || 'W11 an order was confirmed with no location' || E'\n';
  exception when check_violation then null;
    when others then
      get stacked diagnostics v_err = message_text;
      v_fail := v_fail || 'W11 confirming with no location refused for another reason: ' || v_err || E'\n';
  end;

  ---------------------------------------------------------------- W12 security
  select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
                  and exists (select 1 from public.module_assignments m
                               where m.kind = 'function' and m.name = p.proname and m.module_code = 'distribution')) as ok,
         count(*) as n
    into r from pg_proc p
   where p.oid in ('public.order_invoice_without_stock(uuid)'::regprocedure,
                   'public.order_cancel_without_stock(uuid, text)'::regprocedure);
  v_checks := v_checks + 1;
  if not coalesce(r.ok, false) or r.n <> 2 then
    v_fail := v_fail || 'W12 the functions lost their security settings or module rows' || E'\n';
  end if;

  if v_fail = '' then
    raise exception 'order_invoice_without_stock: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'order_invoice_without_stock: FAIL\n%', v_fail;
end;
$$;
