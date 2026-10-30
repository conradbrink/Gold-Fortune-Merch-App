-- Paid on delivery (20261030091119).
--
--   P1  The setting: the company's own, next to "Invoice every order", off by
--       default, written down for every company.
--   P2  Delivered in full: one cash payment for the whole invoice, dated the
--       delivery day, by the person who delivered; nothing left outstanding.
--   P3  Delivered with one back: the payment is the invoice less the credit
--       for the return, never the credited amount too.
--   P4  Part paid before delivery: the payment is only what was left.
--   P5  Dispatched is not delivered: no payment until it is.
--   P6  Setting off: a delivered order's invoice stays outstanding.
--   P7  No client can call the trigger function.
--
-- HOW TO RUN: as order_invoices.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. It writes Gold Fortune rows only
-- inside that block, and switches the setting on for it there.
-- `set constraints all immediate` makes the deferred triggers fire at each
-- statement, as they would at each commit.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_store uuid; v_loc uuid; v_p1 uuid; v_p2 uuid;
  v_order uuid; v_l1 uuid; v_l2 uuid; v_inv public.tax_invoices; v_pay public.invoice_payments;
  v_n int; v_num numeric; v_tz text;
  v_orders uuid[] := '{}'; v_tag text := 'ZZ-POD-' || left(md5(random()::text), 5);
  k int;
