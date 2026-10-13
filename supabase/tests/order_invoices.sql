-- Every order is its own invoice suite (13 Oct 2026).
--
--   O1  The setting: on for Gold Fortune and the Distribution template, written
--       down for every company; Gold Fortune's invoice counter is past every
--       QuickBooks number (on its imported invoices and its orders).
--   O2  An order with an unpriced line cannot be confirmed.
--   O3  Confirming issues the invoice: numbered from the counter, linked both
--       ways, one line per order line at the ordered quantity and price
--       (discounts included), totals at the order's VAT rate.
--   O4  An order carrying a QuickBooks number is not invoiced again.
--   O5  Dispatched short: one credit note for what did not go out.
--   O6  Delivered with a return: a second credit note for what came back, and
--       nothing credited twice. Invoice less credits = what the customer kept.
--   O7  Cancelled with nothing paid: the invoice is voided, the order freed.
--   O8  Cancelled after a payment: everything left is credited instead.
--   O9  Setting off: confirming issues nothing.
--   O10 No client can call the five functions.
--   O11 An invoice brought over from QuickBooks may name its order, but a
--       cancelled order never voids or credits it; any other source still
--       cannot name an order.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. It writes Gold Fortune rows only
-- inside that block. `set constraints all immediate` makes the deferred
-- trigger fire at each statement, as it would at each commit.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_store uuid; v_loc uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_order uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid;
  v_qb uuid; v_cancel uuid; v_paid uuid; v_off uuid; v_unpriced uuid;
  v_inv public.tax_invoices; v_next bigint; v_n int; v_num numeric; v_rate numeric;
  r record;
