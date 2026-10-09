-- Staff score suite (Stage 7 Part 4b).
--
--   S1  Settings: a new cleaning company gets its trade's weights; Gold
--       Fortune keeps today's; every trade's weights add up to 100.
--   S2  Score inputs: a hand-made cleaning fortnight (done, missed, two
--       planned days on approved leave, one of them done anyway; a check-in
--       with no fix; photos, a checklist; workdays). Every count exact.
--   S3  Leave days: the dates only, the caller's company only; none when the
--       company has no HR module.
--   S4  A field employee is refused both functions.
--   S5  Companies cannot see each other's people.
--   S6  Grants and module registration.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_viewer uuid;
  v_tz text; v_today date; v_d1 date; v_from timestamptz; v_to timestamptz;
  v_s1 uuid; v_s2 uuid; v_form uuid; v_r uuid[] := '{}'; v_rid uuid; v_v uuid; v_emp uuid; v_type uuid;
  v_n int; v_t text;
  r record; x record;
begin
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
  select p.id into v_gf_viewer from public.profiles p
   where p.org_id = c_gf and p.is_active and p.id not in (v_owner, v_staff)
     and exists (select 1 from public.profile_permissions pp
                  where pp.profile_id = p.id and pp.permission_code in ('insights', 'admin'))
   order by p.full_name limit 1;
  if v_gf_viewer is null then
    raise exception 'Fixtures missing: a Gold Fortune login that may read reports.';
  end if;
  delete from public.profiles where id in (v_owner, v_staff);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Score check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Score Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Score Staff', v_staff_email);
  v_tz := public.org_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_d1 := v_today - 10;
  v_from := (v_today - 14)::timestamp at time zone v_tz;
  v_to := (v_today + 1)::timestamp at time zone v_tz;

  ---------------------------------------------------------------- S1 settings
  if (select value from public.company_settings where org_id = v_org and key = 'staff_score_weights')
       is distinct from (select value from public.template_settings
                          where template_code = 'cleaning' and setting_key = 'staff_score_weights') then
    v_fail := v_fail || 'S1 a new cleaning company did not get its trade''s weights' || E'\n';
  end if;
  if (select value #>> '{}' from public.company_settings where org_id = c_gf and key = 'staff_score_weights')
       is distinct from 'sales:35,visits:25,coverage:15,merchandising:15,compliance:10' then
    v_fail := v_fail || 'S1 Gold Fortune''s weights are not today''s' || E'\n';
  end if;
  for r in select template_code, value #>> '{}' as w from public.template_settings where setting_key = 'staff_score_weights' loop
    select sum(split_part(p, ':', 2)::int) as total, count(*) as n, count(distinct split_part(p, ':', 1)) as nd
      into x from unnest(string_to_array(r.w, ',')) p;
    if x.total <> 100 or x.n <> x.nd then
      v_fail := v_fail || format('S1 %s''s weights add up to %s, or name a part twice', r.template_code, x.total) || E'\n';
    end if;
  end loop;
  if (select count(*) from public.template_settings where setting_key = 'staff_score_weights') <> 11 then
    v_fail := v_fail || 'S1 not every trade has weights' || E'\n';
  end if;

  ---------------------------------------------------------------- fixtures
  insert into public.company_modules (org_id, module_code, enabled) values (v_org, 'hr', true)
  on conflict (org_id, module_code) do update set enabled = true;
  insert into public.stores (org_id, name) values (v_org, 'Score site one') returning id into v_s1;
  insert into public.stores (org_id, name) values (v_org, 'Score site two') returning id into v_s2;
  select id into v_form from public.form_templates where org_id = v_org and active order by created_at limit 1;
  -- Four planned days at site one: day 1 done, day 2 missed, days 3 and 4 on
  -- approved leave (day 3 missed, day 4 done anyway).
  for i in 0..3 loop
    insert into public.routes (org_id, rep_id, store_id, scheduled_date, source)
    values (v_org, v_staff, v_s1, v_d1 + i, 'manual') returning id into v_rid;
    v_r := v_r || v_rid;
  end loop;
  insert into public.visits (org_id, route_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_r[1], v_staff, v_s1, 'checked_out', (v_d1::timestamp + interval '9 hours') at time zone v_tz,
          (v_d1::timestamp + interval '9 hours 30 minutes') at time zone v_tz, 1800, 20, gen_random_uuid())
  returning id into v_v;
  insert into public.photos (org_id, visit_id, rep_id, storage_path, client_generated_id)
  values (v_org, v_v, v_staff, 'score/' || gen_random_uuid() || '.jpg', gen_random_uuid());
  insert into public.form_submissions (org_id, visit_id, form_template_id, rep_id, client_generated_id)
  values (v_org, v_v, v_form, v_staff, gen_random_uuid());
  -- Day 4: done, no GPS fix, a photo but no checklist.
  insert into public.visits (org_id, route_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_r[4], v_staff, v_s1, 'checked_out', ((v_d1 + 3)::timestamp + interval '9 hours') at time zone v_tz,
          ((v_d1 + 3)::timestamp + interval '9 hours 30 minutes') at time zone v_tz, 1800, null, gen_random_uuid())
  returning id into v_v;
  insert into public.photos (org_id, visit_id, rep_id, storage_path, client_generated_id)
  values (v_org, v_v, v_staff, 'score/' || gen_random_uuid() || '.jpg', gen_random_uuid());
  insert into public.workday_sessions (org_id, rep_id, started_at, ended_at, duration_seconds, client_generated_id)
  values (v_org, v_staff, (v_d1::timestamp + interval '8 hours') at time zone v_tz,
          (v_d1::timestamp + interval '12 hours') at time zone v_tz, 14400, gen_random_uuid());
  -- The owner works too: one unscheduled job, 500 m away, and an 8-hour day.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_owner, v_s2, 'checked_out', (v_d1::timestamp + interval '10 hours') at time zone v_tz,
          (v_d1::timestamp + interval '10 hours 30 minutes') at time zone v_tz, 1800, 500, gen_random_uuid());
  insert into public.workday_sessions (org_id, rep_id, started_at, ended_at, duration_seconds, client_generated_id)
  values (v_org, v_owner, (v_d1::timestamp + interval '8 hours') at time zone v_tz,
          (v_d1::timestamp + interval '16 hours') at time zone v_tz, 28800, gen_random_uuid());
  -- Approved leave over days 3 and 4.
  insert into public.hr_employees (org_id, profile_id, employee_number, first_name, last_name)
  values (v_org, v_staff, 'S-1', 'Score', 'Staff') returning id into v_emp;
  insert into public.hr_leave_types (org_id, name, code) values (v_org, 'Annual', 'score_annual') returning id into v_type;
  -- Recorded as HR would record it: the guard makes anyone else's a request,
  -- so its triggers are paused for this one fixture row.
  set local session_replication_role = replica;
  insert into public.hr_leave_requests (org_id, employee_id, leave_type_id, start_date, end_date, days, status)
  values (v_org, v_emp, v_type, v_d1 + 2, v_d1 + 3, 2, 'approved');
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- S2 inputs
  select count(*) into v_n from public.staff_score_inputs(v_from, v_to);
  if v_n <> 2 then
    v_fail := v_fail || format('S2 %s people, expected 2', v_n) || E'\n';
  end if;
  for r in
    select e.*, s.*
      from (values (v_staff, 'Score Staff', 4, 2, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 3600, 14400, 1, 2),
                   (v_owner, 'Score Owner', 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1800, 28800, 1, 1))
           as e(id, nm, pl, sv, lp, ls, spl, srch, fin, prv, frm, rnd, fix, ins, ons, wds, wdn, sdays)
      left join public.staff_score_inputs(v_from, v_to) s on s.staff_id = e.id
  loop
    if r.staff_name is distinct from r.nm or r.planned is distinct from r.pl or r.served is distinct from r.sv
       or r.leave_planned is distinct from r.lp or r.leave_served is distinct from r.ls
       or r.sites_planned is distinct from r.spl or r.sites_reached is distinct from r.srch
       or r.finished is distinct from r.fin or r.proven is distinct from r.prv or r.with_form is distinct from r.frm
       or r.rounds_proven is distinct from r.rnd or r.with_fix is distinct from r.fix or r.inside is distinct from r.ins
       or r.onsite_seconds is distinct from r.ons or r.workday_seconds is distinct from r.wds
       or r.workdays is distinct from r.wdn or r.staff_days is distinct from r.sdays then
      v_fail := v_fail || format('S2 %s: planned %s served %s leave %s/%s sites %s/%s finished %s proven %s forms %s rounds %s fix %s inside %s onsite %s workday %s (%s) days %s',
                                 r.nm, r.planned, r.served, r.leave_planned, r.leave_served, r.sites_reached, r.sites_planned,
                                 r.finished, r.proven, r.with_form, r.rounds_proven, r.with_fix, r.inside,
                                 r.onsite_seconds, r.workday_seconds, r.workdays, r.staff_days) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- S3 leave days
  select string_agg(day::text, ',' order by day) into v_t from public.approved_leave_days(v_today - 14, v_today + 1)
   where profile_id = v_staff;
  if v_t is distinct from (v_d1 + 2)::text || ',' || (v_d1 + 3)::text then
    v_fail := v_fail || format('S3 leave days %s', v_t) || E'\n';
  end if;
  -- A window that ends inside the leave keeps only the days in it.
  if (select count(*) from public.approved_leave_days(v_today - 14, v_d1 + 3)) <> 1 then
    v_fail := v_fail || 'S3 leave days spill past the window' || E'\n';
  end if;
  reset role;
  update public.company_modules set enabled = false where org_id = v_org and module_code = 'hr';
  set local role authenticated;
  if exists (select 1 from public.approved_leave_days(v_today - 14, v_today + 1))
     or (select leave_planned from public.staff_score_inputs(v_from, v_to) where staff_id = v_staff) <> 0 then
    v_fail := v_fail || 'S3 leave counted for a company without HR' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- S4 a field employee
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_t := '';
  begin
    perform * from public.staff_score_inputs(v_from, v_to);
    v_t := v_t || 'score inputs ';
  exception when others then null;
  end;
  begin
    perform * from public.approved_leave_days(v_today - 14, v_today + 1);
    v_t := v_t || 'leave days';
  exception when others then null;
  end;
  if v_t <> '' then
    v_fail := v_fail || format('S4 a field employee was given: %s', v_t) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- S5 isolation
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.staff_score_inputs(v_from, v_to) s where s.staff_id in (v_staff, v_owner))
     or exists (select 1 from public.approved_leave_days(v_today - 14, v_today + 1) l where l.profile_id = v_staff) then
    v_fail := v_fail || 'S5 Gold Fortune can see the trial''s people' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- S6 grants
  if has_function_privilege('anon', 'public.staff_score_inputs(timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('anon', 'public.approved_leave_days(date, date)', 'execute')
     or not has_function_privilege('authenticated', 'public.staff_score_inputs(timestamptz, timestamptz, uuid)', 'execute')
     -- staff_score_inputs (invoker) calls it as the signed-in user.
     or not has_function_privilege('authenticated', 'public.approved_leave_days(date, date)', 'execute') then
    v_fail := v_fail || 'S6 a score function has the wrong grants' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where kind = 'function' and name in ('staff_score_inputs', 'approved_leave_days') and module_code = 'reports') <> 2 then
    v_fail := v_fail || 'S6 the score functions are not registered under reports' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'SCORE FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL SCORE CHECKS PASSED (rolled back)';
end;
$$;
