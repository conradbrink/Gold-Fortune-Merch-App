-- The record of changes the AI Manager makes: assistant_actions (25 Oct 2026).
--
--   A1  A manager starts a record: it carries their company and their id
--       (from the session, not the caller), the action and the input, and
--       is unfinished. Finishing it says done, the words and the target.
--   A2  A record finishes once: finishing it again is refused.
--   A3  Somebody else's record can't be finished, even at the same company.
--   A4  Nobody writes the table directly: insert, update and delete are
--       refused for authenticated.
--   A5  A rep reads no records; a manager reads their own company's.
--   A6  A manager at another company reads none of these and can't finish one.
--   A7  A read-only company can't start one, with the billing gate's words.
--   A8  A bad action name and an input over 256 KB are refused.
--   A9  The 201st start in an hour from one person is refused.
--   A10 Both functions: security definer, a fixed search_path, no execute
--       for anon or PUBLIC.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_mgr uuid; v_mgr2 uuid; v_rep uuid; v_foreign uuid;
  v_id uuid; v_other uuid; v_target uuid := gen_random_uuid();
  v_err text; v_code text; v_n int; r record; v_status text;
begin
  select p.id into v_mgr from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'manager'
   order by p.created_at, p.id limit 1;
  select p.id into v_mgr2 from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'manager' and p.id <> v_mgr
   order by p.created_at, p.id limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
   order by p.created_at, p.id limit 1;
  select p.id into v_foreign from public.profiles p
   where p.org_id <> c_gf and p.is_active and p.role = 'manager'
     and not exists (select 1 from public.company_account ca where ca.org_id = p.org_id and ca.closed_at is not null)
   order by p.created_at, p.id limit 1;
  if v_mgr is null or v_mgr2 is null or v_rep is null or v_foreign is null then
    raise exception 'Fixtures missing: managers % %, rep %, foreign manager %', v_mgr, v_mgr2, v_rep, v_foreign;
  end if;
  -- Writable for the length of the suite, whatever the account is today.
  select status into v_status from public.company_account where org_id = c_gf;
  update public.company_account set status = 'active' where org_id = c_gf and status in ('read_only', 'cancelled');

  ---------------------------------------------------------------- A1 start and finish
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_id := public.assistant_action_start('create_form', '{"name": "Suite form"}'::jsonb);
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.assistant_actions where id = v_id;
  if r.org_id is distinct from c_gf or r.user_id is distinct from v_mgr or r.action <> 'create_form'
     or r.input->>'name' is distinct from 'Suite form' or r.ok is not null or r.finished_at is not null then
    v_fail := v_fail || format('A1 started row is %s', row_to_json(r)) || E'\n';
  end if;
  set local role authenticated;
  perform public.assistant_action_finish(v_id, true, 'Created.', v_target);
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.assistant_actions where id = v_id;
  if r.ok is distinct from true or r.result is distinct from 'Created.' or r.target_id is distinct from v_target
     or r.finished_at is null then
    v_fail := v_fail || format('A1 finished row is %s', row_to_json(r)) || E'\n';
  end if;

  ---------------------------------------------------------------- A2 once
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role authenticated;
    perform public.assistant_action_finish(v_id, false, 'Again.', null);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '42501' then
    v_fail := v_fail || 'A2 a finished record finished again (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A3 someone else's
  set local role authenticated;
  v_other := public.assistant_action_start('change_dashboard', '{}'::jsonb);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr2, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role authenticated;
    perform public.assistant_action_finish(v_other, true, 'Not mine.', null);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '42501' or exists (select 1 from public.assistant_actions where id = v_other and finished_at is not null) then
    v_fail := v_fail || 'A3 another person finished a record (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A4 no direct writes
  for r in select * from (values ('insert'), ('update'), ('delete')) w(op) loop
    v_checks := v_checks + 1;
    v_code := null;
    begin
      set local role authenticated;
      if r.op = 'insert' then
        insert into public.assistant_actions (org_id, user_id, action, input) values (c_gf, v_mgr2, 'create_form', '{}');
      elsif r.op = 'update' then
        update public.assistant_actions set result = 'tampered' where id = v_id;
      else
        delete from public.assistant_actions where id = v_id;
      end if;
      reset role;
    exception when others then
      reset role;
      v_code := sqlstate;
    end;
    if v_code is distinct from '42501' then
      v_fail := v_fail || format('A4 a direct %s was not refused (%s)', r.op, coalesce(v_code, 'no error')) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- A5 who reads
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.assistant_actions where id in (v_id, v_other);
  reset role;
  v_checks := v_checks + 1;
  if v_n <> 0 then
    v_fail := v_fail || 'A5 a rep read ' || v_n || ' records' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.assistant_actions where id in (v_id, v_other);
  reset role;
  v_checks := v_checks + 1;
  if v_n <> 2 then
    v_fail := v_fail || 'A5 a manager read ' || v_n || ' of their company''s 2 records' || E'\n';
  end if;

  ---------------------------------------------------------------- A6 another company
  perform set_config('request.jwt.claims', json_build_object('sub', v_foreign, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.assistant_actions where org_id = c_gf;
  reset role;
  v_checks := v_checks + 1;
  if v_n <> 0 then
    v_fail := v_fail || 'A6 another company read ' || v_n || ' records' || E'\n';
  end if;
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role authenticated;
    perform public.assistant_action_finish(v_other, true, 'Not mine.', null);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '42501' then
    v_fail := v_fail || 'A6 another company finished a record (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A7 read-only
  update public.company_account set status = 'read_only' where org_id = c_gf;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  v_err := null;
  begin
    set local role authenticated;
    perform public.assistant_action_start('create_form', '{}'::jsonb);
    reset role;
  exception when others then
    reset role;
    v_err := sqlerrm;
  end;
  if v_err is distinct from 'Your company''s account is read-only until the plan is paid.' then
    v_fail := v_fail || 'A7 a read-only company started a record (' || coalesce(v_err, 'no error') || ')' || E'\n';
  end if;
  update public.company_account set status = case when v_status in ('read_only', 'cancelled') then 'active' else v_status end
   where org_id = c_gf;

  ---------------------------------------------------------------- A8 bad input
  for r in select * from (values ('Create Form', '{}'), ('create_form', null)) b(a, i) loop
    v_checks := v_checks + 1;
    v_code := null;
    begin
      set local role authenticated;
      perform public.assistant_action_start(r.a,
        coalesce(r.i::jsonb, jsonb_build_object('big', repeat('x', 262145))));
      reset role;
    exception when others then
      reset role;
      v_code := sqlstate;
    end;
    if v_code is distinct from '22023' then
      v_fail := v_fail || format('A8 %s was not refused (%s)', r.a, coalesce(v_code, 'no error')) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- A9 the hourly cap
  insert into public.assistant_actions (org_id, user_id, action, input)
  select c_gf, v_mgr, 'change_dashboard', '{}'::jsonb from generate_series(1, 200);
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role authenticated;
    perform public.assistant_action_start('change_dashboard', '{}'::jsonb);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '54000' then
    v_fail := v_fail || 'A9 a start past 200 an hour was not refused (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A10 the functions
  for r in
    select p.proname, p.prosecdef, p.proconfig,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('assistant_action_start', 'assistant_action_finish')
  loop
    v_checks := v_checks + 1;
    if not r.prosecdef or r.proconfig is null or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%')
       or r.anon_exec or r.public_exec then
      v_fail := v_fail || format('A10 %s: definer %s, config %s, anon %s, public %s', r.proname, r.prosecdef, r.proconfig, r.anon_exec, r.public_exec) || E'\n';
    end if;
  end loop;

  if v_fail = '' then
    raise exception 'assistant_actions: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'assistant_actions: FAIL\n%', v_fail;
end;
$$;
