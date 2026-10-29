-- Orders without the warehouse module: 20261029203300_invoice_orders_without_stock.
--
-- Run on Gold Fortune with its warehouse module switched off inside the block
-- (the company in question: orders and invoicing, no stock).
--
--   W1  Someone without the invoicing permission cannot invoice an order.
--   W2  The administrator invoices a new order: confirmed by them, one invoice
--       from the order (linked both ways), one line per live order line at
--       the quantity ordered and its price (a cancelled line left off), the
--       totals at the order's VAT rate, and no stock reserved or moved.
--   W3  A second press is refused and issues nothing more.
--   W4  Refused, changing nothing: an unpriced line, a QuickBooks number, an
--       order with nothing live on it, an order on hold.
--   W5  With "Invoice every order" off, it still invoices, exactly once.
--   W6  Cancelling: a reason is needed; a new order is cancelled with it; an
--       invoiced one is refused with the credit-note message.
--   W7  A rep cannot cancel; a manager can.
--   W8  With the warehouse module on, both are refused with the "keeps stock"
--       message, changing nothing.
--   W9  Both functions keep their security: definer, a fixed search_path, no
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
  v_admin uuid; v_rep uuid; v_mgr uuid; v_store uuid; v_p0 uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_order uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid; v_o2 uuid; v_n int;
  v_res jsonb; v_err text; v_inv public.tax_invoices; v_rate numeric; t record; r record;
  v_tag text := 'ZZ-NS-' || left(md5(random()::text), 5);

  -- Makes a new order with two priced lines and returns it.
  v_sql_order constant text := $q$
    with o as (
      insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
      values ($1, $2, $3, 'warehouse_manual', 'other', gen_random_uuid()) returning id)
    select id from o $q$;
