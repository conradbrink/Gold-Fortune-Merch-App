-- Store range suite: Tickd works out which products each store should carry,
-- and judges new products by their repeat orders (20261019180000, 19 Oct 2026).
--
-- Fixtures in Gold Fortune, in their own group so the group's sizes and
-- shares are the suite's alone: "ZZ range chain" (S1..S10 ordering, S11 set
-- big with no orders), "ZZ range other" (T1 ordering, T2 never), one store
-- with no group (N1). Products in "ZZ range cat" (10 a box, P100 a box):
--   PA  every chain store, three orders (first 100 days ago): established
--   PB  S1, S2 twice (50 and 10 days ago): new, trying
--   PC  S4 twice, 100 and 80 days ago: stopped
--   PD  S4..S9 at 40 and 10 days ago, a lot: new, proven
--   PE  S4..S8 once 40 days ago, S9 twice: new, not taking off
--   PH  S1..S5 40 days ago, S1 and S2 again: new, slow
--   PJ  S4..S9 at 120 and 100 days ago: proven, but older than 90 days
--   PF  added today, never ordered: waiting
--   PG  added 40 days ago, never ordered: untried
--   PK  "ZZ range lonely": S10 once, on its last order day: no chance yet
-- Settings for the suite: big 30 %, medium 30 %, two similar stores, one peer.
--
--   G1  Sizes: by sales inside the group (S1-3 big, S4-6 medium, S7-10 small);
--       set by hand (S11); visit frequency for a store with no orders (T2).
--   G2  Similar stores: the chain's own size (level 1); a lone store falls
--       back to the company at its size (level 3); no group is "none".
--   G3  In range: a store's own orders; 2 of 3 similar stores (share); not
--       below 40 %; a store with nothing lately is quiet, not a gap.
--   G4  Status: have, gap, stopped, off_range; returns subtracted;
--       cancelled orders and lines, and back-orders, ignored.
--   G5  New products: waiting, untried, trying (a store with no later order
--       has had no chance), proven (big stores of the groups that tried it,
--       not an untried group), slow (normal rules), not taking off (no gap
--       where never ordered; kept where ordered again), older than 90 days is
--       the normal rule; launch is the first order; similar products by
--       category, or all products when the category has fewer than 3.
--   G6  The gap's estimate from similar stores, at the group price list's
--       case price.
--   G7  Overrides: Always from medium; Never beats proven and own orders;
--       clearing; Not for this store and back.
--   G8  Settings move the answer: a higher share; still learning.
--   G9  The screens' functions agree with the rule: range_status,
--       range_products, range_grid.
--   G10 Access: a rep without insights is refused every function; with
--       insights but not invoicing, no money; nobody writes the tables
--       directly; another company's group refused; only this company's
--       stores; module off refuses.
--   G11 Grants, definer with pinned search_path, registration, module gate.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_mgr uuid; v_rep uuid; v_other_org uuid; v_other_group uuid;
  v_tz text; v_today date;
  v_g1 uuid; v_g2 uuid; v_list uuid;
  s uuid[] := '{}';
  v_t1 uuid; v_t2 uuid; v_n1 uuid; v_id uuid; v_last10 uuid;
  pa uuid; pb uuid; pc uuid; pd uuid; pe uuid; pf uuid; pg uuid; ph uuid; pj uuid; pk uuid;
  i int; v_n int; v_txt text; v_num numeric; v_bool boolean; v_json jsonb;
  f record; r record;
