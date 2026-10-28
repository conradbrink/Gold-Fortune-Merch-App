-- A quote for someone new becomes an order: 20261028113700_quote_convert_adds_customer.
--
--   C1  Someone not on the books: quote_convert adds them (name and address
--       from the quote, spacing tidied), points the quote at them, and the
--       order is theirs; the quote is converted.
--   C2  Someone already on the books under the same name, typed in other
--       case and spacing: that customer is used, nobody is added.
--   C3  Two active customers of that name: refused, naming them, and
--       nothing changes (no customer, no order, the quote as it was).
--   C4  A quote that cannot become an order (a typed line) adds nobody.
--   C5  A quote picked from the books converts as before.
--   C6  Someone without the warehouse permission cannot add a customer this
--       way, is told so in words, and nothing is left behind.
--   C7  quote_convert keeps its security: invoker, a fixed search_path, no
--       execute for anon or PUBLIC.
--
-- quote_convert is called at the top level of the block, never inside a
-- begin/exception, when it is expected to succeed: quote_mark_converted only
-- accepts an order made by the transaction itself (o.xmin =
-- pg_current_xact_id()), and a subtransaction's rows carry their own xid.
-- Refusals happen before any order is made, so those are caught. Runs on its
-- own, not stacked.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_mgr uuid; v_rep uuid; v_store uuid; v_product uuid;
  v_q uuid; v_order uuid; v_new uuid; v_dup1 uuid; v_dup2 uuid;
  v_stores int; v_orders int; v_snap text; v_err text; r record;
  v_name text := 'ZZ Quote Customer ' || left(md5(random()::text), 6);
