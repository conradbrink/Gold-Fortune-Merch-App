-- What is in a delivery, for the rep it was given to (22 Oct 2026).
--
--   C1  The gap, as a control: the assigned rep reads the dispatch's lines but
--       not one of the order lines behind them, when the order is somebody
--       else's.
--   C2  delivery_contents gives that rep one row per order line, each with
--       its product, and the same units the dispatch carries.
--   C3  No price, cost or discount comes back: none is a result column.
--   C4  Another rep in the same company is refused by the access check.
--   C5  An administrator of another company, with Warehouse switched on for
--       it inside this transaction, is refused by the company check.
--   C6  The warehouse reads it too.
--   C7  A null dispatch is refused; anon and PUBLIC cannot call it.
--   C8  It agrees with `dispatches_select` on every assigned dispatch: the
--       rep who can see the dispatch can read its contents, and a rep who
--       cannot see it is refused.
--
-- Refusals are matched on the access check's own message, not on 42501
-- alone: require_module raises the same code, and a check that passes on the
-- module gate proves nothing about the company or the assignment.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. Its only writes (C5's module and
-- permission rows) are rolled back with it.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  c_refusal constant text := 'That delivery is not assigned to you.';
  v_fail text := '';
  v_info text := '';
  v_dispatch uuid; v_rep uuid; v_other uuid; v_foreign uuid; v_foreign_org uuid; v_wh uuid;
  v_lines int; v_units int; v_n int; v_named int; v_sum int; v_ok boolean;
  v_txt text; r record;
  v_checked int := 0;
