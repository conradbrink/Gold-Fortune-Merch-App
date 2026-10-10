-- Alerts suite (Stage 8.4).
--
--   A1  Settings and the module per trade: a cleaning trial has three rules
--       on, a daily email at 17:30 and the module; security adds patrol_gap;
--       distribution has none; Gold Fortune has no rule and no module.
--   A2  Each rule fires exactly once, with its dedupe key, on a hand-made
--       yesterday: away from the site, short, no GPS, a planned job not done,
--       a long gap at one site. A planned job done (on its route, or at its
--       site that day) and today's before the end of the day do not fire.
--       Running again makes nothing new.
--   A3  Rules switched off do not fire: none, one only, short jobs with
--       short_visit_minutes 0; nor for a company without the module, nor a
--       read-only one (where the billing gate exists).
--   A4  Email: off queues nothing; instant one email per alert per
--       recipient, once; digest nothing before its time, then one email per
--       recipient listing them, once a day.
--   A5  Recipients: people holding insights or admin with a real email; not
--       a phone login, not someone without insights, not someone inactive.
--   A6  Reading: a manager reads them and my_alerts(); field staff cannot;
--       another company (Gold Fortune) cannot; nobody signed in writes them.
--   A7  Mark read: one, then all, each person's own.
--   A8  Grants, module registration and gates, the template switch, the
--       scheduled job, and Gold Fortune untouched by a full run.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_viewer uuid;
  v_tz text; v_today date; v_y0 timestamptz;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  v_va uuid; v_vb uuid; v_vc uuid; v_vd uuid; v_ve uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid;
  v_n int; v_m int; v_txt text; v_j jsonb; v_id uuid;
  v_gf_alerts int; v_gf_mail int;
