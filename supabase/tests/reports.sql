-- Reports suite (Stage 7 Part 4a).
--
--   R1  Settings: a new cleaning company gets its trade's report tabs and
--       short-day mark; Gold Fortune keeps today's eight tabs and no marks.
--   R2  Proof of service: a hand-made cleaning fortnight (planned and
--       unscheduled jobs, inside and outside the radius, no fix, photos,
--       checklists, an unfinished job). Every row exact, the place filter, the
--       gap between rounds.
--   R3  Hours: a finished workday, a day with jobs and no workday, a workday
--       still open. Every row exact.
--   R4  A field employee is refused both reports.
--   R5  Companies cannot see each other's rows.
--   R6  Grants and module registration.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_viewer uuid;
  v_tz text; v_today date; v_d1 date; v_d2 date; v_from timestamptz; v_to timestamptz;
  v_s1 uuid; v_s2 uuid; v_form uuid; v_r1 uuid; v_r2 uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_open uuid;
  v_n int; v_t text;
  r record;
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
  -- Someone at Gold Fortune who may read reports, for R5.
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
    jsonb_build_object('name', 'Reports check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Report Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Report Staff', v_staff_email);
  v_tz := public.org_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_d1 := v_today - 10;
  v_d2 := v_today - 9;
  v_from := (v_today - 14)::timestamp at time zone v_tz;
  v_to := (v_today + 1)::timestamp at time zone v_tz;

  ---------------------------------------------------------------- R1 settings
  for r in select * from (values ('report_tabs'), ('report_short_day_hours'), ('report_long_day_hours')) x(k) loop
    if (select value from public.company_settings where org_id = v_org and key = r.k)
         is distinct from coalesce((select value from public.template_settings
                                     where template_code = 'cleaning' and setting_key = r.k),
                                   (select default_value from public.setting_definitions where key = r.k)) then
      v_fail := v_fail || format('R1 a new cleaning company did not get its trade''s %s', r.k) || E'\n';
    end if;
  end loop;
  if (select value #>> '{}' from public.company_settings where org_id = v_org and key = 'report_tabs')
       is distinct from 'service_log,adherence,hours,reps,form,photos,coverage'
     or (select value from public.company_settings where org_id = v_org and key = 'report_short_day_hours') <> '6'::jsonb then
    v_fail := v_fail || 'R1 the cleaning tabs or short day are not the research''s' || E'\n';
  end if;
  if (select value #>> '{}' from public.company_settings where org_id = c_gf and key = 'report_tabs')
       is distinct from 'score,oos,coverage,adherence,reps,trends,form,photos'
     or (select value from public.company_settings where org_id = c_gf and key = 'report_short_day_hours') <> '0'::jsonb
     or (select value from public.company_settings where org_id = c_gf and key = 'report_long_day_hours') <> '0'::jsonb then
    v_fail := v_fail || 'R1 Gold Fortune''s report settings are not today''s' || E'\n';
  end if;
  if (select value from public.template_settings where template_code = 'security' and setting_key = 'report_long_day_hours')
       is distinct from '12'::jsonb then
    v_fail := v_fail || 'R1 security''s long shift is not 12 hours' || E'\n';
  end if;

  ---------------------------------------------------------------- fixtures
  insert into public.stores (org_id, name, address, city) values (v_org, 'Report site one', '1 Main Rd', 'Durban')
    returning id into v_s1;
  insert into public.stores (org_id, name) values (v_org, 'Report site two') returning id into v_s2;
  select id into v_form from public.form_templates where org_id = v_org and active order by created_at limit 1;
  insert into public.routes (org_id, rep_id, store_id, scheduled_date, source)
    values (v_org, v_staff, v_s1, v_d1, 'manual') returning id into v_r1;
  insert into public.routes (org_id, rep_id, store_id, scheduled_date, source)
    values (v_org, v_staff, v_s2, v_d2, 'manual') returning id into v_r2;
  -- Day 1, site one: the planned round at 09:00 on site; an unscheduled one
  -- at 13:00, 500 m away. Day 2, site two: planned, 45 minutes, no fix.
  insert into public.visits (org_id, route_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_r1, v_staff, v_s1, 'checked_out', (v_d1::timestamp + interval '9 hours') at time zone v_tz,
          (v_d1::timestamp + interval '9 hours 30 minutes') at time zone v_tz, 1800, 20, gen_random_uuid())
  returning id into v_v1;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', (v_d1::timestamp + interval '13 hours') at time zone v_tz,
          (v_d1::timestamp + interval '13 hours 30 minutes') at time zone v_tz, 1800, 500, gen_random_uuid())
  returning id into v_v2;
  insert into public.visits (org_id, route_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_r2, v_staff, v_s2, 'checked_out', (v_d2::timestamp + interval '9 hours') at time zone v_tz,
          (v_d2::timestamp + interval '9 hours 45 minutes') at time zone v_tz, 2700, null, gen_random_uuid())
  returning id into v_v3;
  -- Not finished: not proof of anything yet.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_staff, v_s2, 'checked_in', now() - interval '1 minute', 10, gen_random_uuid())
  returning id into v_open;
  insert into public.photos (org_id, visit_id, rep_id, storage_path, client_generated_id)
  select v_org, x.visit_id, v_staff, 'report/' || gen_random_uuid() || '.jpg', gen_random_uuid()
    from (values (v_v1), (v_v3), (v_v3)) as x(visit_id);
  insert into public.form_submissions (org_id, visit_id, form_template_id, rep_id, client_generated_id)
  values (v_org, v_v1, v_form, v_staff, gen_random_uuid());
  -- Day 1: a finished 4-hour workday, 20 km by road. Day 2: jobs, no
  -- workday. Today: a workday still open.
  insert into public.workday_sessions (org_id, rep_id, started_at, ended_at, duration_seconds, road_distance_meters, client_generated_id)
  values (v_org, v_staff, (v_d1::timestamp + interval '8 hours') at time zone v_tz,
          (v_d1::timestamp + interval '12 hours') at time zone v_tz, 14400, 20000, gen_random_uuid()),
         (v_org, v_staff, now() - interval '1 minute', null, null, null, gen_random_uuid());

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- R2 proof of service
  select count(*) into v_n from public.service_log(v_from, v_to);
  if v_n <> 3 then
    v_fail := v_fail || format('R2 %s rows, expected 3 (the unfinished job left out)', v_n) || E'\n';
  end if;
  for r in
    select e.*, s.visit_id as got_id, s.store_name, s.store_address, s.day, s.staff_name, s.minutes,
           s.on_site, s.forms, s.photos, s.planned, s.gap_minutes
      from (values (1, v_v1, 'Report site one', '1 Main Rd, Durban', v_d1, 30, true, 1, 1, true, null::int),
                   (2, v_v2, 'Report site one', '1 Main Rd, Durban', v_d1, 30, false, 0, 0, false, 240),
                   (3, v_v3, 'Report site two', null, v_d2, 45, null, 0, 2, true, null::int))
           as e(n, id, name, address, day_, mins, onsite, forms_, photos_, planned_, gap)
      left join lateral (select row_number() over () as n, x.* from public.service_log(v_from, v_to) x) s on s.n = e.n
  loop
    if r.got_id is distinct from r.id or r.store_name is distinct from r.name
       or r.store_address is distinct from r.address or r.day is distinct from r.day_
       or r.staff_name is distinct from 'Report Staff' or r.minutes is distinct from r.mins
       or r.on_site is distinct from r.onsite or r.forms is distinct from r.forms_
       or r.photos is distinct from r.photos_ or r.planned is distinct from r.planned_
       or r.gap_minutes is distinct from r.gap then
      v_fail := v_fail || format('R2 row %s: %s %s %s %s min, on site %s, forms %s, photos %s, planned %s, gap %s',
                                 r.n, r.store_name, r.store_address, r.day, r.minutes, r.on_site, r.forms,
                                 r.photos, r.planned, r.gap_minutes) || E'\n';
    end if;
  end loop;
  if (select count(*) from public.service_log(v_from, v_to, v_s1)) <> 2
     or exists (select 1 from public.service_log(v_from, v_to, v_s1) x where x.store_id <> v_s1) then
    v_fail := v_fail || 'R2 the place filter did not give site one''s two rows' || E'\n';
  end if;

  ---------------------------------------------------------------- R3 hours
  select count(*) into v_n from public.staff_hours(v_from, v_to);
  if v_n <> 3 then
    v_fail := v_fail || format('R3 %s days, expected 3', v_n) || E'\n';
  end if;
  for r in
    select e.*, h.staff_id, h.staff_name, h.first_in, h.last_out, h.open_now, h.workday_seconds,
           h.onsite_seconds, h.jobs, h.km
      from (values (v_d1, (v_d1::timestamp + interval '8 hours') at time zone v_tz,
                    (v_d1::timestamp + interval '12 hours') at time zone v_tz, false, 14400, 3600, 2, 20.0),
                   (v_d2, null::timestamptz, null::timestamptz, false, 0, 2700, 1, null::numeric),
                   (v_today, null::timestamptz, null::timestamptz, true, 0, 0, 0, null::numeric))
           as e(day_, in_, out_, open_, wd, onsite, jobs_, km_)
      left join public.staff_hours(v_from, v_to) h on h.day = e.day_
  loop
    if r.staff_id is distinct from v_staff or r.staff_name is distinct from 'Report Staff'
       or (r.in_ is not null and r.first_in is distinct from r.in_)
       or (r.day_ = v_d2 and r.first_in is not null)
       or r.last_out is distinct from r.out_ or r.open_now is distinct from r.open_
       or r.workday_seconds is distinct from r.wd or r.onsite_seconds is distinct from r.onsite
       or r.jobs is distinct from r.jobs_ or r.km is distinct from r.km_ then
      v_fail := v_fail || format('R3 %s: in %s out %s open %s, workday %s s, on site %s s, %s jobs, %s km',
                                 r.day_, r.first_in, r.last_out, r.open_now, r.workday_seconds,
                                 r.onsite_seconds, r.jobs, r.km) || E'\n';
    end if;
  end loop;
  reset role;

  ---------------------------------------------------------------- R4 a field employee
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_t := '';
  begin
    perform * from public.service_log(v_from, v_to);
    v_t := v_t || 'proof of service ';
  exception when others then null;
  end;
  begin
    perform * from public.staff_hours(v_from, v_to);
    v_t := v_t || 'hours';
  exception when others then null;
  end;
  if v_t <> '' then
    v_fail := v_fail || format('R4 a field employee was given: %s', v_t) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- R5 isolation
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.service_log(v_from, v_to) x where x.visit_id in (v_v1, v_v2, v_v3))
     or exists (select 1 from public.service_log(v_from, v_to, v_s1))
     or exists (select 1 from public.staff_hours(v_from, v_to) h where h.staff_id = v_staff) then
    v_fail := v_fail || 'R5 Gold Fortune can see the trial''s proof of service or hours' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- R6 grants
  if has_function_privilege('anon', 'public.service_log(timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('anon', 'public.staff_hours(timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.service_log(timestamptz, timestamptz, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.staff_hours(timestamptz, timestamptz)', 'execute') then
    v_fail := v_fail || 'R6 a report function has the wrong grants' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where kind = 'function' and name in ('service_log', 'staff_hours') and module_code = 'reports') <> 2 then
    v_fail := v_fail || 'R6 the report functions are not registered under reports' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'REPORTS FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL REPORTS CHECKS PASSED (rolled back)';
end;
$$;
