-- Low stock is judged at warehouses only (20261029235300).
--
-- Fixtures, all new: three products (fine, short, gone) with a minimum and
-- reorder point; two warehouses in use and one switched off; two of the
-- company's vehicles, one back from its run (emptied) and one still out
-- (loaded); a rep's sample stock.
--
--   L1  Warehouse lines are judged as before: below its minimum, out of stock,
--       and a per-location override, at each warehouse on its own.
--   L2  An emptied van line is not stock: left out of stock_on_hand, whether
--       every location is asked for or that van, and out of every alert.
--   L3  A loaded van line shows, with what is in transit on it, no minimum
--       and no reorder point (a per-location override for it included), not
--       out of stock and not below minimum; it raises no alert and is not
--       "below minimum".
--   L4  A rep's sample line is the same: shown while it holds stock, left
--       out once it holds none, never judged.
--   L5  stock_position_summary counts products, not lines: a product out of
--       stock at two warehouses is one; what is in transit on the van is still
--       in the totals.
--   L6  Each function keeps require_module('warehouse') as its first
--       statement (a company without Stock control is refused), the grants
--       are authenticated only, and none is security definer.
--   L7  A warehouse switched off is judged like a van: its empty line is left
--       out, a line still holding stock shows with no minimum, and neither
--       raises an alert.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_tag text := 'ZZ-LS-' || left(md5(random()::text), 5);
  v_wh uuid; v_rep uuid;
  v_w1 uuid; v_w2 uuid; v_w3 uuid; v_v1 uuid; v_v2 uuid; v_van1 uuid; v_van2 uuid; v_r uuid;
  v_fine uuid; v_short uuid; v_gone uuid;
  v_before record; v_after record;
  v_n int; r record;