begin
  set constraints all immediate;

  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
     and not exists (select 1 from public.profile_permissions pp
                      where pp.profile_id = p.id and pp.permission_code in ('admin', 'invoicing'))
   order by p.created_at, p.id limit 1;
  select p.id into v_mgr from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'manager'
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
  -- Without the module, so the "Invoice every order" trigger path is the one
  -- the company would really have.
  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_invoice_orders';

  execute v_sql_order into v_order using c_gf, v_tag || '-1', v_store;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p1, 10, 12.50, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, discount_pct, client_generated_id)
  values (c_gf, v_order, v_p2, 4, 100, 10, gen_random_uuid()) returning id into v_l2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p3, 3, 7, gen_random_uuid()) returning id into v_l3;
  update public.order_lines set line_status = 'cancelled' where id = v_l3;
  -- A product with no price anywhere: a line saved with no price takes the
  -- store's (20261015210000), so only a product with none stays unpriced.
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, v_tag || ' unpriced product', 10, null) returning id into v_p0;

  ---------------------------------------------------------------- W1 no permission
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_invoice_without_stock(v_order);
    v_fail := v_fail || 'W1 a rep without the invoicing permission invoiced an order' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'Only someone who can issue invoices can invoice an order.' then
      v_fail := v_fail || 'W1 refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;

  ---------------------------------------------------------------- W2 invoiced
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
  select * into v_inv from public.tax_invoices where order_id = v_order and status = 'issued';
  if (r.status, r.confirmed_by) is distinct from ('confirmed', v_admin) or r.confirmed_at is null then
    v_fail := v_fail || format('W2 the order is %s, confirmed by %s', r.status, r.confirmed_by) || E'\n';
  end if;
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
  select * into r from public.money_totals(t.total, (select vat_rate from public.orders where id = v_order), false);
  if (v_inv.subtotal, v_inv.vat, v_inv.total) is distinct from (r.subtotal, r.vat, r.total) then
    v_fail := v_fail || format('W2 totals %s/%s/%s, expected %s/%s/%s',
      v_inv.subtotal, v_inv.vat, v_inv.total, r.subtotal, r.vat, r.total) || E'\n';
  end if;
  -- No location: the company has none. And with none, the stock steps stay shut.
  if (select fulfil_location_id from public.orders where id = v_order) is not null then
    v_fail := v_fail || 'W2 a fulfilment location was set' || E'\n';
  end if;
  v_checks := v_checks + 1;
  begin
    update public.orders set status = 'picking' where id = v_order;
    v_fail := v_fail || 'W2 an order confirmed without stock went on to picking' || E'\n';
  exception
    when check_violation then null;
    when others then
      get stacked diagnostics v_err = message_text;
      v_fail := v_fail || 'W2 picking refused for another reason: ' || v_err || E'\n';
  end;
  if exists (select 1 from public.stock_movements where source_doc_id = v_order)
     or exists (select 1 from public.order_allocations where order_id = v_order)
     or exists (select 1 from public.order_lines where order_id = v_order and qty_reserved <> 0)
     or exists (select 1 from public.credit_notes where invoice_id = v_inv.id) then
    v_fail := v_fail || 'W2 stock was reserved or moved, or a credit note was written' || E'\n';
  end if;

  ---------------------------------------------------------------- W3 twice
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_invoice_without_stock(v_order);
    v_fail := v_fail || 'W3 a second press was accepted' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Order % is already confirmed.' then
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
      ('quickbooks', '% was already invoiced outside the app as QB-1. Clear that number on the order first if it was wrong.'),
      ('empty', 'Order % has nothing on it to invoice.'),
      ('held', 'Order % is on hold (stock count). Release the hold first.')
    ) x(label, expect)
  loop
    execute v_sql_order into v_o2 using c_gf, v_tag || '-' || r.label, v_store;
    if r.label <> 'empty' then
      insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
      values (c_gf, v_o2, case when r.label = 'unpriced' then v_p0 else v_p1 end,
              2, case when r.label = 'unpriced' then null else 5 end, gen_random_uuid());
    end if;
    if r.label = 'unpriced' and (select unit_price from public.order_lines where order_id = v_o2) is not null then
      raise exception 'Fixtures broken: the unpriced line was given a price.';
    end if;
    if r.label = 'quickbooks' then
      update public.orders set invoice_number = 'QB-1' where id = v_o2;
    elsif r.label = 'held' then
      update public.orders set on_hold = true, hold_reason = 'stock count', held_at = now() where id = v_o2;
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

  ---------------------------------------------------------------- W5 setting off
  update public.company_settings set value = 'false'::jsonb where org_id = c_gf and key = 'money_invoice_orders';
  execute v_sql_order into v_o2 using c_gf, v_tag || '-off', v_store;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 3, 9, gen_random_uuid());
  set local role authenticated;
  begin
    perform public.order_invoice_without_stock(v_o2);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'W5 with the setting off it was refused: ' || v_err || E'\n';
  end;
  reset role;
  v_checks := v_checks + 1;
  if (select count(*) from public.tax_invoices where order_id = v_o2 and status = 'issued') <> 1
     or (select status from public.orders where id = v_o2) <> 'confirmed' then
    v_fail := v_fail || 'W5 with the setting off it did not invoice exactly once' || E'\n';
  end if;
  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_invoice_orders';

  ---------------------------------------------------------------- W6 cancel
  execute v_sql_order into v_o2 using c_gf, v_tag || '-cancel', v_store;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 1, 5, gen_random_uuid());
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o2, '   ');
    v_fail := v_fail || 'W6 cancelled with no reason' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'Say why the order is being cancelled.' then
      v_fail := v_fail || 'W6 no reason refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  perform public.order_cancel_without_stock(v_o2, ' Shop closed down ');
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_order, 'Changed their mind');
    v_fail := v_fail || 'W6 an invoiced order was cancelled' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Order % has been invoiced, so it cannot be cancelled. Issue a credit note on its invoice instead.' then
      v_fail := v_fail || 'W6 invoiced order refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  select * into r from public.orders where id = v_o2;
  if (r.status, r.cancel_reason, r.cancelled_by) is distinct from ('cancelled', 'Shop closed down', v_admin) then
    v_fail := v_fail || format('W6 the order is %s (%s, by %s)', r.status, r.cancel_reason, r.cancelled_by) || E'\n';
  end if;
  if (select status from public.orders where id = v_order) <> 'confirmed' then
    v_fail := v_fail || 'W6 the refused cancel changed the invoiced order' || E'\n';
  end if;

  ---------------------------------------------------------------- W7 who cancels
  execute v_sql_order into v_o2 using c_gf, v_tag || '-who', v_store;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o2, 'Wrong shop');
    v_fail := v_fail || 'W7 a rep cancelled an order' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'Only a manager or someone who can issue invoices can cancel an order.' then
      v_fail := v_fail || 'W7 rep refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  if v_mgr is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_checks := v_checks + 1;
    begin
      perform public.order_cancel_without_stock(v_o2, 'Wrong shop');
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_fail := v_fail || 'W7 a manager could not cancel: ' || v_err || E'\n';
    end;
    reset role;
  end if;

  ---------------------------------------------------------------- W8 warehouse on
  update public.company_modules set enabled = true where org_id = c_gf and module_code = 'warehouse';
  execute v_sql_order into v_o2 using c_gf, v_tag || '-stock', v_store;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p1, 1, 5, gen_random_uuid());
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_checks := v_checks + 1;
  begin
    perform public.order_invoice_without_stock(v_o2);
    v_fail := v_fail || 'W8 invoiced without stock while the warehouse is on' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Your company keeps stock, so confirm the order with%' then
      v_fail := v_fail || 'W8 invoice refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  begin
    perform public.order_cancel_without_stock(v_o2, 'No');
    v_fail := v_fail || 'W8 cancelled without stock while the warehouse is on' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Your company keeps stock, so cancel the order with%' then
      v_fail := v_fail || 'W8 cancel refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  reset role;
  if (select status from public.orders where id = v_o2) <> 'new'
     or exists (select 1 from public.tax_invoices where order_id = v_o2) then
    v_fail := v_fail || 'W8 a refusal changed the order' || E'\n';
  end if;

  ---------------------------------------------------------------- W9 security
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
    v_fail := v_fail || 'W9 the functions lost their security settings or module rows' || E'\n';
  end if;

  if v_fail = '' then
    raise exception 'order_invoice_without_stock: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'order_invoice_without_stock: FAIL\n%', v_fail;
end;
$$;