begin
  set constraints all immediate;

  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select s.id into v_store from public.stores s where s.org_id = c_gf and s.active order by s.created_at limit 1;
  select p.id into v_p1 from public.products p where p.org_id = c_gf order by p.created_at, p.id limit 1;
  select p.id into v_p2 from public.products p where p.org_id = c_gf and p.id <> v_p1 order by p.created_at, p.id limit 1;
  select l.id into v_loc from public.stock_locations l where l.org_id = c_gf and l.active order by l.is_default desc, l.id limit 1;
  if v_admin is null or v_store is null or v_p2 is null or v_loc is null then
    raise exception 'Fixtures missing: admin %, store %, product %, location %', v_admin, v_store, v_p2, v_loc;
  end if;
  if not public.order_invoices_on(c_gf) then
    raise exception 'Fixtures missing: Gold Fortune does not invoice its orders';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select coalesce(timezone, 'Africa/Johannesburg') into v_tz from public.organizations where id = c_gf;

  ------------------------------------------------------------------ P1 setting
  if not exists (select 1 from public.setting_definitions
                  where key = 'money_paid_on_delivery' and audience = 'owner'
                    and value_type = 'boolean' and default_value = 'false'::jsonb) then
    v_fail := v_fail || 'P1 money_paid_on_delivery is not an owner switch, off by default' || E'\n';
  end if;
  select count(*) into v_n from public.organizations o
   where not exists (select 1 from public.company_settings cs where cs.org_id = o.id and cs.key = 'money_paid_on_delivery');
  if v_n > 0 then
    v_fail := v_fail || format('P1 %s companies have no money_paid_on_delivery row', v_n) || E'\n';
  end if;

  update public.company_settings set value = 'true'::jsonb where org_id = c_gf and key = 'money_paid_on_delivery';

  -- Four orders, each two lines: 10 x 12.50 and 4 x 20.00, 205.00 before VAT.
  for k in 1..4 loop
    insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
    values (c_gf, v_tag || '-' || k, v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_order;
    insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
    values (c_gf, v_order, v_p1, 10, 12.50, gen_random_uuid());
    insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
    values (c_gf, v_order, v_p2, 4, 20, gen_random_uuid());
    update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_order;
    update public.orders set status = 'picking' where id = v_order;
    update public.orders set status = 'packed' where id = v_order;
    update public.order_lines set qty_dispatched = qty_ordered where order_id = v_order;
    update public.orders set status = 'dispatched' where id = v_order;
    v_orders := v_orders || v_order;
  end loop;

  ------------------------------------------------------------------ P5 dispatched
  select * into v_inv from public.tax_invoices where order_id = v_orders[1] and status = 'issued';
  if v_inv.id is null then
    raise exception 'Fixtures broken: confirming issued no invoice';
  end if;
  if exists (select 1 from public.invoice_payments p
               join public.tax_invoices t on t.id = p.invoice_id
              where t.order_id = any (v_orders)) then
    v_fail := v_fail || 'P5 an invoice was paid before its order was delivered' || E'\n';
  end if;

  ------------------------------------------------------------------ P2 in full
  update public.order_lines set qty_delivered = qty_dispatched where order_id = v_orders[1];
  update public.orders set status = 'delivered', delivered_by = v_admin where id = v_orders[1];
  select count(*) into v_n from public.invoice_payments where invoice_id = v_inv.id;
  select * into v_pay from public.invoice_payments where invoice_id = v_inv.id;
  if v_n <> 1 then
    v_fail := v_fail || format('P2 %s payments after a full delivery, not 1', v_n) || E'\n';
  elsif v_pay.amount <> v_inv.total or v_pay.method <> 'cash' or v_pay.created_by is distinct from v_admin
        or v_pay.paid_on <> (select (coalesce(o.delivered_at, now()) at time zone v_tz)::date
                               from public.orders o where o.id = v_orders[1]) then
    v_fail := v_fail || format('P2 paid %s %s on %s by %s; the invoice is %s',
                               v_pay.amount, v_pay.method, v_pay.paid_on, v_pay.created_by, v_inv.total) || E'\n';
  end if;
  if (select outstanding from public.tax_invoice_balances where invoice_id = v_inv.id) <> 0 then
    v_fail := v_fail || 'P2 something is still outstanding after a full delivery' || E'\n';
  end if;

  ------------------------------------------------------------------ P3 one back
  select * into v_inv from public.tax_invoices where order_id = v_orders[2] and status = 'issued';
  update public.order_lines set qty_delivered = qty_dispatched where order_id = v_orders[2];
  update public.order_lines set qty_returned = 2 where order_id = v_orders[2] and product_id = v_p1;
  update public.orders set status = 'delivered', delivered_by = v_admin where id = v_orders[2];
  select coalesce(sum(total), 0) into v_num from public.credit_notes where invoice_id = v_inv.id;
  select count(*) into v_n from public.invoice_payments where invoice_id = v_inv.id;
  if v_num <= 0 then
    v_fail := v_fail || 'P3 the return was not credited' || E'\n';
  end if;
  if v_n <> 1 or (select amount from public.invoice_payments where invoice_id = v_inv.id) <> v_inv.total - v_num
     or (select outstanding from public.tax_invoice_balances where invoice_id = v_inv.id) <> 0 then
    v_fail := v_fail || format('P3 %s payments; paid %s for an invoice of %s less %s credited', v_n,
                               (select sum(amount) from public.invoice_payments where invoice_id = v_inv.id),
                               v_inv.total, v_num) || E'\n';
  end if;

  ------------------------------------------------------------------ P4 part paid
  select * into v_inv from public.tax_invoices where order_id = v_orders[3] and status = 'issued';
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method, created_by)
  values (c_gf, v_inv.id, 50, current_date, 'eft', v_admin);
  update public.order_lines set qty_delivered = qty_dispatched where order_id = v_orders[3];
  update public.orders set status = 'delivered', delivered_by = v_admin where id = v_orders[3];
  if (select count(*) from public.invoice_payments where invoice_id = v_inv.id) <> 2
     or (select amount from public.invoice_payments where invoice_id = v_inv.id and method = 'cash') <> v_inv.total - 50
     or (select outstanding from public.tax_invoice_balances where invoice_id = v_inv.id) <> 0 then
    v_fail := v_fail || 'P4 a part-paid invoice was not paid only what was left' || E'\n';
  end if;

  ------------------------------------------------------------------ P6 setting off
  update public.company_settings set value = 'false'::jsonb where org_id = c_gf and key = 'money_paid_on_delivery';
  select * into v_inv from public.tax_invoices where order_id = v_orders[4] and status = 'issued';
  update public.order_lines set qty_delivered = qty_dispatched where order_id = v_orders[4];
  update public.orders set status = 'delivered', delivered_by = v_admin where id = v_orders[4];
  if exists (select 1 from public.invoice_payments where invoice_id = v_inv.id)
     or (select outstanding from public.tax_invoice_balances where invoice_id = v_inv.id) <> v_inv.total then
    v_fail := v_fail || 'P6 an invoice was paid with the setting off' || E'\n';
  end if;

  ------------------------------------------------------------------ P7 grants
  if has_function_privilege('authenticated', 'public.orders_paid_on_delivery()', 'execute')
     or has_function_privilege('anon', 'public.orders_paid_on_delivery()', 'execute') then
    v_fail := v_fail || 'P7 a client can call orders_paid_on_delivery' || E'\n';
  end if;

  raise exception E'%', case when v_fail = '' then 'ALL PAID-ON-DELIVERY CHECKS PASSED' else 'FAILURES:' || E'\n' || v_fail end;
end $$;
