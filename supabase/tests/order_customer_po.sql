-- The customer's purchase order on an order and its invoice (20 Oct 2026).
--
--   P1  Office staff can write the three purchase order columns on an order.
--   P2  Confirming an order copies its PO number and date onto the invoice it
--       issues (trimmed); the expiry stays on the order.
--   P3  Editing the order's PO afterwards leaves the issued invoice as it was.
--   P4  An order with no PO issues an invoice with none.
--   P5  A blank or over-long PO number, or an expiry before the PO's own date,
--       is refused.
--
-- HOW TO RUN: as order_invoices.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. It writes Gold Fortune rows only
-- inside that block.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_store uuid; v_loc uuid; v_p1 uuid;
  v_order uuid; v_plain uuid; v_bad uuid;
  v_inv public.tax_invoices;
begin
  set constraints all immediate;

  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select s.id into v_store from public.stores s where s.org_id = c_gf and s.active order by s.created_at limit 1;
  select p.id into v_p1 from public.products p where p.org_id = c_gf order by p.created_at, p.id limit 1;
  select l.id into v_loc from public.stock_locations l where l.org_id = c_gf and l.active order by l.is_default desc, l.id limit 1;
  if v_admin is null or v_store is null or v_p1 is null or v_loc is null then
    raise exception 'Fixtures missing: admin %, store %, product %, location %', v_admin, v_store, v_p1, v_loc;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  ------------------------------------------------------------------ P1 grants
  if not (has_column_privilege('authenticated', 'public.orders', 'customer_po_number', 'UPDATE')
          and has_column_privilege('authenticated', 'public.orders', 'customer_po_date', 'UPDATE')
          and has_column_privilege('authenticated', 'public.orders', 'customer_po_expires_on', 'UPDATE')) then
    v_fail := v_fail || 'P1 office staff cannot write the purchase order columns' || E'\n';
  end if;

  ------------------------------------------------------------------ P2 copied
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id,
                             customer_po_number, customer_po_date, customer_po_expires_on)
  values (c_gf, 'ZZ-PO-1', v_store, 'warehouse_manual', 'email', gen_random_uuid(),
          '  1001160022257 ', date '2026-10-16', date '2026-10-26') returning id into v_order;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p1, 10, 131.57, gen_random_uuid());
  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_order;
  select * into v_inv from public.tax_invoices where order_id = v_order and status = 'issued';
  if v_inv.id is null then
    v_fail := v_fail || 'P2 confirming issued no invoice' || E'\n';
  elsif v_inv.customer_po_number is distinct from '1001160022257'
        or v_inv.customer_po_date is distinct from date '2026-10-16' then
    v_fail := v_fail || format('P2 the invoice says PO %s of %s', v_inv.customer_po_number, v_inv.customer_po_date) || E'\n';
  end if;

  ------------------------------------------------------------------ P3 frozen
  update public.orders set customer_po_number = 'CHANGED', customer_po_date = date '2026-10-18' where id = v_order;
  if (select customer_po_number from public.tax_invoices where id = v_inv.id) is distinct from '1001160022257'
     or (select customer_po_date from public.tax_invoices where id = v_inv.id) is distinct from date '2026-10-16' then
    v_fail := v_fail || 'P3 editing the order rewrote its issued invoice' || E'\n';
  end if;

  ------------------------------------------------------------------ P4 none
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-PO-2', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_plain;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_plain, v_p1, 1, 5, gen_random_uuid());
  update public.orders set status = 'confirmed', fulfil_location_id = v_loc where id = v_plain;
  select * into v_inv from public.tax_invoices where order_id = v_plain and status = 'issued';
  if v_inv.id is null or v_inv.customer_po_number is not null or v_inv.customer_po_date is not null then
    v_fail := v_fail || 'P4 an order with no PO gave its invoice one, or no invoice' || E'\n';
  end if;

  ------------------------------------------------------------------ P5 refused
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-PO-3', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_bad;
  begin
    update public.orders set customer_po_number = '   ' where id = v_bad;
    v_fail := v_fail || 'P5 a blank PO number was saved' || E'\n';
  exception when check_violation then null;
  end;
  begin
    update public.orders set customer_po_number = repeat('9', 61) where id = v_bad;
    v_fail := v_fail || 'P5 a 61-character PO number was saved' || E'\n';
  exception when check_violation then null;
  end;
  begin
    update public.orders set customer_po_date = date '2026-10-16', customer_po_expires_on = date '2026-10-15' where id = v_bad;
    v_fail := v_fail || 'P5 a PO expiring before its own date was saved' || E'\n';
  exception when check_violation then null;
  end;

  if v_fail <> '' then
    raise exception E'order_customer_po FAILED:\n%', v_fail;
  end if;
  raise exception 'order_customer_po PASSED';
end;
$$;
