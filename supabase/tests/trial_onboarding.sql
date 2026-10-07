-- Trial and getting-started suite (Stage 5).
--
--   T1  start_trial_company builds the same company create_company would, with
--       its owner as Administrator and a trial ending trial_days from now.
--   T2  my_onboarding() for that owner: the trade's steps only (no products step
--       without distribution), each done once the company has done it; the
--       owner can put the list away, a field employee cannot.
--   T3  company_account cannot be written through the API, not even by the
--       company's own administrator; each company sees only its own row.
--   T4  Gold Fortune: no trial, the list already put away.
--   T5  Grants: the service-role functions and platform_settings are out of
--       reach of signed-in and anonymous callers.
--   T6  The anonymous rate limit counts per subject.
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives — including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text;
  v_days int; v_ends timestamptz; v_n int; v_j jsonb; v_r jsonb; v_t text; v_gf_admin uuid;
begin
  select (value #>> '{}')::int into v_days from public.platform_settings where key = 'trial_days';

  -- Two logins with no field data of their own become the trial's people.
  select p.id, p.email into v_owner, v_owner_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager'
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  select p.id, p.email into v_staff, v_staff_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id <> v_owner
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  if v_owner is null or v_staff is null then
    raise exception 'Fixtures missing: two quiet logins are needed.';
  end if;
  delete from public.profiles where id in (v_owner, v_staff);

  ---------------------------------------------------------------- T1 the trial
  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Trial check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg',
                       'owner', jsonb_build_object('full_name', 'Trial Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  select trial_ends_at into v_ends from public.company_account where org_id = v_org;
  if v_ends is null or abs(extract(epoch from v_ends - (now() + make_interval(days => v_days)))) > 60 then
    v_fail := v_fail || format('T1 trial ends %s, expected %s days from now%s', v_ends, v_days, E'\n');
  end if;
  if not exists (select 1 from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
                  where p.id = v_owner and p.org_id = v_org and jr.code = 'administrator') then
    v_fail := v_fail || 'T1 the owner is not the Administrator' || E'\n';
  end if;
  if (select industries from public.organizations where id = v_org) is distinct from array['cleaning'] then
    v_fail := v_fail || 'T1 industries not recorded' || E'\n';
  end if;
  select count(*) into v_n from public.form_templates where org_id = v_org;
  if v_n <> jsonb_array_length(public.template_defaults(array['cleaning'])->'checklists')
            + jsonb_array_length(public.template_defaults(array['cleaning'])->'forms') then
    v_fail := v_fail || format('T1 %s forms, not the template''s%s', v_n, E'\n');
  end if;
  -- All or nothing: a refused company leaves no account row and no organisation.
  select count(*) into v_n from public.company_account;
  begin
    perform public.start_trial_company(jsonb_build_object('name', ''), array['cleaning'], v_staff);
    v_fail := v_fail || 'T1 a nameless company was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.company_account) <> v_n then
    v_fail := v_fail || 'T1 a refused trial left a company_account row' || E'\n';
  end if;
  begin
    perform public.start_trial_company(jsonb_build_object('name', 'Trial check no owner'), array['cleaning'], null);
    v_fail := v_fail || 'T1 a trial without an owner was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;

  -- A field employee in the trial company, for T2.
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Trial Staff', v_staff_email);

  ------------------------------------------------------------ T2 the list
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.my_onboarding();
  if v_j->>'dismissed_at' is not null then v_fail := v_fail || 'T2 a new trial starts with the list put away' || E'\n'; end if;
  if exists (select 1 from jsonb_array_elements(v_j->'steps') s where s->>'code' = 'add_products') then
    v_fail := v_fail || 'T2 a cleaning company is asked to add products' || E'\n';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_j->'steps') s where s->>'code' = 'first_checklist') then
    v_fail := v_fail || 'T2 the checklist step is missing (checklists module is on)' || E'\n';
  end if;
  -- Two people now: invite_staff done; nothing else yet.
  select string_agg(s->>'code', ',' order by s->>'code') into v_t
    from jsonb_array_elements(v_j->'steps') s where (s->>'done')::boolean;
  if v_t is distinct from 'invite_staff' then
    v_fail := v_fail || format('T2 done before anything was added: %s%s', coalesce(v_t, 'none'), E'\n');
  end if;
  reset role;
  insert into public.stores (org_id, name) values (v_org, 'Trial check site');
  set local role authenticated;
  v_j := public.my_onboarding();
  if not exists (select 1 from jsonb_array_elements(v_j->'steps') s where s->>'code' = 'add_sites' and (s->>'done')::boolean) then
    v_fail := v_fail || 'T2 add_sites not done after a site was added' || E'\n';
  end if;
  -- The employee cannot put the list away; the owner can.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.dismiss_onboarding();
    v_fail := v_fail || 'T2 a field employee put the list away' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.dismiss_onboarding();
  if public.my_onboarding()->>'dismissed_at' is null then
    v_fail := v_fail || 'T2 the owner could not put the list away' || E'\n';
  end if;

  ------------------------------------------------------- T3 write protection
  begin
    update public.company_account set trial_ends_at = now() + interval '1 year' where org_id = v_org;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_fail := v_fail || 'T3 the administrator moved their own trial date' || E'\n'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_account (org_id) values (gen_random_uuid());
    v_fail := v_fail || 'T3 a company_account row was inserted through the API' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.company_account where org_id = v_org;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_fail := v_fail || 'T3 the administrator deleted their account row' || E'\n'; end if;
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_n from public.company_account where org_id <> v_org;
  if v_n > 0 then v_fail := v_fail || format('T3 the trial owner sees %s other companies'' accounts%s', v_n, E'\n'); end if;
  reset role;

  --------------------------------------------------------- T4 Gold Fortune
  if exists (select 1 from public.company_account where org_id = c_gf and trial_ends_at is not null) then
    v_fail := v_fail || 'T4 Gold Fortune is on a trial' || E'\n';
  end if;
  select p.id into v_gf_admin from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
   where p.org_id = c_gf and jr.code = 'administrator' and p.is_active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.my_onboarding()->>'dismissed_at' is null then
    v_fail := v_fail || 'T4 Gold Fortune would see the getting-started list' || E'\n';
  end if;
  select count(*) into v_n from public.company_account where org_id = v_org;
  if v_n > 0 then v_fail := v_fail || 'T4 Gold Fortune sees the trial company''s account' || E'\n'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -------------------------------------------------------------- T5 grants
  if has_function_privilege('authenticated', 'public.start_trial_company(jsonb, text[], uuid)', 'execute')
     or has_function_privilege('anon', 'public.start_trial_company(jsonb, text[], uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.consume_anonymous_rate_limit(text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.consume_anonymous_rate_limit(text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.my_onboarding()', 'execute')
     or has_function_privilege('anon', 'public.dismiss_onboarding()', 'execute') then
    v_fail := v_fail || 'T5 a service-role or signed-in function is callable by the wrong caller' || E'\n';
  end if;
  if has_table_privilege('authenticated', 'public.platform_settings', 'select')
     or has_table_privilege('anon', 'public.platform_settings', 'select') then
    v_fail := v_fail || 'T5 platform_settings is readable through the API' || E'\n';
  end if;

  --------------------------------------------------------- T6 rate limit
  v_r := public.consume_anonymous_rate_limit('trial_check', 'ip:192.0.2.1', 2, 3600);
  v_r := public.consume_anonymous_rate_limit('trial_check', 'ip:192.0.2.1', 2, 3600);
  if not (v_r->>'allowed')::boolean then v_fail := v_fail || 'T6 the 2nd call of 2 was refused' || E'\n'; end if;
  v_r := public.consume_anonymous_rate_limit('trial_check', 'ip:192.0.2.1', 2, 3600);
  if (v_r->>'allowed')::boolean then v_fail := v_fail || 'T6 the 3rd call past a limit of 2 was allowed' || E'\n'; end if;
  v_r := public.consume_anonymous_rate_limit('trial_check', 'ip:192.0.2.2', 2, 3600);
  if not (v_r->>'allowed')::boolean then v_fail := v_fail || 'T6 another subject was refused' || E'\n'; end if;

  if v_fail <> '' then
    raise exception E'TRIAL AND ONBOARDING FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL TRIAL AND ONBOARDING CHECKS PASSED (rolled back)';
end;
$$;
