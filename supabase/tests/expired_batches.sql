-- Expired batches suite (20261030175300).
--
-- One batch-tracked product at a new location, holding five lots: expired five
-- days ago (30), expired yesterday (7), expiring today (4), in 30 days (20),
-- and stock from before tracking was switched on, with no batch (5). "Today"
-- is Gold Fortune's own calendar day.
--
--   E1  Before confirming, an order for 30 reads 29 available, 1 short and 37
--       expired: expired stock is not available.
--   E2  Confirming it with "reject" is refused, says 37 have expired, and
--       reserves nothing.
--   E3  Confirming it partially reserves 29 first-expiry-first-out from the
--       lots still in date (today's 4, then the 30-day 20, then the undated
--       5) and nothing from either expired lot, which stay available, untouched,
--       for somebody to write off.
--   E4  A second order for 5 reads 0 available, 5 short, 37 expired, and
--       confirming it on hold reserves nothing and holds it.
--   E5  Picking: swapping a reservation onto an expired lot is refused and
--       leaves it as it was; swapping onto a lot in date still works; a plain
--       pick still records.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_wh uuid; v_loc uuid; v_store uuid; v_prod uuid;
  v_today date;
  b_old uuid; b_yday uuid; b_today uuid; b_later uuid; b_spare uuid;
  v_a uuid; v_a_line uuid; v_b uuid;
  v_alloc_later uuid; v_alloc_today uuid;
  j jsonb; r record; v_n int; v_msg text; v_got text;
