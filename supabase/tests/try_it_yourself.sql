-- "Try it yourself" suite (Stage 7 Part 2c).
--
--   Y1  add_owner_test_profile() makes a field-staff login on the trade's field
--       role and names it on company_account; my_setup() shows it, and neither
--       the places nor the people count go up.
--   Y2  A second test login is refused while the first is active.
--   Y3  Only a role that uses the phone app, and only the company's own role.
--   Y4  Never for Gold Fortune (exempt): refused, and nothing changes.
--   Y5  The test login is not "staff invited"; a real one is.
--   Y6  With every place taken, a real login is refused and the test login is
--       not; billing_seats_used leaves it out too.
--   Y7  The list leads with trying the app (on /try-it, no "watch") and ends
--       with the company profile.
--   Y8  Grants: only the service role makes a test login; signed-in callers can
--       read which login it is, not change it.
--
-- HOW TO RUN: as onboarding_wizard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. Its logins are throwaway auth rows.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_other uuid;
  v_owner uuid := gen_random_uuid();
  v_test uuid := gen_random_uuid();
  v_test2 uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_extra uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_field uuid; v_admin_role uuid; v_other_field uuid;
  v_j jsonb; v_j2 jsonb; v_n int; v_t text; v_ok boolean;
begin
  insert into auth.users (id) values (v_owner), (v_test), (v_test2), (v_staff), (v_extra), (v_other_owner);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Try-it check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg',
                       'owner', jsonb_build_object('full_name', 'Try Owner', 'email', 'try-owner@example.invalid')),
    array['cleaning'], v_owner);
  v_other := public.start_trial_company(
    jsonb_build_object('name', 'Try-it check other', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg',
                       'owner', jsonb_build_object('full_name', 'Other Owner', 'email', 'try-other@example.invalid')),
    array['cleaning'], v_other_owner);
  select id into v_field from public.job_roles where org_id = v_org and code = 'sales_rep';
  select id into v_admin_role from public.job_roles where org_id = v_org and code = 'administrator';
  select id into v_other_field from public.job_roles where org_id = v_other and code = 'sales_rep';

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.my_setup();
  reset role;

  ------------------------------------------------------------ Y1 the login
  perform public.add_owner_test_profile(v_org, v_test, 'Try Owner', '27825550142@staff.tickd.co.za', '+27825550142', v_field);
  select count(*) into v_n from public.profiles
   where id = v_test and org_id = v_org and role = 'rep' and job_role_id = v_field and is_active;
  if v_n <> 1 then v_fail := v_fail || 'Y1 the test login is not a field-staff profile' || E'\n'; end if;
  if (select owner_test_profile_id from public.company_account where org_id = v_org) is distinct from v_test then
    v_fail := v_fail || 'Y1 company_account does not name the test login' || E'\n';
  end if;
  set local role authenticated;
  v_j2 := public.my_setup();
  reset role;
  if v_j2->>'owner_test_id' is distinct from v_test::text then
    v_fail := v_fail || format('Y1 my_setup owner_test_id is %s%s', v_j2->>'owner_test_id', E'\n');
  end if;
  if v_j2->'places'->>'used' is distinct from v_j->'places'->>'used'
     or v_j2->'counts'->>'people' is distinct from v_j->'counts'->>'people' then
    v_fail := v_fail || format('Y1 the test login counted: places %s → %s, people %s → %s%s',
                               v_j->'places'->>'used', v_j2->'places'->>'used',
                               v_j->'counts'->>'people', v_j2->'counts'->>'people', E'\n');
  end if;

  ----------------------------------------------------------- Y2 only one
  begin
    perform public.add_owner_test_profile(v_org, v_test2, 'Try Owner', '27825550143@staff.tickd.co.za', '+27825550143', v_field);
    v_fail := v_fail || 'Y2 a second test login was made' || E'\n';
  exception when unique_violation then null;
  end;

  -------------------------------------------------------- Y3 field roles only
  update public.profiles set is_active = false where id = v_test;
  begin
    perform public.add_owner_test_profile(v_org, v_test2, 'Try Owner', '27825550143@staff.tickd.co.za', '+27825550143', v_admin_role);
    v_fail := v_fail || 'Y3 a test login was made on the administrator role' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.add_owner_test_profile(v_org, v_test2, 'Try Owner', '27825550143@staff.tickd.co.za', '+27825550143', v_other_field);
    v_fail := v_fail || 'Y3 a test login was made on another company''s role' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  update public.profiles set is_active = true where id = v_test;

  ---------------------------------------------------------- Y4 Gold Fortune
  select owner_test_profile_id is null into v_ok from public.company_account where org_id = c_gf;
  begin
    perform public.add_owner_test_profile(c_gf, v_test2, 'GF Try', '27825550144@staff.tickd.co.za', '+27825550144',
                                          (select id from public.job_roles where org_id = c_gf and code = 'sales_rep'));
    v_fail := v_fail || 'Y4 Gold Fortune got a test login' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if not coalesce(v_ok, false) or exists (select 1 from public.company_account where org_id = c_gf and owner_test_profile_id is not null)
     or exists (select 1 from public.profiles where id = v_test2) then
    v_fail := v_fail || 'Y4 Gold Fortune''s rows changed' || E'\n';
  end if;

  --------------------------------------------------- Y5 not "staff invited"
  set local role authenticated;
  select (s->>'done')::boolean into v_ok from jsonb_array_elements(public.my_onboarding()->'steps') s where s->>'code' = 'invite_staff';
  reset role;
  if v_ok then v_fail := v_fail || 'Y5 the test login counted as staff invited' || E'\n'; end if;
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', v_field, 'Try Staff', 'try-staff@example.invalid');
  set local role authenticated;
  select (s->>'done')::boolean into v_ok from jsonb_array_elements(public.my_onboarding()->'steps') s where s->>'code' = 'invite_staff';
  reset role;
  if not coalesce(v_ok, false) then v_fail := v_fail || 'Y5 a real staff login did not count as invited' || E'\n'; end if;

  ------------------------------------------------------ Y6 every place taken
  -- Owner + staff = 2 places; the test login is the third profile.
  update public.platform_settings set value = '2'::jsonb where key = 'trial_user_limit';
  if not found then
    insert into public.platform_settings (key, value, description) values ('trial_user_limit', '2'::jsonb, 'suite');
  end if;
  begin
    insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
    values (v_extra, v_org, 'rep', v_field, 'Try Extra', 'try-extra@example.invalid');
    v_fail := v_fail || 'Y6 a third real login got past a limit of 2' || E'\n';
  exception when raise_exception then null;
  end;
  begin
    update public.profiles set is_active = false where id = v_test;
    update public.profiles set is_active = true where id = v_test;
  exception when raise_exception then
    v_fail := v_fail || 'Y6 the test login was refused with every place taken' || E'\n';
  end;
  if public.billing_seats_used(v_org, '{}'::jsonb) <> 2 then
    v_fail := v_fail || format('Y6 billing_seats_used counts %s, expected 2%s', public.billing_seats_used(v_org, '{}'::jsonb), E'\n');
  end if;

  ---------------------------------------------------------------- Y7 the list
  select string_agg(code, ',' order by sort_order) into v_t from public.onboarding_steps;
  if split_part(v_t, ',', 1) <> 'first_workday' or v_t not like '%,company_profile' then
    v_fail := v_fail || format('Y7 the list order is %s%s', v_t, E'\n');
  end if;
  if exists (select 1 from public.onboarding_steps where code = 'first_workday'
              and (href <> '/try-it' or description ilike '%watch%' or title ilike '%watch%')) then
    v_fail := v_fail || 'Y7 the first step does not open /try-it, or says "watch"' || E'\n';
  end if;

  ---------------------------------------------------------------- Y8 grants
  if has_function_privilege('anon', 'public.add_owner_test_profile(uuid, uuid, text, text, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.add_owner_test_profile(uuid, uuid, text, text, text, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.add_owner_test_profile(uuid, uuid, text, text, text, uuid)', 'execute') then
    v_fail := v_fail || 'Y8 add_owner_test_profile has the wrong grants' || E'\n';
  end if;
  if not has_column_privilege('authenticated', 'public.company_account', 'owner_test_profile_id', 'select')
     or has_column_privilege('authenticated', 'public.company_account', 'owner_test_profile_id', 'update')
     or has_column_privilege('anon', 'public.company_account', 'owner_test_profile_id', 'select') then
    v_fail := v_fail || 'Y8 owner_test_profile_id has the wrong grants' || E'\n';
  end if;
  perform set_config('request.jwt.claims', '', true);

  if v_fail <> '' then
    raise exception E'TRY-IT-YOURSELF FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL TRY-IT-YOURSELF CHECKS PASSED (rolled back)';
end;
$$;
