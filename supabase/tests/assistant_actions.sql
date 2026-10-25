-- The record of changes the AI Manager makes: assistant_actions (25 Oct 2026).
--
-- The web's act route starts and finishes each record with the service role,
-- carrying the company and person it read with the person's own session. The
-- calls marked "(service)" are that route.
--
--   A1  (service) A manager's card starts a record: their company, their id
--       and name, the card, the action and the input, unfinished. Finishing
--       says done, the words and the target.
--   A2  (service) The same card again, after it was done, answers with the
--       record: no second record, nothing to redo.
--   A3  (service) The same card while it is under way is answered as under
--       way, not started twice.
--   A4  (service) A card that was tried and not done may be tried again, on
--       the same record.
--   A5  (service) Somebody else's card is refused.
--   A6  Signed in, nobody calls start or finish, nor writes the table directly.
--   A7  A rep reads no records; a manager reads their own company's.
--   A8  A manager at another company reads none of these.
--   A9  (service) A read-only company is refused with the billing gate's
--       words and hint; an inactive person, or one at another company, is
--       refused too.
--   A10 (service) A bad action name and an input over 1 MB are refused.
--   A11 (service) The 201st start in an hour from one person is refused.
--   A12 A record outlives its person: the user is cleared, the name kept.
--   A13 Both functions are security definer with a fixed search_path. Only the
--       service role may execute them: not anon, PUBLIC or authenticated.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_mgr uuid; v_mgr2 uuid; v_rep uuid; v_foreign uuid; v_foreign_org uuid; v_name text;
  v_card uuid := gen_random_uuid();
  v_card2 uuid := gen_random_uuid();
  v_card3 uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_err text; v_code text; v_hint text; v_n int; r record; s record; v_status text;
