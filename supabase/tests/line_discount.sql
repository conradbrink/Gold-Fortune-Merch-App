-- Line discount as a percentage or an amount suite (9 Oct 2026).
--
--   D1  Quote lines: an amount off the whole line sets the unit price (spread
--       over the quantity, to the cent); a percentage works as before; both
--       at once, a negative amount and more than the line is worth are refused.
--   D2  Order lines: the same through the trigger; a phone that sends only a
--       price (or a percentage) is unchanged; a price typed over the line
--       replaces the amount; a new quantity spreads the amount again; no
--       price, or more than the line is worth, is refused.
--   D3  A quote with an amount, turned into an order, keeps it.
--   D4  A recurring order keeps its amount, and places the order at the
--       price less the amount spread over the quantity.
--   D5  Grants: the amount is writable where the percentage is.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. It writes Gold Fortune rows only
-- inside that block.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_store uuid; v_product uuid; v_p2 uuid; v_p3 uuid;
  v_quote uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid;
  v_order uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_converted uuid;
  v_rec uuid; v_placed uuid;
  v_price numeric; v_n int; v_ok boolean;
begin
  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select s.id into v_store from public.stores s where s.org_id = c_gf order by s.created_at limit 1;
  select p.id, p.shrink_price_excl_vat / nullif(p.units_per_shrink, 0) into v_product, v_price
    from public.products p
   where p.org_id = c_gf and p.shrink_price_excl_vat > 0 and p.units_per_shrink > 0
   order by p.created_at limit 1;
  select p.id into v_p2 from public.products p where p.org_id = c_gf and p.id <> v_product order by p.created_at limit 1;
  select p.id into v_p3 from public.products p where p.org_id = c_gf and p.id not in (v_product, v_p2) order by p.created_at limit 1;
  if v_admin is null or v_store is null or v_product is null or v_p3 is null then
    raise exception 'Fixtures missing: admin %, store %, product %', v_admin, v_store, v_product;
  end if;

  ---------------------------------------------------------------- D1 quote lines
  insert into public.quotes (org_id, quote_number, store_id)
  values (c_gf, 'ZZ-DISCOUNT-1', v_store) returning id into v_quote;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price, discount_amount)
  values (c_gf, v_quote, 1, v_product, 10, 59.95, 50) returning id into v_l1;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price, discount_amount)
  values (c_gf, v_quote, 2, v_p2, 3, 20, 50) returning id into v_l2;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price, discount_pct)
  values (c_gf, v_quote, 3, v_p3, 10, 159.50, 10) returning id into v_l3;
  if (select unit_price from public.quote_lines where id = v_l1) <> 54.95
     or (select unit_price from public.quote_lines where id = v_l2) <> 3.33
     or (select unit_price from public.quote_lines where id = v_l3) <> 143.55 then
    v_fail := v_fail || format('D1 quote unit prices are %s, %s, %s, not 54.95, 3.33, 143.55',
      (select unit_price from public.quote_lines where id = v_l1),
      (select unit_price from public.quote_lines where id = v_l2),
      (select unit_price from public.quote_lines where id = v_l3)) || E'\n';
  end if;
  begin
    update public.quote_lines set discount_pct = 5 where id = v_l1;
    v_fail := v_fail || 'D1 a quote line took a percentage and an amount' || E'\n';
  exception when check_violation then null;
  end;
  begin
    update public.quote_lines set discount_amount = 600 where id = v_l1;
    v_fail := v_fail || 'D1 a quote line took more off than it is worth' || E'\n';
  exception when check_violation then null;
  end;
  begin
    update public.quote_lines set discount_amount = -1 where id = v_l1;
    v_fail := v_fail || 'D1 a quote line took a negative amount' || E'\n';
  exception when check_violation then null;
  end;

  ---------------------------------------------------------------- D2 order lines
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-DISCOUNT-SO', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_order;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, discount_amount, client_generated_id)
  values (c_gf, v_order, v_product, 3, 20, 50, gen_random_uuid()) returning id into v_o1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, discount_pct, client_generated_id)
  values (c_gf, v_order, v_p2, 2, 100, 10, gen_random_uuid()) returning id into v_o2;
  -- As a phone sends it: a price, nothing else.
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_order, v_p3, 4, 12.34, gen_random_uuid()) returning id into v_o3;
  if (select (list_price, unit_price, discount_amount) from public.order_lines where id = v_o1) is distinct from (20::numeric, 3.33::numeric, 50::numeric)
     or (select (list_price, unit_price) from public.order_lines where id = v_o2) is distinct from (100::numeric, 90::numeric)
     or (select (list_price, unit_price, discount_pct, discount_amount) from public.order_lines where id = v_o3)
          is distinct from (null::numeric, 12.34::numeric, 0::numeric, 0::numeric) then
    v_fail := v_fail || 'D2 order line prices are wrong after insert' || E'\n';
  end if;
  update public.order_lines set qty_ordered = 10 where id = v_o1;
  if (select unit_price from public.order_lines where id = v_o1) <> 15 then
    v_fail := v_fail || 'D2 a new quantity did not spread the amount again' || E'\n';
  end if;
  update public.order_lines set unit_price = 18 where id = v_o1;
  if (select (list_price, unit_price, discount_amount) from public.order_lines where id = v_o1)
       is distinct from (null::numeric, 18::numeric, 0::numeric) then
    v_fail := v_fail || 'D2 a price typed over the line kept its amount' || E'\n';
  end if;
  begin
    update public.order_lines set discount_amount = 5 where id = v_o2;
    v_fail := v_fail || 'D2 an order line took a percentage and an amount' || E'\n';
  exception when check_violation then null;
  end;
  begin
    update public.order_lines set discount_pct = 0, discount_amount = 1000 where id = v_o2;
    v_fail := v_fail || 'D2 an order line took more off than it is worth' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    update public.order_lines set unit_price = null, list_price = null, discount_amount = 5 where id = v_o3;
    v_fail := v_fail || 'D2 an amount off no price was taken' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------- D3 quote to order
  -- quote_convert cannot run inside a suite's savepoint (quote_mark_converted
  -- checks the order was made in the top transaction), so this makes the
  -- order lines exactly as it does, and checks that it carries the amount.
  insert into public.orders (org_id, order_number, store_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-DISCOUNT-SO2', v_store, 'warehouse_manual', 'other', gen_random_uuid()) returning id into v_converted;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered,
                                  unit_price, list_price, discount_pct, discount_amount, client_generated_id)
  select c_gf, v_converted, l.product_id, l.qty::integer,
         l.list_price, l.list_price, l.discount_pct, l.discount_amount, gen_random_uuid()
    from public.quote_lines l where l.quote_id = v_quote and l.id <> v_l2;
  select count(*) into v_n from public.order_lines
   where order_id = v_converted
     and ((qty_ordered = 10 and list_price = 59.95 and discount_amount = 50 and unit_price = 54.95)
          or (qty_ordered = 10 and list_price = 159.50 and discount_pct = 10 and unit_price = 143.55));
  if v_n <> 2
     or (select prosrc from pg_proc where oid = 'public.quote_convert(uuid)'::regprocedure)
          not like '%l.discount_pct, x.discount_amount, gen_random_uuid()%' then
    v_fail := v_fail || format('D3 the order from the quote has %s of its 2 lines as quoted, or quote_convert drops the amount', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- D4 recurring orders
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_rec := public.recurring_order_save(null,
    jsonb_build_object('name', 'ZZ discount check', 'store_id', v_store, 'rep_id', '', 'contact_name', null,
                       'contact_phone', null, 'frequency', 'weekly', 'next_run', current_date, 'max_runs', '', 'notes', null),
    jsonb_build_array(
      jsonb_build_object('product_id', v_product, 'qty', 4, 'unit_price', '25', 'discount_pct', '0', 'discount_amount', '10'),
      jsonb_build_object('product_id', v_p2, 'qty', 2, 'unit_price', '', 'discount_pct', '50')));
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.recurring_order_lines where recurring_order_id = v_rec and discount_amount = 10 and qty = 4) then
    v_fail := v_fail || 'D4 the recurring order did not keep its amount' || E'\n';
  end if;
  v_placed := public.recurring_order_place(v_rec, current_date);
  if not exists (select 1 from public.order_lines where order_id = v_placed and qty_ordered = 4 and unit_price = 22.5)
     or not exists (select 1 from public.order_lines l join public.products p on p.id = l.product_id
                     where l.order_id = v_placed and l.qty_ordered = 2
                       and l.unit_price is not distinct from round(p.shrink_price_excl_vat / nullif(p.units_per_shrink, 0) * 0.5, 2)) then
    v_fail := v_fail || 'D4 the placed order''s prices are wrong' || E'\n';
  end if;

  ---------------------------------------------------------------- D5 grants
  if not has_column_privilege('authenticated', 'public.quote_lines', 'discount_amount', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.order_lines', 'discount_amount', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.quote_lines', 'discount_amount', 'INSERT')
     or not has_column_privilege('authenticated', 'public.order_lines', 'discount_amount', 'INSERT') then
    v_fail := v_fail || 'D5 the amount is not writable where the percentage is' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'LINE DISCOUNT FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL LINE DISCOUNT CHECKS PASSED (rolled back)';
end;
$$;