begin
  select p.id, p.email into v_owner, v_owner_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager'
     and p.email is not null and p.email !~* '@staff\.tickd\.co\.za$'
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
    raise exception 'Fixtures missing: a Gold Fortune report reader.';
  end if;
  select count(*) into v_gf_mail from public.message_outbox where org_id = c_gf and template in ('alert', 'alerts_digest');
  delete from public.profiles where id in (v_owner, v_staff);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Alert check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Alert Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Alert Staff', v_staff_email);
  v_tz := public.org_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_y0 := ((v_today - 1)::timestamp at time zone v_tz);

  ---------------------------------------------------------------- A1 settings
  if public.org_setting(v_org, 'alerts_on') #>> '{}' is distinct from 'off_site_checkin,short_job,missed_planned'
     or public.org_setting(v_org, 'alerts_email') #>> '{}' is distinct from 'digest'
     or public.org_setting(v_org, 'alerts_digest_time') #>> '{}' is distinct from '17:30'
     or (public.org_setting(v_org, 'alerts_patrol_gap_minutes') #>> '{}')::int is distinct from 90 then
    v_fail := v_fail || 'A1 the cleaning trial''s alert settings are not as seeded' || E'\n';
  end if;
  if (select value #>> '{}' from public.template_settings where template_code = 'security' and setting_key = 'alerts_on')
       is distinct from 'off_site_checkin,short_job,missed_planned,patrol_gap'
     or (select value #>> '{}' from public.template_settings where template_code = 'distribution' and setting_key = 'alerts_on')
       is distinct from ''
     or exists (select 1 from public.template_settings where setting_key = 'alerts_on' and value #>> '{}' like '%no_gps%') then
    v_fail := v_fail || 'A1 the trades'' rules are not as seeded (security patrol_gap, distribution none, no_gps off)' || E'\n';
  end if;
  if not exists (select 1 from public.company_modules where org_id = v_org and module_code = 'owner_notifications' and enabled) then
    v_fail := v_fail || 'A1 a new cleaning company does not get the alerts module' || E'\n';
  end if;
  if coalesce(public.org_setting(c_gf, 'alerts_on') #>> '{}', '') <> ''
     or exists (select 1 from public.company_modules where org_id = c_gf and module_code = 'owner_notifications' and enabled) then
    v_fail := v_fail || 'A1 Gold Fortune has alerts on' || E'\n';
  end if;

  ---------------------------------------------------------------- fixtures: yesterday
  update public.company_settings set value = '"off_site_checkin,short_job,missed_planned,patrol_gap,no_gps"'
   where org_id = v_org and key = 'alerts_on';
  update public.company_settings set value = '5' where org_id = v_org and key = 'short_visit_minutes';
  update public.company_settings set value = '"23:59"' where org_id = v_org and key = 'alerts_digest_time';
  update public.company_settings set value = '"off"' where org_id = v_org and key = 'alerts_email';
  insert into public.stores (org_id, name, geofence_radius_m) values (v_org, 'Alert site one', 100) returning id into v_s1;
  insert into public.stores (org_id, name, geofence_radius_m) values (v_org, 'Alert site two', 100) returning id into v_s2;
  insert into public.stores (org_id, name, geofence_radius_m) values (v_org, 'Alert site three', 100) returning id into v_s3;
  -- A: 08:00 to 08:02, 640 m away: away from the site, and short.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, checkin_lat, checkin_lng, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', v_y0 + interval '8 hours', v_y0 + interval '8 hours 2 minutes', 120,
          640, -26.1, 28.05, gen_random_uuid()) returning id into v_va;
  -- B: 08:30 to 09:00, on site: nothing.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, checkin_lat, checkin_lng, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', v_y0 + interval '8 hours 30 minutes', v_y0 + interval '9 hours', 1800,
          20, -26.1, 28.05, gen_random_uuid()) returning id into v_vb;
  -- C: 11:30 to 12:00, no GPS: no fix, and 180 minutes after B at the same site.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', v_y0 + interval '11 hours 30 minutes', v_y0 + interval '12 hours', 1800,
          gen_random_uuid()) returning id into v_vc;
  -- D: 12:30, site three, on its route, done.
  insert into public.routes (org_id, rep_id, store_id, scheduled_date) values (v_org, v_staff, v_s3, v_today - 1)
  returning id into v_r4;
  insert into public.visits (org_id, rep_id, store_id, route_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, checkin_lat, checkin_lng, client_generated_id)
  values (v_org, v_staff, v_s3, v_r4, 'checked_out', v_y0 + interval '12 hours 30 minutes', v_y0 + interval '13 hours', 1800,
          10, -26.1, 28.05, gen_random_uuid()) returning id into v_vd;
  -- Routes: site two yesterday, not done (missed); site one yesterday, done
  -- off its route (not missed); site two today, before the end of the day.
  insert into public.routes (org_id, rep_id, store_id, scheduled_date) values (v_org, v_staff, v_s2, v_today - 1)
  returning id into v_r1;
  insert into public.routes (org_id, rep_id, store_id, scheduled_date) values (v_org, v_staff, v_s1, v_today - 1)
  returning id into v_r2;
  insert into public.routes (org_id, rep_id, store_id, scheduled_date) values (v_org, v_staff, v_s2, v_today)
  returning id into v_r3;

  ---------------------------------------------------------------- A2 each rule once
  v_n := public.detect_company_alerts(v_org);
  select string_agg(rule || '=' || dedupe_key, ' ' order by rule) into v_txt from public.alerts where org_id = v_org;
  if v_n <> 5
     or (select count(*) from public.alerts where org_id = v_org) <> 5
     or not exists (select 1 from public.alerts where org_id = v_org and rule = 'off_site_checkin'
                     and dedupe_key = 'off_site_checkin:' || v_va and visit_id = v_va and profile_id = v_staff
                     and (detail ->> 'distance_m')::int = 640 and (detail ->> 'radius_m')::int = 100)
     or not exists (select 1 from public.alerts where org_id = v_org and rule = 'short_job'
                     and dedupe_key = 'short_job:' || v_va and (detail ->> 'seconds')::int = 120
                     and (detail ->> 'limit_minutes')::int = 5)
     or not exists (select 1 from public.alerts where org_id = v_org and rule = 'no_gps' and dedupe_key = 'no_gps:' || v_vc)
     or not exists (select 1 from public.alerts where org_id = v_org and rule = 'missed_planned'
                     and dedupe_key = 'missed_planned:' || v_r1 and route_id = v_r1 and store_id = v_s2 and day = v_today - 1)
     or not exists (select 1 from public.alerts where org_id = v_org and rule = 'patrol_gap'
                     and dedupe_key = 'patrol_gap:' || v_s1 || ':' || (v_today - 1) and visit_id = v_vc
                     and (detail ->> 'gap_minutes')::int = 180) then
    v_fail := v_fail || format('A2 the five rules did not fire once each (%s new): %s', v_n, v_txt) || E'\n';
  end if;
  if exists (select 1 from public.alerts where org_id = v_org and route_id in (v_r2, v_r4))
     or (exists (select 1 from public.alerts where org_id = v_org and route_id = v_r3)
         and (now() at time zone v_tz)::time < time '23:59') then
    v_fail := v_fail || 'A2 a planned job that was done, or today''s before the end of the day, counted as missed' || E'\n';
  end if;
  if public.detect_company_alerts(v_org) <> 0 or (select count(*) from public.alerts where org_id = v_org) <> 5 then
    v_fail := v_fail || 'A2 running again made alerts twice' || E'\n';
  end if;
  -- Today's planned job, once the end of the day has passed.
  update public.company_settings set value = '"00:00"' where org_id = v_org and key = 'alerts_digest_time';
  perform public.detect_company_alerts(v_org);
  if not exists (select 1 from public.alerts where org_id = v_org and route_id = v_r3 and rule = 'missed_planned') then
    v_fail := v_fail || 'A2 today''s planned job not done by the end of the day did not fire' || E'\n';
  end if;
  delete from public.routes where id = v_r3;   -- its alert goes with it
  update public.company_settings set value = '"23:59"' where org_id = v_org and key = 'alerts_digest_time';

  ---------------------------------------------------------------- A3 rules off
  delete from public.alerts where org_id = v_org;
  update public.company_settings set value = '""' where org_id = v_org and key = 'alerts_on';
  if public.detect_company_alerts(v_org) <> 0 then
    v_fail := v_fail || 'A3 alerts fired with every rule off' || E'\n';
  end if;
  update public.company_settings set value = '"no_gps"' where org_id = v_org and key = 'alerts_on';
  perform public.detect_company_alerts(v_org);
  if (select string_agg(rule, ',') from public.alerts where org_id = v_org) is distinct from 'no_gps' then
    v_fail := v_fail || 'A3 a rule that is off fired' || E'\n';
  end if;
  delete from public.alerts where org_id = v_org;
  update public.company_settings set value = '"short_job"' where org_id = v_org and key = 'alerts_on';
  update public.company_settings set value = '0' where org_id = v_org and key = 'short_visit_minutes';
  if public.detect_company_alerts(v_org) <> 0 then
    v_fail := v_fail || 'A3 short jobs fired with short_visit_minutes 0' || E'\n';
  end if;
  update public.company_settings set value = '5' where org_id = v_org and key = 'short_visit_minutes';
  update public.company_settings set value = '"off_site_checkin,short_job,missed_planned,patrol_gap,no_gps"'
   where org_id = v_org and key = 'alerts_on';
  update public.company_modules set enabled = false where org_id = v_org and module_code = 'owner_notifications';
  perform public.detect_alerts();
  if exists (select 1 from public.alerts where org_id = v_org) then
    v_fail := v_fail || 'A3 a company without the module got alerts' || E'\n';
  end if;
  update public.company_modules set enabled = true where org_id = v_org and module_code = 'owner_notifications';
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'company_account' and column_name = 'status') then
    execute 'select status::text from public.company_account where org_id = $1' into v_txt using v_org;
    execute 'update public.company_account set status = ''read_only'' where org_id = $1' using v_org;
    perform public.detect_alerts();
    if exists (select 1 from public.alerts where org_id = v_org) then
      v_fail := v_fail || 'A3 a read-only company got alerts' || E'\n';
    end if;
    execute format('update public.company_account set status = %L where org_id = %L', v_txt, v_org);
  end if;

  ---------------------------------------------------------------- A4 email
  -- Off: nothing queued, and nothing left waiting.
  perform public.detect_company_alerts(v_org);
  perform public.queue_alert_emails(v_org);
  if exists (select 1 from public.message_outbox where org_id = v_org and template in ('alert', 'alerts_digest'))
     or exists (select 1 from public.alerts where org_id = v_org and email_handled_at is null) then
    v_fail := v_fail || 'A4 alert emails were queued with emails off' || E'\n';
  end if;
  -- Instant: one per alert per recipient (the owner only), once.
  delete from public.alerts where org_id = v_org;
  update public.company_settings set value = '"instant"' where org_id = v_org and key = 'alerts_email';
  perform public.detect_company_alerts(v_org);
  v_n := public.queue_alert_emails(v_org);
  select count(*) into v_m from public.message_outbox where org_id = v_org and template = 'alert';
  if v_n <> 5 or v_m <> 5
     or exists (select 1 from public.message_outbox where org_id = v_org and template = 'alert'
                 and (to_address <> lower(v_owner_email) or related_kind <> 'alert'
                      or related_id not in (select id from public.alerts where org_id = v_org)))
     or (select count(distinct related_id) from public.message_outbox where org_id = v_org and template = 'alert') <> 5 then
    v_fail := v_fail || format('A4 instant queued %s (%s), not one per alert to the owner', v_m, v_n) || E'\n';
  end if;
  select payload into v_j from public.message_outbox where org_id = v_org and template = 'alert'
   and related_id = (select id from public.alerts where org_id = v_org and rule = 'off_site_checkin');
  if v_j -> 'terms' -> 'job' ->> 'one' is distinct from 'Visit'
     or v_j ->> 'timezone' is distinct from 'Africa/Johannesburg'
     or (v_j ->> 'total')::int is distinct from 1
     or v_j -> 'alerts' -> 0 ->> 'site_name' is distinct from 'Alert site one'
     or v_j -> 'alerts' -> 0 ->> 'staff_name' is distinct from 'Alert Staff'
     or v_j -> 'alerts' -> 0 ->> 'rule' is distinct from 'off_site_checkin' then
    v_fail := v_fail || format('A4 the alert email''s payload is wrong: %s', left(v_j::text, 300)) || E'\n';
  end if;
  if public.queue_alert_emails(v_org) <> 0 then
    v_fail := v_fail || 'A4 instant emailed an alert twice' || E'\n';
  end if;
  -- Digest: nothing before its time, then one email listing all, once a day.
  delete from public.message_outbox where org_id = v_org;
  delete from public.alerts where org_id = v_org;
  update public.company_settings set value = '"digest"' where org_id = v_org and key = 'alerts_email';
  perform public.detect_company_alerts(v_org);
  if (now() at time zone v_tz)::time < time '23:59' then
    if public.queue_alert_emails(v_org) <> 0
       or exists (select 1 from public.alert_digests where org_id = v_org) then
      v_fail := v_fail || 'A4 the daily alert email went before its time' || E'\n';
    end if;
  end if;
  update public.company_settings set value = '"00:00"' where org_id = v_org and key = 'alerts_digest_time';
  v_n := public.queue_alert_emails(v_org);
  select payload into v_j from public.message_outbox where org_id = v_org and template = 'alerts_digest';
  if v_n <> 1
     or (select count(*) from public.message_outbox where org_id = v_org and template = 'alerts_digest') <> 1
     or exists (select 1 from public.message_outbox where org_id = v_org and template = 'alert')
     or (v_j ->> 'total')::int is distinct from 5
     or jsonb_array_length(v_j -> 'alerts') <> 5
     or (select alert_count from public.alert_digests where org_id = v_org and day = v_today) is distinct from 5
     or exists (select 1 from public.alerts where org_id = v_org and email_handled_at is null) then
    v_fail := v_fail || format('A4 the daily email was not one per recipient listing five (%s queued): %s', v_n, left(v_j::text, 200)) || E'\n';
  end if;
  -- A later alert waits for tomorrow's email.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, client_generated_id)
  values (v_org, v_staff, v_s2, 'checked_in', now() - interval '1 minute', gen_random_uuid()) returning id into v_ve;
  perform public.detect_company_alerts(v_org);
  if public.queue_alert_emails(v_org) <> 0
     or (select count(*) from public.message_outbox where org_id = v_org and template = 'alerts_digest') <> 1
     or not exists (select 1 from public.alerts where org_id = v_org and visit_id = v_ve and email_handled_at is null) then
    v_fail := v_fail || 'A4 a second daily email went the same day' || E'\n';
  end if;
  update public.company_settings set value = '"23:59"' where org_id = v_org and key = 'alerts_digest_time';

  ---------------------------------------------------------------- A5 recipients
  if (select string_agg(email, ',') from public.alert_recipients(v_org)) is distinct from lower(v_owner_email) then
    v_fail := v_fail || 'A5 the recipients are not the owner alone (staff without insights must not get them)' || E'\n';
  end if;
  insert into public.profile_permissions (profile_id, permission_code) values (v_staff, 'insights') on conflict do nothing;
  update public.profiles set email = '27825550142@staff.tickd.co.za' where id = v_staff;
  if exists (select 1 from public.alert_recipients(v_org) where email like '%@staff.tickd.co.za') then
    v_fail := v_fail || 'A5 a phone login is a recipient' || E'\n';
  end if;
  update public.profiles set email = 'alert-staff@example.com' where id = v_staff;
  if not exists (select 1 from public.alert_recipients(v_org) where email = 'alert-staff@example.com') then
    v_fail := v_fail || 'A5 someone with insights and an email is not a recipient' || E'\n';
  end if;
  update public.profiles set is_active = false where id = v_staff;
  if exists (select 1 from public.alert_recipients(v_org) where email = 'alert-staff@example.com') then
    v_fail := v_fail || 'A5 an inactive person is a recipient' || E'\n';
  end if;
  update public.profiles set is_active = true, email = v_staff_email where id = v_staff;
  delete from public.profile_permissions where profile_id = v_staff and permission_code = 'insights';

  ---------------------------------------------------------------- A6 reading
  select count(*) into v_n from public.alerts where org_id = v_org;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.alerts) <> v_n
     or (select count(*) from public.my_alerts(50)) <> v_n
     or exists (select 1 from public.my_alerts(50) where not unread)
     or not exists (select 1 from public.my_alerts(50) where rule = 'off_site_checkin'
                     and site_name = 'Alert site one' and staff_name = 'Alert Staff') then
    v_fail := v_fail || 'A6 the manager cannot read the company''s alerts' || E'\n';
  end if;
  if (select count(*) from public.my_alerts(2)) <> 2 then
    v_fail := v_fail || 'A6 my_alerts does not keep to its limit' || E'\n';
  end if;
  begin
    insert into public.alerts (org_id, rule, occurred_at, day, dedupe_key)
    values (v_org, 'no_gps', now(), v_today, 'no_gps:made-up');
    v_fail := v_fail || 'A6 a signed-in person wrote an alert' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.alerts set detail = '{}' where org_id = v_org;
    v_fail := v_fail || 'A6 a signed-in person changed an alert' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.alert_reads (alert_id, profile_id, org_id)
    select id, v_owner, v_org from public.alerts limit 1;
    v_fail := v_fail || 'A6 a signed-in person wrote a read mark directly' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.alerts) then
    v_fail := v_fail || 'A6 field staff can read alerts' || E'\n';
  end if;
  begin
    perform public.my_alerts(50);
    v_fail := v_fail || 'A6 field staff called my_alerts' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mark_alerts_read(null);
    v_fail := v_fail || 'A6 field staff called mark_alerts_read' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.alerts where org_id = v_org)
     or exists (select 1 from public.alert_reads where org_id = v_org) then
    v_fail := v_fail || 'A6 Gold Fortune can read the trial''s alerts' || E'\n';
  end if;
  begin
    perform public.my_alerts(50);
    v_fail := v_fail || 'A6 Gold Fortune (no alerts module) called my_alerts' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------- A7 mark read
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- Each step its own statement: a check in the same statement as the write
  -- reads the snapshot from before it.
  select id into v_id from public.my_alerts(50) where rule = 'no_gps' limit 1;
  v_m := public.mark_alerts_read(array[v_id]);
  if v_m <> 1
     or (select unread from public.my_alerts(50) where id = v_id)
     or (select count(*) from public.my_alerts(50) where unread) <> v_n - 1 then
    v_fail := v_fail || 'A7 marking one alert read did not mark that one only' || E'\n';
  end if;
  v_m := public.mark_alerts_read(null);
  if v_m <> v_n - 1 or exists (select 1 from public.my_alerts(50) where unread) then
    v_fail := v_fail || 'A7 mark all read did not mark the rest' || E'\n';
  end if;
  v_m := public.mark_alerts_read(null);
  if v_m <> 0 or (select count(*) from public.alert_reads) <> v_n then
    v_fail := v_fail || 'A7 mark all read marked something twice' || E'\n';
  end if;
  reset role;
  if (select count(*) from public.alert_reads where org_id = v_org and profile_id <> v_owner) <> 0 then
    v_fail := v_fail || 'A7 read marks were made for someone else' || E'\n';
  end if;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- A8 grants and registration
  if has_function_privilege('authenticated', 'public.detect_alerts()', 'execute')
     or has_function_privilege('authenticated', 'public.detect_company_alerts(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.queue_alert_emails(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.alert_recipients(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.alert_email_payload(uuid, uuid[])', 'execute')
     or has_function_privilege('anon', 'public.my_alerts(integer)', 'execute')
     or has_function_privilege('anon', 'public.mark_alerts_read(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.my_alerts(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_alerts_read(uuid[])', 'execute')
     or has_table_privilege('authenticated', 'public.alerts', 'insert')
     or has_table_privilege('authenticated', 'public.alerts', 'update')
     or has_table_privilege('authenticated', 'public.alert_reads', 'insert')
     or has_table_privilege('authenticated', 'public.alert_digests', 'select')
     or has_table_privilege('anon', 'public.alerts', 'select') then
    v_fail := v_fail || 'A8 an alerts function or table has the wrong grants' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where module_code = 'owner_notifications'
         and ((kind = 'table' and name in ('alerts', 'alert_reads', 'alert_digests'))
              or (kind = 'function' and name in ('my_alerts', 'mark_alerts_read')))) <> 5
     or (select count(*) from pg_policies where schemaname = 'public' and policyname = 'module_gate'
          and permissive = 'RESTRICTIVE' and tablename in ('alerts', 'alert_reads', 'alert_digests')) <> 3
     or not (select is_built from public.modules where code = 'owner_notifications')
     or exists (select 1 from public.industry_templates it where it.code <> 'distribution'
                 and not exists (select 1 from public.template_modules tm
                                  where tm.template_code = it.code and tm.module_code = 'owner_notifications'))
     or exists (select 1 from public.template_modules where template_code = 'distribution' and module_code = 'owner_notifications')
     or not exists (select 1 from cron.job where jobname = 'alerts-detect' and schedule = '*/5 * * * *') then
    v_fail := v_fail || 'A8 registration, the gates, the template switch or the scheduled job is wrong' || E'\n';
  end if;
  -- A full run leaves Gold Fortune as it was.
  perform public.detect_alerts();
  select count(*) into v_gf_alerts from public.alerts where org_id = c_gf;
  if v_gf_alerts <> 0
     or (select count(*) from public.message_outbox where org_id = c_gf and template in ('alert', 'alerts_digest')) <> v_gf_mail then
    v_fail := v_fail || 'A8 a full run made alerts or alert emails for Gold Fortune' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'ALERT FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL ALERT CHECKS PASSED (rolled back)';
end;
$$;
