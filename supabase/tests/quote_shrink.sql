-- A quote's product priced per shrink: 20261027154700_quote_shrink_lines (27 Oct 2026).
--
--   S1  quote_save keeps a line's units per shrink and its 'shrink'; a line
--       per unit has neither.
--   S2  A line per shrink is worth qty x the shrink's price, as typed.
--   S3  A typed line with units per shrink is refused, and nothing changes.
--   S4  Units per shrink of 0 is refused, and nothing changes.
--   S5  quote_convert, VAT-exclusive: 2 shrinks of 10 at 771.69 become 20
--       units at 77.17; a line per unit stays as it was; the percentage off
--       stays.
--   S6  quote_convert, VAT-inclusive at 15%: 1 shrink of 10 at 887.44 becomes
--       10 units at 77.17 (887.44 / 1.15 / 10, to the cent); an amount off
--       the line stays the same amount, VAT taken off.
--   S7  quote_save and quote_convert keep their security: invoker, a fixed
--       search_path, no execute for anon or PUBLIC.
--
-- quote_convert is called at the top level of the block, never inside a
-- begin/exception: quote_mark_converted only accepts an order made by the
-- transaction itself (o.xmin = pg_current_xact_id()), and a subtransaction's
-- rows carry their own xid. So this suite runs on its own, not stacked.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_mgr uuid; v_store uuid; v_product uuid; v_product2 uuid;
  v_q uuid; v_q2 uuid; v_at timestamptz; v_order uuid;
  v_shrink uuid := gen_random_uuid();
  v_unit uuid := gen_random_uuid();
  v_snap text; v_err text; r record;
