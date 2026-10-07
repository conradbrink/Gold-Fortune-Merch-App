-- Tenant isolation suite: one company must never read or write another's data.
--
-- `security_regression.sql` was written while there was only ever one company,
-- so its tenancy checks are about one rep against another inside it. This file
-- is the multi-company half. It stands up **Company B** inside the transaction,
-- signs in as B's manager and as B's rep, and attacks **Company A** (the
-- existing company) from every direction it can find:
--
--   T1  every table with an `org_id`, **found from the catalogue** rather than a
--       hand-made list, so a table added next month is attacked without anyone
--       remembering to add it: read, insert (a copy of a real A row), update,
--       delete.
--   T2  every table without an `org_id`. These are scoped through a parent, so
--       each needs its own predicate — and the suite refuses to run if a table
--       appears that is not in the list, rather than skipping it in silence.
--   T3  storage: no object outside B's own folder is visible, and B cannot
--       write into A's folder.
--   T4  the security-definer helpers that take a company or employee id.
--   T5  every stable function `authenticated` may call, invoked with A's ids
--       wherever the parameter name says what it wants. The result is searched
--       for anything that identifies A: its id, its people's ids and names, its
--       stores' ids and names.
--
-- Controls: B's manager can create and read B's own store, and sees B's own
-- organisation. A lock that also breaks the legitimate case is one the next
-- person removes in a hurry (see `security_regression.sql`).
--
-- HOW COMPANY B IS STAFFED. `profiles.id` references `auth.users`, and this
-- suite has no business writing to the auth schema. So B's two users are two of
-- A's existing logins **moved** into B for the length of the transaction — the
-- two with the least field data of their own (no visits, pings or routes), so
-- that a policy legitimately showing a user their own rows is not mistaken for
-- a leak. Their personal rows (dashboard layout, notifications) are removed
-- first for the same reason.
--
-- HOW TO RUN
--
--   Supabase MCP:  paste this whole file into execute_sql
--   psql:          psql "$DATABASE_URL" -f supabase/tests/tenant_isolation.sql
--
-- One DO block, one transaction, and it always ends in `raise exception`, so
-- nothing it does survives — it is safe against production. The final message
-- is the report: `TENANT ISOLATION FAILURES` or `ALL TENANT ISOLATION CHECKS
-- PASSED`, followed by what could not be proven and why. Anything else (a
-- fixture error) means the suite is broken, not the database.

do $$
declare
  a_org uuid; b_org uuid;
  b_mgr uuid; b_rep uuid;
  a_rep uuid; a_store uuid; a_group uuid; a_file uuid; a_emp uuid;

  -- Everything that identifies Company A, for T5's search.
  a_tokens text[];
  a_ids jsonb := '{}'::jsonb;   -- parameter-name hint -> an A id

  -- Parent ids for T2, captured while we can still see them.
  a_templates uuid[]; a_subs uuid[]; a_promos uuid[]; a_files uuid[];
  a_reviews uuid[]; a_roles uuid[]; a_profiles uuid[];

  t record; f record;
  v_n int; v_total int; v_row jsonb; v_txt text; v_cols text; v_args text;
  v_who text; v_tok text;

  v_fail text := '';
  v_info text := '';
  v_unproven text := '';
  v_tables_checked int := 0; v_funcs_checked int := 0;

  -- T2's list. Any public table without `org_id` that is not here stops the run.
  -- Above companies by design. `platform_*` have no API access at all; T2
  -- checks that B's users cannot read them.
  c_global constant text[] := array['organizations','app_permissions','app_releases',
                                     'service_flags','rate_limits',
                                     'platform_admins','platform_audit_log'];
  c_children constant text[] := array['form_fields','form_responses','promotion_products',
                                       'promotion_stores','file_groups','file_reps',
                                       'hr_review_ratings','job_role_permissions',
                                       'profile_permissions'];