begin
  select id into v_wh from public.profiles
   where org_id = c_gf and role = 'warehouse' and is_active order by created_at limit 1;
  if v_wh is null then
    raise exception 'Fixtures missing: a Gold Fortune warehouse user is needed.';
  end if;
  v_today := (now() at time zone public.org_timezone(c_gf))::date;

  insert into public.stock_locations (org_id, name, type)
  values (c_gf, 'ZZ expiry test', 'warehouse') returning id into v_loc;
  -- Priced: Gold Fortune invoices every order, and confirming issues it.
  insert into public.products (org_id, name, is_batch_tracked, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ expiry product', true, 1, 10) returning id into v_prod;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ expiry store') returning id into v_store;

  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod, 'ZZ-OLD', v_today - 5) returning id into b_old;
  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod, 'ZZ-YDAY', v_today - 1) returning id into b_yday;
  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod, 'ZZ-TODAY', v_today) returning id into b_today;
  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod, 'ZZ-LATER', v_today + 30) returning id into b_later;
  insert into public.product_batches (org_id, product_id, batch_number, expiry_date)
  values (c_gf, v_prod, 'ZZ-SPARE', v_today + 60) returning id into b_spare;

  insert into public.stock_movements (org_id, product_id, batch_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, b_old,   30, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_prod, b_yday,   7, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_prod, b_today,  4, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_prod, b_later, 20, v_loc, 'available', 'opening_stock', 'system'),
         (c_gf, v_prod, null,     5, v_loc, 'available', 'opening_stock', 'system');

  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-EXP-1', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'new')
  returning id into v_a;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, client_generated_id)
  values (c_gf, v_a, v_prod, 30, gen_random_uuid()) returning id into v_a_line;
  insert into public.orders (org_id, order_number, store_id, source, client_generated_id, fulfil_location_id, status)
  values (c_gf, 'ZZ-EXP-2', v_store, 'warehouse_manual', gen_random_uuid(), v_loc, 'new')
  returning id into v_b;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, client_generated_id)
  values (c_gf, v_b, v_prod, 5, gen_random_uuid());

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------- E1 the warning
  select * into r from public.order_availability_check(v_a);
  if (r.qty_available, r.qty_short, r.qty_expired) is distinct from (29, 1, 37) then
    v_fail := v_fail || format('E1 order for 30 read available %s, short %s, expired %s (expected 29, 1, 37)',
      r.qty_available, r.qty_short, r.qty_expired) || E'\n';
  end if;

  ---------------------------------------------------------- E2 reject
  v_msg := null;
  begin
    perform public.order_confirm(v_a, null, 'reject');
    v_fail := v_fail || 'E2 an order 1 short was confirmed with "reject"' || E'\n';
  exception when others then
    v_msg := sqlstate || ' ' || sqlerrm;
  end;
  if v_msg is not null and v_msg not like '23514 %1 short of 30 needed. 37 more have expired%' then
    v_fail := v_fail || 'E2 the refusal reads: ' || v_msg || E'\n';
  end if;
  select count(*) into v_n from public.order_allocations where order_id = v_a;
  if v_n <> 0 or (select status from public.orders where id = v_a) <> 'new' then
    v_fail := v_fail || 'E2 a refused confirm left the order changed or stock reserved' || E'\n';
  end if;

  ---------------------------------------------------------- E3 partial
  begin
    j := public.order_confirm(v_a, null, 'partial');
    if (j->>'total_short')::int <> 1 then
      v_fail := v_fail || 'E3 partial confirm returned ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'E3 partial confirm failed: ' || sqlerrm || E'\n';
  end;
  select string_agg(coalesce(pb.batch_number, 'none') || '=' || a.qty_reserved, ' '
                    order by pb.expiry_date nulls last)
    into v_got
    from public.order_allocations a
    left join public.product_batches pb on pb.id = a.batch_id
   where a.order_id = v_a;
  if v_got is distinct from 'ZZ-TODAY=4 ZZ-LATER=20 none=5' then
    v_fail := v_fail || 'E3 reserved ' || coalesce(v_got, 'nothing')
      || ' (expected ZZ-TODAY=4 ZZ-LATER=20 none=5)' || E'\n';
  end if;
  select qty_reserved, line_status into r from public.order_lines where id = v_a_line;
  if (r.qty_reserved, r.line_status) is distinct from (29, 'partial') then
    v_fail := v_fail || format('E3 line reads reserved %s, %s (expected 29, partial)',
      r.qty_reserved, r.line_status) || E'\n';
  end if;
  reset role;
  select string_agg(pb.batch_number || '=' || b.qty_available || '/' || b.qty_reserved, ' '
                    order by pb.expiry_date)
    into v_got
    from public.stock_balances b
    join public.product_batches pb on pb.id = b.batch_id
   where b.location_id = v_loc and pb.expiry_date < v_today;
  if v_got is distinct from 'ZZ-OLD=30/0 ZZ-YDAY=7/0' then
    v_fail := v_fail || 'E3 expired lots after confirming (available/reserved): ' || coalesce(v_got, 'none') || E'\n';
  end if;
  set local role authenticated;

  ---------------------------------------------------------- E4 hold
  select * into r from public.order_availability_check(v_b);
  if (r.qty_available, r.qty_short, r.qty_expired) is distinct from (0, 5, 37) then
    v_fail := v_fail || format('E4 order for 5 read available %s, short %s, expired %s (expected 0, 5, 37)',
      r.qty_available, r.qty_short, r.qty_expired) || E'\n';
  end if;
  begin
    j := public.order_confirm(v_b, null, 'hold');
    if (j->>'total_short')::int <> 5 or not (j->>'on_hold')::boolean then
      v_fail := v_fail || 'E4 hold confirm returned ' || j::text || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'E4 hold confirm failed: ' || sqlerrm || E'\n';
  end;
  select count(*) into v_n from public.order_allocations where order_id = v_b;
  if v_n <> 0 then
    v_fail := v_fail || 'E4 the held order reserved stock' || E'\n';
  end if;

  ---------------------------------------------------------- E5 picking
  reset role;
  -- A fresh lot in date to swap onto, arriving after the confirms.
  insert into public.stock_movements (org_id, product_id, batch_id, qty, to_location_id, to_bucket, reason, source_doc_type)
  values (c_gf, v_prod, b_spare, 20, v_loc, 'available', 'opening_stock', 'system');
  set local role authenticated;
  select a.id into v_alloc_later from public.order_allocations a where a.order_id = v_a and a.batch_id = b_later;
  select a.id into v_alloc_today from public.order_allocations a where a.order_id = v_a and a.batch_id = b_today;
  begin
    perform public.order_start_picking(v_a);
  exception when others then
    v_fail := v_fail || 'E5 picking could not start: ' || sqlerrm || E'\n';
  end;

  v_msg := null;
  begin
    perform public.order_record_pick(v_a, jsonb_build_array(jsonb_build_object(
      'allocation_id', v_alloc_later, 'qty_picked', 20, 'actual_batch_id', b_old)));
    v_fail := v_fail || 'E5 a pick was swapped onto an expired lot' || E'\n';
  exception when others then
    v_msg := sqlstate || ' ' || sqlerrm;
  end;
  if v_msg is not null and v_msg not like '23514 Batch ZZ-OLD expired on %' then
    v_fail := v_fail || 'E5 the refusal reads: ' || v_msg || E'\n';
  end if;
  select batch_id, qty_picked, status into r from public.order_allocations where id = v_alloc_later;
  if (r.batch_id, r.qty_picked, r.status) is distinct from (b_later, 0, 'reserved') then
    v_fail := v_fail || 'E5 the refused swap changed the reservation' || E'\n';
  end if;

  begin
    perform public.order_record_pick(v_a, jsonb_build_array(
      jsonb_build_object('allocation_id', v_alloc_later, 'qty_picked', 20, 'actual_batch_id', b_spare),
      jsonb_build_object('allocation_id', v_alloc_today, 'qty_picked', 4)));
  exception when others then
    v_fail := v_fail || 'E5 a swap onto a lot in date, with a plain pick, failed: ' || sqlerrm || E'\n';
  end;
  select batch_id, qty_picked, status into r from public.order_allocations where id = v_alloc_later;
  if (r.batch_id, r.qty_picked, r.status) is distinct from (b_spare, 20, 'picked') then
    v_fail := v_fail || 'E5 the swap onto ZZ-SPARE did not record' || E'\n';
  end if;
  select qty_picked, status into r from public.order_allocations where id = v_alloc_today;
  if (r.qty_picked, r.status) is distinct from (4, 'picked') then
    v_fail := v_fail || 'E5 the plain pick did not record' || E'\n';
  end if;
  reset role;
  select qty_available, qty_reserved into r from public.stock_balances
   where location_id = v_loc and batch_id = b_old;
  if (r.qty_available, r.qty_reserved) is distinct from (30, 0) then
    v_fail := v_fail || format('E5 ZZ-OLD after picking: available %s, reserved %s (expected 30, 0)',
      r.qty_available, r.qty_reserved) || E'\n';
  end if;

  if v_fail = '' then
    raise exception E'expired batches suite\nALL PASSED (rolled back)';
  end if;
  raise exception E'expired batches suite\n%FAILED (rolled back)', v_fail;
end $$;
