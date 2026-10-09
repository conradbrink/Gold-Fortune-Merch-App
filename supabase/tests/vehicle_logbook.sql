-- Vehicle logbook suite (Stage 8 Part 6).
--
--   V1  The module: built, so it can be switched on; on for nobody by
--       default (Gold Fortune and a new cleaning company do not have it).
--   V2  Module off: the logbook is refused and the tables read nothing.
--   V3  Writing, as the trial's owner: vehicles and vehicle days through RLS;
--       a person from another company, a second row for the same vehicle,
--       person and day, and a closing odometer below the opening are refused.
--   V4  The logbook: two vehicles, three vehicle days in the period and one
--       outside it; a day with two finished, measured workdays (km summed,
--       first in, last out), a day whose workday is not measured yet (no km),
--       a day with no workday. Every row exact, and the vehicle filter.
--   V5  A field employee: refused the logbook and the writes; reads the
--       vehicles and only their own vehicle days.
--   V6  Companies cannot see each other's vehicles, days or logbook rows.
--   V7  Grants, gates and module registration.
--
-- HOW TO RUN: as reports.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_viewer uuid;
  v_tz text; v_today date; v_d1 date; v_d2 date; v_old date; v_from timestamptz; v_to timestamptz;
  v_car1 uuid; v_car2 uuid; v_day1 uuid; v_day2 uuid; v_day3 uuid; v_day_old uuid;
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
  -- Someone at Gold Fortune who may read reports, for V6.
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
    jsonb_build_object('name', 'Logbook check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Logbook Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Logbook Staff', v_staff_email);
  v_tz := public.org_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_d1 := v_today - 10;
  v_d2 := v_today - 9;
  v_old := v_today - 20;
  v_from := (v_today - 14)::timestamp at time zone v_tz;
  v_to := (v_today + 1)::timestamp at time zone v_tz;

  ---------------------------------------------------------------- V1 the module
  if not (select is_built from public.modules where code = 'vehicle_logbook') then
    v_fail := v_fail || 'V1 vehicle_logbook is not built, so no company can switch it on' || E'\n';
  end if;
  if exists (select 1 from public.company_modules
              where org_id in (c_gf, v_org) and module_code = 'vehicle_logbook' and enabled) then
    v_fail := v_fail || 'V1 Gold Fortune or a new cleaning company has the logbook switched on' || E'\n';
  end if;

  -- Day 1: two finished, measured workdays, 08:00 to 12:00 (20 km) and 13:00
  -- to 15:00 (5.5 km). Day 2: a finished workday the nightly job has not
  -- measured yet. The owner never starts a workday.
  insert into public.workday_sessions (org_id, rep_id, started_at, ended_at, duration_seconds, road_distance_meters, client_generated_id)
  values (v_org, v_staff, (v_d1::timestamp + interval '8 hours') at time zone v_tz,
          (v_d1::timestamp + interval '12 hours') at time zone v_tz, 14400, 20000, gen_random_uuid()),
         (v_org, v_staff, (v_d1::timestamp + interval '13 hours') at time zone v_tz,
          (v_d1::timestamp + interval '15 hours') at time zone v_tz, 7200, 5500, gen_random_uuid()),
         (v_org, v_staff, (v_d2::timestamp + interval '7 hours') at time zone v_tz,
          (v_d2::timestamp + interval '16 hours') at time zone v_tz, 32400, null, gen_random_uuid());

  ---------------------------------------------------------------- V2 module off
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_t := null;
  begin
    perform * from public.vehicle_logbook(v_from, v_to);
    v_t := 'ran';
  exception when others then
    if sqlstate <> '42501' or sqlerrm not like '%not enabled for your company''s plan' then
      v_t := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  if v_t is not null then
    v_fail := v_fail || format('V2 module off: the logbook was not refused for the plan (%s)', v_t) || E'\n';
  end if;
  begin
    insert into public.logbook_vehicles (org_id, name, registration) values (v_org, 'Not yet', 'NOPE 1');
    v_fail := v_fail || 'V2 module off: a vehicle was added' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  insert into public.company_modules (org_id, module_code, enabled) values (v_org, 'vehicle_logbook', true);

  ---------------------------------------------------------------- V3 writing
  set local role authenticated;
  insert into public.logbook_vehicles (org_id, name, registration, notes)
  values (v_org, 'Logbook bakkie', 'ND 123 GP', 'Toyota Hilux') returning id into v_car1;
  insert into public.logbook_vehicles (org_id, name, registration)
  values (v_org, 'Logbook sedan', 'CA 456') returning id into v_car2;
  insert into public.vehicle_days (org_id, vehicle_id, profile_id, day, purpose, odometer_start, odometer_end)
  values (v_org, v_car1, v_staff, v_d1, 'business', 1000, 1026) returning id into v_day1;
  insert into public.vehicle_days (org_id, vehicle_id, profile_id, day, purpose, notes)
  values (v_org, v_car1, v_staff, v_d2, 'private', 'Weekend move') returning id into v_day2;
  insert into public.vehicle_days (org_id, vehicle_id, profile_id, day)
  values (v_org, v_car2, v_owner, v_d1) returning id into v_day3;
  insert into public.vehicle_days (org_id, vehicle_id, profile_id, day)
  values (v_org, v_car2, v_owner, v_old) returning id into v_day_old;
  if (select created_by from public.vehicle_days where id = v_day1) is distinct from v_owner then
    v_fail := v_fail || 'V3 a vehicle day does not record who wrote it' || E'\n';
  end if;
  v_t := '';
  begin
    insert into public.vehicle_days (org_id, vehicle_id, profile_id, day) values (v_org, v_car1, v_gf_viewer, v_d1);
    v_t := v_t || 'a person from another company; ';
  exception when others then null;
  end;
  begin
    insert into public.vehicle_days (org_id, vehicle_id, profile_id, day) values (v_org, v_car1, v_staff, v_d1);
    v_t := v_t || 'a second row for the same vehicle, person and day; ';
  exception when unique_violation then null;
  end;
  begin
    insert into public.vehicle_days (org_id, vehicle_id, profile_id, day, odometer_start, odometer_end)
    values (v_org, v_car2, v_staff, v_d2, 500, 400);
    v_t := v_t || 'a closing odometer below the opening; ';
  exception when check_violation then null;
  end;
  begin
    insert into public.logbook_vehicles (org_id, name, registration) values (v_org, 'Same car', 'nd 123 gp ');
    v_t := v_t || 'the same registration twice; ';
  exception when unique_violation then null;
  end;
  if v_t <> '' then
    v_fail := v_fail || format('V3 accepted: %s', v_t) || E'\n';
  end if;

  ---------------------------------------------------------------- V4 the logbook
  select count(*) into v_n from public.vehicle_logbook(v_from, v_to);
  if v_n <> 3 then
    v_fail := v_fail || format('V4 %s rows, expected 3 (the day outside the period left out)', v_n) || E'\n';
  end if;
  for r in
    select e.*, l.vehicle_day_id, l.vehicle_id as got_vehicle, l.vehicle_name, l.registration, l.day,
           l.driver_id, l.driver_name, l.purpose, l.km, l.odometer_start, l.odometer_end,
           l.first_in, l.last_out, l.notes
      from (values
              (1, v_day1, v_car1, 'Logbook bakkie', 'ND 123 GP', v_d1, v_staff, 'Logbook Staff', 'business', 25.5,
               1000, 1026, (v_d1::timestamp + interval '8 hours') at time zone v_tz,
               (v_d1::timestamp + interval '15 hours') at time zone v_tz, null::text),
              (2, v_day3, v_car2, 'Logbook sedan', 'CA 456', v_d1, v_owner, 'Logbook Owner', 'business', null::numeric,
               null::int, null::int, null::timestamptz, null::timestamptz, null::text),
              (3, v_day2, v_car1, 'Logbook bakkie', 'ND 123 GP', v_d2, v_staff, 'Logbook Staff', 'private', null::numeric,
               null::int, null::int, (v_d2::timestamp + interval '7 hours') at time zone v_tz,
               (v_d2::timestamp + interval '16 hours') at time zone v_tz, 'Weekend move'))
           as e(n, id_, car, name_, reg, day_, driver, driver_name_, purpose_, km_, odo_s, odo_e, in_, out_, notes_)
      left join lateral (select row_number() over () as n, x.* from public.vehicle_logbook(v_from, v_to) x) l on l.n = e.n
  loop
    if r.vehicle_day_id is distinct from r.id_ or r.got_vehicle is distinct from r.car
       or r.vehicle_name is distinct from r.name_ or r.registration is distinct from r.reg
       or r.day is distinct from r.day_ or r.driver_id is distinct from r.driver
       or r.driver_name is distinct from r.driver_name_ or r.purpose is distinct from r.purpose_
       or r.km is distinct from r.km_ or r.odometer_start is distinct from r.odo_s
       or r.odometer_end is distinct from r.odo_e or r.first_in is distinct from r.in_
       or r.last_out is distinct from r.out_ or r.notes is distinct from r.notes_ then
      v_fail := v_fail || format('V4 row %s: %s %s %s %s %s, %s km, odometer %s to %s, %s to %s, %s',
                                 r.n, r.vehicle_name, r.registration, r.day, r.driver_name, r.purpose, r.km,
                                 r.odometer_start, r.odometer_end, r.first_in, r.last_out, r.notes) || E'\n';
    end if;
  end loop;
  if (select count(*) from public.vehicle_logbook(v_from, v_to, v_car2)) <> 1
     or exists (select 1 from public.vehicle_logbook(v_from, v_to, v_car2) x where x.vehicle_id <> v_car2) then
    v_fail := v_fail || 'V4 the vehicle filter did not give the sedan''s one row' || E'\n';
  end if;
  if not exists (select 1 from public.vehicle_logbook(v_old::timestamp at time zone v_tz, v_from) x
                  where x.vehicle_day_id = v_day_old) then
    v_fail := v_fail || 'V4 an earlier period does not show its own day' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- V2 again: off hides the rows
  update public.company_modules set enabled = false where org_id = v_org and module_code = 'vehicle_logbook';
  set local role authenticated;
  if exists (select 1 from public.logbook_vehicles) or exists (select 1 from public.vehicle_days) then
    v_fail := v_fail || 'V2 module off: vehicles or vehicle days are still readable' || E'\n';
  end if;
  reset role;
  update public.company_modules set enabled = true where org_id = v_org and module_code = 'vehicle_logbook';

  ---------------------------------------------------------------- V5 a field employee
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_t := '';
  begin
    perform * from public.vehicle_logbook(v_from, v_to);
    v_t := v_t || 'the logbook; ';
  exception when others then null;
  end;
  begin
    insert into public.logbook_vehicles (org_id, name, registration) values (v_org, 'Mine now', 'MINE 1');
    v_t := v_t || 'adding a vehicle; ';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.vehicle_days (org_id, vehicle_id, profile_id, day) values (v_org, v_car2, v_staff, v_today);
    v_t := v_t || 'assigning a vehicle; ';
  exception when insufficient_privilege then null;
  end;
  update public.logbook_vehicles set name = 'Renamed' where id = v_car1;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_t := v_t || 'renaming a vehicle; '; end if;
  delete from public.vehicle_days where id = v_day1;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_t := v_t || 'removing a vehicle day; '; end if;
  if v_t <> '' then
    v_fail := v_fail || format('V5 a field employee was given: %s', v_t) || E'\n';
  end if;
  if (select count(*) from public.logbook_vehicles) <> 2 then
    v_fail := v_fail || 'V5 a field employee cannot read the company''s two vehicles' || E'\n';
  end if;
  if (select array_agg(id order by id) from public.vehicle_days)
       is distinct from (select array_agg(x order by x) from unnest(array[v_day1, v_day2]) x) then
    v_fail := v_fail || 'V5 a field employee does not read exactly their own vehicle days' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- V6 isolation
  -- Gold Fortune given the module inside this transaction, so its logbook
  -- answers and the isolation is what hides the trial's rows.
  insert into public.company_modules (org_id, module_code, enabled) values (c_gf, 'vehicle_logbook', true)
  on conflict (org_id, module_code) do update set enabled = true;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.logbook_vehicles where id in (v_car1, v_car2))
     or exists (select 1 from public.vehicle_days where org_id = v_org)
     or exists (select 1 from public.vehicle_logbook(v_from, v_to) x where x.vehicle_day_id in (v_day1, v_day2, v_day3))
     or exists (select 1 from public.vehicle_logbook(v_from, v_to, v_car1)) then
    v_fail := v_fail || 'V6 Gold Fortune can see the trial''s vehicles, days or logbook' || E'\n';
  end if;
  v_t := '';
  begin
    insert into public.vehicle_days (org_id, vehicle_id, profile_id, day) values (v_org, v_car1, v_staff, v_today);
    v_t := v_t || 'a day in the trial''s logbook; ';
  exception when others then null;
  end;
  begin
    insert into public.logbook_vehicles (org_id, name, registration) values (v_org, 'Planted', 'PLANT 1');
    v_t := v_t || 'a vehicle in the trial''s list; ';
  exception when others then null;
  end;
  update public.logbook_vehicles set active = false where id = v_car1;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_t := v_t || 'switching off the trial''s vehicle; '; end if;
  if v_t <> '' then
    v_fail := v_fail || format('V6 Gold Fortune could write: %s', v_t) || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- V7 grants and gates
  if has_function_privilege('anon', 'public.vehicle_logbook(timestamptz, timestamptz, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.vehicle_logbook(timestamptz, timestamptz, uuid)', 'execute') then
    v_fail := v_fail || 'V7 the logbook function has the wrong grants' || E'\n';
  end if;
  if has_table_privilege('anon', 'public.logbook_vehicles', 'select')
     or has_table_privilege('anon', 'public.vehicle_days', 'select')
     or has_table_privilege('authenticated', 'public.logbook_vehicles', 'delete')
     or has_column_privilege('authenticated', 'public.vehicle_days', 'created_by', 'insert')
     or has_column_privilege('authenticated', 'public.vehicle_days', 'created_by', 'update')
     or has_column_privilege('authenticated', 'public.logbook_vehicles', 'org_id', 'update') then
    v_fail := v_fail || 'V7 a table grant is wider than it should be' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where module_code = 'vehicle_logbook'
         and (kind, name) in (('table', 'logbook_vehicles'), ('table', 'vehicle_days'),
                              ('function', 'vehicle_logbook'))) <> 3 then
    v_fail := v_fail || 'V7 the logbook tables and function are not registered under vehicle_logbook' || E'\n';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename in ('logbook_vehicles', 'vehicle_days')
         and policyname = 'module_gate' and permissive = 'RESTRICTIVE') <> 2 then
    v_fail := v_fail || 'V7 a logbook table has no restrictive module_gate' || E'\n';
  end if;
  if (select prosrc from pg_proc where oid = 'public.vehicle_logbook(timestamptz, timestamptz, uuid)'::regprocedure)
       not like '%require_module(''vehicle_logbook'')%require_permission(''insights'')%' then
    v_fail := v_fail || 'V7 the logbook does not check the module, then insights, first' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'VEHICLE LOGBOOK FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL VEHICLE LOGBOOK CHECKS PASSED (rolled back)';
end;
$$;
