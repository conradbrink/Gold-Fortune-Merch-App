-- Store reorder suite: when each store last ordered and when it is due again
-- (20261015100000, 15 Oct 2026).
--
--   R1  Fixtures with known dates: never ordered; one order 10 days ago; a
--       store that orders every 14 days; one that orders every 60 days (due at
--       the 30-day rule, not its own 60); QuickBooks history only; a cancelled
--       order that does not count; a void invoice that does not count; an
--       imported invoice that names its order, counted once; two orders on one
--       day, one order day; an order more than a year ago, outside the rhythm
--       but still the last order; a back-order that is not a new order; an
--       inactive store left out.
--   R2  The company's rule: at 21 days the 60-day store is due after 21 and the
--       14-day store stays at 14.
--   R3  A rep sees exactly what a manager sees, orders taken by anyone
--       included (they cannot read those orders themselves).
--   R4  Live: one row per active store; due_on is always last order + due
--       after; due after never exceeds the rule.
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
  v_g_order uuid;
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
      ('ZZ-RO-L1', v_l, null, 'new', 400)
    ) as x(num, store, rep, status, ago);
  select id into v_g_order from public.orders where org_id = c_gf and order_number = 'ZZ-RO-G1';
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
    -- The imported invoice of order G1, two days after it: the same order.
    (c_gf, 'ZZ9102', 'quickbooks', 'standard', v_g_order, 'ZZ-RO-G1', v_g, 'issued', null,
     'Gold Fortune', 'Test', v_today - 18, v_today + 12, 14, 10, 1.4, 11.4),
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
    elsif r.store_id = v_g and not (r.last_order_on = v_today - 20 and r.last_order_ref = 'ZZ-RO-G1'
                                    and r.order_days_year = 1) then
      v_fail := v_fail || format('R1 an imported invoice counted beside its order: %s', row_to_json(r)) || E'\n';
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
  if (select count(*) from public.store_reorder() where store_name like 'ZZ reorder %') <> 10 then
    v_fail := v_fail || format('R1 expected 10 fixture stores, found %s',
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
