-- Store health suite (the dashboard card opened up as a list, 13 Oct 2026).
--
--   H1  Live data: dashboard_business's health counts equal store_health's rows,
--       group by group, read as a manager through row-level security; and the
--       card's five "go here first" stores are the list's first five.
--   H2  The three statuses split the active stores with nothing left over.
--   H3  Fixtures with known dates land in the right group: never visited,
--       visited 40 days ago, visited exactly 30 days ago, visited without an
--       order, visited and ordering, ordering without a visit, a cancelled
--       order that does not count, lapsed after 60 days but not at exactly 60,
--       and an inactive store left out.
--   H4  Grants, security invoker and the module registration.
--   H5  The window (20261013130000): no argument is exactly the card's 30
--       days; a 14-day window regroups the fixtures as it should, with
--       "stopped ordering" at twice the window; a start in the future counts
--       as now.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_mgr uuid; v_rep uuid;
  v_j jsonb;
  v_all int; v_ordering int; v_no_order int; v_not_visited int; v_lapsed int; v_ordered_30 int;
  v_card text; v_list text;
  v_same int; v_w record;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_h uuid; v_i uuid; v_k uuid;
  r record;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by created_at limit 1;
  if v_mgr is null or v_rep is null then
    raise exception 'Fixtures missing: a Gold Fortune manager and a rep are needed.';
  end if;

  ---------------------------------------------------------------- H3 fixtures
  -- Inserted before the live counts are read, so H1 also covers stores in every
  -- group even on a quiet day.
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health A never visited') returning id into v_a;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health B 40 days') returning id into v_b;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health C no order') returning id into v_c;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health D ordering') returning id into v_d;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health E lapsed') returning id into v_e;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health F cancelled') returning id into v_f;
  insert into public.stores (org_id, name, active) values (c_gf, 'ZZ health G inactive', false) returning id into v_g;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health H orders unseen') returning id into v_h;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health I 30 days') returning id into v_i;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ health K 60 days') returning id into v_k;

  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, client_generated_id)
  values (c_gf, v_rep, v_b, 'checked_out', now() - interval '40 days', gen_random_uuid()),
         (c_gf, v_rep, v_c, 'checked_out', now() - interval '5 days', gen_random_uuid()),
         (c_gf, v_rep, v_d, 'checked_out', now() - interval '5 days', gen_random_uuid()),
         (c_gf, v_rep, v_e, 'checked_out', now() - interval '5 days', gen_random_uuid()),
         (c_gf, v_rep, v_f, 'checked_out', now() - interval '2 days', gen_random_uuid()),
         (c_gf, v_rep, v_g, 'checked_out', now() - interval '1 day', gen_random_uuid()),
         (c_gf, v_rep, v_i, 'checked_out', now() - interval '30 days', gen_random_uuid()),
         (c_gf, v_rep, v_k, 'checked_out', now() - interval '1 day', gen_random_uuid());

  insert into public.orders (org_id, order_number, store_id, source, received_via, status, cancel_reason,
                             created_at, client_generated_id)
  values (c_gf, 'ZZ-HEALTH-D', v_d, 'warehouse_manual', 'other', 'new', null, now() - interval '3 days', gen_random_uuid()),
         (c_gf, 'ZZ-HEALTH-E', v_e, 'warehouse_manual', 'other', 'new', null, now() - interval '90 days', gen_random_uuid()),
         (c_gf, 'ZZ-HEALTH-F', v_f, 'warehouse_manual', 'other', 'cancelled', 'Suite fixture', now() - interval '1 day', gen_random_uuid()),
         (c_gf, 'ZZ-HEALTH-H', v_h, 'warehouse_manual', 'other', 'new', null, now() - interval '10 days', gen_random_uuid()),
         (c_gf, 'ZZ-HEALTH-K', v_k, 'warehouse_manual', 'other', 'new', null, now() - interval '60 days', gen_random_uuid());

  ---------------------------------------------------------------- read as the manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_j := public.dashboard_business(now() - interval '30 days', now()) -> 'health';
  select count(*),
         count(*) filter (where status = 'ordering'),
         count(*) filter (where status = 'no_order'),
         count(*) filter (where status = 'not_visited'),
         count(*) filter (where lapsed),
         count(*) filter (where last_order_at >= now() - interval '30 days')
    into v_all, v_ordering, v_no_order, v_not_visited, v_lapsed, v_ordered_30
    from public.store_health();
  select string_agg(x ->> 'id', ',' order by ord) into v_card
    from jsonb_array_elements(v_j -> 'longest_unvisited') with ordinality as e(x, ord);
  select string_agg(store_id::text, ',' order by n) into v_list
    from (select store_id, row_number() over (order by last_visit_at nulls first, store_name, store_id) as n
            from public.store_health() where status = 'not_visited') t
   where n <= 5;

  -- H5, while still the manager.
  select count(*) into v_same
    from public.store_health() a
    full join public.store_health(now() - interval '30 days') b using (store_id)
   where a.status is distinct from b.status or a.lapsed is distinct from b.lapsed;
  if v_same <> 0 then
    v_fail := v_fail || format('H5 no argument differs from the last 30 days for %s stores', v_same) || E'\n';
  end if;
  for v_w in select * from public.store_health(now() - interval '14 days') where store_name like 'ZZ health %' loop
    if (v_w.store_id = v_c and v_w.status <> 'no_order')           -- visited 5 days ago, no order
       or (v_w.store_id = v_d and v_w.status <> 'ordering')        -- ordered 3 days ago
       or (v_w.store_id = v_i and v_w.status <> 'not_visited')     -- visited 30 days ago: outside 14
       or (v_w.store_id = v_h and (v_w.status <> 'not_visited' or v_w.lapsed))  -- ordered 10 days ago, never seen
       or (v_w.store_id = v_k and not v_w.lapsed)                  -- last order 60 days ago: over 28
       or (v_w.store_id = v_e and not v_w.lapsed) then             -- last order 90 days ago
      v_fail := v_fail || format('H5 14-day window: %s', row_to_json(v_w)) || E'\n';
    end if;
  end loop;
  -- A start in the future is now: nothing has been visited "since tomorrow".
  if (select count(*) from public.store_health(now() + interval '5 days') where status <> 'not_visited') <> 0 then
    v_fail := v_fail || 'H5 a future start found stores visited after it' || E'\n';
  end if;

  -- H3 rows, while still the manager.
  for r in select * from public.store_health() where store_name like 'ZZ health %' loop
    if r.store_id = v_a and not (r.status = 'not_visited' and r.days_since_visit is null and not r.lapsed and r.orders_ever = 0) then
      v_fail := v_fail || format('H3 never visited: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_b and not (r.status = 'not_visited' and r.days_since_visit = 40) then
      v_fail := v_fail || format('H3 visited 40 days ago: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_c and not (r.status = 'no_order' and r.days_since_visit = 5 and r.last_order_at is null and not r.lapsed) then
      v_fail := v_fail || format('H3 visited, no order: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_d and not (r.status = 'ordering' and r.days_since_order = 3 and r.orders_ever = 1 and not r.lapsed) then
      v_fail := v_fail || format('H3 visited and ordering: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_e and not (r.status = 'no_order' and r.lapsed and r.days_since_order = 90) then
      v_fail := v_fail || format('H3 lapsed: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_f and not (r.status = 'no_order' and r.orders_ever = 0 and r.last_order_at is null) then
      v_fail := v_fail || format('H3 a cancelled order counted: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_h and not (r.status = 'not_visited' and r.orders_ever = 1 and not r.lapsed) then
      v_fail := v_fail || format('H3 ordering but never visited: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_i and not (r.status = 'no_order' and r.days_since_visit = 30) then
      v_fail := v_fail || format('H3 visited exactly 30 days ago: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_k and not (r.status = 'no_order' and not r.lapsed and r.days_since_order = 60) then
      v_fail := v_fail || format('H3 ordered exactly 60 days ago: %s', row_to_json(r)) || E'\n';
    elsif r.store_id = v_g then
      v_fail := v_fail || 'H3 an inactive store is listed' || E'\n';
    end if;
  end loop;
  if (select count(*) from public.store_health() where store_name like 'ZZ health %') <> 9 then
    v_fail := v_fail || format('H3 expected 9 fixture stores, found %s',
      (select count(*) from public.store_health() where store_name like 'ZZ health %')) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- H1 the card equals the list
  if (v_j ->> 'stores_active')::int <> v_all then
    v_fail := v_fail || format('H1 stores_active %s, list %s', v_j ->> 'stores_active', v_all) || E'\n';
  end if;
  if (v_j ->> 'visited_no_order_30d')::int <> v_no_order then
    v_fail := v_fail || format('H1 visited_no_order_30d %s, list %s', v_j ->> 'visited_no_order_30d', v_no_order) || E'\n';
  end if;
  if (v_j ->> 'not_visited_30d')::int <> v_not_visited then
    v_fail := v_fail || format('H1 not_visited_30d %s, list %s', v_j ->> 'not_visited_30d', v_not_visited) || E'\n';
  end if;
  if (v_j ->> 'lapsed_60d')::int <> v_lapsed then
    v_fail := v_fail || format('H1 lapsed_60d %s, list %s', v_j ->> 'lapsed_60d', v_lapsed) || E'\n';
  end if;
  if (v_j ->> 'ordered_30d')::int <> v_ordered_30 then
    v_fail := v_fail || format('H1 ordered_30d %s, list %s', v_j ->> 'ordered_30d', v_ordered_30) || E'\n';
  end if;
  -- The card shows "Visited and ordering" as what is left: it must be the list's.
  if (v_j ->> 'stores_active')::int - (v_j ->> 'visited_no_order_30d')::int - (v_j ->> 'not_visited_30d')::int <> v_ordering then
    v_fail := v_fail || format('H1 visited and ordering: card %s, list %s',
      (v_j ->> 'stores_active')::int - (v_j ->> 'visited_no_order_30d')::int - (v_j ->> 'not_visited_30d')::int,
      v_ordering) || E'\n';
  end if;
  if coalesce(v_card, '') is distinct from coalesce(v_list, '') then
    v_fail := v_fail || format('H1 "go here first": card %s, list %s', v_card, v_list) || E'\n';
  end if;

  ---------------------------------------------------------------- H2 a clean split
  if v_ordering + v_no_order + v_not_visited <> v_all then
    v_fail := v_fail || format('H2 %s + %s + %s is not %s', v_ordering, v_no_order, v_not_visited, v_all) || E'\n';
  end if;
  if v_all <> (select count(*) from public.stores where org_id = c_gf and active) then
    v_fail := v_fail || 'H2 store_health does not list every active store for a manager' || E'\n';
  end if;

  ---------------------------------------------------------------- H4 grants
  if (select prosecdef from pg_proc where oid = 'public.store_health(timestamptz)'::regprocedure) then
    v_fail := v_fail || 'H4 store_health is security definer' || E'\n';
  end if;
  if has_function_privilege('anon', 'public.store_health(timestamptz)', 'execute') then
    v_fail := v_fail || 'H4 anon can call store_health' || E'\n';
  end if;
  if not has_function_privilege('authenticated', 'public.store_health(timestamptz)', 'execute') then
    v_fail := v_fail || 'H4 authenticated cannot call store_health' || E'\n';
  end if;
  if (select module_code from public.module_assignments where kind = 'function' and name = 'store_health')
       is distinct from 'core' then
    v_fail := v_fail || 'H4 store_health is not registered as core' || E'\n';
  end if;

  raise exception '%', case when v_fail = ''
    then format('STORE HEALTH SUITE PASSED (live: %s active, %s ordering, %s no order, %s not visited, %s lapsed)',
                v_all, v_ordering, v_no_order, v_not_visited, v_lapsed)
    else E'STORE HEALTH SUITE FAILED\n' || v_fail end;
end;
$$;
