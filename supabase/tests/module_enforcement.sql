-- Module enforcement suite: a company without a module cannot reach it, in the
-- database, whatever the web or phone does.
--
--   M1  Coverage. Every public table, every storage bucket and every function
--       `authenticated` may call is assigned to a module in
--       `module_assignments` (core included). A table added by any branch
--       without an assignment fails here. That is the point: a new table must
--       be classified, not silently left ungated.
--   M2  Wiring. Every non-core table carries a restrictive `module_gate`
--       policy; every non-core function's body calls require_module for its
--       own module.
--   M3  Behaviour, on real data. For each gated module, in turn, the module is
--       switched OFF for the existing company (Gold Fortune) inside this
--       transaction. Then, as that company's administrator:
--         * every table of the module reads 0 rows (where it had rows),
--         * a copy of an existing row cannot be inserted,
--         * every function of the module raises "… is not enabled",
--         * the module's storage bucket shows nothing.
--       Then the module is switched back ON and the reads return again (the
--       control: the gate, not something else, did the hiding).
--   M4  Cross-module control. Distribution ON and warehouse OFF: a rep can
--       still take an order (no warehouse trigger on the order path blocks it).
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives. The last line is the report.

do $$
declare
  v_org uuid; v_admin uuid; v_rep uuid; v_store uuid;
  r record; t record; f record;
  v_n int; v_before int; v_row jsonb; v_cols text; v_txt text; v_args text;
  v_fail text := ''; v_info text := '';
  v_modules text[] := array['warehouse','hr','checklists_forms','reports',
                             'recurring_jobs','distribution','invoicing'];  -- warehouse before distribution
  v_mod text;
  v_checked_tables int := 0; v_checked_funcs int := 0;
