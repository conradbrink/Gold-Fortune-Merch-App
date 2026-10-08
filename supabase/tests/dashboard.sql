-- Dashboard numbers suite (Stage 7 Part 3).
--
--   D1  Settings: a new cleaning company gets its trade's numbers and cards;
--       Gold Fortune keeps today's dashboard (distribution layout).
--   D2  A hand-made fortnight for a cleaning trial: planned, done, missed,
--       an unscheduled job, photos, checklists, GPS inside and outside the
--       radius, two workdays with road distance. Every number exact.
--   D3  Money: an invoice, a payment, three quotes (won, lost, waiting).
--   D4  The previous window is empty; numbers about now carry no previous.
--   D5  A field employee gets no money numbers.
--   D6  Quotes: sent and decided are the database's to stamp.
--   D7  The trend's days are the company's days.
--   D8  Grants and module registration.
--
-- HOW TO RUN: as trial_onboarding.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_admin uuid;
  v_tz text; v_today date; v_from timestamptz; v_to timestamptz;
  v_s1 uuid; v_s2 uuid; v_form uuid;
  v_r uuid[] := '{}'; v_rid uuid; v_v uuid[] := '{}'; v_vid uuid; v_u1 uuid;
  v_q1 uuid; v_q2 uuid; v_q3 uuid; v_inv uuid;
  v_j jsonb; v_t text; i int;
  -- Expected: code -> value, and the events it rests on.
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
  delete from public.profiles where id in (v_owner, v_staff);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Dashboard check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Dash Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Dash Staff', v_staff_email);
  v_tz := public.org_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_from := (v_today - 14)::timestamp at time zone v_tz;
  v_to := (v_today + 1)::timestamp at time zone v_tz;

  ---------------------------------------------------------------- D1 settings
  if (select value #>> '{}' from public.company_settings where org_id = v_org and key = 'dashboard_layout')
       is distinct from (select value #>> '{}' from public.template_settings
                          where template_code = 'cleaning' and setting_key = 'dashboard_layout')
     or (select value #>> '{}' from public.company_settings where org_id = v_org and key = 'dashboard_cards')
       is distinct from (select value #>> '{}' from public.template_settings
                          where template_code = 'cleaning' and setting_key = 'dashboard_cards') then
    v_fail := v_fail || 'D1 a new cleaning company did not get its trade''s dashboard' || E'\n';
  end if;
  if coalesce((select value #>> '{}' from public.company_settings where org_id = c_gf and key = 'dashboard_layout'),
              (select default_value #>> '{}' from public.setting_definitions where key = 'dashboard_layout'))
       is distinct from 'headline,sales,pipeline,field_team,store_health,live_reps' then
    v_fail := v_fail || 'D1 Gold Fortune''s dashboard layout changed' || E'\n';
  end if;

  ---------------------------------------------------------------- D2 fixtures
  insert into public.stores (org_id, name) values (v_org, 'Dash site one') returning id into v_s1;
  insert into public.stores (org_id, name) values (v_org, 'Dash site two') returning id into v_s2;
  select id into v_form from public.form_templates where org_id = v_org and active order by created_at limit 1;
  -- Six planned jobs, 10 to 5 days ago; the first four done on the day.
  for i in 1..6 loop
    insert into public.routes (org_id, rep_id, store_id, scheduled_date, source)
    values (v_org, v_staff, case when i % 2 = 1 then v_s1 else v_s2 end, v_today - 11 + i, 'manual')
    returning id into v_rid;
    v_r := v_r || v_rid;
  end loop;
  -- The first was logged at 06:00 that morning: three hours to on site.
  update public.routes set created_at = ((v_today - 10)::timestamp + interval '6 hours') at time zone v_tz where id = v_r[1];
  for i in 1..4 loop
    insert into public.visits (org_id, route_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                               checkin_distance_from_store_m, client_generated_id)
    values (v_org, v_r[i], v_staff, case when i % 2 = 1 then v_s1 else v_s2 end, 'checked_out',
            ((v_today - 11 + i)::timestamp + interval '9 hours') at time zone v_tz,
            ((v_today - 11 + i)::timestamp + interval '9 hours 30 minutes') at time zone v_tz, 1800,
            case when i = 4 then 500 else 20 end, gen_random_uuid())
    returning id into v_vid;
    v_v := v_v || v_vid;
  end loop;
  -- An unscheduled job at site one, the afternoon of the first day.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out',
          ((v_today - 10)::timestamp + interval '13 hours') at time zone v_tz,
          ((v_today - 10)::timestamp + interval '13 hours 30 minutes') at time zone v_tz, 1800, 10, gen_random_uuid())
  returning id into v_u1;
  -- Photos: 1, 2, 1, 0 on the planned jobs, 1 on the unscheduled one.
  insert into public.photos (org_id, visit_id, rep_id, storage_path, client_generated_id)
  select v_org, x.visit_id, v_staff, 'dash/' || gen_random_uuid() || '.jpg', gen_random_uuid()
    from (values (v_v[1]), (v_v[2]), (v_v[2]), (v_v[3]), (v_u1)) as x(visit_id);
  -- Checklists on the first two planned jobs and the unscheduled one.
  insert into public.form_submissions (org_id, visit_id, form_template_id, rep_id, client_generated_id)
  select v_org, x.visit_id, v_form, v_staff, gen_random_uuid()
    from (values (v_v[1]), (v_v[2]), (v_u1)) as x(visit_id);
  -- Two finished workdays: 4 and 6 hours, 20 and 30 km by road.
  insert into public.workday_sessions (org_id, rep_id, started_at, ended_at, duration_seconds, road_distance_meters, client_generated_id)
  values (v_org, v_staff, ((v_today - 10)::timestamp + interval '8 hours') at time zone v_tz,
          ((v_today - 10)::timestamp + interval '12 hours') at time zone v_tz, 14400, 20000, gen_random_uuid()),
         (v_org, v_staff, ((v_today - 9)::timestamp + interval '8 hours') at time zone v_tz,
          ((v_today - 9)::timestamp + interval '14 hours') at time zone v_tz, 21600, 30000, gen_random_uuid());

  ---------------------------------------------------------------- D3 money
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_inv := public.invoice_direct(jsonb_build_object('name', 'Dash client'),
             jsonb_build_array(jsonb_build_object('description', 'Monthly clean', 'qty', 1, 'unit_price', 1000)));
  perform public.invoice_payment_record(v_inv, 500, v_today, 'eft', 'DASH');
  insert into public.quotes (org_id, quote_number, customer_name, status)
    values (v_org, public.next_document_number(v_org, 'quote', 'QT'), 'Won client', 'draft') returning id into v_q1;
  insert into public.quotes (org_id, quote_number, customer_name, status)
    values (v_org, public.next_document_number(v_org, 'quote', 'QT'), 'Lost client', 'draft') returning id into v_q2;
  insert into public.quotes (org_id, quote_number, customer_name, status)
    values (v_org, public.next_document_number(v_org, 'quote', 'QT'), 'Waiting client', 'draft') returning id into v_q3;
  insert into public.quote_lines (org_id, quote_id, description, qty, list_price)
  values (v_org, v_q1, 'Deep clean', 1, 1000),
         (v_org, v_q2, 'Windows', 1, 500),
         (v_org, v_q3, 'Carpets', 1, 300);
  update public.quotes set status = 'sent' where id in (v_q1, v_q2, v_q3);
  update public.quotes set status = 'accepted' where id = v_q1;
  update public.quotes set status = 'declined' where id = v_q2;

  v_j := public.dashboard_kpis(v_from, v_to, null);
  for r in
    select * from (values
      ('jobs_done_pct', 0.6667::numeric, 6), ('missed', 2, 6), ('jobs_done', 5, 5),
      ('proof_pct', 0.6, 5), ('gps_verified_pct', 0.8, 5), ('rounds_proven_pct', 0.8, 5),
      ('planned_share', 0.8, 5), ('time_on_site', 30.0, 5), ('photos_taken', 5, 5), ('forms_done', 3, 3),
      ('jobs_per_staff_day', 1.3, 4), ('longest_gap', 240, 1), ('response_hours', 3.0, 1),
      ('hours_worked', 10.0, 2), ('km', 50.0, 2), ('km_per_job', 10.0, 2), ('jobs_per_hour', 0.5, 2),
      ('onsite_share', 0.25, 2),
      ('invoiced', 1150, 1), ('avg_invoice', 1150, 1), ('received', 500, 1),
      ('owed', 650, 1), ('overdue', 0, 0), ('unbilled_jobs', 5, 5),
      ('quote_win_rate', 0.5, 2), ('quote_win_value', 0.6667, 2),
      ('quotes_waiting_value', 300, 1), ('accepted_not_invoiced', 1000, 1),
      ('jobs_today', 0, 0), ('upcoming_7d', 0, 0)
    ) as e(code, value, events)
  loop
    if (v_j -> r.code ->> 'value')::numeric is distinct from r.value
       or (v_j -> r.code ->> 'events')::int is distinct from r.events then
      v_fail := v_fail || format('D2/D3 %s is %s (%s events), expected %s (%s)',
                                 r.code, v_j -> r.code ->> 'value', v_j -> r.code ->> 'events', r.value, r.events) || E'\n';
    end if;
  end loop;
  if (v_j -> 'hours_worked' ->> 'extra')::int is distinct from 0
     or (v_j -> 'owed' ->> 'extra')::numeric is distinct from 0
     or (v_j -> 'quotes_waiting_value' ->> 'extra')::int is distinct from 0 then
    v_fail := v_fail || format('D3 extras: long shifts %s, overdue part %s, oldest waiting %s days',
                               v_j -> 'hours_worked' ->> 'extra', v_j -> 'owed' ->> 'extra',
                               v_j -> 'quotes_waiting_value' ->> 'extra') || E'\n';
  end if;
  if v_j -> 'first_week' is distinct from '{"sites": 1, "proven": 1, "invoices": 1, "workdays": 1}'::jsonb then
    v_fail := v_fail || format('D2 first week %s', v_j -> 'first_week') || E'\n';
  end if;
  -- Only what was asked for.
  if (select count(*) from jsonb_object_keys(public.dashboard_kpis(v_from, v_to, array['missed', 'owed', 'nonsense']))) <> 2 then
    v_fail := v_fail || 'D2 asking for two numbers did not return exactly those two' || E'\n';
  end if;

  ---------------------------------------------------------------- D4 previous
  if (v_j -> 'jobs_done' ->> 'previous')::int is distinct from 0
     or v_j -> 'jobs_done_pct' -> 'previous' is distinct from 'null'::jsonb
     or (v_j -> 'invoiced' ->> 'previous')::numeric is distinct from 0
     or v_j -> 'owed' ? 'previous' or v_j -> 'jobs_today' ? 'previous' then
    v_fail := v_fail || format('D4 previous values: jobs %s, done %% %s, invoiced %s, owed has previous %s',
                               v_j -> 'jobs_done' -> 'previous', v_j -> 'jobs_done_pct' -> 'previous',
                               v_j -> 'invoiced' -> 'previous', v_j -> 'owed' ? 'previous') || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- D5 a field employee
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.dashboard_kpis(v_from, v_to, null);
  select string_agg(k, ',' order by k) into v_t from jsonb_object_keys(v_j) k
   where k in ('owed', 'overdue', 'invoiced', 'avg_invoice', 'received', 'unbilled_jobs', 'quote_win_rate',
               'quote_win_value', 'quotes_waiting_value', 'accepted_not_invoiced');
  if v_t is not null or v_j -> 'first_week' ->> 'invoices' is not null then
    v_fail := v_fail || format('D5 a field employee sees money numbers: %s', v_t) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- D6 quote stamps
  if (select count(*) from public.quotes where id in (v_q1, v_q2, v_q3) and sent_at is not null) <> 3
     or (select count(*) from public.quotes where id in (v_q1, v_q2) and decided_at is not null) <> 2
     or (select decided_at from public.quotes where id = v_q3) is not null then
    v_fail := v_fail || 'D6 the quotes were not stamped sent and decided' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.quotes set decided_at = '2020-01-01', sent_at = '2020-01-01' where id = v_q1;
  exception when insufficient_privilege then null;
  end;
  reset role;
  if (select decided_at from public.quotes where id = v_q1) < now() - interval '1 day'
     or (select sent_at from public.quotes where id = v_q1) < now() - interval '1 day' then
    v_fail := v_fail || 'D6 a quote''s sent or decided date was set by hand' || E'\n';
  end if;

  ---------------------------------------------------------------- D7 company days
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.dashboard_summary(v_from, v_to);
  if v_j -> 'series' -> 0 ->> 'day' is distinct from to_char(v_today - 14, 'YYYY-MM-DD')
     or v_j -> 'series' -> -1 ->> 'day' is distinct from to_char(v_today, 'YYYY-MM-DD')
     or (select sum((d ->> 'completed')::int) from jsonb_array_elements(v_j -> 'series') d) <> 5 then
    v_fail := v_fail || format('D7 the trend runs %s to %s with %s done',
                               v_j -> 'series' -> 0 ->> 'day', v_j -> 'series' -> -1 ->> 'day',
                               (select sum((d ->> 'completed')::int) from jsonb_array_elements(v_j -> 'series') d)) || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- D8 grants
  if has_function_privilege('anon', 'public.dashboard_kpis(timestamptz, timestamptz, text[])', 'execute')
     or has_function_privilege('anon', 'public.dashboard_kpi_window(date, date, date, uuid[], boolean, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.dashboard_kpis(timestamptz, timestamptz, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.quotes_stamp_status()', 'execute') then
    v_fail := v_fail || 'D8 a dashboard function has the wrong grants' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where kind = 'function' and name in ('dashboard_kpis', 'dashboard_kpi_window') and module_code = 'core') <> 2 then
    v_fail := v_fail || 'D8 the dashboard functions are not registered as core' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'DASHBOARD FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL DASHBOARD CHECKS PASSED (rolled back)';
end;
$$;
