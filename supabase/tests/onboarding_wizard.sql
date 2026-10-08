-- Set-up wizard suite (Stage 7 Part 2).
--
--   W1  A new trial: my_setup() for its owner shows the wizard, with the trade
--       and how it usually gets paid, the template's price list (nothing priced
--       yet), the trial's places and the country's usual VAT rate.
--   W2  save_setup_step remembers the step; finishing hides the wizard and the
--       first finishing time stays; a malformed step is refused.
--   W3  A field employee can neither read nor move the wizard, nor see the
--       team status.
--   W4  my_team_status(): the caller's own company only, one row per active
--       person, and a started workday shows.
--   W5  Gold Fortune: the wizard never shows, no places are counted, and
--       saving a step changes nothing.
--   W6  Grants: none of the three is callable anonymously; the new columns are
--       readable, not writable, by signed-in callers.
--   W7  "Invite your staff" opens Settings → Users.
--
-- HOW TO RUN: as trial_onboarding.sql. One DO block that always ends in
-- `raise exception`, so nothing survives — including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_admin uuid;
  v_j jsonb; v_n int; v_m int; v_t text; v_limit int; v_items int; v_forms int; v_trade text;
begin
  select coalesce((value #>> '{}')::int, 10) into v_limit from public.platform_settings where key = 'trial_user_limit';
  v_limit := coalesce(v_limit, 10);
  select count(*) into v_items from public.template_service_items where template_code = 'cleaning';
  select ts.value #>> '{}' into v_trade from public.template_settings ts
   where ts.template_code = 'cleaning' and ts.setting_key = 'money_workflow';

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

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Wizard check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg',
                       'owner', jsonb_build_object('full_name', 'Wizard Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Wizard Staff', v_staff_email);
  select count(*) into v_forms from public.form_templates where org_id = v_org and active;

  -------------------------------------------------------- W1 a new trial
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.my_setup();
  if not coalesce((v_j->>'show')::boolean, false) then
    v_fail := v_fail || 'W1 a new trial does not see the wizard' || E'\n';
  end if;
  if v_j->>'step' is not null or v_j->>'finished_at' is not null then
    v_fail := v_fail || format('W1 a new trial starts at %s, finished %s%s', v_j->>'step', v_j->>'finished_at', E'\n');
  end if;
  if jsonb_array_length(v_j->'industries') <> 1 or v_j->'industries'->0->>'code' is distinct from 'cleaning'
     or coalesce(v_j->'industries'->0->>'name', '') = '' then
    v_fail := v_fail || format('W1 industries %s%s', v_j->'industries', E'\n');
  end if;
  if v_trade is null or v_j->>'trade_workflow' is distinct from v_trade then
    v_fail := v_fail || format('W1 trade workflow %s%s', v_j->>'trade_workflow', E'\n');
  end if;
  if (v_j->'counts'->>'items')::int <> v_items or (v_j->'counts'->>'priced_items')::int <> 0 then
    v_fail := v_fail || format('W1 price list %s items, %s priced; expected %s and 0%s',
                               v_j->'counts'->>'items', v_j->'counts'->>'priced_items', v_items, E'\n');
  end if;
  if (v_j->'counts'->>'checklists')::int <> v_forms or (v_j->'counts'->>'sites')::int <> 0
     or (v_j->'counts'->>'people')::int <> 2 or (v_j->'counts'->>'checkins')::int <> 0 then
    v_fail := v_fail || format('W1 counts %s (expected %s checklists, 0 sites, 2 people, 0 check-ins)%s',
                               v_j->'counts', v_forms, E'\n');
  end if;
  if (v_j->'places'->>'used')::int is distinct from 2 or (v_j->'places'->>'limit')::int is distinct from v_limit then
    v_fail := v_fail || format('W1 places %s, expected 2 of %s%s', v_j->'places', v_limit, E'\n');
  end if;
  if v_j->>'country_code' is distinct from 'ZA' or (v_j->>'vat_rate_default')::numeric is distinct from 15 then
    v_fail := v_fail || format('W1 country %s, VAT %s; expected ZA and 15%s', v_j->>'country_code', v_j->>'vat_rate_default', E'\n');
  end if;

  ------------------------------------------------------------ W2 the step
  perform public.save_setup_step('team');
  v_j := public.my_setup();
  if v_j->>'step' is distinct from 'team' or not coalesce((v_j->>'show')::boolean, false) then
    v_fail := v_fail || format('W2 after saving "team": step %s, show %s%s', v_j->>'step', v_j->>'show', E'\n');
  end if;
  begin
    perform public.save_setup_step('Team; drop');
    v_fail := v_fail || 'W2 a malformed step was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_setup_step(null);
    v_fail := v_fail || 'W2 an empty step was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  perform public.save_setup_step('done', true);
  v_j := public.my_setup();
  if coalesce((v_j->>'show')::boolean, true) or v_j->>'finished_at' is null or v_j->>'step' is distinct from 'done' then
    v_fail := v_fail || format('W2 finishing: show %s, finished %s, step %s%s', v_j->>'show', v_j->>'finished_at', v_j->>'step', E'\n');
  end if;
  -- The first finishing time stays.
  reset role;
  update public.company_account set wizard_finished_at = '2026-01-01T00:00:00Z' where org_id = v_org;
  set local role authenticated;
  perform public.save_setup_step('done', true);
  perform public.save_setup_step('company');
  v_j := public.my_setup();
  if (v_j->>'finished_at')::timestamptz is distinct from '2026-01-01T00:00:00Z'::timestamptz
     or coalesce((v_j->>'show')::boolean, true) then
    v_fail := v_fail || format('W2 the finishing time moved to %s (show %s)%s', v_j->>'finished_at', v_j->>'show', E'\n');
  end if;
  reset role;
  update public.company_account set wizard_finished_at = null, wizard_step = null where org_id = v_org;

  ----------------------------------------------------- W3 a field employee
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.my_setup();
    v_fail := v_fail || 'W3 a field employee read the wizard' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_setup_step('team');
    v_fail := v_fail || 'W3 a field employee moved the wizard' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.my_team_status();
    v_fail := v_fail || 'W3 a field employee saw the team status' || E'\n';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_n from public.company_account where org_id = v_org and wizard_step is not null;
  if v_n > 0 then v_fail := v_fail || 'W3 the wizard moved for a field employee' || E'\n'; end if;
  reset role;

  ------------------------------------------------------- W4 team status
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select string_agg(profile_id::text, ',' order by profile_id::text), count(*) filter (where started_workday)
    into v_t, v_m from public.my_team_status();
  if v_t is distinct from (select string_agg(x::text, ',' order by x::text) from unnest(array[v_owner, v_staff]) x) then
    v_fail := v_fail || format('W4 team status lists %s, expected the owner and the employee%s', v_t, E'\n');
  end if;
  if v_m <> 0 then v_fail := v_fail || 'W4 a workday shows before anyone started one' || E'\n'; end if;
  reset role;
  insert into public.workday_sessions (org_id, rep_id, client_generated_id) values (v_org, v_staff, gen_random_uuid());
  set local role authenticated;
  select count(*) filter (where started_workday and profile_id = v_staff), count(*) filter (where started_workday)
    into v_n, v_m from public.my_team_status();
  if v_n <> 1 or v_m <> 1 then
    v_fail := v_fail || format('W4 after the employee started a workday: %s for them, %s in all%s', v_n, v_m, E'\n');
  end if;
  reset role;

  --------------------------------------------------------- W5 Gold Fortune
  select p.id into v_gf_admin from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
   where p.org_id = c_gf and jr.code = 'administrator' and p.is_active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.my_setup();
  if coalesce((v_j->>'show')::boolean, true) then
    v_fail := v_fail || 'W5 Gold Fortune would see the wizard' || E'\n';
  end if;
  if jsonb_typeof(v_j->'places') is distinct from 'null' then
    v_fail := v_fail || format('W5 Gold Fortune is counted against places: %s%s', v_j->'places', E'\n');
  end if;
  perform public.save_setup_step('team');
  select string_agg(profile_id::text, ',') into v_t from public.my_team_status() where profile_id in (v_owner, v_staff);
  if v_t is not null then v_fail := v_fail || 'W5 Gold Fortune sees the trial company''s people' || E'\n'; end if;
  reset role;
  if exists (select 1 from public.company_account where org_id = c_gf and (wizard_step is not null or wizard_finished_at is null)) then
    v_fail := v_fail || 'W5 Gold Fortune''s account row has a wizard step or no finishing time' || E'\n';
  end if;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- W6 grants
  if has_function_privilege('anon', 'public.my_setup()', 'execute')
     or has_function_privilege('anon', 'public.save_setup_step(text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.my_team_status()', 'execute') then
    v_fail := v_fail || 'W6 a wizard function is callable anonymously' || E'\n';
  end if;
  if not has_function_privilege('authenticated', 'public.my_setup()', 'execute')
     or not has_function_privilege('authenticated', 'public.save_setup_step(text, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_team_status()', 'execute') then
    v_fail := v_fail || 'W6 a wizard function is not callable when signed in' || E'\n';
  end if;
  if not has_column_privilege('authenticated', 'public.company_account', 'wizard_step', 'select')
     or not has_column_privilege('authenticated', 'public.company_account', 'wizard_finished_at', 'select')
     or has_column_privilege('authenticated', 'public.company_account', 'wizard_step', 'update')
     or has_column_privilege('authenticated', 'public.company_account', 'wizard_finished_at', 'update')
     or has_column_privilege('anon', 'public.company_account', 'wizard_finished_at', 'select') then
    v_fail := v_fail || 'W6 the new company_account columns have the wrong grants' || E'\n';
  end if;

  ------------------------------------------------------------- W7 the link
  select href into v_t from public.onboarding_steps where code = 'invite_staff';
  if v_t is distinct from '/settings/users' then
    v_fail := v_fail || format('W7 "invite your staff" opens %s%s', v_t, E'\n');
  end if;

  if v_fail <> '' then
    raise exception E'SET-UP WIZARD FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL SET-UP WIZARD CHECKS PASSED (rolled back)';
end;
$$;
