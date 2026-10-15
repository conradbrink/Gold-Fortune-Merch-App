-- Price lists suite: a price list per store group, and order lines priced from
-- it (20261015210000, 15 Oct 2026).
--
--   P1  price_list_save creates a list with its prices and gives it a group.
--   P2  store_unit_price: the group's list price per unit; the product's own
--       price for a product the list leaves out, for a store with no group,
--       and for a group with no list; nothing without a pack size or a price.
--   P3  New order lines: a rep's unpriced line takes the store's price (the
--       rep cannot read the list itself); a line that brings a price, or a
--       discount, keeps what it brings; an order for a store with no group
--       takes the catalogue price.
--   P4  A recurring order line with no fixed price takes the list price, its
--       discount applied.
--   P5  Saving again replaces: a new name, only the prices sent (a product
--       dropped falls back to its own price), a group taken from another list,
--       a group no longer named let go.
--   P6  Refusals: a name already used (any case), no name, another company's
--       product or group or list, a negative price, a product twice, prices
--       that are not a list. A group cannot point at another company's list.
--   P7  Who: a rep can neither save nor read a list; the manager reads it.
--   P8  price_list_delete: the groups go back to the products' own prices.
--   P9  Grants, security definer with a pinned search_path, the internal
--       functions not callable, the module registration, and both RPCs
--       refusing with distribution off.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_unproven text := '';
  v_mgr uuid; v_rep uuid; v_other_org uuid; v_other_product uuid; v_other_group uuid; v_other_list uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_g1 uuid; v_g2 uuid; v_g3 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  v_l1 uuid; v_l2 uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_ro uuid; v_placed uuid;
  v_n int; v_num numeric; v_txt text;
  r record;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by created_at limit 1;
  if v_mgr is null or v_rep is null then
    raise exception 'Fixtures missing: a Gold Fortune manager and a rep are needed.';
  end if;

  ------------------------------------------------------------------ fixtures
  -- Products with known prices: P1 10 a case at 100.00; P2 50 a case at
  -- 272.37 (5.4474 a unit); P3 no pack size; P4 no price of its own.
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ price P1', 10, 100.00) returning id into v_p1;
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ price P2', 50, 272.37) returning id into v_p2;
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ price P3', null, 50.00) returning id into v_p3;
  insert into public.products (org_id, name, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ price P4', 12, null) returning id into v_p4;

  insert into public.store_groups (org_id, name) values (c_gf, 'ZZ price group 1') returning id into v_g1;
  insert into public.store_groups (org_id, name) values (c_gf, 'ZZ price group 2 no list') returning id into v_g2;
  insert into public.store_groups (org_id, name) values (c_gf, 'ZZ price group 3') returning id into v_g3;
  insert into public.stores (org_id, name, store_group_id) values (c_gf, 'ZZ price S1 group 1', v_g1) returning id into v_s1;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ price S2 no group') returning id into v_s2;
  insert into public.stores (org_id, name, store_group_id) values (c_gf, 'ZZ price S3 group 2', v_g2) returning id into v_s3;

  -- Another company, for P6. Any will do: nothing is written to it but a
  -- list, a product and a group of its own, all rolled back.
  select id into v_other_org from public.organizations where id <> c_gf order by created_at limit 1;
  if v_other_org is not null then
    insert into public.products (org_id, name) values (v_other_org, 'ZZ price other company')
    returning id into v_other_product;
    insert into public.store_groups (org_id, name) values (v_other_org, 'ZZ price other group')
    returning id into v_other_group;
    insert into public.customer_price_lists (org_id, name) values (v_other_org, 'ZZ price other list')
    returning id into v_other_list;
  else
    v_unproven := v_unproven || '  P6 another company''s product, group and list: there is no other company' || E'\n';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.has_permission('invoicing') then
    raise exception 'Fixtures broken: the Gold Fortune manager does not have invoicing.';
  end if;

  ---------------------------------------------------------------- P1 create
  v_l1 := public.price_list_save(null, '  ZZ Forecourts  ', array[v_g1],
    jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'price', 120),
      jsonb_build_object('product_id', v_p2, 'price', 294.16),
      jsonb_build_object('product_id', v_p4, 'price', 60.004)));
  v_l2 := public.price_list_save(null, 'ZZ Other', array[v_g3],
    jsonb_build_array(jsonb_build_object('product_id', v_p1, 'price', 150)));
  reset role;

  if (select name from public.customer_price_lists where id = v_l1) is distinct from 'ZZ Forecourts' then
    v_fail := v_fail || 'P1 the name is not trimmed' || E'\n';
  end if;
  select count(*) into v_n from public.customer_price_list_items where price_list_id = v_l1;
  if v_n <> 3 then
    v_fail := v_fail || format('P1 %s prices saved, not 3', v_n) || E'\n';
  end if;
  if (select shrink_price_excl_vat from public.customer_price_list_items
       where price_list_id = v_l1 and product_id = v_p4) <> 60.00 then
    v_fail := v_fail || 'P1 a price is not rounded to the cent' || E'\n';
  end if;
  if (select price_list_id from public.store_groups where id = v_g1) is distinct from v_l1
     or (select price_list_id from public.store_groups where id = v_g3) is distinct from v_l2 then
    v_fail := v_fail || 'P1 the groups were not given their lists' || E'\n';
  end if;

  ------------------------------------------------------- P2 store_unit_price
  for r in
    select * from (values
      ('S1 P1 list', public.store_unit_price(v_s1, v_p1), 12.00::numeric),
      ('S1 P2 list', public.store_unit_price(v_s1, v_p2), 5.88),
      ('S1 P3 off the list, no pack size', public.store_unit_price(v_s1, v_p3), null),
      ('S1 P4 list, no own price', public.store_unit_price(v_s1, v_p4), 5.00),
      ('S2 P1 no group', public.store_unit_price(v_s2, v_p1), 10.00),
      ('S2 P2 no group', public.store_unit_price(v_s2, v_p2), 5.45),
      ('S2 P4 no group, no own price', public.store_unit_price(v_s2, v_p4), null),
      ('S3 P1 group with no list', public.store_unit_price(v_s3, v_p1), 10.00),
      ('no store', public.store_unit_price(null, v_p1), 10.00)
    ) as t(label, got, want)
  loop
    if r.got is distinct from r.want then
      v_fail := v_fail || format('P2 %s: %s, not %s', r.label, r.got, r.want) || E'\n';
    end if;
  end loop;

  ------------------------------------------------------- P3 new order lines
  -- The rep, from the phone: no prices on any line.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-PL-1', v_s1, v_rep, 'rep_app', 'rep_visit', gen_random_uuid()) returning id into v_o1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  select c_gf, v_o1, p, 10, null, gen_random_uuid() from unnest(array[v_p1, v_p2, v_p3, v_p4]) p;
  insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-PL-2', v_s2, v_rep, 'rep_app', 'rep_visit', gen_random_uuid()) returning id into v_o2;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o2, v_p2, 50, null, gen_random_uuid());
  reset role;

  for r in
    select l.product_id, l.unit_price, l.list_price,
           case l.product_id when v_p1 then 12.00 when v_p2 then 5.88 when v_p4 then 5.00 end as want
      from public.order_lines l where l.order_id = v_o1
  loop
    if r.unit_price is distinct from r.want or r.list_price is not null then
      v_fail := v_fail || format('P3 rep line %s: %s (list %s), not %s', r.product_id, r.unit_price, r.list_price, r.want) || E'\n';
    end if;
  end loop;
  if (select unit_price from public.order_lines where order_id = v_o2) is distinct from 5.45 then
    v_fail := v_fail || 'P3 a store with no group did not get the catalogue price' || E'\n';
  end if;

  -- The office: a price typed in, and a discounted line, are kept as typed.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-PL-3', v_s1, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_o3;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o3, v_p1, 10, 9.99, gen_random_uuid());
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, discount_pct, client_generated_id)
  values (c_gf, v_o3, v_p2, 10, 10.00, 10, gen_random_uuid());
  reset role;

  if (select unit_price from public.order_lines where order_id = v_o3 and product_id = v_p1) is distinct from 9.99 then
    v_fail := v_fail || 'P3 a typed price was replaced' || E'\n';
  end if;
  select unit_price into v_num from public.order_lines where order_id = v_o3 and product_id = v_p2;
  if v_num is distinct from 9.00 then
    v_fail := v_fail || format('P3 a discounted line is %s, not 9.00', v_num) || E'\n';
  end if;

  --------------------------------------------------------- P4 recurring orders
  insert into public.recurring_orders (org_id, name, store_id, frequency, next_run)
  values (c_gf, 'ZZ price recurring', v_s1, 'weekly', current_date) returning id into v_ro;
  insert into public.recurring_order_lines (recurring_order_id, product_id, qty, unit_price, discount_pct)
  values (v_ro, v_p1, 10, null, 0), (v_ro, v_p2, 50, null, 10), (v_ro, v_p4, 12, 7.50, 0);
  v_placed := public.recurring_order_place(v_ro, current_date);
  if v_placed is null then
    v_fail := v_fail || 'P4 the recurring order was not placed' || E'\n';
  else
    for r in
      select l.product_id, l.unit_price,
             case l.product_id when v_p1 then 12.00 when v_p2 then 5.29 when v_p4 then 7.50 end as want
        from public.order_lines l where l.order_id = v_placed
    loop
      if r.unit_price is distinct from r.want then
        v_fail := v_fail || format('P4 recurring line %s: %s, not %s', r.product_id, r.unit_price, r.want) || E'\n';
      end if;
    end loop;
  end if;

  ---------------------------------------------------------------- P5 replace
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.price_list_save(v_l1, 'ZZ Forecourts & HRC', array[v_g1, v_g3],
       jsonb_build_array(jsonb_build_object('product_id', v_p1, 'price', 130))) <> v_l1 then
    v_fail := v_fail || 'P5 saving a list returned another id' || E'\n';
  end if;
  reset role;

  if (select name from public.customer_price_lists where id = v_l1) <> 'ZZ Forecourts & HRC' then
    v_fail := v_fail || 'P5 the list was not renamed' || E'\n';
  end if;
  if public.store_unit_price(v_s1, v_p1) is distinct from 13.00
     or public.store_unit_price(v_s1, v_p2) is distinct from 5.45 then
    v_fail := v_fail || format('P5 after replacing: P1 %s (13.00), P2 %s (5.45, its own)',
                               public.store_unit_price(v_s1, v_p1), public.store_unit_price(v_s1, v_p2)) || E'\n';
  end if;
  if (select price_list_id from public.store_groups where id = v_g3) is distinct from v_l1 then
    v_fail := v_fail || 'P5 a group was not taken from its other list' || E'\n';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.price_list_save(v_l1, 'ZZ Forecourts & HRC', array[v_g3],
    jsonb_build_array(jsonb_build_object('product_id', v_p1, 'price', 130)));
  reset role;
  if (select price_list_id from public.store_groups where id = v_g1) is not null then
    v_fail := v_fail || 'P5 a group no longer named kept the list' || E'\n';
  end if;

  ------------------------------------------------------------- P6 refusals
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for r in
    select * from (values
      ('a name already used', 'select public.price_list_save(null, ''zz forecourts & hrc'', null, ''[]'')', '23505'),
      ('no name', 'select public.price_list_save(null, ''   '', null, ''[]'')', '22023'),
      ('a name too long', format('select public.price_list_save(null, %L, null, ''[]'')', repeat('x', 81)), '22023'),
      ('prices that are not a list', 'select public.price_list_save(null, ''ZZ x'', null, ''{}'')', '22023'),
      ('a price with no product', 'select public.price_list_save(null, ''ZZ x'', null, ''[{"price": 1}]'')', '22023'),
      ('a negative price', format('select public.price_list_save(null, ''ZZ x'', null, %L)',
         jsonb_build_array(jsonb_build_object('product_id', v_p1, 'price', -1))), '22023'),
      ('a missing price', format('select public.price_list_save(null, ''ZZ x'', null, %L)',
         jsonb_build_array(jsonb_build_object('product_id', v_p1))), '22023'),
      ('a product twice', format('select public.price_list_save(null, ''ZZ x'', null, %L)',
         jsonb_build_array(jsonb_build_object('product_id', v_p1, 'price', 1),
                           jsonb_build_object('product_id', v_p1, 'price', 2))), '22023'),
      ('a list that does not exist', format('select public.price_list_save(%L, ''ZZ x'', null, ''[]'')', gen_random_uuid()), 'P0002'),
      ('deleting a list that does not exist', format('select public.price_list_delete(%L)', gen_random_uuid()), 'P0002')
    ) as t(label, stmt, want)
  loop
    begin
      execute r.stmt;
      v_fail := v_fail || format('P6 %s was accepted', r.label) || E'\n';
    exception when others then
      if sqlstate <> r.want then
        v_fail := v_fail || format('P6 %s: %s %s, not %s', r.label, sqlstate, sqlerrm, r.want) || E'\n';
      end if;
    end;
  end loop;

  if v_other_org is not null then
    for r in
      select * from (values
        ('another company''s product', format('select public.price_list_save(null, ''ZZ x'', null, %L)',
           jsonb_build_array(jsonb_build_object('product_id', v_other_product, 'price', 1))), '22023'),
        ('another company''s group', format('select public.price_list_save(null, ''ZZ x'', %L, ''[]'')',
           array[v_other_group]), '22023'),
        ('saving over another company''s list', format('select public.price_list_save(%L, ''ZZ x'', null, ''[]'')',
           v_other_list), 'P0002'),
        ('deleting another company''s list', format('select public.price_list_delete(%L)', v_other_list), 'P0002')
      ) as t(label, stmt, want)
    loop
      begin
        execute r.stmt;
        v_fail := v_fail || format('P6 %s was accepted', r.label) || E'\n';
      exception when others then
        if sqlstate <> r.want then
          v_fail := v_fail || format('P6 %s: %s %s, not %s', r.label, sqlstate, sqlerrm, r.want) || E'\n';
        end if;
      end;
    end loop;
  end if;
  -- Nothing half-written by any of the refusals.
  if exists (select 1 from public.customer_price_lists where org_id = c_gf and name = 'ZZ x') then
    v_fail := v_fail || 'P6 a refused save left a list behind' || E'\n';
  end if;
  reset role;

  if v_other_org is not null then
    begin
      update public.store_groups set price_list_id = v_other_list where id = v_g2;
      v_fail := v_fail || 'P6 a group was pointed at another company''s list' || E'\n';
    exception when foreign_key_violation then null;
    end;
    if exists (select 1 from public.customer_price_lists where id = v_other_list and name <> 'ZZ price other list') then
      v_fail := v_fail || 'P6 another company''s list was changed' || E'\n';
    end if;
  end if;

  ------------------------------------------------------------------ P7 who
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.price_list_save(null, 'ZZ rep list', null, '[]');
    v_fail := v_fail || 'P7 a rep saved a price list' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.price_list_delete(v_l1);
    v_fail := v_fail || 'P7 a rep deleted a price list' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.customer_price_lists) > 0
     or (select count(*) from public.customer_price_list_items) > 0 then
    v_fail := v_fail || 'P7 a rep can read price lists' || E'\n';
  end if;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not exists (select 1 from public.customer_price_lists where id = v_l1)
     or not exists (select 1 from public.customer_price_list_items where price_list_id = v_l1) then
    v_fail := v_fail || 'P7 the manager cannot read the list' || E'\n';
  end if;
  if v_other_org is not null and exists (select 1 from public.customer_price_lists where id = v_other_list) then
    v_fail := v_fail || 'P7 the manager reads another company''s list' || E'\n';
  end if;
  begin
    insert into public.customer_price_lists (org_id, name) values (c_gf, 'ZZ direct');
    v_fail := v_fail || 'P7 a list was written past price_list_save' || E'\n';
  exception when insufficient_privilege then null;
  end;

  --------------------------------------------------------------- P8 delete
  perform public.price_list_delete(v_l1);
  reset role;
  if exists (select 1 from public.customer_price_lists where id = v_l1)
     or exists (select 1 from public.customer_price_list_items where price_list_id = v_l1) then
    v_fail := v_fail || 'P8 the list or its prices survived' || E'\n';
  end if;
  if (select price_list_id from public.store_groups where id = v_g3) is not null then
    v_fail := v_fail || 'P8 a group still points at the deleted list' || E'\n';
  end if;
  if public.store_unit_price(v_s1, v_p1) is distinct from 10.00 then
    v_fail := v_fail || 'P8 a store is still priced from the deleted list' || E'\n';
  end if;
  if (select unit_price from public.order_lines where order_id = v_o1 and product_id = v_p1) is distinct from 12.00 then
    v_fail := v_fail || 'P8 an order already priced lost its price' || E'\n';
  end if;

  ---------------------------------------------------------- P9 grants, module
  for r in
    select * from (values
      ('public.price_list_save(uuid, text, uuid[], jsonb)'::regprocedure),
      ('public.price_list_delete(uuid)'::regprocedure)
    ) as t(fn)
  loop
    if not (select prosecdef from pg_proc where oid = r.fn) then
      v_fail := v_fail || format('P9 %s is not security definer', r.fn) || E'\n';
    end if;
    if not exists (select 1 from pg_proc where oid = r.fn
                      and proconfig::text like '%search_path=public, pg_temp%') then
      v_fail := v_fail || format('P9 %s has no pinned search_path', r.fn) || E'\n';
    end if;
    if has_function_privilege('anon', r.fn, 'execute') then
      v_fail := v_fail || format('P9 anon can call %s', r.fn) || E'\n';
    end if;
    if not has_function_privilege('authenticated', r.fn, 'execute') then
      v_fail := v_fail || format('P9 authenticated cannot call %s', r.fn) || E'\n';
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.store_unit_price(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.store_unit_price(uuid, uuid)', 'execute') then
    v_fail := v_fail || 'P9 store_unit_price is callable from outside' || E'\n';
  end if;
  if has_function_privilege('authenticated', 'public.order_lines_price_from_list()', 'execute') then
    v_fail := v_fail || 'P9 the trigger function is callable' || E'\n';
  end if;
  select string_agg(n, ', ') into v_txt
    from unnest(array['customer_price_lists', 'customer_price_list_items', 'price_list_save', 'price_list_delete']) n
   where not exists (select 1 from public.module_assignments a where a.name = n and a.module_code = 'distribution');
  if v_txt is not null then
    v_fail := v_fail || 'P9 not registered to distribution: ' || v_txt || E'\n';
  end if;

  -- Distribution off (warehouse depends on it, so it goes first).
  update public.company_modules set enabled = false
   where org_id = c_gf and module_code = 'warehouse';
  update public.company_modules set enabled = false
   where org_id = c_gf and module_code = 'distribution';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.price_list_save(null, 'ZZ module off', null, '[]');
    v_fail := v_fail || 'P9 price_list_save worked with distribution off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.price_list_delete(v_l2);
    v_fail := v_fail || 'P9 price_list_delete worked with distribution off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.customer_price_lists) then
    v_fail := v_fail || 'P9 price lists are readable with distribution off' || E'\n';
  end if;
  reset role;

  raise exception '%', case when v_fail = ''
    then 'ALL PRICE LIST CHECKS PASSED' ||
         case when v_unproven = '' then '' else E'\nNot proven:\n' || v_unproven end
    else E'PRICE LIST SUITE FAILED\n' || v_fail end;
end;
$$;