begin
  -------------------------------------------------------------------- fixtures
  select id into a_org from public.organizations order by created_at limit 1;
  if a_org is null then raise exception 'Fixtures missing: no organisation.'; end if;

  -- The two A logins with no field data of their own become Company B.
  select array_agg(id order by full_name) into a_profiles
    from public.profiles where org_id = a_org;
  select p.id into b_mgr from public.profiles p
   where p.org_id = a_org and p.role <> 'manager'
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.routes r where r.rep_id = p.id)
   order by p.full_name limit 1;
  select p.id into b_rep from public.profiles p
   where p.org_id = a_org and p.role <> 'manager' and p.id <> b_mgr
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.routes r where r.rep_id = p.id)
   order by p.full_name limit 1;
  -- Never one of the two logins about to become Company B: a_rep must stay
  -- A's, or T5 would pass B's own id to every rep parameter and test B
  -- against itself (CodeRabbit on #69).
  select id into a_rep from public.profiles
   where org_id = a_org and role = 'rep' and id not in (b_mgr, b_rep)
   order by full_name limit 1;
  select id into a_store from public.stores where org_id = a_org order by name limit 1;
  select id into a_group from public.store_groups where org_id = a_org order by name limit 1;
  select id into a_file  from public.files where org_id = a_org order by created_at limit 1;
  select id into a_emp   from public.hr_employees
   where org_id = a_org and (profile_id is null or profile_id not in (b_mgr, b_rep))
   order by created_at limit 1;

  if b_mgr is null or b_rep is null or a_rep is null or a_store is null
     or a_group is null or a_file is null or a_emp is null then
    raise exception 'Fixtures missing: b_mgr=% b_rep=% a_rep=% a_store=% a_group=% a_file=% a_emp=%',
      b_mgr, b_rep, a_rep, a_store, a_group, a_file, a_emp;
  end if;

  -- `file_groups` and `file_reps` are empty in production, so a leak there
  -- would read as "zero rows" — the classic false pass. Give A a row in each.
  insert into public.file_groups (file_id, store_group_id) values (a_file, a_group)
    on conflict do nothing;
  insert into public.file_reps (file_id, rep_id) values (a_file, a_rep)
    on conflict do nothing;

  insert into public.organizations (name) values ('Isolation Test Company B')
    returning id into b_org;

  delete from public.dashboard_layouts where user_id in (b_mgr, b_rep);
  delete from public.hr_notifications where recipient_id in (b_mgr, b_rep);
  update public.profiles set org_id = b_org, role = 'manager', job_role_id = null,
                             is_active = true where id = b_mgr;
  update public.profiles set org_id = b_org, role = 'rep', job_role_id = null,
                             is_active = true where id = b_rep;
  delete from public.profile_permissions where profile_id in (b_mgr, b_rep);
  insert into public.profile_permissions (profile_id, permission_code)
    select b_mgr, code from public.app_permissions;

  -- Parent ids for T2.
  select array_agg(id) into a_templates from public.form_templates where org_id = a_org;
  select array_agg(id) into a_subs      from public.form_submissions where org_id = a_org;
  select array_agg(id) into a_promos    from public.promotions where org_id = a_org;
  select array_agg(id) into a_files     from public.files where org_id = a_org;
  select array_agg(id) into a_reviews   from public.hr_reviews where org_id = a_org;
  select array_agg(id) into a_roles     from public.job_roles where org_id = a_org;
  a_profiles := array(select unnest(a_profiles) except select unnest(array[b_mgr, b_rep]));

  -- T5's tokens: ids are unambiguous; names are what a report would print.
  select array_agg(x) into a_tokens from (
    select a_org::text as x
    union all select id::text from public.profiles where org_id = a_org
    union all select full_name from public.profiles
               where org_id = a_org and length(coalesce(full_name, '')) >= 5
    union all select id::text from public.stores where org_id = a_org
    union all select name from public.stores where org_id = a_org and length(name) >= 6
    union all select id::text from public.form_templates where org_id = a_org
  ) s;

  -- Parameter-name hint -> an A id, for T5. Longest hints first is not needed:
  -- each parameter is matched against these in order and the first wins.
  a_ids := jsonb_build_object(
    'rep',       a_rep,
    'store',     a_store,
    'template',  (select id from public.form_templates where org_id = a_org limit 1),
    'promotion', (select id from public.promotions where org_id = a_org limit 1),
    'product',   (select id from public.products where org_id = a_org limit 1),
    'field',     (select ff.id from public.form_fields ff
                    join public.form_templates ft on ft.id = ff.form_template_id
                   where ft.org_id = a_org limit 1),
    'employee',  a_emp,
    'order',     (select id from public.orders where org_id = a_org limit 1),
    'territory', (select id from public.territories where org_id = a_org limit 1),
    'file',      a_file,
    'visit',     (select id from public.visits where org_id = a_org limit 1),
    'org',       a_org
  );

  -- T2 refuses to run with an unlisted table.
  select string_agg(c.relname, ', ') into v_txt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from information_schema.columns i
                      where i.table_schema = 'public' and i.table_name = c.relname
                        and i.column_name = 'org_id')
     and c.relname <> all (c_global || c_children);
  if v_txt is not null then
    raise exception 'Suite out of date: tables without org_id that T2 does not cover: %. '
                    'Add each to c_children with a predicate, or to c_global.', v_txt;
  end if;

  ---------------------------------------------------- T1 tables with org_id
  for t in
    select c.relname as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from information_schema.columns i
                    where i.table_schema = 'public' and i.table_name = c.relname
                      and i.column_name = 'org_id')
     order by c.relname
  loop
    v_tables_checked := v_tables_checked + 1;

    -- As the owner: does A have rows here, and grab one to copy.
    execute format('select count(*), (select to_jsonb(x) from public.%I x where org_id = $1 limit 1)
                      from public.%I where org_id = $1', t.tbl, t.tbl)
      into v_total, v_row using a_org;
    if v_total = 0 then
      v_unproven := v_unproven || format('  %s: Company A has no rows, so reads prove nothing%s', t.tbl, E'\n');
    end if;

    -- Reads, as each of B's users.
    foreach v_who in array array['manager','rep'] loop
      perform set_config('request.jwt.claims', json_build_object(
        'sub', case v_who when 'manager' then b_mgr else b_rep end,
        'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        execute format('select count(*) from public.%I where org_id is distinct from $1', t.tbl)
          into v_n using b_org;
        if v_n > 0 then
          v_fail := v_fail || format('T1 read   %s: B''s %s sees %s row(s) of another company%s',
                                     t.tbl, v_who, v_n, E'\n');
        end if;
      exception when insufficient_privilege then null;   -- no grant at all: fine
      end;
      reset role;
    end loop;

    -- Writes, as B's manager (the most privileged user B has).
    perform set_config('request.jwt.claims', json_build_object(
      'sub', b_mgr, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin
      execute format('update public.%I set org_id = org_id where org_id = $1', t.tbl) using a_org;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_fail := v_fail || format('T1 update %s: B changed %s of A''s rows%s', t.tbl, v_n, E'\n');
      end if;
    exception
      when insufficient_privilege then null;   -- no grant at all: the right refusal
      when others then
        -- RLS filters A's rows out silently, so an error here means a row got
        -- past the filter and something else stopped it: the tenancy guard is
        -- not what held, and the report must say so (CodeRabbit on #69/#74).
        v_unproven := v_unproven || format('  T1 update %s: refused by %s, not RLS: %s%s',
                                           t.tbl, sqlstate, left(sqlerrm, 80), E'\n');
    end;

    begin
      execute format('delete from public.%I where org_id = $1', t.tbl) using a_org;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_fail := v_fail || format('T1 delete %s: B deleted %s of A''s rows%s', t.tbl, v_n, E'\n');
      end if;
    exception
      when insufficient_privilege then null;   -- no grant at all: the right refusal
      when others then
        -- RLS filters A's rows out silently, so an error here means a row got
        -- past the filter and something else stopped it: the tenancy guard is
        -- not what held, and the report must say so (CodeRabbit on #69/#74).
        v_unproven := v_unproven || format('  T1 delete %s: refused by %s, not RLS: %s%s',
                                           t.tbl, sqlstate, left(sqlerrm, 80), E'\n');
    end;

    -- Insert a copy of a real A row, still marked as A's. Fresh ids so a
    -- unique key is not what refuses it.
    if v_row is not null then
      if v_row ? 'id' and jsonb_typeof(v_row->'id') = 'string' then
        v_row := jsonb_set(v_row, '{id}', to_jsonb(gen_random_uuid()::text));
      end if;
      if v_row ? 'client_generated_id' then
        v_row := jsonb_set(v_row, '{client_generated_id}', to_jsonb(gen_random_uuid()::text));
      end if;
      -- Name the columns, leaving out generated and identity-always ones:
      -- supplying those is refused with 428C9 before RLS is ever asked, which
      -- would count as a pass for the wrong reason.
      select string_agg(quote_ident(c.column_name), ', ') into v_cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t.tbl
         and c.is_generated = 'NEVER'
         and coalesce(c.identity_generation, '') <> 'ALWAYS';
      if v_cols is null then
        v_info := v_info || format('  %s: every column is generated; no insert to attempt%s', t.tbl, E'\n');
      else
      begin
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                       t.tbl, v_cols, v_cols, t.tbl) using v_row;
        v_fail := v_fail || format('T1 insert %s: B inserted a row into Company A%s', t.tbl, E'\n');
      exception
        when insufficient_privilege then null;  -- RLS or no grant: the right refusal
        when others then
          v_info := v_info || format('  %s insert refused by %s: %s%s',
                                     t.tbl, sqlstate, left(sqlerrm, 90), E'\n');
      end;
      end if;
    end if;

    reset role;
  end loop;

  ------------------------------------------------- T2 tables without org_id
  foreach v_who in array array['manager','rep'] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', case v_who when 'manager' then b_mgr else b_rep end,
      'role', 'authenticated')::text, true);
    set local role authenticated;

    for t in select * from (values
        ('organizations',        'id <> $1',                           null::uuid[]),
        ('form_fields',          'form_template_id = any($2)',          a_templates),
        ('form_responses',       'form_submission_id = any($2)',        a_subs),
        ('promotion_products',   'promotion_id = any($2)',              a_promos),
        ('promotion_stores',     'promotion_id = any($2)',              a_promos),
        ('file_groups',          'file_id = any($2)',                   a_files),
        ('file_reps',            'file_id = any($2)',                   a_files),
        ('hr_review_ratings',    'review_id = any($2)',                 a_reviews),
        ('job_role_permissions', 'job_role_id = any($2)',               a_roles),
        ('profile_permissions',  'profile_id = any($2)',                a_profiles)
      ) as x(tbl, pred, ids)
    loop
      begin
        execute format('select count(*) from public.%I where %s', t.tbl, t.pred)
          into v_n using b_org, t.ids;
        if v_n > 0 then
          v_fail := v_fail || format('T2 read   %s: B''s %s sees %s of A''s row(s)%s',
                                     t.tbl, v_who, v_n, E'\n');
        end if;
      exception when insufficient_privilege then null;
      end;
    end loop;

    -- The operator tables must not be readable by any company's users.
    -- `to_regclass` so the suite still runs before they exist.
    foreach v_txt in array array['platform_admins','platform_audit_log'] loop
      if to_regclass('public.' || v_txt) is not null then
        begin
          execute format('select count(*) from public.%I', v_txt) into v_n;
          v_fail := v_fail || format('T2 read   %s: B''s %s can query the operator table%s',
                                     v_txt, v_who, E'\n');
        exception when insufficient_privilege then null;
        end;
      end if;
    end loop;
    if to_regprocedure('public.is_platform_admin()') is not null
       and public.is_platform_admin() then
      v_fail := v_fail || format('T2 B''s %s is a platform operator%s', v_who, E'\n');
    end if;

    reset role;
  end loop;

  -- Writes through the two file link tables: B linking itself to A's file.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', b_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.file_reps (file_id, rep_id) values (a_file, b_rep);
    v_fail := v_fail || 'T2 insert file_reps: B linked a rep to A''s file' || E'\n';
  exception when others then null;
  end;
  begin
    insert into public.file_groups (file_id, store_group_id) values (a_file, a_group);
    v_fail := v_fail || 'T2 insert file_groups: B linked A''s file to a group' || E'\n';
  exception when others then null;
  end;
  reset role;

  ---------------------------------------------------------------- T3 storage
  foreach v_who in array array['manager','rep'] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', case v_who when 'manager' then b_mgr else b_rep end,
      'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from storage.objects
     where (storage.foldername(name))[1] is distinct from b_org::text;
    if v_n > 0 then
      v_fail := v_fail || format('T3 storage: B''s %s sees %s object(s) outside B''s folder%s',
                                 v_who, v_n, E'\n');
    end if;
    reset role;
  end loop;

  select count(*) into v_n from storage.objects where (storage.foldername(name))[1] = a_org::text;
  if v_n = 0 then
    v_unproven := v_unproven || '  storage: Company A has no objects, so reads prove nothing' || E'\n';
  end if;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', b_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach v_txt in array array['visit-photos','files','fulfilment-docs','hr-documents'] loop
    begin
      insert into storage.objects (bucket_id, name, owner)
      values (v_txt, a_org::text || '/' || a_emp::text || '/isolation-test.jpg', b_mgr);
      v_fail := v_fail || format('T3 storage: B wrote into A''s folder in %s%s', v_txt, E'\n');
    exception when others then null;
    end;
  end loop;
  reset role;

  ---------------------------------------------------- T4 definer helpers
  perform set_config('request.jwt.claims', json_build_object(
    'sub', b_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if public.hr_can_view_employee(a_emp) then
    v_fail := v_fail || 'T4 hr_can_view_employee: true for another company''s employee' || E'\n';
  end if;
  if public.hr_manages_employee(a_emp) then
    v_fail := v_fail || 'T4 hr_manages_employee: true for another company''s employee' || E'\n';
  end if;
  if public.org_timezone(a_org) is not null then
    v_fail := v_fail || 'T4 org_timezone: answers for another company' || E'\n';
  end if;
  if public.hr_working_days(a_org, current_date - 30, current_date) is not null then
    v_fail := v_fail || 'T4 hr_working_days: answers for another company' || E'\n';
  end if;
  if public.hr_leave_year_of(a_org, current_date) is not null then
    v_fail := v_fail || 'T4 hr_leave_year_of: answers for another company' || E'\n';
  end if;
  if public.hr_current_leave_year(a_org) is not null then
    v_fail := v_fail || 'T4 hr_current_leave_year: answers for another company' || E'\n';
  end if;

  -- Controls: the same helpers still answer for B's own company.
  if public.org_timezone(b_org) is null then
    v_fail := v_fail || 'T4 control: org_timezone refuses the caller''s own company' || E'\n';
  end if;
  if public.hr_working_days(b_org, current_date - 30, current_date) is null then
    v_fail := v_fail || 'T4 control: hr_working_days refuses the caller''s own company' || E'\n';
  end if;
  reset role;

  ------------------------------------------------ T5 every callable function
  perform set_config('request.jwt.claims', json_build_object(
    'sub', b_mgr, 'role', 'authenticated')::text, true);

  for f in
    select p.oid, p.proname, p.proargnames, p.proargtypes::oid[] as types, p.pronargs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.provolatile in ('s', 'i')
       and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by p.proname
  loop
    v_args := '';
    for i in 1 .. f.pronargs loop
      declare
        nm text := lower(coalesce(f.proargnames[i], ''));
        ty text := format_type(f.types[i], null);
        hint text;
        val text := 'null';
      begin
        if ty in ('timestamp with time zone', 'date') then
          val := case when nm ~ 'to|end|until' then format('%L::%s', now() + interval '1 day', ty)
                      else format('%L::%s', now() - interval '2 years', ty) end;
        elsif ty in ('uuid', 'uuid[]') then
          select h into hint from jsonb_object_keys(a_ids) h
           where nm like '%' || h || '%' order by length(h) desc limit 1;
          if hint is not null then
            val := case ty when 'uuid' then format('%L::uuid', a_ids->>hint)
                           else format('array[%L]::uuid[]', a_ids->>hint) end;
          else
            val := format('null::%s', ty);
          end if;
        elsif ty in ('integer', 'smallint', 'bigint') then
          val := format('10::%s', ty);
        elsif ty in ('numeric', 'double precision', 'real') then
          val := format('0::%s', ty);
        elsif ty = 'boolean' then
          val := 'false';
        else
          val := format('null::%s', ty);
        end if;
        v_args := v_args || case when i > 1 then ', ' else '' end || val;
      end;
    end loop;

    set local role authenticated;
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x))::text, '''') from public.%I(%s) x',
                     f.proname, v_args)
        into v_txt;
      foreach v_tok in array a_tokens loop
        if position(v_tok in v_txt) > 0 then
          v_fail := v_fail || format('T5 %s(%s): result contains Company A data (%s)%s',
                                     f.proname, v_args, left(v_tok, 40), E'\n');
          exit;
        end if;
      end loop;
      -- Counted only once its result has been searched (CodeRabbit on #69).
      v_funcs_checked := v_funcs_checked + 1;
    exception when others then
      if sqlstate = '42501' then
        v_funcs_checked := v_funcs_checked + 1;   -- refused B outright: the guard working
      else
        -- The guessed arguments did not fit: not a leak, but not tested either.
        v_unproven := v_unproven || format('  T5 %s: not probed (%s: %s)%s',
                                           f.proname, sqlstate, left(sqlerrm, 80), E'\n');
      end if;
    end;
    reset role;
  end loop;

  -- T5 calls stable and immutable functions only: a volatile one may write,
  -- and guessed arguments are no basis for a write. Name what was skipped so
  -- the gap is visible rather than counted as coverage. The volatile RPCs
  -- (order_confirm and the like) check the caller's company themselves; the
  -- module suite and security_regression.sql exercise the ones that matter.
  select string_agg(p.proname, ' ' order by p.proname) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 'v'
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_txt is not null then
    v_unproven := v_unproven || '  T5 did not call these volatile functions: ' || v_txt || E'\n';
  end if;

  ---------------------------------------------------------------- controls
  perform set_config('request.jwt.claims', json_build_object(
    'sub', b_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if public.current_org_id() is distinct from b_org then
    raise exception 'Fixtures broken: B''s manager resolves to org %, not %.',
      public.current_org_id(), b_org;
  end if;

  select count(*) into v_n from public.organizations where id = b_org;
  if v_n <> 1 then
    v_fail := v_fail || 'control: B''s manager cannot see B''s own organisation' || E'\n';
  end if;

  begin
    insert into public.stores (org_id, name) values (b_org, 'Isolation Test Store B');
    select count(*) into v_n from public.stores where org_id = b_org;
    if v_n <> 1 then
      v_fail := v_fail || 'control: B''s manager cannot read back B''s own store' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || 'control: B''s manager cannot create a store in B: ' || sqlerrm || E'\n';
  end;

  select count(*) into v_n from public.job_roles where org_id = b_org;
  if v_n = 0 then
    v_fail := v_fail || 'control: B was not provisioned (no job roles visible)' || E'\n';
  end if;

  -- `provision_organization` failed outright from 28 August to 7 October 2026
  -- (42P10 on the review categories). Pin that it now seeds them.
  select count(*) into v_n from public.hr_review_categories where org_id = b_org;
  if v_n = 0 then
    v_fail := v_fail || 'control: B was provisioned without review categories' || E'\n';
  end if;
  reset role;

  ------------------------------------------------------------------ report
  v_txt := format('%s tables with org_id, %s functions attacked.%s', v_tables_checked,
                  v_funcs_checked, E'\n');
  if v_unproven <> '' then
    v_txt := v_txt || E'\nNot proven (no data to leak):\n' || v_unproven;
  end if;
  if v_info <> '' then
    v_txt := v_txt || E'\nInserts refused by something other than RLS (not a leak, but '
                      'the refusal is not the tenancy guard):\n' || v_info;
  end if;

  if v_fail <> '' then
    raise exception E'TENANT ISOLATION FAILURES (rolled back):\n%\n%', v_fail, v_txt;
  end if;
  raise exception E'ALL TENANT ISOLATION CHECKS PASSED (rolled back)\n%', v_txt;
end;
$$;