begin
  -- Warehouse staff, else a manager (who holds every permission).
  select id into v_wh from public.profiles
   where org_id = c_gf and role in ('warehouse', 'manager') and is_active
   order by (role = 'warehouse') desc, created_at, id limit 1;
  -- A rep with no stock location yet: one each, so a second cannot be made.
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.role = 'rep' and p.is_active
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.created_at, p.id limit 1;
  if v_wh is null or v_rep is null then
    raise exception 'Fixtures missing: warehouse or manager %, rep without a stock location %', v_wh, v_rep;
  end if;

  -- The company-wide figures before anything here exists.
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_before from public.stock_position_summary(null);
  reset role;

  insert into public.products (org_id, name, min_stock_level, reorder_point, reorder_qty)
  values (c_gf, v_tag || ' fine', 50, 100, 200) returning id into v_fine;
  insert into public.products (org_id, name, min_stock_level, reorder_point, reorder_qty)
  values (c_gf, v_tag || ' short', 50, 100, 200) returning id into v_short;
  insert into public.products (org_id, name, min_stock_level, reorder_point, reorder_qty)
  values (c_gf, v_tag || ' gone', 50, 100, 200) returning id into v_gone;

  insert into public.stock_locations (org_id, name, type)
  values (c_gf, v_tag || ' main', 'warehouse') returning id into v_w1;
  insert into public.stock_locations (org_id, name, type)
  values (c_gf, v_tag || ' depot', 'warehouse') returning id into v_w2;
  insert into public.stock_locations (org_id, name, type)
  values (c_gf, v_tag || ' old depot', 'warehouse') returning id into v_w3;
  insert into public.vehicles (org_id, registration) values (c_gf, v_tag || ' 1') returning id into v_van1;
  insert into public.vehicles (org_id, registration) values (c_gf, v_tag || ' 2') returning id into v_van2;
  -- As order_dispatch names them on first use.
  insert into public.stock_locations (org_id, name, type, vehicle_id)
  values (c_gf, 'Vehicle ' || v_tag || ' 1', 'vehicle', v_van1) returning id into v_v1;
  insert into public.stock_locations (org_id, name, type, vehicle_id)
  values (c_gf, 'Vehicle ' || v_tag || ' 2', 'vehicle', v_van2) returning id into v_v2;
  insert into public.stock_locations (org_id, name, type, rep_id)
  values (c_gf, v_tag || ' rep samples', 'rep', v_rep) returning id into v_r;

  -- Main warehouse: 200 fine, 30 short, 10 gone.
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_fine, 200, v_w1, 'available', 'opening_stock', 'system'),
         (c_gf, v_short, 30, v_w1, 'available', 'opening_stock', 'system'),
         (c_gf, v_gone, 10, v_w1, 'available', 'opening_stock', 'system');
  -- Van 1 takes 10 fine and the 10 gone out and delivers them: two zero lines.
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_fine, 10, v_w1, 'available', v_v1, 'in_transit', 'order_dispatch', 'dispatch'),
         (c_gf, v_gone, 10, v_w1, 'available', v_v1, 'in_transit', 'order_dispatch', 'dispatch');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket, reason, source_doc_type)
  values (c_gf, v_fine, 10, v_v1, 'in_transit', 'order_delivery', 'dispatch'),
         (c_gf, v_gone, 10, v_v1, 'in_transit', 'order_delivery', 'dispatch');
  -- Van 2 is still out with 20 fine.
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_fine, 20, v_w1, 'available', v_v2, 'in_transit', 'order_dispatch', 'dispatch');
  -- The rep carries 5 short, and carried 3 fine that are gone.
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_short, 5, v_w1, 'available', v_r, 'available', 'transfer_out', 'transfer'),
         (c_gf, v_fine, 3, v_w1, 'available', v_r, 'available', 'transfer_out', 'transfer');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket, reason, source_doc_type)
  values (c_gf, v_fine, 3, v_r, 'available', 'adjustment_write_off', 'adjustment');
  -- Depot: 20 short against its own minimum of 10; gone sold out there too.
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_short, 20, v_w2, 'available', 'opening_stock', 'system'),
         (c_gf, v_gone, 5, v_w2, 'available', 'opening_stock', 'system');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket, reason, source_doc_type)
  values (c_gf, v_gone, 5, v_w2, 'available', 'adjustment_write_off', 'adjustment');
  insert into public.product_location_settings (org_id, product_id, location_id, min_stock_level, reorder_point)
  values (c_gf, v_short, v_w2, 10, 15),
         -- A level set on a van is not a level: L3.
         (c_gf, v_fine, v_v2, 100, 150);
  -- The old depot: its gone was written off and 4 short are still there
  -- when it is switched off.
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_gone, 2, v_w3, 'available', 'opening_stock', 'system'),
         (c_gf, v_short, 4, v_w3, 'available', 'opening_stock', 'system');
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket, reason, source_doc_type)
  values (c_gf, v_gone, 2, v_w3, 'available', 'adjustment_write_off', 'adjustment');
  update public.stock_locations set active = false where id = v_w3;
  -- Main is left with 167 fine, 25 short, 0 gone.

  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- L1 warehouses
  select count(*) into v_n from public.stock_on_hand(null, v_tag, false);
  if v_n <> 8 then
    v_fail := v_fail || format('L1 stock_on_hand lists %s lines, expected 8 (2 warehouses x products held, the loaded van, the rep''s 5, the old depot''s 4)', v_n) || E'\n';
  end if;
  select * into r from public.stock_on_hand(v_w1, v_tag, false) where product_id = v_short;
  if r.qty_available is distinct from 25 or r.min_stock_level is distinct from 50
     or not r.is_below_min or r.is_out_of_stock then
    v_fail := v_fail || format('L1 short at main is not below its minimum: %s', row_to_json(r)) || E'\n';
  end if;
  select * into r from public.stock_on_hand(v_w2, v_tag, false) where product_id = v_short;
  if r.qty_available is distinct from 20 or r.min_stock_level is distinct from 10
     or r.reorder_point is distinct from 15 or r.is_below_min then
    v_fail := v_fail || format('L1 the depot''s own minimum for short was not used: %s', row_to_json(r)) || E'\n';
  end if;
  select count(*) into v_n from public.stock_on_hand(null, v_tag, false)
   where product_id = v_gone and is_out_of_stock and is_below_min and location_id in (v_w1, v_w2);
  if v_n <> 2 then
    v_fail := v_fail || format('L1 gone is out of stock at %s warehouses, expected both', v_n) || E'\n';
  end if;
  select count(*) as n_all,
         count(*) filter (where (a.product_id, a.location_id, a.severity) in (
           (v_gone, v_w1, 'out_of_stock'), (v_gone, v_w2, 'out_of_stock'),
           (v_short, v_w1, 'below_minimum'))) as n_expected,
         string_agg(a.product_name || ' at ' || a.location_name || ': ' || a.severity, '; ') as list
    into r
    from public.low_stock_alerts(null) a where a.product_id in (v_fine, v_short, v_gone);
  if r.n_all <> 3 or r.n_expected <> 3 then
    v_fail := v_fail || format('L1 the alerts are "%s"; expected gone out at both warehouses and short below at main', r.list) || E'\n';
  end if;
  select count(*) into v_n from public.stock_on_hand(null, v_tag, true);
  if v_n <> 3 or exists (select 1 from public.stock_on_hand(null, v_tag, true)
                          where location_id not in (v_w1, v_w2)) then
    v_fail := v_fail || format('L1 "only below minimum" lists %s lines, or one off a warehouse; expected gone x2 and short at main', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- L2 emptied van
  select count(*) into v_n from public.stock_on_hand(null, v_tag, false) where location_id = v_v1;
  if v_n <> 0 then
    v_fail := v_fail || format('L2 the emptied van shows %s lines across all locations', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.stock_on_hand(v_v1, null, false);
  if v_n <> 0 then
    v_fail := v_fail || format('L2 the emptied van shows %s lines when picked', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.low_stock_alerts(v_v1);
  if v_n <> 0 then
    v_fail := v_fail || format('L2 the emptied van raises %s alerts', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.stock_on_hand(v_v1, null, true);
  if v_n <> 0 then
    v_fail := v_fail || format('L2 the emptied van has %s lines below minimum', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- L3 loaded van
  select * into r from public.stock_on_hand(null, v_tag, false) where location_id = v_v2;
  if r.product_id is distinct from v_fine or r.qty_in_transit is distinct from 20
     or r.qty_available is distinct from 0 or r.min_stock_level is not null
     or r.reorder_point is not null or r.is_below_min or r.is_out_of_stock then
    v_fail := v_fail || format('L3 the loaded van''s line is wrong: %s', row_to_json(r)) || E'\n';
  end if;
  select count(*) into v_n from public.stock_on_hand(v_v2, null, false);
  if v_n <> 1 then
    v_fail := v_fail || format('L3 the loaded van shows %s lines when picked, expected 1', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.low_stock_alerts(v_v2);
  if v_n <> 0 then
    v_fail := v_fail || format('L3 the loaded van raises %s alerts', v_n) || E'\n';
  end if;
  select count(*) into v_n from public.stock_on_hand(v_v2, null, true);
  if v_n <> 0 then
    v_fail := v_fail || format('L3 the loaded van has %s lines below minimum', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- L4 rep samples
  select count(*) into v_n from public.stock_on_hand(v_r, null, false);
  select * into r from public.stock_on_hand(v_r, null, false) limit 1;
  if v_n <> 1 or r.product_id is distinct from v_short or r.qty_available is distinct from 5
     or r.min_stock_level is not null or r.is_below_min or r.is_out_of_stock then
    v_fail := v_fail || format('L4 the rep''s samples are wrong (%s lines): %s', v_n, row_to_json(r)) || E'\n';
  end if;
  select count(*) into v_n from public.low_stock_alerts(v_r);
  if v_n <> 0 then
    v_fail := v_fail || format('L4 the rep''s samples raise %s alerts', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- L7 closed warehouse
  select count(*) into v_n from public.stock_on_hand(v_w3, null, false);
  select * into r from public.stock_on_hand(v_w3, null, false) limit 1;
  if v_n <> 1 or r.product_id is distinct from v_short or r.qty_available is distinct from 4
     or r.min_stock_level is not null or r.is_below_min or r.is_out_of_stock then
    v_fail := v_fail || format('L7 the closed warehouse is wrong (%s lines): %s', v_n, row_to_json(r)) || E'\n';
  end if;
  select count(*) into v_n from public.low_stock_alerts(v_w3);
  if v_n <> 0 then
    v_fail := v_fail || format('L7 the closed warehouse raises %s alerts', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- L5 the tiles
  select * into v_after from public.stock_position_summary(null);
  if v_after.products_out_of_stock - v_before.products_out_of_stock <> 1
     or v_after.products_below_min - v_before.products_below_min <> 2
     or v_after.products_stocked - v_before.products_stocked <> 3
     or v_after.qty_in_transit - v_before.qty_in_transit <> 20
     or v_after.qty_available - v_before.qty_available <> 167 + 25 + 20 + 5 + 4 then
    v_fail := v_fail || format('L5 the company figures moved by out %s, below %s, stocked %s, in transit %s, available %s; expected 1, 2, 3, 20, 221',
      v_after.products_out_of_stock - v_before.products_out_of_stock,
      v_after.products_below_min - v_before.products_below_min,
      v_after.products_stocked - v_before.products_stocked,
      v_after.qty_in_transit - v_before.qty_in_transit,
      v_after.qty_available - v_before.qty_available) || E'\n';
  end if;
  select * into r from public.stock_position_summary(v_w1);
  if r.products_stocked <> 3 or r.products_out_of_stock <> 1 or r.products_below_min <> 2 then
    v_fail := v_fail || format('L5 main''s figures are wrong: %s', row_to_json(r)) || E'\n';
  end if;
  select * into r from public.stock_position_summary(v_v1);
  if r.products_stocked <> 0 or r.products_out_of_stock <> 0 or r.products_below_min <> 0 then
    v_fail := v_fail || format('L5 the emptied van has figures: %s', row_to_json(r)) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- L6 guards
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('stock_on_hand', 'stock_position_summary', 'low_stock_alerts')
     and btrim(p.prosrc, E' \n') like 'select public.require_module(''warehouse'');%'
     and not p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute');
  if v_n <> 3 then
    v_fail := v_fail || format('L6 only %s of the 3 functions start with the module check, run as invoker and are granted to authenticated only', v_n) || E'\n';
  end if;
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'warehouse';
  set local role authenticated;
  begin
    perform * from public.low_stock_alerts(null);
    v_fail := v_fail || 'L6 low_stock_alerts answered a company without Stock control' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise exception '%', case when v_fail = ''
    then 'LOW STOCK LOCATIONS SUITE PASSED'
    else E'LOW STOCK LOCATIONS SUITE FAILED\n' || v_fail end;
end;
$$;