begin
  select p.id, p.full_name into v_mgr, v_name from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'manager'
   order by p.created_at, p.id limit 1;
  select p.id into v_mgr2 from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'manager' and p.id <> v_mgr
   order by p.created_at, p.id limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
   order by p.created_at, p.id limit 1;
  select p.id, p.org_id into v_foreign, v_foreign_org from public.profiles p
   where p.org_id <> c_gf and p.is_active and p.role = 'manager'
     and not exists (select 1 from public.company_account ca where ca.org_id = p.org_id and ca.closed_at is not null)
   order by p.created_at, p.id limit 1;
  if v_mgr is null or v_mgr2 is null or v_rep is null or v_foreign is null then
    raise exception 'Fixtures missing: managers % %, rep %, foreign manager %', v_mgr, v_mgr2, v_rep, v_foreign;
  end if;
  -- Writable for the length of the suite, whatever the account is today (A9 sets it back).
  select status into v_status from public.company_account where org_id = c_gf;
  update public.company_account set status = 'active' where org_id = c_gf and status in ('read_only', 'cancelled');

  ---------------------------------------------------------------- A1 start and finish
  set local role service_role;
  select * into s from public.assistant_action_start(c_gf, v_mgr, v_card, 'create_form', '{"name": "Suite form"}'::jsonb);
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.assistant_actions where id = s.record_id;
  if not s.fresh or r.org_id is distinct from c_gf or r.user_id is distinct from v_mgr or r.person_name is distinct from v_name
     or r.draft_id <> v_card or r.action <> 'create_form' or r.input->>'name' is distinct from 'Suite form'
     or r.ok is not null or r.finished_at is not null then
    v_fail := v_fail || format('A1 started row is %s (fresh %s)', row_to_json(r), s.fresh) || E'\n';
  end if;
  set local role service_role;
  perform public.assistant_action_finish(s.record_id, true, 'Created.', v_target);
  reset role;
  v_checks := v_checks + 1;
  select * into r from public.assistant_actions where id = s.record_id;
  if r.ok is distinct from true or r.result is distinct from 'Created.' or r.target_id is distinct from v_target
     or r.finished_at is null then
    v_fail := v_fail || format('A1 finished row is %s', row_to_json(r)) || E'\n';
  end if;

  ---------------------------------------------------------------- A2 a done card again
  set local role service_role;
  select * into s from public.assistant_action_start(c_gf, v_mgr, v_card, 'create_form', '{"name": "Suite form"}'::jsonb);
  reset role;
  v_checks := v_checks + 1;
  select count(*) into v_n from public.assistant_actions where draft_id = v_card;
  if s.fresh or s.was_ok is distinct from true or s.was_result is distinct from 'Created.' or v_n <> 1 then
    v_fail := v_fail || format('A2 a done card again: fresh %s, ok %s, result %s, rows %s', s.fresh, s.was_ok, s.was_result, v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- A3 a card under way
  set local role service_role;
  perform public.assistant_action_start(c_gf, v_mgr, v_card2, 'change_dashboard', '{}'::jsonb);
  select * into s from public.assistant_action_start(c_gf, v_mgr, v_card2, 'change_dashboard', '{}'::jsonb);
  reset role;
  v_checks := v_checks + 1;
  select count(*) into v_n from public.assistant_actions where draft_id = v_card2;
  if s.fresh or s.was_ok is not null or v_n <> 1 then
    v_fail := v_fail || format('A3 a card under way: fresh %s, ok %s, rows %s', s.fresh, s.was_ok, v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- A4 tried and not done, tried again
  set local role service_role;
  select * into s from public.assistant_action_start(c_gf, v_mgr, v_card3, 'change_form', '{"try": 1}'::jsonb);
  perform public.assistant_action_finish(s.record_id, false, 'Not done.', null);
  select * into r from public.assistant_action_start(c_gf, v_mgr, v_card3, 'change_form', '{"try": 2}'::jsonb);
  reset role;
  v_checks := v_checks + 1;
  select count(*) into v_n from public.assistant_actions where draft_id = v_card3;
  if not r.fresh or r.record_id <> s.record_id or v_n <> 1
     or exists (select 1 from public.assistant_actions where id = s.record_id
                 and (ok is not null or finished_at is not null or input->>'try' <> '2')) then
    v_fail := v_fail || format('A4 a retried card: fresh %s, same row %s, rows %s', r.fresh, r.record_id = s.record_id, v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- A5 somebody else's card
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role service_role;
    perform public.assistant_action_start(c_gf, v_mgr2, v_card2, 'change_dashboard', '{}'::jsonb);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '42501' then
    v_fail := v_fail || 'A5 another person''s card was started (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A6 nothing for the signed-in
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  for r in select * from (values ('start'), ('finish'), ('insert'), ('update'), ('delete')) w(op) loop
    v_checks := v_checks + 1;
    v_code := null;
    begin
      set local role authenticated;
      if r.op = 'start' then
        perform public.assistant_action_start(c_gf, v_mgr, gen_random_uuid(), 'create_form', '{}'::jsonb);
      elsif r.op = 'finish' then
        perform public.assistant_action_finish(s.record_id, true, 'Forged.', null);
      elsif r.op = 'insert' then
        insert into public.assistant_actions (org_id, user_id, draft_id, action, input)
        values (c_gf, v_mgr, gen_random_uuid(), 'create_form', '{}');
      elsif r.op = 'update' then
        update public.assistant_actions set result = 'tampered' where draft_id = v_card;
      else
        delete from public.assistant_actions where draft_id = v_card;
      end if;
      reset role;
    exception when others then
      reset role;
      v_code := sqlstate;
    end;
    if v_code is distinct from '42501' then
      v_fail := v_fail || format('A6 a signed-in %s was not refused (%s)', r.op, coalesce(v_code, 'no error')) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- A7 who reads
  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.assistant_actions where draft_id in (v_card, v_card2);
  reset role;
  v_checks := v_checks + 1;
  if v_n <> 0 then
    v_fail := v_fail || 'A7 a rep read ' || v_n || ' records' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.assistant_actions where draft_id in (v_card, v_card2);
  reset role;
  v_checks := v_checks + 1;
  if v_n <> 2 then
    v_fail := v_fail || 'A7 a manager read ' || v_n || ' of their company''s 2 records' || E'\n';
  end if;

  ---------------------------------------------------------------- A8 another company
  perform set_config('request.jwt.claims', json_build_object('sub', v_foreign, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.assistant_actions where org_id = c_gf;
  reset role;
  v_checks := v_checks + 1;
  if v_n <> 0 then
    v_fail := v_fail || 'A8 another company read ' || v_n || ' records' || E'\n';
  end if;

  ---------------------------------------------------------------- A9 who may start one
  update public.company_account set status = 'read_only' where org_id = c_gf;
  v_checks := v_checks + 1;
  v_err := null; v_hint := null;
  begin
    set local role service_role;
    perform public.assistant_action_start(c_gf, v_mgr, gen_random_uuid(), 'create_form', '{}'::jsonb);
    reset role;
  exception when others then
    reset role;
    get stacked diagnostics v_err = message_text, v_hint = pg_exception_hint;
  end;
  if v_err is distinct from 'Your company''s account is read-only until the plan is paid.' or v_hint is distinct from 'read_only' then
    v_fail := v_fail || format('A9 a read-only company started a record (%s / %s)', coalesce(v_err, 'no error'), v_hint) || E'\n';
  end if;
  update public.company_account set status = case when v_status in ('read_only', 'cancelled') then 'active' else v_status end
   where org_id = c_gf;
  -- A person at another company, named as this one's.
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role service_role;
    perform public.assistant_action_start(c_gf, v_foreign, gen_random_uuid(), 'create_form', '{}'::jsonb);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '42501' then
    v_fail := v_fail || 'A9 a person of another company started a record (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A10 bad input
  for r in select * from (values ('Create Form', '{}'), ('create_form', null)) b(a, i) loop
    v_checks := v_checks + 1;
    v_code := null;
    begin
      set local role service_role;
      perform public.assistant_action_start(c_gf, v_mgr, gen_random_uuid(), r.a,
        coalesce(r.i::jsonb, jsonb_build_object('big', repeat('x', 1048577))));
      reset role;
    exception when others then
      reset role;
      v_code := sqlstate;
    end;
    if v_code is distinct from '22023' then
      v_fail := v_fail || format('A10 %s was not refused (%s)', r.a, coalesce(v_code, 'no error')) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- A11 the hourly cap
  insert into public.assistant_actions (org_id, user_id, draft_id, action, input)
  select c_gf, v_mgr, gen_random_uuid(), 'change_dashboard', '{}'::jsonb from generate_series(1, 200);
  v_checks := v_checks + 1;
  v_code := null;
  begin
    set local role service_role;
    perform public.assistant_action_start(c_gf, v_mgr, gen_random_uuid(), 'change_dashboard', '{}'::jsonb);
    reset role;
  exception when others then
    reset role;
    v_code := sqlstate;
  end;
  if v_code is distinct from '54000' then
    v_fail := v_fail || 'A11 a start past 200 an hour was not refused (' || coalesce(v_code, 'no error') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A12 a record outlives its person
  v_checks := v_checks + 1;
  select c.confdeltype::text into v_err
    from pg_constraint c
   where c.conrelid = 'public.assistant_actions'::regclass and c.contype = 'f'
     and c.confrelid = 'public.profiles'::regclass;
  if v_err is distinct from 'n' or exists (select 1 from information_schema.columns
                                            where table_schema = 'public' and table_name = 'assistant_actions'
                                              and column_name = 'user_id' and is_nullable = 'NO') then
    v_fail := v_fail || 'A12 removing a person would take their records (on delete ' || coalesce(v_err, 'none') || ')' || E'\n';
  end if;

  ---------------------------------------------------------------- A13 the functions
  for r in
    select p.proname, p.prosecdef, p.proconfig,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
           exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('assistant_action_start', 'assistant_action_finish')
  loop
    v_checks := v_checks + 1;
    if not r.prosecdef or r.proconfig is null or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%')
       or r.anon_exec or r.public_exec or r.auth_exec or not r.service_exec then
      v_fail := v_fail || format('A13 %s: definer %s, config %s, anon %s, public %s, authenticated %s, service %s',
                                 r.proname, r.prosecdef, r.proconfig, r.anon_exec, r.public_exec, r.auth_exec, r.service_exec) || E'\n';
    end if;
  end loop;

  if v_fail = '' then
    raise exception 'assistant_actions: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'assistant_actions: FAIL\n%', v_fail;
end;
$$;