begin
  select p.id into v_mgr from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role in ('admin', 'manager')
   order by p.role, p.created_at, p.id limit 1;
  select id into v_store from public.stores where org_id = c_gf and active order by name, id limit 1;
  select id into v_product from public.products where org_id = c_gf and active order by name, id limit 1;
  select id into v_product2 from public.products where org_id = c_gf and active and id <> v_product order by name, id limit 1;
  if v_mgr is null or v_store is null or v_product is null or v_product2 is null then
    raise exception 'Fixtures missing: manager %, store %, products % %', v_mgr, v_store, v_product, v_product2;
  end if;

  -- A quote takes its VAT basis from the company when it is made (quotes_stamp).
  update public.organizations set prices_include_vat = false where id = c_gf;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.quotes (org_id, quote_number, store_id, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), v_store, 'shrink suite')
  returning id, updated_at into v_q, v_at;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price)
  values (c_gf, v_q, 1, v_product, 1, 1);
  select updated_at into v_at from public.quotes where id = v_q;

  ---------------------------------------------------------------- S1 saved as given
  perform public.quote_save(v_q, v_at, jsonb_build_object('store_id', v_store, 'notes', 'shrink suite'), jsonb_build_array(
    jsonb_build_object('id', v_shrink, 'product_id', v_product, 'unit', 'shrink', 'units_per_shrink', 10,
                       'qty', 2, 'list_price', 771.69, 'discount_pct', 10),
    jsonb_build_object('id', v_unit, 'product_id', v_product2, 'qty', 3, 'list_price', 50)));
  v_checks := v_checks + 1;
  select string_agg(format('%s:%s:%s', position, coalesce(unit, '-'), coalesce(units_per_shrink::text, '-')), ', ' order by position)
    into v_err from public.quote_lines where quote_id = v_q;
  if v_err is distinct from '1:shrink:10, 2:-:-' then
    v_fail := v_fail || 'S1 lines are ' || coalesce(v_err, 'none') || E'\n';
  end if;

  ---------------------------------------------------------------- S2 worth qty x the shrink's price
  v_checks := v_checks + 1;
  select qty, list_price, unit_price into r from public.quote_lines where id = v_shrink;
  if r.qty <> 2 or r.list_price <> 771.69 or r.unit_price <> round(771.69 * 0.9, 2) then
    v_fail := v_fail || format('S2 the shrink line is %s at %s (%s)', r.qty, r.list_price, r.unit_price) || E'\n';
  end if;

  ---------------------------------------------------------------- refusals change nothing
  select updated_at into v_at from public.quotes where id = v_q;
  select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) || md5((select q::text from public.quotes q where q.id = v_q))
    into v_snap from public.quote_lines l where l.quote_id = v_q;

  -- S3 a typed line in shrinks
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('store_id', v_store, 'notes', 'typed'), jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'description', 'Call-out', 'units_per_shrink', 10, 'qty', 1, 'list_price', 10)));
    v_fail := v_fail || 'S3 a typed line in shrinks was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%quote_lines_units_per_shrink%' then v_fail := v_fail || 'S3 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  -- S4 a shrink of nothing
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('store_id', v_store, 'notes', 'zero'), jsonb_build_array(
      jsonb_build_object('id', v_shrink, 'product_id', v_product, 'unit', 'shrink', 'units_per_shrink', 0, 'qty', 1, 'list_price', 10)));
    v_fail := v_fail || 'S4 a shrink of 0 was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%quote_lines_units_per_shrink%' then v_fail := v_fail || 'S4 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  if (select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) || md5((select q::text from public.quotes q where q.id = v_q))
        from public.quote_lines l where l.quote_id = v_q) is distinct from v_snap then
    v_fail := v_fail || 'S3/S4 a refused save changed the quote' || E'\n';
  end if;

  ---------------------------------------------------------------- S5 convert, VAT-exclusive
  update public.quotes set status = 'accepted' where id = v_q;
  v_order := public.quote_convert(v_q);
  v_checks := v_checks + 1;
  select string_agg(format('%s x %s at %s less %s%%', case when product_id = v_product then 'shrunk' else 'unit' end,
                           qty_ordered, list_price, discount_pct::numeric(5,2)), ', ' order by product_id = v_product desc)
    into v_err from public.order_lines where order_id = v_order;
  if v_err is distinct from 'shrunk x 20 at 77.17 less 10.00%, unit x 3 at 50.00 less 0.00%' then
    v_fail := v_fail || 'S5 the order is ' || coalesce(v_err, 'empty') || E'\n';
  end if;

  ---------------------------------------------------------------- S6 convert, VAT-inclusive
  reset role;
  update public.organizations set prices_include_vat = true, vat_rate = 15 where id = c_gf;
  set local role authenticated;
  insert into public.quotes (org_id, quote_number, store_id, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), v_store, 'shrink suite inclusive')
  returning id into v_q2;
  insert into public.quote_lines (org_id, quote_id, position, product_id, unit, units_per_shrink, qty, list_price, discount_amount)
  values (c_gf, v_q2, 1, v_product, 'shrink', 10, 1, 887.44, 11.50);
  update public.quotes set status = 'accepted' where id = v_q2;
  v_order := public.quote_convert(v_q2);
  v_checks := v_checks + 1;
  select qty_ordered, list_price, discount_amount into r from public.order_lines where order_id = v_order;
  if (select not prices_include_vat or vat_rate <> 15 from public.quotes where id = v_q2) then
    v_fail := v_fail || 'S6 fixture: the quote is not VAT-inclusive at 15%' || E'\n';
  elsif r.qty_ordered <> 10 or r.list_price <> 77.17 or r.discount_amount <> 10.00 then
    v_fail := v_fail || format('S6 the order line is %s at %s less %s', r.qty_ordered, r.list_price, r.discount_amount) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- S7 security unchanged
  v_checks := v_checks + 1;
  select bool_and(not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)) as ok
    into r from pg_proc p
   where p.oid in ('public.quote_save(uuid, timestamptz, jsonb, jsonb)'::regprocedure, 'public.quote_convert(uuid)'::regprocedure);
  if not coalesce(r.ok, false) then
    v_fail := v_fail || 'S7 quote_save or quote_convert lost its security settings' || E'\n';
  end if;

  if v_fail = '' then
    raise exception 'quote_shrink: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'quote_shrink: FAIL\n%', v_fail;
end;
$$;