begin
  select pp.profile_id into v_mgr
    from public.profile_permissions pp join public.profiles p on p.id = pp.profile_id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin'
   order by p.created_at limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
     and not exists (select 1 from public.profile_permissions pp
                      where pp.profile_id = p.id and pp.permission_code in ('admin', 'insights', 'invoicing',
                                                                           'resources', 'sales_coverage'))
   order by p.created_at limit 1;
  select id into v_other_org from public.organizations where id <> c_gf order by created_at limit 1;
  if v_mgr is null or v_rep is null or v_other_org is null then
    raise exception 'Fixtures missing: a Gold Fortune administrator, a plain rep and another company are needed.';
  end if;
  v_tz := public.org_timezone(c_gf);
  v_today := (now() at time zone v_tz)::date;

  -- An order n days ago at midday, company time, with lines
  -- [{"p": product, "q": units, "price"?, "st"?, "ret"?}].
  create function pg_temp.zz_order(p_store uuid, p_ago int, p_lines jsonb,
                                   p_status text default 'new', p_parent uuid default null)
  returns uuid language plpgsql as $f$
  declare
    v_org constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
    v_zone text := public.org_timezone(v_org);
    v_day date := (now() at time zone public.org_timezone(v_org))::date;
    v_order uuid;
  begin
    insert into public.orders (org_id, order_number, store_id, source, received_via, status, cancel_reason,
                               parent_order_id, created_at, client_generated_id)
    values (v_org, 'ZZ-RG-' || substr(gen_random_uuid()::text, 1, 8), p_store, 'warehouse_manual', 'other',
            p_status, case when p_status = 'cancelled' then 'Suite fixture' end, p_parent,
            ((v_day - p_ago) + time '12:00') at time zone v_zone, gen_random_uuid())
    returning id into v_order;
    insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, line_status,
                                    qty_dispatched, qty_returned, client_generated_id)
    select v_org, v_order, (l->>'p')::uuid, (l->>'q')::int, coalesce((l->>'price')::numeric, 10),
           coalesce(l->>'st', 'open'),
           case when l ? 'ret' then (l->>'q')::int else 0 end, coalesce((l->>'ret')::int, 0),
           gen_random_uuid()
      from jsonb_array_elements(p_lines) l;
    return v_order;
  end $f$;

  ---------------------------------------------------------------- fixtures
  update public.company_settings set value = to_jsonb(x.v)
    from (values ('range_lapse_days', 60), ('range_history_days', 180), ('range_big_pct', 30),
                 ('range_medium_pct', 30), ('range_share_pct', 40), ('range_own_orders', 2),
                 ('range_size_min_orders', 3), ('range_min_stores', 2), ('range_peer_min', 1),
                 ('range_new_days', 90), ('range_untried_days', 30), ('range_result_min_stores', 5),
                 ('range_proven_repeat_pct', 50), ('range_slow_repeat_pct', 25),
                 ('range_proven_ros_pct', 75)) as x(k, v)
   where org_id = c_gf and key = x.k;

  insert into public.store_groups (org_id, name) values (v_other_org, 'ZZ range elsewhere') returning id into v_other_group;
  insert into public.store_groups (org_id, name) values (c_gf, 'ZZ range chain') returning id into v_g1;
  insert into public.store_groups (org_id, name) values (c_gf, 'ZZ range other') returning id into v_g2;
  for i in 1..11 loop
    insert into public.stores (org_id, name, store_group_id, visit_frequency, size_override)
    values (c_gf, 'ZZ range S' || i, v_g1, 'monthly', case when i = 11 then 'big' end)
    returning id into v_id;
    s := s || v_id;
  end loop;
  insert into public.stores (org_id, name, store_group_id, visit_frequency)
  values (c_gf, 'ZZ range T1', v_g2, 'monthly') returning id into v_t1;
  insert into public.stores (org_id, name, store_group_id, visit_frequency)
  values (c_gf, 'ZZ range T2', v_g2, 'biweekly') returning id into v_t2;
  insert into public.stores (org_id, name, visit_frequency)
  values (c_gf, 'ZZ range N1', 'monthly') returning id into v_n1;

  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PA', 'ZZ range cat', 10, 100) returning id into pa;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PB', 'ZZ range cat', 10, 100) returning id into pb;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PC', 'ZZ range cat', 10, 100) returning id into pc;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PD', 'ZZ range cat', 10, 100) returning id into pd;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PE', 'ZZ range cat', 10, 100) returning id into pe;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PF', 'ZZ range cat', 10, 100) returning id into pf;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat, created_at)
  values (c_gf, 'ZZ range PG', 'ZZ range cat', 10, 100, now() - interval '40 days') returning id into pg;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PH', 'ZZ range cat', 10, 100) returning id into ph;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PJ', 'ZZ range cat', 10, 100) returning id into pj;
  insert into public.products (org_id, name, category, units_per_shrink, shrink_price_excl_vat)
  values (c_gf, 'ZZ range PK', 'ZZ range lonely', 10, 100) returning id into pk;

  -- PA: S1 biggest .. S10 smallest, three orders each; S2's last one partly
  -- sent back (9,000 sent, 3,000 returned).
  for i in 1..10 loop
    perform pg_temp.zz_order(s[i], 100, jsonb_build_array(jsonb_build_object('p', pa, 'q', 1000 * (11 - i))));
    perform pg_temp.zz_order(s[i], 50, jsonb_build_array(jsonb_build_object('p', pa, 'q', 1000 * (11 - i))));
    if i = 2 then
      perform pg_temp.zz_order(s[i], 10, jsonb_build_array(jsonb_build_object('p', pa, 'q', 9000, 'ret', 3000)));
    else
      v_id := pg_temp.zz_order(s[i], 10, jsonb_build_array(jsonb_build_object('p', pa, 'q', 1000 * (11 - i))));
      if i = 10 then v_last10 := v_id; end if;
    end if;
  end loop;
  for i in 1..3 loop
    perform pg_temp.zz_order(v_t1, 20 * i, jsonb_build_array(jsonb_build_object('p', pa, 'q', 100)));
  end loop;
  perform pg_temp.zz_order(v_n1, 15, jsonb_build_array(jsonb_build_object('p', pa, 'q', 100)));

  -- PB: S1 and S2 twice.
  for i in 1..2 loop
    perform pg_temp.zz_order(s[i], 50, jsonb_build_array(jsonb_build_object('p', pb, 'q', 20)));
    perform pg_temp.zz_order(s[i], 10, jsonb_build_array(jsonb_build_object('p', pb, 'q', 20)));
  end loop;
  -- PC: S4, 100 and 80 days ago, not since.
  perform pg_temp.zz_order(s[4], 100, jsonb_build_array(jsonb_build_object('p', pc, 'q', 10)));
  perform pg_temp.zz_order(s[4], 80, jsonb_build_array(jsonb_build_object('p', pc, 'q', 10)));
  -- PD: S4..S9, 40 and 10 days ago, 10 boxes each time.
  for i in 4..9 loop
    perform pg_temp.zz_order(s[i], 40, jsonb_build_array(jsonb_build_object('p', pd, 'q', 100)));
    perform pg_temp.zz_order(s[i], 10, jsonb_build_array(jsonb_build_object('p', pd, 'q', 100)));
  end loop;
  -- PE: S4..S8 once, S9 twice.
  for i in 4..9 loop
    perform pg_temp.zz_order(s[i], 40, jsonb_build_array(jsonb_build_object('p', pe, 'q', 10)));
  end loop;
  perform pg_temp.zz_order(s[9], 10, jsonb_build_array(jsonb_build_object('p', pe, 'q', 10)));
  -- PH: S1..S5 40 days ago, S1 and S2 again.
  for i in 1..5 loop
    perform pg_temp.zz_order(s[i], 40, jsonb_build_array(jsonb_build_object('p', ph, 'q', 10)));
  end loop;
  perform pg_temp.zz_order(s[1], 10, jsonb_build_array(jsonb_build_object('p', ph, 'q', 10)));
  perform pg_temp.zz_order(s[2], 10, jsonb_build_array(jsonb_build_object('p', ph, 'q', 10)));
  -- PJ: S4..S9, 120 and 100 days ago.
  for i in 4..9 loop
    perform pg_temp.zz_order(s[i], 120, jsonb_build_array(jsonb_build_object('p', pj, 'q', 100)));
    perform pg_temp.zz_order(s[i], 100, jsonb_build_array(jsonb_build_object('p', pj, 'q', 100)));
  end loop;
  -- PK: S10 on its last order day only (the PA order 10 days ago).
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, line_status, client_generated_id)
  values (c_gf, v_last10, pk, 10, 10, 'open', gen_random_uuid());
  -- Not orders: a cancelled order (PF), a cancelled line (PG), a back-order (PF).
  perform pg_temp.zz_order(s[10], 5, jsonb_build_array(jsonb_build_object('p', pf, 'q', 10)), 'cancelled');
  perform pg_temp.zz_order(s[10], 5, jsonb_build_array(jsonb_build_object('p', pg, 'q', 10, 'st', 'cancelled')));
  perform pg_temp.zz_order(s[10], 5, jsonb_build_array(jsonb_build_object('p', pf, 'q', 10)), 'new', v_last10);

  -- The chain's price list: PB at P500 a box.
  insert into public.customer_price_lists (org_id, name) values (c_gf, 'ZZ range list') returning id into v_list;
  insert into public.customer_price_list_items (price_list_id, org_id, product_id, shrink_price_excl_vat)
  values (v_list, c_gf, pb, 500);
  update public.store_groups set price_list_id = v_list where id = v_g1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);

  create temp table zz_f on commit drop as select * from public.range_facts(c_gf, null);

  ---------------------------------------------------------------- G1 sizes
  for i in 1..11 loop
    select * into f from zz_f where store_id = s[i] and product_id = pa;
    if f.size is distinct from (case when i <= 3 or i = 11 then 'big' when i <= 6 then 'medium' else 'small' end)
       or f.size_source is distinct from (case when i = 11 then 'set' else 'sales' end) then
      v_fail := v_fail || format('G1 S%s sized %s/%s', i, f.size, f.size_source) || E'\n';
    end if;
  end loop;
  select * into f from zz_f where store_id = v_t2 and product_id = pa;
  if f.size is distinct from 'medium' or f.size_source is distinct from 'visits' then
    v_fail := v_fail || format('G1 T2 (every two weeks, no orders) sized %s/%s', f.size, f.size_source) || E'\n';
  end if;

  ---------------------------------------------------------------- G2 similar stores
  select * into f from zz_f where store_id = s[1] and product_id = pa;
  if f.level <> 1 or f.cluster_stores <> 3 then
    v_fail := v_fail || format('G2 S1 compared with %s stores at level %s', f.cluster_stores, f.level) || E'\n';
  end if;
  select * into f from zz_f where store_id = v_t1 and product_id = pa;
  if f.level <> 3 or f.size <> 'big' then
    v_fail := v_fail || format('G2 T1 alone in its group: level %s, %s', f.level, f.size) || E'\n';
  end if;
  if (select group_key from zz_f where store_id = v_n1 limit 1) is distinct from 'none' then
    v_fail := v_fail || 'G2 a store with no group is not in "none"' || E'\n';
  end if;

  ---------------------------------------------------------------- G3 in range
  select * into f from zz_f where store_id = s[1] and product_id = pb;
  if not f.in_range or f.reason <> 'own' or f.status <> 'have' or f.own_orders <> 2 then
    v_fail := v_fail || format('G3 S1 PB own: %s/%s/%s/%s', f.in_range, f.reason, f.status, f.own_orders) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[3] and product_id = pb;
  if not f.in_range or f.reason <> 'share' or f.status <> 'gap' or f.share <> 66.7 then
    v_fail := v_fail || format('G3 S3 PB share: %s/%s/%s/%s', f.in_range, f.reason, f.status, f.share) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[4] and product_id = pb;
  if f.in_range or f.status is not null then
    v_fail := v_fail || format('G3 S4 (medium) PB in range: %s/%s', f.reason, f.status) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[5] and product_id = pc;
  if f.in_range then
    v_fail := v_fail || format('G3 S5 PC at 33 %% in range: %s', f.reason) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[11] and product_id = pa;
  if not f.in_range or f.reason <> 'share' or f.status <> 'quiet' or f.recent then
    v_fail := v_fail || format('G3 S11 (no orders) PA: %s/%s/%s', f.in_range, f.reason, f.status) || E'\n';
  end if;

  ---------------------------------------------------------------- G4 status and data
  select * into f from zz_f where store_id = s[4] and product_id = pc;
  if not f.in_range or f.reason <> 'own' or f.status <> 'stopped' or f.last_ordered <> v_today - 80 then
    v_fail := v_fail || format('G4 S4 PC stopped: %s/%s/%s/%s', f.in_range, f.reason, f.status, f.last_ordered) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[4] and product_id = pe;
  if f.in_range or f.status <> 'off_range' then
    v_fail := v_fail || format('G4 S4 PE once: %s/%s', f.reason, f.status) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[2] and product_id = pa;
  if f.boxes_recent <> 1500 then
    v_fail := v_fail || format('G4 S2 PA boxes with the return: %s, not 1500', f.boxes_recent) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[1] and product_id = pa;
  if f.boxes_recent <> 2000 or f.value_recent <> 200000 then
    v_fail := v_fail || format('G4 S1 PA: %s boxes P%s', f.boxes_recent, f.value_recent) || E'\n';
  end if;
  if exists (select 1 from zz_f where product_id in (pf, pg) and (status is not null or own_orders > 0)) then
    v_fail := v_fail || 'G4 a cancelled order, cancelled line or back-order counted' || E'\n';
  end if;

  ---------------------------------------------------------------- G5 new products
  create temp table zz_r on commit drop as select * from public.range_product_results(c_gf);
  for r in select x.p, x.stage, x.result, x.tried, x.chances, x.repeats
             from (values (pa, 'established', 'proven', 12, 11, 11),  -- T1 and N1 too; N1 once
                          (pb, 'new', 'trying', 2, 2, 2),
                          (pd, 'new', 'proven', 6, 6, 6),
                          (pe, 'new', 'not_taking', 6, 6, 1),
                          (ph, 'new', 'slow', 5, 5, 2),
                          (pj, 'established', 'proven', 6, 6, 6),
                          (pf, 'not_ordered', 'waiting', 0, 0, 0),
                          (pg, 'not_ordered', 'untried', 0, 0, 0),
                          (pk, 'new', 'trying', 1, 0, 0)) as x(p, stage, result, tried, chances, repeats)
  loop
    if not exists (select 1 from zz_r q where q.product_id = r.p and q.stage = r.stage and q.result = r.result
                      and q.tried = r.tried and q.chances = r.chances and q.repeats = r.repeats) then
      select format('%s/%s tried %s chances %s repeats %s', stage, result, tried, chances, repeats) into v_txt
        from zz_r where product_id = r.p;
      v_fail := v_fail || format('G5 %s: %s, expected %s/%s %s/%s/%s',
        (select name from public.products where id = r.p), v_txt, r.stage, r.result, r.tried, r.chances, r.repeats) || E'\n';
    end if;
  end loop;
  if (select launch_on from zz_r where product_id = pb) is distinct from v_today - 50
     or (select added_on from zz_r where product_id = pb) is distinct from v_today then
    v_fail := v_fail || 'G5 PB launch is not its first order' || E'\n';
  end if;
  if (select groups_tried from zz_r where product_id = pd) is distinct from array[v_g1::text] then
    v_fail := v_fail || 'G5 PD groups tried is not the chain' || E'\n';
  end if;
  select percentile_cont(0.5) within group (order by q.ros) into v_num
    from zz_r q join public.products p on p.id = q.product_id
   where p.category = 'ZZ range cat' and q.tried > 0;
  if (select similar_ros from zz_r where product_id = pd) is distinct from round(v_num::numeric, 3) then
    v_fail := v_fail || format('G5 PD compared with %s, the category median is %s',
      (select similar_ros from zz_r where product_id = pd), round(v_num::numeric, 3)) || E'\n';
  end if;
  if (select similar_ros from zz_r where product_id = pk) is not distinct from (select similar_ros from zz_r where product_id = pd)
     or (select similar_ros from zz_r where product_id = pk) is null then
    v_fail := v_fail || 'G5 a lonely category is not compared with all products' || E'\n';
  end if;
  -- Proven: the chain's big stores that never ordered it; not an untried group.
  for i in 1..3 loop
    select * into f from zz_f where store_id = s[i] and product_id = pd;
    if not f.in_range or f.reason <> 'launch' or f.status <> 'gap' then
      v_fail := v_fail || format('G5 S%s PD launch: %s/%s/%s', i, f.in_range, f.reason, f.status) || E'\n';
    end if;
  end loop;
  select * into f from zz_f where store_id = v_t1 and product_id = pd;
  if f.in_range then
    v_fail := v_fail || format('G5 T1 (big, untried group) has PD: %s', f.reason) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[10] and product_id = pd;
  if not f.in_range or f.reason <> 'share' or f.status <> 'gap' then
    v_fail := v_fail || format('G5 S10 PD (small, 3 of 4): %s/%s/%s', f.in_range, f.reason, f.status) || E'\n';
  end if;
  -- Not taking off: no gap where never ordered, kept where ordered again.
  select * into f from zz_f where store_id = s[10] and product_id = pe;
  if f.in_range or f.status is not null or f.cluster_reason <> 'not_taking' then
    v_fail := v_fail || format('G5 S10 PE (75 %% share, not taking off): %s/%s/%s', f.reason, f.status, f.cluster_reason) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[9] and product_id = pe;
  if not f.in_range or f.reason <> 'own' or f.status <> 'have' then
    v_fail := v_fail || format('G5 S9 PE ordered again: %s/%s/%s', f.in_range, f.reason, f.status) || E'\n';
  end if;
  -- Slow: the normal rules.
  select * into f from zz_f where store_id = s[6] and product_id = ph;
  if not f.in_range or f.reason <> 'share' or f.status <> 'gap' then
    v_fail := v_fail || format('G5 S6 PH (slow, 2 of 3): %s/%s/%s', f.in_range, f.reason, f.status) || E'\n';
  end if;
  -- Older than 90 days: no launch, the share rule only.
  select * into f from zz_f where store_id = s[1] and product_id = pj;
  if f.in_range then
    v_fail := v_fail || format('G5 S1 PJ (proven but established) in range: %s', f.reason) || E'\n';
  end if;

  ---------------------------------------------------------------- G6 the estimate
  select * into f from zz_f where store_id = s[3] and product_id = pb;
  v_num := round(80::numeric / 10 / 2 / (60 / 30.4), 2);
  if f.est_boxes_month is distinct from v_num or f.case_price is distinct from 500.00 then
    v_fail := v_fail || format('G6 S3 PB: %s boxes at P%s, expected %s at P500', f.est_boxes_month, f.case_price, v_num) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[1] and product_id = pd;
  if f.case_price is distinct from 100.00 then
    v_fail := v_fail || format('G6 PD (not on the list) at P%s', f.case_price) || E'\n';
  end if;

  ---------------------------------------------------------------- G7 overrides (as the manager)
  set local role authenticated;
  perform public.range_pin_set(v_g1, pg, 'always', 'medium');
  perform public.range_pin_set(v_g1, pd, 'never');
  perform public.store_range_exclude(s[3], array[pb], 'Not allowed to sell it');
  reset role;
  truncate zz_f;
  insert into zz_f select * from public.range_facts(c_gf, null);
  select count(*) into v_n from zz_f
   where product_id = pg and store_group_id = v_g1 and in_range and reason = 'pin';
  if v_n <> 7 then  -- S1..S6 and S11
    v_fail := v_fail || format('G7 Always from medium put PG in %s stores, not 7', v_n) || E'\n';
  end if;
  if exists (select 1 from zz_f where product_id = pg and store_id = any (s[7:10]) and in_range) then
    v_fail := v_fail || 'G7 Always from medium reached a small store' || E'\n';
  end if;
  if exists (select 1 from zz_f where product_id = pd and store_group_id = v_g1 and in_range) then
    v_fail := v_fail || 'G7 Never did not beat proven and own orders' || E'\n';
  end if;
  select * into f from zz_f where store_id = s[4] and product_id = pd;
  if f.reason <> 'pin_never' or f.status <> 'off_range' then
    v_fail := v_fail || format('G7 S4 PD under Never: %s/%s', f.reason, f.status) || E'\n';
  end if;
  select * into f from zz_f where store_id = s[3] and product_id = pb;
  if f.in_range or f.reason <> 'excluded' or f.exclusion_reason <> 'Not allowed to sell it' or f.status is not null then
    v_fail := v_fail || format('G7 S3 PB not for this store: %s/%s/%s', f.in_range, f.reason, f.status) || E'\n';
  end if;
  set local role authenticated;
  perform public.range_pin_clear(v_g1, pd);
  perform public.range_pin_clear(null, pg);
  perform public.store_range_include(s[3], array[pb]);
  reset role;
  truncate zz_f;
  insert into zz_f select * from public.range_facts(c_gf, null);
  if (select reason from zz_f where store_id = s[1] and product_id = pd) is distinct from 'launch'
     or (select reason from zz_f where store_id = s[3] and product_id = pb) is distinct from 'share'
     or exists (select 1 from zz_f where product_id = pg and in_range) then
    v_fail := v_fail || 'G7 clearing the pins and the exclusion did not go back to Tickd deciding' || E'\n';
  end if;
  -- Every group at once.
  set local role authenticated;
  perform public.range_pin_set(null, pf, 'never');
  reset role;
  if (select count(*) from public.range_pins where product_id = pf)
     <> (select count(*) from public.store_groups where org_id = c_gf) then
    v_fail := v_fail || 'G7 a pin for every group missed a group' || E'\n';
  end if;
  delete from public.range_pins where product_id = pf;

  ---------------------------------------------------------------- G8 settings
  update public.company_settings set value = '70'::jsonb where org_id = c_gf and key = 'range_share_pct';
  select * into f from public.range_facts(c_gf, null) x where x.store_id = s[3] and x.product_id = pb;
  if f.in_range then
    v_fail := v_fail || 'G8 at 70 %, 2 of 3 still puts PB in S3''s range' || E'\n';
  end if;
  update public.company_settings set value = '40'::jsonb where org_id = c_gf and key = 'range_share_pct';
  -- Gold Fortune has more ordering stores than the setting's highest value
  -- (50), so the suite steps past the setting's check to be a company that
  -- is still learning.
  alter table public.company_settings disable trigger company_settings_validate;
  update public.company_settings set value = '100000'::jsonb where org_id = c_gf and key = 'range_min_stores';
  select * into f from public.range_facts(c_gf, null) x where x.store_id = s[3] and x.product_id = pb;
  if f.level <> 0 or f.in_range then
    v_fail := v_fail || format('G8 learning: level %s, S3 PB in range %s', f.level, f.in_range) || E'\n';
  end if;
  select * into f from public.range_facts(c_gf, null) x where x.store_id = s[1] and x.product_id = pb;
  if not f.in_range or f.reason <> 'own' then
    v_fail := v_fail || 'G8 learning dropped a store''s own orders' || E'\n';
  end if;
  update public.company_settings set value = '2'::jsonb where org_id = c_gf and key = 'range_min_stores';
  alter table public.company_settings enable trigger company_settings_validate;
  -- A shorter look-back: PB's day-50 order is outside 30 days, its day-10 inside.
  select * into f from public.range_facts(c_gf, 30) x where x.store_id = s[1] and x.product_id = pb;
  if f.boxes_recent <> 2 or f.status <> 'have' then
    v_fail := v_fail || format('G8 30 days: S1 PB %s boxes, %s', f.boxes_recent, f.status) || E'\n';
  end if;

  ---------------------------------------------------------------- G9 the screens (as the manager)
  set local role authenticated;
  select rs.lines, rs.size, rs.learning into v_json, v_txt, v_bool
    from public.range_status(null) rs where rs.store_id = s[3];
  if v_txt <> 'big' or v_bool
     or (select l->>'status' from jsonb_array_elements(v_json) l where l->>'product_id' = pb::text) <> 'gap'
     or (select (l->>'est_value_month')::numeric from jsonb_array_elements(v_json) l where l->>'product_id' = pb::text)
          is distinct from round(round(80::numeric / 10 / 2 / (60 / 30.4), 2) * 500, 2)
     or exists (select 1 from jsonb_array_elements(v_json) l where l->>'product_id' = pf::text) then
    v_fail := v_fail || format('G9 range_status S3: %s %s', v_txt, v_json) || E'\n';
  end if;
  if not (select rs.quiet from public.range_status(null) rs where rs.store_id = s[11]) then
    v_fail := v_fail || 'G9 S11 is not quiet' || E'\n';
  end if;
  select rs.store_name, rs.min_stores, rs.ordering_stores into v_txt, v_n, i
    from public.range_status(null) rs where rs.store_id = s[3];
  if v_txt <> 'ZZ range S3' or v_n <> 2
     or i <> (select count(distinct o.store_id) from public.orders o join public.stores x on x.id = o.store_id
               where o.org_id = c_gf and x.active and o.status <> 'cancelled' and o.parent_order_id is null
                 and o.created_at >= ((v_today - 179)::timestamp at time zone v_tz)
                 and exists (select 1 from public.order_lines ol where ol.order_id = o.id
                              and ol.line_status <> 'cancelled' and ol.qty_ordered - ol.qty_returned > 0)) then
    v_fail := v_fail || format('G9 range_status S3: %s, needs %s, %s ordering', v_txt, v_n, i) || E'\n';
  end if;
  if exists (select 1 from public.range_status(null) rs
              where not exists (select 1 from public.stores x where x.id = rs.store_id and x.org_id = c_gf and x.active)) then
    v_fail := v_fail || 'G9 range_status returned a store that is not an active Gold Fortune store' || E'\n';
  end if;
  select * into r from public.range_products() x where x.product_id = pd;
  if r.result <> 'proven' or r.repeats <> 6 or r.min_chances <> 5 or r.untried_days <> 30 then
    v_fail := v_fail || format('G9 range_products PD: %s repeats %s', r.result, r.repeats) || E'\n';
  end if;
  -- The spread from range_status: S1-3 launch + S10 share are missing; S4-9 have it; S11 is quiet.
  select count(*) filter (where l->>'status' = 'have'), count(*) filter (where l->>'status' = 'gap')
    into v_n, i
    from public.range_status(null) rs cross join jsonb_array_elements(rs.lines) l
   where l->>'product_id' = pd::text;
  if v_n <> 6 or i <> 4 then
    v_fail := v_fail || format('G9 range_status PD: have %s, missing %s', v_n, i) || E'\n';
  end if;
  select * into r from public.range_grid(v_g1) x where x.product_id = pb and x.size = 'big';
  if not r.cluster_in or r.cluster_reason <> 'share' or r.stores <> 4 then
    v_fail := v_fail || format('G9 range_grid PB big: %s %s %s', r.cluster_in, r.cluster_reason, r.stores) || E'\n';
  end if;
  select * into r from public.range_grid(v_g1) x where x.product_id = pc and x.size = 'medium';
  if r.cluster_in or r.own_in <> 1 then
    v_fail := v_fail || format('G9 range_grid PC medium: %s own %s', r.cluster_in, r.own_in) || E'\n';
  end if;
  select * into r from public.range_grid(v_g1) x where x.product_id = pe and x.size = 'small';
  if r.cluster_reason <> 'not_taking' then
    v_fail := v_fail || format('G9 range_grid PE small: %s', r.cluster_reason) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- G10 access
  -- Nobody writes the tables directly.
  set local role authenticated;
  begin
    insert into public.range_pins (org_id, store_group_id, product_id, rule) values (c_gf, v_g1, pa, 'never');
    v_fail := v_fail || 'G10 a manager wrote range_pins directly' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.range_pin_set(v_other_group, pa, 'never');
    v_fail := v_fail || 'G10 a pin on another company''s group' || E'\n';
  exception when others then null;
  end;
  begin
    perform public.store_range_exclude(s[1], array[pa], '');
    v_fail := v_fail || 'G10 not for this store with no reason' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform count(*) from public.range_status(null);
    v_fail := v_fail || 'G10 a rep read range_status' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.range_products();
    v_fail := v_fail || 'G10 a rep read range_products' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.range_grid(v_g1);
    v_fail := v_fail || 'G10 a rep read range_grid' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.range_pin_set(v_g1, pa, 'never');
    v_fail := v_fail || 'G10 a rep pinned a product' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.store_range_exclude(s[1], array[pa], 'Rep says no');
    v_fail := v_fail || 'G10 a rep marked not for this store' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.range_facts(c_gf, null);
    v_fail := v_fail || 'G10 a rep called the internal range_facts' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  -- With insights but not invoicing: the range, no money.
  insert into public.profile_permissions (profile_id, permission_code) values (v_rep, 'insights');
  set local role authenticated;
  select rs.lines into v_json from public.range_status(null) rs where rs.store_id = s[3];
  if (select l->>'est_value_month' from jsonb_array_elements(v_json) l where l->>'product_id' = pb::text) is not null
     or (select l->>'est_boxes_month' from jsonb_array_elements(v_json) l where l->>'product_id' = pb::text) is null
     then
    v_fail := v_fail || 'G10 money shown without invoicing' || E'\n';
  end if;
  reset role;

  -- Distribution off (warehouse depends on it, so it goes first).
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'warehouse';
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'distribution';
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform count(*) from public.range_status(null);
    v_fail := v_fail || 'G10 range_status answered with distribution off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  update public.company_modules set enabled = true where org_id = c_gf and module_code = 'distribution';
  update public.company_modules set enabled = true where org_id = c_gf and module_code = 'warehouse';

  ---------------------------------------------------------------- G11 grants and registration
  for r in select x.sig, x.callable
             from (values ('public.range_facts(uuid, integer)', false),
                          ('public.range_product_results(uuid)', false),
                          ('public.range_status(integer)', true),
                          ('public.range_products()', true),
                          ('public.range_grid(uuid)', true),
                          ('public.range_pin_set(uuid, uuid, text, text)', true),
                          ('public.range_pin_clear(uuid, uuid)', true),
                          ('public.store_range_exclude(uuid, uuid[], text)', true),
                          ('public.store_range_include(uuid, uuid[])', true)) as x(sig, callable)
  loop
    if has_function_privilege('anon', r.sig, 'execute')
       or has_function_privilege('authenticated', r.sig, 'execute') <> r.callable then
      v_fail := v_fail || format('G11 %s grants', r.sig) || E'\n';
    end if;
    if not (select prosecdef and proconfig::text like '%search_path=public, pg_temp%'
              from pg_proc where oid = r.sig::regprocedure) then
      v_fail := v_fail || format('G11 %s is not definer with a pinned search_path', r.sig) || E'\n';
    end if;
    -- The callable ones belong to distribution; the internal ones to nobody
    -- (nothing can call them for the module to refuse).
    if (select module_code from public.module_assignments
         where kind = 'function' and name = split_part(replace(r.sig, 'public.', ''), '(', 1))
       is distinct from (case when r.callable then 'distribution' end) then
      v_fail := v_fail || format('G11 %s is registered wrongly', r.sig) || E'\n';
    end if;
  end loop;
  for v_txt in select unnest(array['range_pins', 'store_range_exclusions']) loop
    if (select module_code from public.module_assignments where kind = 'table' and name = v_txt) is distinct from 'distribution'
       or not exists (select 1 from pg_policies where tablename = v_txt and policyname = 'module_gate' and permissive = 'RESTRICTIVE')
       or has_table_privilege('authenticated', 'public.' || v_txt, 'insert')
       or has_table_privilege('authenticated', 'public.' || v_txt, 'update')
       or has_table_privilege('authenticated', 'public.' || v_txt, 'delete') then
      v_fail := v_fail || format('G11 %s is not gated, or is writable', v_txt) || E'\n';
    end if;
  end loop;
  if exists (select 1 from public.organizations o where not exists (
               select 1 from public.company_settings cs where cs.org_id = o.id and cs.key = 'range_lapse_days')) then
    v_fail := v_fail || 'G11 a company has no range_lapse_days' || E'\n';
  end if;

  raise exception '%', case when v_fail = ''
    then format('STORE RANGE SUITE PASSED (live: %s stores, %s products, %s in range, %s gaps)',
                (select count(distinct store_id) from zz_f where store_id <> all (s) and store_id not in (v_t1, v_t2, v_n1)),
                (select count(distinct product_id) from zz_r),
                (select count(*) from zz_f where in_range and status <> 'quiet'),
                (select count(*) from zz_f where status = 'gap'))
    else E'STORE RANGE SUITE FAILED\n' || v_fail end;
end;
$$;