begin
  select p.id into v_mgr from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role in ('admin', 'manager')
   order by p.role, p.created_at, p.id limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
     and not exists (select 1 from public.profile_permissions pp
                      where pp.profile_id = p.id and pp.permission_code = 'warehouse')
   order by p.created_at, p.id limit 1;
  select id into v_store from public.stores where org_id = c_gf and active order by name, id limit 1;
  select id into v_product from public.products where org_id = c_gf and active order by name, id limit 1;
  if v_mgr is null or v_store is null or v_product is null then
    raise exception 'Fixtures missing: manager %, store %, product %', v_mgr, v_store, v_product;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- C1 someone new
  insert into public.quotes (org_id, quote_number, customer_name, customer_address, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), '  ' || replace(v_name, ' ', '   ') || ' ',
          ' 12 Main Road, Maun ', 'customer suite')
  returning id into v_q;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price)
  values (c_gf, v_q, 1, v_product, 2, 10);
  update public.quotes set status = 'accepted' where id = v_q;
  select count(*) into v_stores from public.stores where org_id = c_gf;

  v_order := public.quote_convert(v_q);
  v_checks := v_checks + 1;
  select s.id, s.name, s.address, s.active into r
    from public.orders o join public.stores s on s.id = o.store_id where o.id = v_order;
  v_new := r.id;
  if r.name is distinct from v_name or r.address is distinct from '12 Main Road, Maun' or not r.active then
    v_fail := v_fail || format('C1 the order went to %s (%s, %s)', r.name, r.address, r.active) || E'\n';
  end if;
  if (select count(*) from public.stores where org_id = c_gf) <> v_stores + 1 then
    v_fail := v_fail || 'C1 not exactly one customer was added' || E'\n';
  end if;
  select status, store_id, converted_order_id into r from public.quotes where id = v_q;
  if (r.status, r.store_id, r.converted_order_id) is distinct from ('converted', v_new, v_order) then
    v_fail := v_fail || 'C1 the quote is ' || row_to_json(r)::text || E'\n';
  end if;

  ---------------------------------------------------------------- C2 already on the books
  insert into public.quotes (org_id, quote_number, customer_name, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), upper(v_name), 'customer suite')
  returning id into v_q;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price)
  values (c_gf, v_q, 1, v_product, 1, 10);
  update public.quotes set status = 'accepted' where id = v_q;
  select count(*) into v_stores from public.stores where org_id = c_gf;

  v_order := public.quote_convert(v_q);
  v_checks := v_checks + 1;
  if (select store_id from public.orders where id = v_order) is distinct from v_new
     or (select store_id from public.quotes where id = v_q) is distinct from v_new then
    v_fail := v_fail || 'C2 the customer of the same name was not used' || E'\n';
  end if;
  if (select count(*) from public.stores where org_id = c_gf) <> v_stores then
    v_fail := v_fail || 'C2 a customer was added though one has the name' || E'\n';
  end if;

  ---------------------------------------------------------------- C3 two of that name
  reset role;
  insert into public.stores (org_id, name) values (c_gf, v_name || ' Twin') returning id into v_dup1;
  insert into public.stores (org_id, name) values (c_gf, lower(v_name) || ' twin') returning id into v_dup2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.quotes (org_id, quote_number, customer_name, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), v_name || ' Twin', 'customer suite')
  returning id into v_q;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price)
  values (c_gf, v_q, 1, v_product, 1, 10);
  update public.quotes set status = 'accepted' where id = v_q;
  select count(*) into v_stores from public.stores where org_id = c_gf;
  select count(*) into v_orders from public.orders where org_id = c_gf;
  select md5(q::text) into v_snap from public.quotes q where q.id = v_q;
  begin
    perform public.quote_convert(v_q);
    v_fail := v_fail || 'C3 a name shared by two customers was converted' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'More than one customer on your books is called "%Twin". Choose which one on the quote first.' then
      v_fail := v_fail || 'C3 refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  if (select count(*) from public.stores where org_id = c_gf) <> v_stores
     or (select count(*) from public.orders where org_id = c_gf) <> v_orders
     or (select md5(q::text) from public.quotes q where q.id = v_q) is distinct from v_snap then
    v_fail := v_fail || 'C3 the refusal left something behind' || E'\n';
  end if;

  ---------------------------------------------------------------- C4 cannot become an order
  insert into public.quotes (org_id, quote_number, customer_name, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), v_name || ' Typed', 'customer suite')
  returning id into v_q;
  insert into public.quote_lines (org_id, quote_id, position, description, qty, list_price)
  values (c_gf, v_q, 1, 'Call-out', 1, 10);
  update public.quotes set status = 'accepted' where id = v_q;
  select count(*) into v_stores from public.stores where org_id = c_gf;
  begin
    perform public.quote_convert(v_q);
    v_fail := v_fail || 'C4 a quote with a typed line was converted' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Only a quote of whole products%' then
      v_fail := v_fail || 'C4 refused for another reason: ' || v_err || E'\n';
    end if;
  end;
  v_checks := v_checks + 1;
  if (select count(*) from public.stores where org_id = c_gf) <> v_stores then
    v_fail := v_fail || 'C4 a customer was added for a quote that cannot become an order' || E'\n';
  end if;

  ---------------------------------------------------------------- C5 picked from the books
  insert into public.quotes (org_id, quote_number, store_id, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), v_store, 'customer suite')
  returning id into v_q;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price)
  values (c_gf, v_q, 1, v_product, 1, 10);
  update public.quotes set status = 'accepted' where id = v_q;
  select count(*) into v_stores from public.stores where org_id = c_gf;
  v_order := public.quote_convert(v_q);
  v_checks := v_checks + 1;
  if (select store_id from public.orders where id = v_order) is distinct from v_store
     or (select count(*) from public.stores where org_id = c_gf) <> v_stores then
    v_fail := v_fail || 'C5 a quote picked from the books changed' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- C6 no warehouse permission
  if v_rep is null then
    v_fail := v_fail || 'C6 fixture: no rep without the warehouse permission' || E'\n';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if public.has_permission('warehouse') then
      v_fail := v_fail || 'C6 fixture: the rep has the warehouse permission' || E'\n';
    end if;
    reset role;
    insert into public.quotes (org_id, quote_number, customer_name, rep_id, notes)
    values (c_gf, 'QZ-' || left(md5(random()::text), 8), v_name || ' Rep', v_rep, 'customer suite')
    returning id into v_q;
    insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price)
    values (c_gf, v_q, 1, v_product, 1, 10);
    update public.quotes set status = 'accepted' where id = v_q;
    select count(*) into v_stores from public.stores where org_id = c_gf;
    perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.quote_convert(v_q);
      v_fail := v_fail || 'C6 a rep without the warehouse permission converted and added a customer' || E'\n';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%adding a customer needs the warehouse permission%' then
        v_fail := v_fail || 'C6 refused for another reason: ' || v_err || E'\n';
      end if;
    end;
    reset role;
    v_checks := v_checks + 1;
    if (select count(*) from public.stores where org_id = c_gf) <> v_stores
       or (select store_id from public.quotes where id = v_q) is not null then
      v_fail := v_fail || 'C6 the refusal left a customer or a pointer behind' || E'\n';
    end if;
  end if;

  ---------------------------------------------------------------- C7 security
  select bool_and(not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)) as ok
    into r from pg_proc p where p.oid = 'public.quote_convert(uuid)'::regprocedure;
  v_checks := v_checks + 1;
  if not coalesce(r.ok, false) then
    v_fail := v_fail || 'C7 quote_convert lost its security settings' || E'\n';
  end if;

  if v_fail = '' then
    raise exception 'quote_convert_customer: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'quote_convert_customer: FAIL\n%', v_fail;
end;
$$;