begin
  set constraints all immediate;

  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select s.id into v_store from public.stores s where s.org_id = c_gf and s.active order by s.created_at limit 1;
  select p.id into v_p1 from public.products p where p.org_id = c_gf order by p.created_at, p.id limit 1;
  select p.id into v_p2 from public.products p where p.org_id = c_gf and p.id <> v_p1 order by p.created_at, p.id limit 1;
  select p.id into v_p3 from public.products p where p.org_id = c_gf and p.id not in (v_p1, v_p2) order by p.created_at, p.id limit 1;
  select l.id into v_loc from public.stock_locations l where l.org_id = c_gf and l.active order by l.is_default desc, l.id limit 1;
  if v_admin is null or v_store is null or v_p3 is null or v_loc is null then
    raise exception 'Fixtures missing: admin %, store %, product %, location %', v_admin, v_store, v_p3, v_loc;
  end if;
  -- As the administrator, so created_by and the number checks see a person.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  ------------------------------------------------------------------ O1 setting
  if not public.order_invoices_on(c_gf) then
    v_fail := v_fail || 'O1 Gold Fortune does not invoice its orders' || E'\n';
  end if;
  if (select value from public.template_settings
       where template_code = 'distribution' and setting_key = 'money_invoice_orders') is distinct from 'true'::jsonb then
    v_fail := v_fail || 'O1 the Distribution template does not switch it on' || E'\n';
  end if;
  select count(*) into v_n from public.organizations o
   where not exists (select 1 from public.company_settings cs where cs.org_id = o.id and cs.key = 'money_invoice_orders');
  if v_n > 0 then
    v_fail := v_fail || format('O1 %s companies have no money_invoice_orders row', v_n) || E'\n';
  end if;
  select next_value into v_next from public.document_counters where org_id = c_gf and doc_type = 'tax_invoice';
  if v_next is null or v_next <= greatest(
       coalesce((select max(invoice_number::bigint) from public.tax_invoices
                  where org_id = c_gf and invoice_number ~ '^[0-9]{1,12}$'), 0),
       coalesce((select max(invoice_number::bigint) from public.orders
                  where org_id = c_gf and invoice_number ~ '^[0-9]{1,12}$'), 0)) then
    v_fail := v_fail || format('O1 the counter (%s) would reuse a QuickBooks number', v_next) || E'\n';
  end if;
  select vat_rate into v_rate from public.organizations where id = c_gf;

  ------------------------------------------------------------------ O2 unpriced
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-OI-UNPRICED', v_store, 'rep_app', 'other', gen_random_uuid()) returning id into v_unpriced;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_unpriced, v_p1, 2, null, gen_random_uuid());
  begin
    update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_unpriced;
    v_fail := v_fail || 'O2 an order with an unpriced line was confirmed' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ------------------------------------------------------------------ O3 confirm
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-OI-1', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_order;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p1, 10, 12.50, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, discount_pct, client_generated_id)
  values (c_gf, v_order, v_p2, 4, 100, 10, gen_random_uuid()) returning id into v_l2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p3, 3, 7.99, gen_random_uuid()) returning id into v_l3;
  select next_value into v_next from public.document_counters where org_id = c_gf and doc_type = 'tax_invoice';

  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_order;
  select * into v_inv from public.tax_invoices where order_id = v_order and status = 'issued';
  if v_inv.id is null then
    v_fail := v_fail || 'O3 confirming issued no invoice' || E'\n';
  else
    if v_next is not null and v_inv.invoice_number <> 'INV-' || lpad(v_next::text, 6, '0') then
      v_fail := v_fail || format('O3 the invoice is %s, not the counter''s %s', v_inv.invoice_number, v_next) || E'\n';
    end if;
    if (select invoice_number from public.orders where id = v_order) is distinct from v_inv.invoice_number then
      v_fail := v_fail || 'O3 the order does not carry its invoice number' || E'\n';
    end if;
    -- 10 × 12.50 + 4 × 90.00 + 3 × 7.99 = 125 + 360 + 23.97 = 508.97
    if v_inv.subtotal <> 508.97 or v_inv.vat <> round(508.97 * v_rate / 100, 2)
       or v_inv.total <> 508.97 + round(508.97 * v_rate / 100, 2) then
      v_fail := v_fail || format('O3 totals %s / %s / %s', v_inv.subtotal, v_inv.vat, v_inv.total) || E'\n';
    end if;
    select count(*) into v_n from public.tax_invoice_lines tl
     where tl.invoice_id = v_inv.id
       and ((tl.order_line_id = v_l1 and tl.qty = 10 and tl.unit_price = 12.50)
         or (tl.order_line_id = v_l2 and tl.qty = 4 and tl.unit_price = 90)
         or (tl.order_line_id = v_l3 and tl.qty = 3 and tl.unit_price = 7.99));
    if v_n <> 3 or (select count(*) from public.tax_invoice_lines where invoice_id = v_inv.id) <> 3 then
      v_fail := v_fail || format('O3 %s of 3 invoice lines match their order lines', v_n) || E'\n';
    end if;
    if v_inv.source <> 'order' or v_inv.order_number <> 'ZZ-OI-1' or v_inv.created_by is distinct from v_admin then
      v_fail := v_fail || 'O3 the invoice is not linked to its order, or not by the confirmer' || E'\n';
    end if;
  end if;

  ------------------------------------------------------------------ O4 QuickBooks
  insert into public.orders (org_id, order_number, store_id, source, received_via, invoice_number, client_generated_id)
  values (c_gf, 'ZZ-OI-QB', v_store, 'warehouse_manual', 'other', '9999', gen_random_uuid()) returning id into v_qb;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_qb, v_p1, 1, null, gen_random_uuid());
  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_qb;
  if exists (select 1 from public.tax_invoices where order_id = v_qb)
     or (select invoice_number from public.orders where id = v_qb) <> '9999' then
    v_fail := v_fail || 'O4 an order with a QuickBooks number was invoiced again' || E'\n';
  end if;

  ------------------------------------------------------------------ O5 dispatched short
  update public.orders set status = 'picking' where id = v_order;
  update public.orders set status = 'packed' where id = v_order;
  update public.order_lines set qty_dispatched = 10 where id = v_l1;
  update public.order_lines set qty_dispatched = 3 where id = v_l2;
  update public.order_lines set qty_dispatched = 0 where id = v_l3;
  if exists (select 1 from public.credit_notes where invoice_id = v_inv.id) then
    v_fail := v_fail || 'O5 a credit note before anything went out' || E'\n';
  end if;
  update public.orders set status = 'dispatched' where id = v_order;
  select count(*) into v_n from public.credit_notes where invoice_id = v_inv.id;
  if v_n <> 1 then
    v_fail := v_fail || format('O5 %s credit notes after a short dispatch, not 1', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.credit_note_lines cl
    join public.credit_notes c on c.id = cl.credit_note_id
    join public.tax_invoice_lines tl on tl.id = cl.invoice_line_id
   where c.invoice_id = v_inv.id
     and ((tl.order_line_id = v_l2 and cl.qty = 1) or (tl.order_line_id = v_l3 and cl.qty = 3));
  if v_n <> 2 or (select count(*) from public.credit_note_lines cl join public.credit_notes c on c.id = cl.credit_note_id
                   where c.invoice_id = v_inv.id) <> 2 then
    v_fail := v_fail || 'O5 the credit is not 1 of line 2 and 3 of line 3' || E'\n';
  end if;
  if (select reason from public.credit_notes where invoice_id = v_inv.id) not like 'Not sent:%' then
    v_fail := v_fail || 'O5 the credit note does not say why' || E'\n';
  end if;

  ------------------------------------------------------------------ O6 delivered, one back
  update public.order_lines set qty_delivered = qty_dispatched where order_id = v_order;
  update public.order_lines set qty_returned = 1 where id = v_l1;
  update public.orders set status = 'delivered' where id = v_order;
  select count(*) into v_n from public.credit_notes where invoice_id = v_inv.id;
  if v_n <> 2 then
    v_fail := v_fail || format('O6 %s credit notes after delivery with a return, not 2', v_n) || E'\n';
  end if;
  -- Kept: 9 × 12.50 + 3 × 90 = 112.50 + 270 = 382.50 before VAT.
  select (select sum(tl.line_total) from public.tax_invoice_lines tl where tl.invoice_id = v_inv.id)
       - (select sum(cl.line_total) from public.credit_note_lines cl
            join public.credit_notes c on c.id = cl.credit_note_id where c.invoice_id = v_inv.id)
    into v_num;
  if v_num <> 382.50 then
    v_fail := v_fail || format('O6 invoice less credits is %s before VAT, not 382.50', v_num) || E'\n';
  end if;

  ------------------------------------------------------------------ O7 cancelled, unpaid
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-OI-CANCEL', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_cancel;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_cancel, v_p1, 2, 10, gen_random_uuid());
  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_cancel;
  update public.orders set status = 'cancelled', cancel_reason = 'test' where id = v_cancel;
  if exists (select 1 from public.tax_invoices where order_id = v_cancel and status = 'issued')
     or not exists (select 1 from public.tax_invoices where order_id = v_cancel and status = 'void'
                     and void_reason like '%was cancelled.')
     or (select invoice_number from public.orders where id = v_cancel) is not null then
    v_fail := v_fail || 'O7 a cancelled order''s unpaid invoice was not voided' || E'\n';
  end if;

  ------------------------------------------------------------------ O8 cancelled, paid
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-OI-PAID', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_paid;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_paid, v_p1, 2, 10, gen_random_uuid());
  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_paid;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on)
  select c_gf, id, 5, current_date from public.tax_invoices where order_id = v_paid and status = 'issued';
  update public.orders set status = 'cancelled', cancel_reason = 'test' where id = v_paid;
  if not exists (select 1 from public.tax_invoices t
                   join public.credit_notes c on c.invoice_id = t.id
                  where t.order_id = v_paid and t.status = 'issued' and c.subtotal = 20) then
    v_fail := v_fail || 'O8 a cancelled order''s paid invoice was not credited in full' || E'\n';
  end if;

  ------------------------------------------------------------------ O9 setting off
  update public.company_settings set value = 'false' where org_id = c_gf and key = 'money_invoice_orders';
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-OI-OFF', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_off;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_off, v_p1, 1, null, gen_random_uuid());
  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_off;
  if exists (select 1 from public.tax_invoices where order_id = v_off) then
    v_fail := v_fail || 'O9 an order was invoiced with the setting off' || E'\n';
  end if;

  ------------------------------------------------------------------ O10 grants
  for r in select unnest(array['public.order_invoices_on(uuid)', 'public.order_invoice_write(uuid)',
                               'public.credit_note_write(uuid,text,jsonb)', 'public.orders_invoice_ready()',
                               'public.orders_invoice_follow()']) as fn loop
    if has_function_privilege('authenticated', r.fn, 'EXECUTE') or has_function_privilege('anon', r.fn, 'EXECUTE') then
      v_fail := v_fail || format('O10 a client can call %s', r.fn) || E'\n';
    end if;
  end loop;

  ------------------------------------------------------------------ O11 QuickBooks invoices
  update public.company_settings set value = 'true' where org_id = c_gf and key = 'money_invoice_orders';
  insert into public.orders (org_id, order_number, store_id, source, received_via, invoice_number, client_generated_id)
  values (c_gf, 'ZZ-OI-QBLINK', v_store, 'warehouse_manual', 'other', 'ZZ9001', gen_random_uuid()) returning id into v_qb;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_qb, v_p1, 1, 10, gen_random_uuid());
  insert into public.tax_invoices (org_id, invoice_number, source, kind, order_id, order_number, store_id,
                                   seller_name, customer_name, issue_date, due_date, vat_rate, subtotal, vat, total)
  values (c_gf, 'ZZ9001', 'quickbooks', 'standard', v_qb, 'ZZ-OI-QBLINK', v_store,
          'Gold Fortune', 'Test', current_date, current_date, 14, 10, 1.4, 11.4) returning * into v_inv;
  update public.orders set status = 'cancelled', cancel_reason = 'test' where id = v_qb;
  if (select status from public.tax_invoices where id = v_inv.id) <> 'issued'
     or exists (select 1 from public.credit_notes where invoice_id = v_inv.id) then
    v_fail := v_fail || 'O11 cancelling an order voided or credited its QuickBooks invoice' || E'\n';
  end if;
  begin
    insert into public.tax_invoices (org_id, invoice_number, source, kind, order_id, order_number,
                                     seller_name, customer_name, issue_date, due_date, vat_rate, subtotal, vat, total)
    values (c_gf, 'ZZ9002', 'direct', 'standard', v_qb, 'ZZ-OI-QBLINK',
            'Gold Fortune', 'Test', current_date, current_date, 14, 10, 1.4, 11.4);
    v_fail := v_fail || 'O11 a direct invoice was allowed to name an order' || E'\n';
  exception when check_violation then null;
  end;

  if v_fail <> '' then
    raise exception E'order_invoices FAILED:\n%', v_fail;
  end if;
  raise exception 'order_invoices PASSED';
end;
$$;