begin
  -- A delivery given to a rep for an order somebody else took: the case the
  -- phone could not open.
  select d.id, d.assigned_rep_id into v_dispatch, v_rep
    from public.dispatches d
    join public.orders o on o.id = d.order_id
    join public.profiles p on p.id = d.assigned_rep_id
   where d.org_id = c_gf and p.is_active
     and o.rep_id is distinct from d.assigned_rep_id
     and exists (select 1 from public.dispatch_lines dl where dl.dispatch_id = d.id)
   order by d.dispatched_at desc, d.id
   limit 1;
  select id into v_other from public.profiles
   where org_id = c_gf and role = 'rep' and is_active and id <> v_rep
   order by full_name, id limit 1;
  select id into v_wh from public.profiles
   where org_id = c_gf and role = 'warehouse' and is_active
   order by full_name, id limit 1;
  -- Anybody active in an open company that is not Gold Fortune.
  select p.id, p.org_id into v_foreign, v_foreign_org from public.profiles p
   where p.org_id <> c_gf and p.is_active
     and not exists (select 1 from public.company_account ca
                      where ca.org_id = p.org_id and ca.closed_at is not null)
   order by p.created_at, p.id limit 1;
  if v_dispatch is null or v_other is null or v_wh is null then
    raise exception 'Fixtures missing: dispatch %, other rep %, warehouse %', v_dispatch, v_other, v_wh;
  end if;
  select count(distinct order_line_id), coalesce(sum(qty), 0) into v_lines, v_units
    from public.dispatch_lines where dispatch_id = v_dispatch;

  ---------------------------------------------------------------- C1 the gap
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(distinct order_line_id) into v_n from public.dispatch_lines where dispatch_id = v_dispatch;
  select count(*) into v_named
    from public.order_lines ol
   where ol.id in (select dl.order_line_id from public.dispatch_lines dl where dl.dispatch_id = v_dispatch);
  if v_n <> v_lines or v_named <> 0 then
    v_fail := v_fail || format('C1 control: the rep read %s of %s order lines'' dispatch lines and %s order lines (expected all, and 0)',
                               v_n, v_lines, v_named) || E'\n';
  end if;

  ---------------------------------------------------------------- C2 the rep reads it
  select count(*), count(product_name), coalesce(sum(qty), 0)::int into v_n, v_named, v_sum
    from public.delivery_contents(v_dispatch);
  if v_n <> v_lines or v_named <> v_lines or v_sum <> v_units then
    v_fail := v_fail || format('C2 the rep got %s rows, %s named, %s units (expected %s, %s, %s)',
                               v_n, v_named, v_sum, v_lines, v_lines, v_units) || E'\n';
  end if;
  if exists (select 1 from public.delivery_contents(v_dispatch) where qty_ordered is null or qty > qty_ordered) then
    v_fail := v_fail || 'C2 a row has no ordered quantity, or ships more than was ordered' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- C3 no price
  select string_agg(n, ', ') into v_txt
    from pg_proc p, unnest(p.proargnames) n
   where p.oid = 'public.delivery_contents(uuid)'::regprocedure
     and (n ilike '%price%' or n ilike '%cost%' or n ilike '%discount%' or n ilike '%vat%');
  if v_txt is not null then
    v_fail := v_fail || 'C3 delivery_contents returns ' || v_txt || E'\n';
  end if;

  ---------------------------------------------------------------- C4 another rep
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.dispatches where id = v_dispatch and assigned_rep_id = v_other) then
    v_fail := v_fail || 'C4 fixture: the other rep is assigned the dispatch' || E'\n';
  end if;
  begin
    perform * from public.delivery_contents(v_dispatch);
    v_fail := v_fail || 'C4 another rep read the delivery' || E'\n';
  exception when insufficient_privilege then
    if sqlerrm <> c_refusal then
      v_fail := v_fail || 'C4 refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  reset role;

  ---------------------------------------------------------------- C5 another company
  if v_foreign is null then
    v_info := v_info || 'C5 skipped: nobody active in another open company' || E'\n';
  else
    -- Give the other company everything that would let it in, if the company
    -- check were missing: the modules, and the warehouse permission. Only the
    -- company check is then left to refuse.
    insert into public.company_modules (org_id, module_code, enabled)
    values (v_foreign_org, 'distribution', true)
    on conflict (org_id, module_code) do update set enabled = true;
    -- Deliveries owns delivery_contents since 20261029224700; it needs
    -- Distribution, and Stock control (`warehouse`) needs it.
    insert into public.company_modules (org_id, module_code, enabled)
    values (v_foreign_org, 'deliveries', true)
    on conflict (org_id, module_code) do update set enabled = true;
    insert into public.company_modules (org_id, module_code, enabled)
    values (v_foreign_org, 'warehouse', true)
    on conflict (org_id, module_code) do update set enabled = true;
    insert into public.profile_permissions (profile_id, permission_code)
    values (v_foreign, 'warehouse')
    on conflict do nothing;

    perform set_config('request.jwt.claims', json_build_object('sub', v_foreign, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if not public.module_enabled('deliveries') or not public.has_permission('warehouse') then
      v_fail := v_fail || 'C5 fixture: the other company''s user lacks the module or the permission' || E'\n';
    end if;
    begin
      perform * from public.delivery_contents(v_dispatch);
      v_fail := v_fail || 'C5 somebody in another company read the delivery' || E'\n';
    exception when insufficient_privilege then
      if sqlerrm <> c_refusal then
        v_fail := v_fail || 'C5 refused by the wrong guard: ' || sqlerrm || E'\n';
      end if;
    end;
    reset role;
  end if;

  ---------------------------------------------------------------- C6 the warehouse
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.has_permission('warehouse') then
    v_fail := v_fail || 'C6 fixture: the warehouse profile lacks the warehouse permission' || E'\n';
  end if;
  select count(*) into v_n from public.delivery_contents(v_dispatch);
  if v_n <> v_lines then
    v_fail := v_fail || format('C6 the warehouse got %s of %s rows', v_n, v_lines) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- C7 null, anon, PUBLIC
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.delivery_contents(null);
    v_fail := v_fail || 'C7 a null dispatch was answered' || E'\n';
  exception when insufficient_privilege then
    if sqlerrm <> c_refusal then
      v_fail := v_fail || 'C7 null refused by the wrong guard: ' || sqlerrm || E'\n';
    end if;
  end;
  reset role;
  if has_function_privilege('anon', 'public.delivery_contents(uuid)', 'EXECUTE') then
    v_fail := v_fail || 'C7 anon can call delivery_contents' || E'\n';
  end if;
  select exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.delivery_contents(uuid)'::regprocedure
       and a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_ok;
  if v_ok then
    v_fail := v_fail || 'C7 PUBLIC can call delivery_contents' || E'\n';
  end if;

  ---------------------------------------------------------------- C8 agrees with the policy
  -- Every assigned dispatch, as its rep and as one other rep: what RLS shows
  -- on `dispatches` and what the function answers must be the same decision.
  for r in
    select d.id, d.assigned_rep_id,
           (select p.id from public.profiles p
             where p.org_id = c_gf and p.role = 'rep' and p.is_active and p.id <> d.assigned_rep_id
             order by p.full_name, p.id limit 1) as stranger,
           (select count(distinct dl.order_line_id) from public.dispatch_lines dl where dl.dispatch_id = d.id) as lines
      from public.dispatches d
      join public.profiles p on p.id = d.assigned_rep_id and p.is_active
     where d.org_id = c_gf
  loop
    v_checked := v_checked + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', r.assigned_rep_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := exists (select 1 from public.dispatches where id = r.id);
    begin
      select count(*) into v_n from public.delivery_contents(r.id);
      if not v_ok or v_n <> r.lines then
        v_fail := v_fail || format('C8 %s: its rep sees the dispatch %s, the function gave %s of %s rows', r.id, v_ok, v_n, r.lines) || E'\n';
      end if;
    exception when insufficient_privilege then
      v_fail := v_fail || format('C8 %s: its rep sees the dispatch %s, the function refused: %s', r.id, v_ok, sqlerrm) || E'\n';
    end;
    reset role;

    continue when r.stranger is null;
    perform set_config('request.jwt.claims', json_build_object('sub', r.stranger, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := exists (select 1 from public.dispatches where id = r.id);
    begin
      perform * from public.delivery_contents(r.id);
      if not v_ok then
        v_fail := v_fail || format('C8 %s: another rep cannot see the dispatch but read its contents', r.id) || E'\n';
      end if;
    exception when insufficient_privilege then
      if v_ok or sqlerrm <> c_refusal then
        v_fail := v_fail || format('C8 %s: another rep sees the dispatch %s, refused: %s', r.id, v_ok, sqlerrm) || E'\n';
      end if;
    end;
    reset role;
  end loop;
  if v_checked = 0 then
    v_fail := v_fail || 'C8 fixture: no assigned dispatches to check' || E'\n';
  end if;
  v_info := v_info || format('C8 checked %s assigned dispatches', v_checked) || E'\n';

  if v_fail <> '' then
    raise exception E'DELIVERY CONTENTS FAILURES (rolled back):\n%\n%', v_fail, v_info;
  end if;
  raise exception E'ALL DELIVERY CONTENTS CHECKS PASSED (rolled back)\n%', v_info;
end;
$$;
