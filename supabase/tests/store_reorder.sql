-- Store reorder suite: when each store last ordered and when it is due again
-- (20261015100000, 15 Oct 2026; invoice day 20261016100000).
--
--   R1  Fixtures with known dates: never ordered; one order 10 days ago; a
--       store that orders every 14 days; one that orders every 60 days (due at
--       the 30-day rule, not its own 60); QuickBooks history only; a cancelled
--       order that does not count; a void invoice that does not count; an
--       imported invoice that names its order, counted once, on the day it
--       was invoiced; an invoice dated before its order, and a void one after
--       it, leave the order on its own day; two orders on one
--       day, one order day; an order more than a year ago, outside the rhythm
--       but still the last order; a back-order that is not a new order; an
--       inactive store left out.
--   R2  The company's rule: at 21 days the 60-day store is due after 21 and the
--       14-day store stays at 14.
--   R3  A rep sees exactly what a manager sees, orders taken by anyone
--       included (they cannot read those orders themselves).
--   R4  Live: one row per active store; due_on is always last order + due
--       after; due after never exceeds the rule.
--   R6  The last order's products (20261015200000): a Tickd order's lines in
--       shrinks, rounded up; a QuickBooks invoice's lines in shrinks, or
--       converted when priced per single item; each unmatched line counted
--       as missing, a note with no price not; a store with no order has none.
--   R7  order_declines: a rep records their own reason and reads it back;
--       cannot record one as somebody else, read another rep's, record a
--       second for the same visit, change or delete one. A manager reads all.
--   R8  store_year_sales: someone with invoicing gets each store's invoices
--       in the last year excluding VAT; a rep is refused.
--   R5  Grants, security definer with a pinned search_path, the module
--       registration, and the function refusing when distribution is off.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_mgr uuid; v_rep uuid; v_other uuid;
  v_tz text; v_today date;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_h uuid; v_i uuid; v_k uuid; v_l uuid;
  v_m uuid;
  v_g_order uuid; v_m_order uuid; v_c1_order uuid;
  v_prod uuid; v_units int; v_price numeric;
  v_lines jsonb; v_missing int; v_n int;
  v_mgr_rows text; v_rep_rows text;
  v_all int; v_active int; v_ever int; v_due int; v_rhythm int; v_bad int;
  r record;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by created_at limit 1;
  select id into v_other from public.profiles
   where org_id = c_gf and role = 'rep' and is_active and id <> v_rep order by created_at limit 1;
  if v_mgr is null or v_rep is null or v_other is null then
    raise exception 'Fixtures missing: a Gold Fortune manager and two reps are needed.';
  end if;
  v_tz := public.org_timezone(c_gf);
  v_today := (now() at time zone v_tz)::date;

  ---------------------------------------------------------------- R1 fixtures
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder A never') returning id into v_a;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder B once') returning id into v_b;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder C every 14') returning id into v_c;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder D every 60') returning id into v_d;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder E quickbooks') returning id into v_e;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder F cancelled') returning id into v_f;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder G linked') returning id into v_g;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder H same day') returning id into v_h;
  insert into public.stores (org_id, name, active) values (c_gf, 'ZZ reorder I inactive', false) returning id into v_i;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder K void') returning id into v_k;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder L last year') returning id into v_l;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ reorder M invoiced first') returning id into v_m;

  -- Every order at midday, company time, n days ago. The 14-day store's and the
  -- same-day store's were taken by another rep, which R3 needs.
  insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, status, cancel_reason,
                             created_at, client_generated_id)
  select c_gf, x.num, x.store, x.rep, 'warehouse_manual', 'other', x.status,
         case when x.status = 'cancelled' then 'Suite fixture' end,
         ((v_today - x.ago) + time '12:00') at time zone v_tz, gen_random_uuid()
    from (values
      ('ZZ-RO-B1', v_b, null::uuid, 'new', 10),
      ('ZZ-RO-C1', v_c, v_other, 'new', 5),
      ('ZZ-RO-C2', v_c, v_other, 'new', 19),
      ('ZZ-RO-C3', v_c, v_other, 'new', 33),
      ('ZZ-RO-C4', v_c, v_other, 'new', 47),
      ('ZZ-RO-D1', v_d, null, 'new', 10),
      ('ZZ-RO-D2', v_d, null, 'new', 70),
      ('ZZ-RO-D3', v_d, null, 'new', 130),
      ('ZZ-RO-F1', v_f, null, 'cancelled', 3),
      ('ZZ-RO-G1', v_g, null, 'new', 20),
      ('ZZ-RO-H1', v_h, v_other, 'new', 8),
      ('ZZ-RO-H2', v_h, v_other, 'new', 8),
      ('ZZ-RO-L1', v_l, null, 'new', 400),
      ('ZZ-RO-M1', v_m, null, 'new', 6)
    ) as x(num, store, rep, status, ago);
  select id into v_g_order from public.orders where org_id = c_gf and order_number = 'ZZ-RO-G1';
  select id into v_m_order from public.orders where org_id = c_gf and order_number = 'ZZ-RO-M1';
  -- A back-order of B's order, 3 days ago: the warehouse finishing B1, not a new order.
  insert into public.orders (org_id, order_number, store_id, source, received_via, status, parent_order_id,
                             created_at, client_generated_id)
  select c_gf, 'ZZ-RO-B1-BO', v_b, 'warehouse_manual', 'other', 'new', o.id,
         ((v_today - 3) + time '12:00') at time zone v_tz, gen_random_uuid()
    from public.orders o where o.org_id = c_gf and o.order_number = 'ZZ-RO-B1';

  insert into public.tax_invoices (org_id, invoice_number, source, kind, order_id, order_number, store_id, status,
                                   void_reason, seller_name, customer_name, issue_date, due_date, vat_rate,
                                   subtotal, vat, total)
  values
    -- QuickBooks history only, 40 days ago.
    (c_gf, 'ZZ9101', 'quickbooks', 'standard', null, null, v_e, 'issued', null,
     'Gold Fortune', 'Test', v_today - 40, v_today - 10, 14, 10, 1.4, 11.4),
    -- The imported invoice of order G1, two days after it: the same order,
    -- bought on the day it was invoiced (Puma Phakalane, 16 Oct 2026).
    (c_gf, 'ZZ9102', 'quickbooks', 'standard', v_g_order, 'ZZ-RO-G1', v_g, 'issued', null,
     'Gold Fortune', 'Test', v_today - 18, v_today + 12, 14, 10, 1.4, 11.4),
    -- Order M1 was entered a day after QuickBooks invoiced it: it stays on its
    -- own day. A void invoice of it, later still, does not move it either.
    (c_gf, 'ZZ9106', 'quickbooks', 'standard', v_m_order, 'ZZ-RO-M1', v_m, 'issued', null,
     'Gold Fortune', 'Test', v_today - 7, v_today + 23, 14, 10, 1.4, 11.4),
    (c_gf, 'ZZ9107', 'quickbooks', 'standard', v_m_order, 'ZZ-RO-M1', v_m, 'void', 'Suite fixture',
     'Gold Fortune', 'Test', v_today - 2, v_today + 28, 14, 10, 1.4, 11.4),
    -- A void invoice is not an order.
    (c_gf, 'ZZ9103', 'quickbooks', 'standard', null, null, v_k, 'void', 'Suite fixture',
     'Gold Fortune', 'Test', v_today - 6, v_today + 24, 14, 10, 1.4, 11.4);

  update public.company_settings set value = '30'::jsonb
   where org_id = c_gf and key = 'reorder_after_days';

  ---------------------------------------------------------------- R1 as the manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  for r in select * from public.store_reorder() where store_name like 'ZZ reorder %' loop
    if r.store_id = v_a and not (r.last_order_on is null and r.due_on is null and r.order_days_year = 0
                                 and r.usual_days is null and r.due_after_days = 30) then
      v_fail := v_fail || format('R1 never ordered: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_b and not (r.last_order_on = v_today - 10 and r.last_order_ref = 'ZZ-RO-B1'
                                    and r.last_order_status = 'new' and r.order_days_year = 1
                                    and r.usual_days is null and r.due_after_days = 30 and r.due_on = v_today + 20) then
      v_fail := v_fail || format('R1 one order: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_c and not (r.last_order_on = v_today - 5 and r.last_order_ref = 'ZZ-RO-C1'
                                    and r.order_days_year = 4 and r.usual_days = 14
                                    and r.due_after_days = 14 and r.due_on = v_today + 9) then
      v_fail := v_fail || format('R1 every 14 days: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_d and not (r.last_order_on = v_today - 10 and r.order_days_year = 3 and r.usual_days = 60
                                    and r.due_after_days = 30 and r.due_on = v_today + 20) then
      v_fail := v_fail || format('R1 every 60 days, due at the rule: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_e and not (r.last_order_on = v_today - 40 and r.last_order_ref = 'ZZ9101'
                                    and r.last_order_status = 'invoiced' and r.order_days_year = 1
                                    and r.due_on = v_today - 10) then
      v_fail := v_fail || format('R1 QuickBooks history: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_f and not (r.last_order_on is null and r.order_days_year = 0) then
      v_fail := v_fail || format('R1 a cancelled order counted: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_g and not (r.last_order_on = v_today - 18 and r.last_order_ref = 'ZZ-RO-G1'
                                    and r.last_order_status = 'new' and r.order_days_year = 1
                                    and r.due_on = v_today + 12) then
      v_fail := v_fail || format('R1 an invoiced order not counted once, on its invoice day: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_m and not (r.last_order_on = v_today - 6 and r.last_order_ref = 'ZZ-RO-M1'
                                    and r.order_days_year = 1 and r.due_on = v_today + 24) then
      v_fail := v_fail || format('R1 an earlier or a void invoice moved its order: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_h and not (r.last_order_on = v_today - 8 and r.order_days_year = 1) then
      v_fail := v_fail || format('R1 two orders on one day: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_k and not (r.last_order_on is null and r.order_days_year = 0) then
      v_fail := v_fail || format('R1 a void invoice counted: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_l and not (r.last_order_on = v_today - 400 and r.order_days_year = 0
                                    and r.due_on = v_today - 370) then
      v_fail := v_fail || format('R1 an order over a year ago: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_i then
      v_fail := v_fail || 'R1 an inactive store is listed' || E'\n';
    end if;
  end loop;
  if (select count(*) from public.store_reorder() where store_name like 'ZZ reorder %') <> 11 then
    v_fail := v_fail || format('R1 expected 11 fixture stores, found %s',
      (select count(*) from public.store_reorder() where store_name like 'ZZ reorder %')) || E'\n';
  end if;

  select string_agg(row_to_json(t)::text, '|' order by t.store_id) into v_mgr_rows
    from public.store_reorder() t where t.store_name like 'ZZ reorder %';

  -- R4, still as the manager.
  select count(*),
         count(*) filter (where last_order_on is not null),
         count(*) filter (where due_on <= v_today),
         count(*) filter (where usual_days is not null),
         count(*) filter (where due_on is distinct from last_order_on + due_after_days
                             or due_after_days > 30 or due_after_days < 1
                             or (usual_days is not null and due_after_days <> least(usual_days, 30)))
    into v_all, v_ever, v_due, v_rhythm, v_bad
    from public.store_reorder();
  reset role;

  select count(*) into v_active from public.stores where org_id = c_gf and active;
  if v_all <> v_active then
    v_fail := v_fail || format('R4 %s rows for %s active stores', v_all, v_active) || E'\n';
  end if;
  if v_bad <> 0 then
    v_fail := v_fail || format('R4 %s rows where due_on or due_after_days breaks the rule', v_bad) || E'\n';
  end if;

  ---------------------------------------------------------------- R2 the company's rule
  update public.company_settings set value = '21'::jsonb
   where org_id = c_gf and key = 'reorder_after_days';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for r in select * from public.store_reorder() where store_id in (v_b, v_c, v_d) loop
    if (r.store_id = v_b and not (r.due_after_days = 21 and r.due_on = v_today + 11))
       or (r.store_id = v_c and not (r.due_after_days = 14 and r.due_on = v_today + 9))
       or (r.store_id = v_d and not (r.due_after_days = 21 and r.due_on = v_today + 11)) then
      v_fail := v_fail || format('R2 at 21 days: %s', row_to_json(r)) || E'\n';
    end if;
  end loop;
  reset role;
  update public.company_settings set value = '30'::jsonb
   where org_id = c_gf and key = 'reorder_after_days';

  ---------------------------------------------------------------- R3 a rep sees the same
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select string_agg(row_to_json(t)::text, '|' order by t.store_id) into v_rep_rows
    from public.store_reorder() t where t.store_name like 'ZZ reorder %';
  -- The control: this rep cannot read the 14-day store's orders directly.
  if exists (select 1 from public.orders where store_id = v_c) then
    v_fail := v_fail || 'R3 control: the rep can read another rep''s orders, so R3 proves nothing' || E'\n';
  end if;
  reset role;
  if v_rep_rows is distinct from v_mgr_rows then
    v_fail := v_fail || 'R3 a rep sees different rows from a manager' || E'\n';
  end if;

  ---------------------------------------------------------------- R6 the last order's products
  select id, units_per_shrink, shrink_price_excl_vat into v_prod, v_units, v_price from public.products
   where org_id = c_gf and active and is_stock_tracked and coalesce(units_per_shrink, 0) > 2
     and coalesce(shrink_price_excl_vat, 0) > 0
   order by name limit 1;
  if v_prod is null then
    v_fail := v_fail || 'R6 fixture missing: an orderable product with a shrink size' || E'\n';
  else
    select id into v_c1_order from public.orders where org_id = c_gf and order_number = 'ZZ-RO-C1';
    -- One and a half shrinks and a bit: three shrinks, not two.
    insert into public.order_lines (org_id, order_id, product_id, qty_ordered, line_status, client_generated_id)
    values (c_gf, v_c1_order, v_prod, 2 * v_units + 1, 'open', gen_random_uuid());
    -- Priced per shrink: 2 shrinks. Two lines with no product: counted. A note
    -- with no price: not a product, not counted.
    insert into public.tax_invoice_lines (invoice_id, position, product_id, description, qty, unit_price, line_total)
    select t.id, x.pos, x.product, x.descr, x.qty, x.price, x.qty * x.price
      from public.tax_invoices t,
           (values (1, v_prod, 'Matched', 2::numeric, v_price),
                   (2, null::uuid, 'Not in Tickd', 1, 100::numeric),
                   (3, null, 'Also not in Tickd', 4, 100),
                   (4, null, 'As invoiced in QuickBooks', 1, 0)) as x(pos, product, descr, qty, price)
     where t.org_id = c_gf and t.invoice_number = 'ZZ9101';
    -- The same product invoiced per single item, on the void-invoice store
    -- (whose only other invoice is void, so this is its last order): two
    -- shrinks and one item over is 3 shrinks.
    insert into public.tax_invoices (org_id, invoice_number, source, kind, store_id, seller_name, customer_name,
                                     issue_date, due_date, vat_rate, subtotal, vat, total)
    values (c_gf, 'ZZ9104', 'quickbooks', 'standard', v_k, 'Gold Fortune', 'Test',
            v_today - 2, v_today + 28, 14, 10, 1.4, 11.4);
    insert into public.tax_invoice_lines (invoice_id, position, product_id, description, qty, unit_price, line_total)
    select t.id, 1, v_prod, 'Per item', v_units * 2 + 1, round(v_price / v_units, 2), 1
      from public.tax_invoices t where t.org_id = c_gf and t.invoice_number = 'ZZ9104';

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select last_lines, last_lines_missing into v_lines, v_missing from public.store_reorder() where store_id = v_c;
    if v_lines is distinct from jsonb_build_array(jsonb_build_object('product_id', v_prod, 'shrinks', 3)) or v_missing <> 0 then
      v_fail := v_fail || format('R6 a Tickd order''s lines: %s, missing %s', v_lines, v_missing) || E'\n';
    end if;
    select last_lines, last_lines_missing into v_lines, v_missing from public.store_reorder() where store_id = v_e;
    if v_lines is distinct from jsonb_build_array(jsonb_build_object('product_id', v_prod, 'shrinks', 2)) or v_missing <> 2 then
      v_fail := v_fail || format('R6 a QuickBooks invoice''s lines: %s, missing %s', v_lines, v_missing) || E'\n';
    end if;
    select last_lines, last_lines_missing into v_lines, v_missing from public.store_reorder() where store_id = v_k;
    if v_lines is distinct from jsonb_build_array(jsonb_build_object('product_id', v_prod, 'shrinks', 3)) or v_missing <> 0 then
      v_fail := v_fail || format('R6 a QuickBooks line priced per item: %s, missing %s', v_lines, v_missing) || E'\n';
    end if;
    select last_lines, last_lines_missing into v_lines, v_missing from public.store_reorder() where store_id = v_a;
    if v_lines <> '[]'::jsonb or v_missing <> 0 then
      v_fail := v_fail || format('R6 a store that never ordered has lines: %s', v_lines) || E'\n';
    end if;
    reset role;
  end if;

  ---------------------------------------------------------------- R7 the reasons
  -- Another rep's reason, written as the owner so the rep has something not to see.
  insert into public.order_declines (org_id, store_id, rep_id, client_generated_id, reason)
  values (c_gf, v_b, v_other, gen_random_uuid(), 'price');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.order_declines (org_id, store_id, rep_id, visit_client_generated_id, client_generated_id, reason, note)
    values (c_gf, v_b, v_rep, '00000000-0000-4000-8000-00000000ab01', gen_random_uuid(), 'has_stock', 'Suite');
  exception when others then
    v_fail := v_fail || 'R7 a rep could not record their own reason: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.order_declines (org_id, store_id, rep_id, client_generated_id, reason)
    values (c_gf, v_b, v_other, gen_random_uuid(), 'price');
    v_fail := v_fail || 'R7 a rep recorded a reason as somebody else' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.order_declines (org_id, store_id, rep_id, visit_client_generated_id, client_generated_id, reason)
    values (c_gf, v_b, v_rep, '00000000-0000-4000-8000-00000000ab01', gen_random_uuid(), 'price');
    v_fail := v_fail || 'R7 a second reason for one visit was kept' || E'\n';
  exception when unique_violation then null;
  end;
  select count(*) into v_n from public.order_declines where store_id = v_b;
  if v_n <> 1 then
    v_fail := v_fail || format('R7 the rep sees %s reasons at the store, expected only their own 1', v_n) || E'\n';
  end if;
  begin
    update public.order_declines set reason = 'other' where store_id = v_b;
    get diagnostics v_n = row_count;
    if v_n <> 0 then v_fail := v_fail || 'R7 a rep changed a reason' || E'\n'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.order_declines where store_id = v_b;
    get diagnostics v_n = row_count;
    if v_n <> 0 then v_fail := v_fail || 'R7 a rep deleted a reason' || E'\n'; end if;
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.order_declines where store_id = v_b;
  if v_n <> 2 then
    v_fail := v_fail || format('R7 the manager sees %s reasons at the store, expected 2', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- R8 a year's sales
  select coalesce(sum(sales_excl_vat), -1) into v_n from public.store_year_sales() where store_id = v_e;
  if v_n <> 10 then
    v_fail := v_fail || format('R8 the QuickBooks-only store bought %s in the year, expected 10', v_n) || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform count(*) from public.store_year_sales();
    v_fail := v_fail || 'R8 a rep read what each store bought' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------- R5 grants and the module
  if not (select prosecdef from pg_proc where oid = 'public.store_reorder()'::regprocedure) then
    v_fail := v_fail || 'R5 store_reorder is not security definer' || E'\n';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.store_reorder()'::regprocedure
                    and proconfig::text like '%search_path=public, pg_temp%') then
    v_fail := v_fail || 'R5 store_reorder has no pinned search_path' || E'\n';
  end if;
  if has_function_privilege('anon', 'public.store_reorder()', 'execute') then
    v_fail := v_fail || 'R5 anon can call store_reorder' || E'\n';
  end if;
  if not has_function_privilege('authenticated', 'public.store_reorder()', 'execute') then
    v_fail := v_fail || 'R5 authenticated cannot call store_reorder' || E'\n';
  end if;
  if (select module_code from public.module_assignments where kind = 'table' and name = 'order_declines')
       is distinct from 'distribution'
     or not exists (select 1 from pg_policies where tablename = 'order_declines' and policyname = 'module_gate'
                     and permissive = 'RESTRICTIVE') then
    v_fail := v_fail || 'R5 order_declines is not gated on distribution' || E'\n';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.store_year_sales()'::regprocedure)
     or has_function_privilege('anon', 'public.store_year_sales()', 'execute') then
    v_fail := v_fail || 'R5 store_year_sales is definer or open to anon' || E'\n';
  end if;
  if (select module_code from public.module_assignments where kind = 'function' and name = 'store_reorder')
       is distinct from 'distribution' then
    v_fail := v_fail || 'R5 store_reorder is not registered to distribution' || E'\n';
  end if;

  -- Distribution off (warehouse depends on it, so it goes first).
  update public.company_modules set enabled = false
   where org_id = c_gf and module_code in ('warehouse');
  update public.company_modules set enabled = false
   where org_id = c_gf and module_code = 'distribution';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform count(*) from public.store_reorder();
    v_fail := v_fail || 'R5 store_reorder answered with distribution off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise exception '%', case when v_fail = ''
    then format('STORE REORDER SUITE PASSED (live: %s active stores, %s with an order, %s with a rhythm, %s due today or earlier)',
                v_all, v_ever, v_rhythm, v_due)
    else E'STORE REORDER SUITE FAILED\n' || v_fail end;
end;
$$;