begin
  select p.id, p.org_id into v_admin, v_org
    from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
   where jr.code = 'administrator' and p.is_active
     -- A company with field data to exercise (the oldest such: Gold Fortune).
     -- Trial companies have an administrator and nothing else yet.
     and exists (select 1 from public.profiles pr where pr.org_id = p.org_id and pr.role = 'rep' and pr.is_active)
     and exists (select 1 from public.stores st where st.org_id = p.org_id and st.active)
   order by (select o.created_at from public.organizations o where o.id = p.org_id), p.id
   limit 1;
  select id into v_rep from public.profiles
   where org_id = v_org and role = 'rep' and is_active order by full_name limit 1;
  select id into v_store from public.stores where org_id = v_org and active limit 1;
  if v_admin is null or v_rep is null or v_store is null then
    raise exception 'Fixtures missing: administrator %, rep %, store %', v_admin, v_rep, v_store;
  end if;

  ------------------------------------------------------------- M1 coverage
  select string_agg(c.relname, ', ') into v_txt
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and not exists (select 1 from public.module_assignments a
                      where a.kind = 'table' and a.name = c.relname);
  if v_txt is not null then
    v_fail := v_fail || 'M1 tables with no module: ' || v_txt || E'\n';
  end if;

  select string_agg(distinct p.proname, ', ') into v_txt
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not exists (select 1 from public.module_assignments a
                      where a.kind = 'function' and a.name = p.proname);
  if v_txt is not null then
    v_fail := v_fail || 'M1 callable functions with no module: ' || v_txt || E'\n';
  end if;

  select string_agg(b.id, ', ') into v_txt
    from storage.buckets b
   where not exists (select 1 from public.module_assignments a
                      where a.kind = 'bucket' and a.name = b.id);
  if v_txt is not null then
    v_fail := v_fail || 'M1 buckets with no module: ' || v_txt || E'\n';
  end if;

  --------------------------------------------------------------- M2 wiring
  select string_agg(a.name, ', ') into v_txt
    from public.module_assignments a
   where a.kind = 'table' and a.module_code <> 'core'
     and to_regclass('public.' || quote_ident(a.name)) is not null
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = a.name
                        and p.policyname = 'module_gate' and p.permissive = 'RESTRICTIVE');
  if v_txt is not null then
    v_fail := v_fail || 'M2 gated tables without a module_gate policy: ' || v_txt || E'\n';
  end if;

  select string_agg(p.proname, ', ') into v_txt
    from public.module_assignments a
    join pg_proc p on p.proname = a.name and p.pronamespace = 'public'::regnamespace
   where a.kind = 'function' and a.module_code <> 'core'
     and p.prosrc not like '%require_module(''' || a.module_code || ''')%';
  if v_txt is not null then
    v_fail := v_fail || 'M2 gated functions without their require_module: ' || v_txt || E'\n';
  end if;

  ----------------------------------------------------------- M3 behaviour
  foreach v_mod in array v_modules loop
    -- Anything that depends on this module goes off first, or the dependency
    -- guard (rightly) refuses: warehouse before distribution.
    update public.company_modules cm set enabled = false
      from public.module_dependencies d
     where cm.org_id = v_org and cm.module_code = d.module_code
       and d.requires_code = v_mod and cm.enabled;

    -- Off, as the operator would (service role path).
    update public.company_modules set enabled = false
     where org_id = v_org and module_code = v_mod;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'Fixtures broken: % is not switched on for the company to begin with', v_mod;
    end if;

    for t in
      select a.name from public.module_assignments a
       where a.kind = 'table' and a.module_code = v_mod
         and to_regclass('public.' || quote_ident(a.name)) is not null
       order by a.name
    loop
      v_checked_tables := v_checked_tables + 1;
      execute format('select count(*), (select to_jsonb(x) from public.%I x limit 1) from public.%I where true',
                     t.name, t.name)
        into v_before, v_row;   -- as the owner: the truth

      perform set_config('request.jwt.claims', json_build_object(
        'sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;

      begin
        execute format('select count(*) from public.%I', t.name) into v_n;
        if v_n > 0 then
          v_fail := v_fail || format('M3 %s off: %s still readable (%s rows)%s', v_mod, t.name, v_n, E'\n');
        end if;
      exception when insufficient_privilege then null;
      end;

      if v_row is not null then
        if v_row ? 'id' and jsonb_typeof(v_row->'id') = 'string' then
          v_row := jsonb_set(v_row, '{id}', to_jsonb(gen_random_uuid()::text));
        end if;
        if v_row ? 'client_generated_id' then
          v_row := jsonb_set(v_row, '{client_generated_id}', to_jsonb(gen_random_uuid()::text));
        end if;
        select string_agg(quote_ident(c.column_name), ', ') into v_cols
          from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.name
           and c.is_generated = 'NEVER' and coalesce(c.identity_generation, '') <> 'ALWAYS';
        begin
          execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                         t.name, v_cols, v_cols, t.name) using v_row;
          v_fail := v_fail || format('M3 %s off: insert into %s accepted%s', v_mod, t.name, E'\n');
        exception
          when insufficient_privilege then null;
          when others then
            v_info := v_info || format('  %s off, %s insert refused by %s: %s%s',
                                       v_mod, t.name, sqlstate, left(sqlerrm, 70), E'\n');
        end;
      end if;
      reset role;

      -- On again: the same read must see the rows (if the admin could before).
      update public.company_modules set enabled = true
       where org_id = v_org and module_code = v_mod;
      perform set_config('request.jwt.claims', json_build_object(
        'sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        execute format('select count(*) from public.%I', t.name) into v_n;
      exception when insufficient_privilege then v_n := null;
      end;
      reset role;
      if v_before > 0 and coalesce(v_n, 0) = 0 then
        v_info := v_info || format('  %s on: %s unreadable to the administrator even with the module on (%s rows exist) - read proves nothing here%s',
                                   v_mod, t.name, v_before, E'\n');
      end if;
      update public.company_modules set enabled = false
       where org_id = v_org and module_code = v_mod;
    end loop;

    -- Functions: each must refuse with the module message, whatever its
    -- arguments, because the guard is its first statement.
    for f in
      select p.oid, p.proname, p.pronargs, string_to_array(p.proargtypes::text, ' ')::oid[] as types
        from public.module_assignments a
        join pg_proc p on p.proname = a.name and p.pronamespace = 'public'::regnamespace
       where a.kind = 'function' and a.module_code = v_mod
       order by p.proname
    loop
      v_checked_funcs := v_checked_funcs + 1;
      select string_agg(format('null::%s', format_type(f.types[i], null)), ', ')
        into v_args from generate_series(1, f.pronargs) i;
      perform set_config('request.jwt.claims', json_build_object(
        'sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        execute format('select public.%I(%s)', f.proname, coalesce(v_args, ''));
        v_fail := v_fail || format('M3 %s off: %s ran%s', v_mod, f.proname, E'\n');
      exception when others then
        if sqlstate <> '42501' or sqlerrm not like '%not enabled for your company''s plan' then
          v_fail := v_fail || format('M3 %s off: %s refused for the wrong reason: %s %s%s',
                                     v_mod, f.proname, sqlstate, left(sqlerrm, 80), E'\n');
        end if;
      end;
      reset role;
    end loop;

    -- Storage.
    for r in select name from public.module_assignments where kind = 'bucket' and module_code = v_mod loop
      perform set_config('request.jwt.claims', json_build_object(
        'sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_n from storage.objects where bucket_id = r.name;
      if v_n > 0 then
        v_fail := v_fail || format('M3 %s off: %s objects still visible in %s%s', v_mod, v_n, r.name, E'\n');
      end if;
      reset role;
    end loop;

    -- Leave it on for the next module (and for M4).
    update public.company_modules set enabled = true
     where org_id = v_org and module_code = v_mod;
  end loop;

  ------------------------------------------------------- M4 cross-module
  -- Distribution is on again (the loop ends by switching each module back on);
  -- warehouse was switched off on the way to testing distribution.
  update public.company_modules set enabled = false
   where org_id = v_org and module_code = 'warehouse';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, client_generated_id)
    values (v_org, 'ORD-MODULE-TEST', v_store, v_rep, 'rep_app', 'rep_visit', gen_random_uuid());
  exception when others then
    v_fail := v_fail || 'M4 distribution on, warehouse off: a rep could NOT take an order: ' || sqlerrm || E'\n';
  end;
  reset role;

  -- M5. Reports on, Distribution off: the report functions call helpers that
  -- read merchandising data (oos_visit_flags); they must answer, not raise.
  -- Caught in the rehearsal of 8 Oct 2026, when those helpers were gated.
  update public.company_modules set enabled = false
   where org_id = v_org and module_code in ('warehouse', 'distribution');
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform count(*) from public.rep_performance_summary(null, now() - interval '30 days', now(), null);
    perform count(*) from public.compliance_trends(now() - interval '30 days', now(), 'day', null);
  exception when others then
    v_fail := v_fail || 'M5 reports on, distribution off: a report raised: ' || sqlerrm || E'\n';
  end;
  reset role;

  -------------------------------------------------------------- report
  v_txt := format('%s gated tables and %s gated functions exercised.%s',
                  v_checked_tables, v_checked_funcs, E'\n');
  if v_info <> '' then v_txt := v_txt || E'\nNotes:\n' || v_info; end if;
  if v_fail <> '' then
    raise exception E'MODULE ENFORCEMENT FAILURES (rolled back):\n%\n%', v_fail, v_txt;
  end if;
  raise exception E'ALL MODULE CHECKS PASSED (rolled back)\n%', v_txt;
end;
$$;
