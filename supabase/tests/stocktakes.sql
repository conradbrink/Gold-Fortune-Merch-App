-- Stocktake suite (20261017100000).
--
--   S1  A count below the stock packed for an order is refused at approval
--       with a sentence naming the product, the count, how many are set aside
--       and the order number. Nothing moves, on any line.
--   S2  A manager recounts that line on the handed-in sheet: the first count
--       stays, the recount is measured against the system now.
--   S3  A recount is a manager's: warehouse staff are refused, as are a
--       negative number and a sheet that is not handed in.
--   S4  A line that moved after hand-in, then recounted, is no longer flagged
--       as moved, and its variance is against the new reading.
--   S5  On approval a shortfall comes out of available first, then damaged and
--       expired; stock set aside for an order is never touched. A product
--       that is all expired can be counted down.
--   S6  anon cannot call the recount.
--   S7  A line that changed after it was counted is refused at approval even
--       when ticked "re-checked" (20261017130000), and named in the refusal.
--   S8  Warehouse staff cancel a count being counted (20261031163700): filed
--       as cancelled with who, when and why, the typed counts kept and locked,
--       nothing posted, the freeze lifted, and a new count can start there.
--   S9  A handed-in count, or one already cancelled, cannot be cancelled.
--   S10 A rep and anon cannot cancel a count.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_mgr uuid; v_wh uuid;
  v_loc uuid; v_store uuid; v_order uuid; v_order_no text;
  v_packed uuid; v_expired uuid; v_damaged uuid; v_moved uuid;
  v_st uuid; v_line uuid; v_msg text; v_n int; j jsonb; r record;
  v_rep uuid; v_cancel uuid;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at limit 1;
  select id into v_wh from public.profiles
   where org_id = c_gf and role = 'warehouse' and is_active order by created_at limit 1;
  if v_mgr is null or v_wh is null then
    raise exception 'Fixtures missing: a Gold Fortune manager and a warehouse user are needed.';
  end if;

  -- A location of its own: one open count per location, and the real
  -- warehouse may have one open.
  insert into public.stock_locations (org_id, name, type)
  values (c_gf, 'ZZ stocktake test', 'warehouse') returning id into v_loc;
  insert into public.products (org_id, name) values (c_gf, 'ZZ packed for orders') returning id into v_packed;
  insert into public.products (org_id, name) values (c_gf, 'ZZ all expired') returning id into v_expired;
  insert into public.products (org_id, name) values (c_gf, 'ZZ mostly damaged') returning id into v_damaged;
  insert into public.products (org_id, name) values (c_gf, 'ZZ moved after hand-in') returning id into v_moved;

  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_packed, 50, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_expired, 100, v_loc, 'expired', 'opening_stock', 'system'),
         (c_gf, v_damaged, 1, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_damaged, 12, v_loc, 'damaged', 'opening_stock', 'system'),
         (c_gf, v_moved, 20, v_loc, 'available', 'opening_stock', 'system');

  -- 40 packed for an order from this location, as order_confirm leaves it.
  insert into public.stores (org_id, name) values (c_gf, 'ZZ stocktake store') returning id into v_store;
  v_order_no := 'ZZ-STK-' || substr(md5(random()::text), 1, 6);
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id)
  values (c_gf, v_order_no, v_store, 'warehouse_manual', gen_random_uuid(), v_loc)
  returning id into v_order;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, qty_reserved, client_generated_id)
  values (c_gf, v_order, v_packed, 40, 40, gen_random_uuid());
  insert into public.stock_movements (org_id, product_id, qty, from_location_id, from_bucket,
                                      to_location_id, to_bucket, reason, source_doc_type, source_doc_id)
  values (c_gf, v_packed, 40, v_loc, 'available', v_loc, 'reserved', 'order_reservation', 'order', v_order);

  ------------------------------------------------------------- count it
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  j := public.stocktake_open(v_loc, 'full', null, false);
  v_st := (j->>'stocktake_id')::uuid;
  -- The packed boxes are missed; 10 expired, 3 damaged and 2 good are gone.
  update public.stocktake_lines set counted_qty = 8,  variance_reason = 'other'
   where stocktake_id = v_st and product_id = v_packed;
  update public.stocktake_lines set counted_qty = 90, variance_reason = 'theft'
   where stocktake_id = v_st and product_id = v_expired;
  update public.stocktake_lines set counted_qty = 10, variance_reason = 'damage_unrecorded'
   where stocktake_id = v_st and product_id = v_damaged;
  update public.stocktake_lines set counted_qty = 18, variance_reason = 'miscount'
   where stocktake_id = v_st and product_id = v_moved;
  perform public.stocktake_submit(v_st);

  ---------------------------------------------------------- S1 refused
  begin
    perform public.stocktake_decide(v_st, true, null, null);
    v_fail := v_fail || 'S1 a count below the packed stock was approved' || E'\n';
  exception when check_violation then
    v_msg := sqlerrm;
  end;
  if v_msg is null
     or position('ZZ packed for orders was counted at 8' in v_msg) = 0
     or position('40 of the 50' in v_msg) = 0
     or position(v_order_no in v_msg) = 0 then
    v_fail := v_fail || 'S1 the refusal does not say what and why: ' || coalesce(v_msg, '(none)') || E'\n';
  end if;
  select count(*) into v_n from public.stock_movements
   where source_doc_type = 'stocktake' and source_doc_id = v_st;
  if v_n <> 0 then
    v_fail := v_fail || format('S1 %s movements were left behind by a refused approval', v_n) || E'\n';
  end if;
  select status into v_msg from public.stocktakes where id = v_st;
  if v_msg <> 'submitted' then
    v_fail := v_fail || 'S1 a refused approval left the count ' || v_msg || E'\n';
  end if;

  ---------------------------------------------------------- S3 who may recount
  select id into v_line from public.stocktake_lines where stocktake_id = v_st and product_id = v_packed;
  begin
    perform public.stocktake_recount_line(v_line, -1, null);
    v_fail := v_fail || 'S3 a negative recount was taken' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.stocktake_recount_line(v_line, 48, null);
    v_fail := v_fail || 'S3 warehouse staff recounted a handed-in sheet' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------- S2 recount
  j := public.stocktake_recount_line(v_line, 48, null);
  if (j->>'variance_qty')::int <> -2 then
    v_fail := v_fail || 'S2 the recount variance is ' || (j->>'variance_qty') || ', expected -2' || E'\n';
  end if;
  select * into r from public.stocktake_lines where id = v_line;
  if r.counted_qty <> 8 or r.recount_qty <> 48 or r.system_qty_at_submit <> 50
     or r.variance_reason is distinct from 'other' then
    v_fail := v_fail || format('S2 the line after a recount: counted %s, recount %s, at submit %s, reason %s',
      r.counted_qty, r.recount_qty, r.system_qty_at_submit, r.variance_reason) || E'\n';
  end if;

  ---------------------------------------------------------- S4 moved, then recounted
  reset role;
  insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_moved, 5, v_loc, 'available', 'adjustment_found', 'adjustment');
  set local role authenticated;
  select moved_since_submit into r from public.stocktake_variance_report(v_st) where product_id = v_moved;
  if not r.moved_since_submit then
    v_fail := v_fail || 'S4 a line that moved after hand-in was not flagged' || E'\n';
  end if;
  select id into v_line from public.stocktake_lines where stocktake_id = v_st and product_id = v_moved;
  -- S7: ticked or not, a line that changed after it was counted is refused,
  -- by name, with both figures.
  v_msg := null;
  begin
    perform public.stocktake_decide(v_st, true, null, array[v_line]);
    v_fail := v_fail || 'S7 a ticked line that changed after its count was approved' || E'\n';
  exception when check_violation then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('Recount this line before approving: ZZ moved after hand-in (it said 20 when counted, 25 now)' in v_msg) = 0 then
    v_fail := v_fail || 'S7 the refusal does not name the changed line: ' || coalesce(v_msg, '(none)') || E'\n';
  end if;
  j := public.stocktake_recount_line(v_line, 23, null);
  select * into r from public.stocktake_variance_report(v_st) where product_id = v_moved;
  if r.moved_since_submit or r.variance_qty <> -2 or r.system_qty_at_submit <> 25 then
    v_fail := v_fail || format('S4 after the recount: moved %s, variance %s, at submit %s',
      r.moved_since_submit, r.variance_qty, r.system_qty_at_submit) || E'\n';
  end if;

  ---------------------------------------------------------- S5 approve
  begin
    j := public.stocktake_decide(v_st, true, 'Suite', null);
  exception when others then
    v_fail := v_fail || 'S5 the corrected count was refused: ' || sqlerrm || E'\n';
  end;
  reset role;
  for r in
    select p.name, b.qty_available a, b.qty_reserved res, b.qty_damaged d, b.qty_expired e
    from public.stock_balances b join public.products p on p.id = b.product_id
    where b.location_id = v_loc
  loop
    if (r.name = 'ZZ packed for orders' and (r.a, r.res) <> (8, 40))
       or (r.name = 'ZZ all expired' and (r.a, r.e) <> (0, 90))
       or (r.name = 'ZZ mostly damaged' and (r.a, r.d) <> (0, 10))
       or (r.name = 'ZZ moved after hand-in' and r.a <> 23) then
      v_fail := v_fail || format('S5 %s ends at available %s, reserved %s, damaged %s, expired %s',
        r.name, r.a, r.res, r.d, r.e) || E'\n';
    end if;
  end loop;
  select count(*) into v_n from public.stock_movements
   where source_doc_type = 'stocktake' and source_doc_id = v_st and product_id = v_damaged
     and ((from_bucket = 'available' and qty = 1) or (from_bucket = 'damaged' and qty = 2));
  if v_n <> 2 then
    v_fail := v_fail || 'S5 the damaged shortfall was not taken as 1 available + 2 damaged' || E'\n';
  end if;

  -- S3 again: a decided sheet cannot be recounted.
  set local role authenticated;
  begin
    perform public.stocktake_recount_line(v_line, 30, null);
    v_fail := v_fail || 'S3 an approved sheet was recounted' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------- S6 anon
  if has_function_privilege('anon', 'public.stocktake_recount_line(uuid, integer, text)', 'execute') then
    v_fail := v_fail || 'S6 anon can call the recount' || E'\n';
  end if;

  ---------------------------------------------------------- S8 cancel
  -- The first count is approved, so the location is free for another.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.stocktake_open(v_loc, 'full', null, true);
  v_cancel := (j->>'stocktake_id')::uuid;
  update public.stocktake_lines set counted_qty = 7
   where stocktake_id = v_cancel and product_id = v_moved;
  reset role;
  begin
    insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
    values (c_gf, v_moved, 1, v_loc, 'available', 'adjustment_found', 'adjustment');
    v_fail := v_fail || 'S8 stock moved at a frozen location' || E'\n';
  exception when insufficient_privilege then null;
  end;
  set local role authenticated;

  j := public.stocktake_cancel(v_cancel, '  Started at the wrong warehouse  ');
  if j->>'status' <> 'cancelled' then
    v_fail := v_fail || 'S8 the cancel returned ' || j::text || E'\n';
  end if;
  reset role;
  select * into r from public.stocktakes where id = v_cancel;
  if r.status <> 'cancelled' or r.decided_by is distinct from v_wh or r.decided_at is null
     or r.decision_note is distinct from 'Started at the wrong warehouse' then
    v_fail := v_fail || format('S8 the cancelled count: status %s, by %s, at %s, note %s',
      r.status, r.decided_by, r.decided_at, r.decision_note) || E'\n';
  end if;
  select count(*) into v_n from public.stock_movements
   where source_doc_type = 'stocktake' and source_doc_id = v_cancel;
  if v_n <> 0 then
    v_fail := v_fail || format('S8 a cancel posted %s movements', v_n) || E'\n';
  end if;
  select counted_qty into v_n from public.stocktake_lines
   where stocktake_id = v_cancel and product_id = v_moved;
  if v_n is distinct from 7 then
    v_fail := v_fail || 'S8 the typed count did not stay on the cancelled sheet' || E'\n';
  end if;
  -- The freeze held only while the count was open.
  begin
    insert into public.stock_movements (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
    values (c_gf, v_moved, 1, v_loc, 'available', 'adjustment_found', 'adjustment');
  exception when others then
    v_fail := v_fail || 'S8 the freeze outlived the cancel: ' || sqlerrm || E'\n';
  end;
  set local role authenticated;
  -- A page left open: the counter is told it was cancelled.
  v_msg := null;
  begin
    update public.stocktake_lines set counted_qty = 9
     where stocktake_id = v_cancel and product_id = v_moved;
    v_fail := v_fail || 'S8 a count was changed on a cancelled sheet' || E'\n';
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('was cancelled, so its counts cannot be changed' in v_msg) = 0 then
    v_fail := v_fail || 'S8 the refusal on a cancelled sheet says: ' || coalesce(v_msg, '(none)') || E'\n';
  end if;
  -- One open count per location: the cancel freed it. No reason is fine.
  begin
    j := public.stocktake_open(v_loc, 'spot', null, false);
    v_st := (j->>'stocktake_id')::uuid;
    perform public.stocktake_cancel(v_st, null);
    if (select decision_note from public.stocktakes where id = v_st) is not null then
      v_fail := v_fail || 'S8 a cancel with no reason filed one' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'S8 a new count could not start after a cancel: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------------- S9 not twice, not handed in
  v_msg := null;
  begin
    perform public.stocktake_cancel(v_cancel, null);
    v_fail := v_fail || 'S9 a cancelled count was cancelled again' || E'\n';
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('is cancelled, so it cannot be cancelled' in v_msg) = 0 then
    v_fail := v_fail || 'S9 cancelling twice says: ' || coalesce(v_msg, '(none)') || E'\n';
  end if;
  j := public.stocktake_open(v_loc, 'full', null, false);
  v_st := (j->>'stocktake_id')::uuid;
  update public.stocktake_lines set counted_qty = system_qty_at_open where stocktake_id = v_st;
  perform public.stocktake_submit(v_st);
  v_msg := null;
  begin
    perform public.stocktake_cancel(v_st, null);
    v_fail := v_fail || 'S9 a handed-in count was cancelled' || E'\n';
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('has been handed in. A manager can reject it instead' in v_msg) = 0 then
    v_fail := v_fail || 'S9 cancelling a handed-in count says: ' || coalesce(v_msg, '(none)') || E'\n';
  end if;
  v_msg := null;
  begin
    update public.stocktake_lines set counted_qty = 0 where stocktake_id = v_st;
    v_fail := v_fail || 'S9 a count was changed on a handed-in sheet' || E'\n';
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('has been handed in, so its counts cannot be changed' in v_msg) = 0 then
    v_fail := v_fail || 'S9 the refusal on a handed-in sheet says: ' || coalesce(v_msg, '(none)') || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------- S10 who may cancel
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by created_at limit 1;
  if v_rep is null then
    v_fail := v_fail || 'S10 fixture missing: a Gold Fortune rep' || E'\n';
  else
    update public.stocktakes set status = 'counting', submitted_at = null, submitted_by = null
     where id = v_st;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.stocktake_cancel(v_st, null);
      v_fail := v_fail || 'S10 a rep cancelled a count' || E'\n';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end if;
  if has_function_privilege('anon', 'public.stocktake_cancel(uuid, text)', 'execute') then
    v_fail := v_fail || 'S10 anon can call the cancel' || E'\n';
  end if;

  if v_fail = '' then
    raise exception E'stocktakes suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'stocktakes suite\n%FAILED (rolled back)', v_fail;
end $$;
