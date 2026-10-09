-- Signed job report suite (Stage 8.3).
--
--   J1  Settings: a cleaning company sends each evening; Gold Fortune sends
--       nothing unless asked.
--   J2  Automatic sends: "immediate" queues each finished job once, to the
--       site's contacts who get reports and have an email; "evening" waits
--       for the company's send time, then one email per site; "manual" and a
--       site with no contacts send nothing.
--   J3  "Send to the client now": a manager can, field staff cannot, nor for
--       an unfinished job or another company's.
--   J4  The link's report: made once, the same id after.
--   J5  The client's page (service role): who, when, on site, checklist
--       answers and photos; nothing when expired or withdrawn.
--   J6  Signing: once; a signature that is not plain strokes is refused;
--       not after it expires.
--   J7  Reading: managers see their own company's reports; field staff and
--       another company do not.
--   J8  Grants, module registration and the scheduled job.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_viewer uuid;
  v_tz text; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_form uuid; v_field uuid; v_sub uuid; v_photo uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_open uuid; v_gf_visit uuid;
  v_rep uuid; v_rep2 uuid; v_n int; v_j jsonb; v_ok boolean;
begin
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
  select v.id into v_gf_visit from public.visits v where v.org_id = c_gf and v.status = 'checked_out'
   order by v.checkin_at desc limit 1;
  if v_gf_viewer is null or v_gf_visit is null then
    raise exception 'Fixtures missing: a Gold Fortune report reader and a finished job.';
  end if;
  delete from public.profiles where id in (v_owner, v_staff);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Report check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Report Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Report Staff', v_staff_email);
  v_tz := public.org_timezone(v_org);

  ---------------------------------------------------------------- J1 settings
  if public.org_setting(v_org, 'job_report_send') #>> '{}' is distinct from 'evening'
     or public.org_setting(v_org, 'job_report_send_time') #>> '{}' is distinct from '18:00'
     or coalesce(public.org_setting(c_gf, 'job_report_send') #>> '{}', 'manual') <> 'manual' then
    v_fail := v_fail || 'J1 the trades'' send settings are not as seeded' || E'\n';
  end if;

  ---------------------------------------------------------------- fixtures
  insert into public.stores (org_id, name, address) values (v_org, 'Report site one', '1 Main Rd') returning id into v_s1;
  insert into public.stores (org_id, name) values (v_org, 'Report site two') returning id into v_s2;
  insert into public.stores (org_id, name) values (v_org, 'Report site three') returning id into v_s3;
  insert into public.site_contacts (org_id, store_id, name, email) values (v_org, v_s1, 'Gets it', 'gets@example.com');
  insert into public.site_contacts (org_id, store_id, name, phone) values (v_org, v_s1, 'Phone only', '+27115550142');
  insert into public.site_contacts (org_id, store_id, name, email, receives_reports)
    values (v_org, v_s1, 'Not reports', 'no@example.com', false);
  insert into public.site_contacts (org_id, store_id, name, email) values (v_org, v_s2, 'Evening', 'eve@example.com');
  -- Site three has no contacts.
  select id into v_form from public.form_templates where org_id = v_org and active order by created_at limit 1;
  select id into v_field from public.form_fields where form_template_id = v_form and field_type = 'boolean' order by sort_order limit 1;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', now() - interval '2 hours', now() - interval '90 minutes', 1800, 20, gen_random_uuid())
  returning id into v_v1;
  insert into public.photos (org_id, visit_id, rep_id, storage_path, client_generated_id)
  values (v_org, v_v1, v_staff, 'report/one.jpg', gen_random_uuid()) returning id into v_photo;
  insert into public.form_submissions (org_id, visit_id, form_template_id, rep_id, client_generated_id)
  values (v_org, v_v1, v_form, v_staff, gen_random_uuid()) returning id into v_sub;
  if v_field is not null then
    insert into public.form_responses (form_submission_id, form_field_id, value_boolean) values (v_sub, v_field, true);
  end if;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds, client_generated_id)
  values (v_org, v_staff, v_s2, 'checked_out', now() - interval '3 hours', now() - interval '150 minutes', 1800, gen_random_uuid())
  returning id into v_v2;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds, client_generated_id)
  values (v_org, v_staff, v_s3, 'checked_out', now() - interval '1 hour', now() - interval '30 minutes', 1800, gen_random_uuid())
  returning id into v_v3;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_in', now() - interval '5 minutes', gen_random_uuid()) returning id into v_open;

  ---------------------------------------------------------------- J2 automatic sends
  update public.company_settings set value = '"manual"' where org_id = v_org and key = 'job_report_send';
  perform public.queue_job_reports();
  if exists (select 1 from public.message_outbox where org_id = v_org) then
    v_fail := v_fail || 'J2 a manual company sent reports by itself' || E'\n';
  end if;
  update public.company_settings set value = '"immediate"' where org_id = v_org and key = 'job_report_send';
  perform public.queue_job_reports();
  select count(*) into v_n from public.message_outbox where org_id = v_org;
  if v_n <> 2
     or not exists (select 1 from public.message_outbox where org_id = v_org and to_address = 'gets@example.com'
                     and template = 'job_report' and related_id = v_s1
                     and payload -> 'report_ids' ? (select id::text from public.job_reports where visit_id = v_v1))
     or not exists (select 1 from public.message_outbox where org_id = v_org and to_address = 'eve@example.com')
     or exists (select 1 from public.job_reports where visit_id in (v_v3, v_open)) then
    v_fail := v_fail || format('J2 immediate queued %s emails, not one per contact with an email at each site', v_n) || E'\n';
  end if;
  perform public.queue_job_reports();
  if (select count(*) from public.message_outbox where org_id = v_org) <> v_n then
    v_fail := v_fail || 'J2 a job was sent twice' || E'\n';
  end if;
  -- Evening: not before the send time, then one email per site.
  delete from public.message_outbox where org_id = v_org;
  update public.job_reports set first_queued_at = null, last_queued_at = null where org_id = v_org;
  update public.company_settings set value = '"evening"' where org_id = v_org and key = 'job_report_send';
  update public.company_settings set value = to_jsonb(to_char((now() at time zone v_tz) + interval '1 hour', 'HH24:MI'))
   where org_id = v_org and key = 'job_report_send_time';
  perform public.queue_job_reports();
  if exists (select 1 from public.message_outbox where org_id = v_org)
     and (now() at time zone v_tz)::time < time '23:00' then
    v_fail := v_fail || 'J2 the evening email went before its time' || E'\n';
  end if;
  update public.company_settings set value = '"00:00"' where org_id = v_org and key = 'job_report_send_time';
  delete from public.message_outbox where org_id = v_org;
  perform public.queue_job_reports();
  -- The fixtures check in 1 to 3 hours ago: just after the company's
  -- midnight some fall on yesterday, so the evening count is not checked then.
  if (now() at time zone v_tz)::time >= time '04:00'
     and (select count(*) from public.message_outbox where org_id = v_org and template = 'job_reports_day') <> 2 then
    v_fail := v_fail || 'J2 the evening email was not one per site' || E'\n';
  end if;

  ---------------------------------------------------------------- J3 send now
  delete from public.message_outbox where org_id = v_org;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.send_job_report(v_v1) <> 1 then
    v_fail := v_fail || 'J3 send now did not queue one email for site one' || E'\n';
  end if;
  begin
    perform public.send_job_report(v_open);
    v_fail := v_fail || 'J3 an unfinished job''s report was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_job_report(v_gf_visit);
    v_fail := v_fail || 'J3 another company''s job was sent' || E'\n';
  exception when sqlstate 'P0002' then null;
  end;
  ---------------------------------------------------------------- J4 the link's report
  v_rep := public.job_report_for_visit(v_v1);
  v_rep2 := public.job_report_for_visit(v_v1);
  if v_rep is null or v_rep <> v_rep2 or v_rep <> (select id from public.job_reports where visit_id = v_v1) then
    v_fail := v_fail || 'J4 the report for a job was not made once' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_job_report(v_v1);
    v_fail := v_fail || 'J3 field staff sent a report' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.job_report_for_visit(v_v1);
    v_fail := v_fail || 'J4 field staff opened a report link' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- J5 the client's page
  set local role service_role;
  v_j := public.job_report_view(v_rep);
  reset role;
  if v_j ->> 'staff_name' is distinct from 'Report Staff'
     or v_j -> 'site' ->> 'name' is distinct from 'Report site one'
     or (v_j ->> 'minutes')::int is distinct from 30
     or (v_j ->> 'on_site')::boolean is distinct from true
     or jsonb_array_length(v_j -> 'photos') <> 1
     or v_j -> 'photos' -> 0 ->> 'path' is distinct from 'report/one.jpg'
     or jsonb_array_length(v_j -> 'checklists') <> 1
     or (v_field is not null and (v_j -> 'checklists' -> 0 -> 'answers' -> 0 ->> 'yes')::boolean is distinct from true)
     or v_j -> 'company' ->> 'name' is distinct from 'Report check cleaning'
     or v_j -> 'signed' is distinct from 'null'::jsonb then
    v_fail := v_fail || format('J5 the client page data is wrong: %s', left(v_j::text, 300)) || E'\n';
  end if;
  update public.job_reports set revoked_at = now() where id = v_rep;
  set local role service_role;
  if public.job_report_view(v_rep) is not null then
    v_fail := v_fail || 'J5 a withdrawn report still opens' || E'\n';
  end if;
  reset role;
  update public.job_reports set revoked_at = null where id = v_rep;

  ---------------------------------------------------------------- J6 signing
  set local role service_role;
  begin
    perform public.job_report_sign(v_rep, 'Nomsa', '<svg onload=alert(1)>');
    v_fail := v_fail || 'J6 markup was accepted as a signature' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  v_ok := public.job_report_sign(v_rep, ' Nomsa Client ', 'M10 20L30 40L50 20', '198.51.100.7', 'Test browser');
  if not v_ok or public.job_report_sign(v_rep, 'Someone else', 'M1 1L2 2') then
    v_fail := v_fail || 'J6 the report was not signed exactly once' || E'\n';
  end if;
  v_j := public.job_report_view(v_rep);
  reset role;
  if v_j -> 'signed' ->> 'name' is distinct from 'Nomsa Client' or v_j -> 'signed' ->> 'path' is distinct from 'M10 20L30 40L50 20' then
    v_fail := v_fail || 'J6 the signature is not on the report' || E'\n';
  end if;
  v_rep2 := (select public.ensure_job_report(v_v2));
  update public.job_reports set expires_at = now() - interval '1 minute' where id = v_rep2;
  set local role service_role;
  if public.job_report_sign(v_rep2, 'Late', 'M1 1L2 2') or public.job_report_view(v_rep2) is not null then
    v_fail := v_fail || 'J6 an expired report could be signed or opened' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- J7 reading
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not exists (select 1 from public.job_reports where id = v_rep and signed_name = 'Nomsa Client') then
    v_fail := v_fail || 'J7 the manager cannot see the signed report' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.job_reports) then
    v_fail := v_fail || 'J7 field staff can read job reports' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.job_reports where org_id = v_org) then
    v_fail := v_fail || 'J7 Gold Fortune can read the trial''s reports' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- J8 grants
  if has_function_privilege('authenticated', 'public.job_report_view(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.job_report_sign(uuid, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.queue_job_reports()', 'execute')
     or has_function_privilege('authenticated', 'public.ensure_job_report(uuid)', 'execute')
     or has_function_privilege('anon', 'public.send_job_report(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.send_job_report(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.job_report_view(uuid)', 'execute') then
    v_fail := v_fail || 'J8 a job report function has the wrong grants' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where (kind = 'table' and name = 'job_reports')
          or (kind = 'function' and name in ('send_job_report', 'job_report_for_visit'))) <> 3
     or not exists (select 1 from cron.job where jobname = 'job-reports' and schedule = '*/15 * * * *') then
    v_fail := v_fail || 'J8 registration or the scheduled job is missing' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'JOB REPORT FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL JOB REPORT CHECKS PASSED (rolled back)';
end;
$$;
