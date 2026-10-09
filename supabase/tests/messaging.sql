-- Messaging and site contacts suite (Stage 8.1 and 8.2).
--
--   E1  Site contacts: a manager adds one to their own site; an email or a
--       phone is required; field staff cannot add; another company's site is
--       refused; another company cannot see them.
--   E2  Queueing: nobody signed in can queue mail directly; a settings manager
--       can send themselves a test, five an hour; field staff cannot.
--   E3  Suppression: a suppressed address is recorded as suppressed, not sent;
--       every-company suppressions apply to all, a company's only to it.
--   E4  Sending (service role): due rows are claimed once, future ones wait;
--       success, retry with backoff, and failure after five attempts.
--   E5  Delivery events: a hard bounce stops every company; an unsubscribe
--       stops the company that sent it.
--   E6  The unsubscribe link: suppresses for that company and cancels what
--       it still had queued for the address.
--   E7  Reading the outbox: a settings manager sees their own company's rows
--       only; field staff see none; another company sees none.
--   E8  Grants and module registration.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the two quiet Gold
-- Fortune profiles it removes and re-creates as the trial's owner and employee.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text; v_gf_viewer uuid;
  v_site uuid; v_gf_site uuid; v_id uuid; v_id2 uuid; v_id3 uuid; v_n int; v_t text;
  r record;
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
                  where pp.profile_id = p.id and pp.permission_code in ('company_settings', 'admin'))
   order by p.full_name limit 1;
  select id into v_gf_site from public.stores where org_id = c_gf order by created_at limit 1;
  if v_gf_viewer is null or v_gf_site is null then
    raise exception 'Fixtures missing: a Gold Fortune settings manager and site.';
  end if;
  delete from public.profiles where id in (v_owner, v_staff);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Messaging check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Mail Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Mail Staff', v_staff_email);
  insert into public.stores (org_id, name) values (v_org, 'Mail site') returning id into v_site;

  ---------------------------------------------------------------- E1 contacts
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.site_contacts (org_id, store_id, name, email, role)
  values (v_org, v_site, 'Nomsa Client', 'nomsa@example.com', 'Facilities manager') returning id into v_id;
  begin
    insert into public.site_contacts (org_id, store_id, name) values (v_org, v_site, 'Nobody');
    v_fail := v_fail || 'E1 a contact with no email or phone was accepted' || E'\n';
  exception when check_violation then null;
  end;
  begin
    insert into public.site_contacts (org_id, store_id, name, email) values (v_org, v_gf_site, 'Wrong site', 'x@example.com');
    v_fail := v_fail || 'E1 a contact on another company''s site was accepted' || E'\n';
  exception when insufficient_privilege then null;
  end;
  -- The rule itself must tie the site to the contact's company, not lean on
  -- the caller being unable to see other companies' sites (CodeRabbit, #107):
  -- checked on the policy as written, since RLS on stores would hide the case.
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'site_contacts' and p.policyname = 'site_contacts_insert'
                    and p.with_check like '%(s.org_id = site_contacts.org_id)%')
     or not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = 'site_contacts' and p.policyname = 'site_contacts_update'
                       and p.with_check like '%(s.org_id = site_contacts.org_id)%') then
    v_fail := v_fail || 'E1 the contact rules do not tie the site to the contact''s company' || E'\n';
  end if;
  begin
    insert into public.site_contacts (org_id, store_id, name, phone) values (v_org, v_site, 'Bad phone', '082 555 0142');
    v_fail := v_fail || 'E1 a phone not in international form was accepted' || E'\n';
  exception when check_violation then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.site_contacts (org_id, store_id, name, email) values (v_org, v_site, 'By staff', 's@example.com');
    v_fail := v_fail || 'E1 field staff added a contact' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from public.site_contacts where id = v_id) then
    v_fail := v_fail || 'E1 field staff cannot see who to call at a site' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.site_contacts where id = v_id) then
    v_fail := v_fail || 'E1 Gold Fortune can see the trial''s contacts' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- E2 queueing
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.queue_email(v_org, 'a@example.com', null, 'test', '{}'::jsonb);
    v_fail := v_fail || 'E2 a signed-in user queued mail directly' || E'\n';
  exception when insufficient_privilege then null;
  end;
  v_id := public.send_test_email();
  reset role;
  select count(*) into v_n from public.message_outbox
   where id = v_id and org_id = v_org and template = 'test' and status = 'queued'
     and to_address = lower(v_owner_email) and created_by = v_owner;
  if v_n <> 1 then
    v_fail := v_fail || 'E2 the test email was not queued to the manager' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 2..5 loop perform public.send_test_email(); end loop;
  begin
    perform public.send_test_email();
    v_fail := v_fail || 'E2 a sixth test email in an hour was queued' || E'\n';
  exception when sqlstate '54000' then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_test_email();
    v_fail := v_fail || 'E2 field staff sent a test email' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- E3 suppression
  insert into public.message_suppressions (org_id, address, reason) values (null, 'gone@example.com', 'hard_bounce');
  insert into public.message_suppressions (org_id, address, reason) values (v_org, 'stop@example.com', 'unsubscribed');
  if (select status from public.message_outbox where id = public.queue_email(v_org, 'Gone@Example.com', null, 'test', '{}')) <> 'suppressed'
     or (select status from public.message_outbox where id = public.queue_email(c_gf, 'gone@example.com', null, 'test', '{}')) <> 'suppressed'
     or (select status from public.message_outbox where id = public.queue_email(v_org, 'stop@example.com', null, 'test', '{}')) <> 'suppressed'
     or (select status from public.message_outbox where id = public.queue_email(c_gf, 'stop@example.com', null, 'test', '{}')) <> 'queued' then
    v_fail := v_fail || 'E3 suppressions do not apply as they should' || E'\n';
  end if;
  -- The GF row above is test data; it must never be sent.
  delete from public.message_outbox where org_id = c_gf and to_address in ('gone@example.com', 'stop@example.com');

  ---------------------------------------------------------------- E4 sending
  update public.message_outbox set status = 'cancelled' where status = 'queued';
  v_id := public.queue_email(v_org, 'one@example.com', 'One', 'test', '{}');
  v_id2 := public.queue_email(v_org, 'later@example.com', null, 'test', '{}', null, null, now() + interval '1 hour');
  set local role service_role;
  select count(*) into v_n from public.claim_messages(50) c where c.id = v_id;
  if v_n <> 1 or exists (select 1 from public.claim_messages(50) c where c.id in (v_id, v_id2)) then
    v_fail := v_fail || 'E4 claiming took the wrong rows, or one twice' || E'\n';
  end if;
  perform public.finish_message(v_id, true, 'brevo-1');
  reset role;
  if (select status || '/' || attempts || '/' || coalesce(provider_message_id, '') from public.message_outbox where id = v_id) <> 'sent/1/brevo-1' then
    v_fail := v_fail || 'E4 a sent message was not recorded as sent' || E'\n';
  end if;
  v_id3 := public.queue_email(v_org, 'flaky@example.com', null, 'test', '{}');
  set local role service_role;
  perform 1 from public.claim_messages(50);
  perform public.finish_message(v_id3, false, null, 'timeout');
  reset role;
  if (select status from public.message_outbox where id = v_id3) <> 'queued'
     or (select send_after from public.message_outbox where id = v_id3) < now() + interval '50 seconds' then
    v_fail := v_fail || 'E4 a failed send was not put back with a delay' || E'\n';
  end if;
  update public.message_outbox set attempts = 5, status = 'sending' where id = v_id3;
  set local role service_role;
  perform public.finish_message(v_id3, false, null, 'timeout again');
  reset role;
  if (select status from public.message_outbox where id = v_id3) <> 'failed' then
    v_fail := v_fail || 'E4 a message was retried past five attempts' || E'\n';
  end if;
  v_id3 := public.queue_email(v_org, 'bad@example.com', null, 'test', '{}');
  update public.message_outbox set status = 'sending', attempts = 1 where id = v_id3;
  set local role service_role;
  perform public.finish_message(v_id3, false, null, 'invalid address', false, true);
  reset role;
  if (select status from public.message_outbox where id = v_id3) <> 'failed' then
    v_fail := v_fail || 'E4 a permanent refusal was retried' || E'\n';
  end if;

  ---------------------------------------------------------------- E5 events
  set local role service_role;
  perform public.record_message_event('brevo-1', 'hard_bounce');
  reset role;
  if not exists (select 1 from public.message_suppressions where org_id is null and address = 'one@example.com' and reason = 'hard_bounce')
     or (select status from public.message_outbox where id = v_id) <> 'failed' then
    v_fail := v_fail || 'E5 a hard bounce did not stop the address everywhere' || E'\n';
  end if;
  v_id := public.queue_email(v_org, 'leaver@example.com', null, 'test', '{}');
  update public.message_outbox set status = 'sent', provider_message_id = 'brevo-2' where id = v_id;
  set local role service_role;
  perform public.record_message_event('brevo-2', 'unsubscribed');
  perform public.record_message_event('nobody-knows', 'hard_bounce');
  reset role;
  if not exists (select 1 from public.message_suppressions where org_id = v_org and address = 'leaver@example.com')
     or exists (select 1 from public.message_suppressions where org_id is null and address = 'leaver@example.com') then
    v_fail := v_fail || 'E5 an unsubscribe was not kept to the company that sent it' || E'\n';
  end if;

  ---------------------------------------------------------------- E6 unsubscribe link
  v_id := public.queue_email(v_org, 'tidy@example.com', null, 'test', '{}');
  v_id2 := public.queue_email(v_org, 'tidy@example.com', null, 'test', '{}', null, null, now() + interval '1 day');
  set local role service_role;
  v_t := public.unsubscribe_message(v_id);
  reset role;
  if v_t is distinct from 'Messaging check cleaning'
     or not exists (select 1 from public.message_suppressions where org_id = v_org and address = 'tidy@example.com')
     or (select status from public.message_outbox where id = v_id2) <> 'cancelled' then
    v_fail := v_fail || format('E6 the unsubscribe link: company %s, queued not cancelled or not suppressed', v_t) || E'\n';
  end if;

  ---------------------------------------------------------------- E7 reading
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.message_outbox;
  if v_n = 0 or exists (select 1 from public.message_outbox where org_id is distinct from v_org) then
    v_fail := v_fail || format('E7 the manager sees %s rows, or another company''s', v_n) || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.message_outbox) or exists (select 1 from public.message_suppressions) then
    v_fail := v_fail || 'E7 field staff can read the outbox' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.message_outbox where org_id = v_org) then
    v_fail := v_fail || 'E7 Gold Fortune can read the trial''s outbox' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- E8 grants
  for r in select * from (values
      ('public.queue_email(uuid, text, text, text, jsonb, text, uuid, timestamptz)'),
      ('public.claim_messages(integer)'),
      ('public.finish_message(uuid, boolean, text, text, boolean, boolean)'),
      ('public.record_message_event(text, text)'),
      ('public.unsubscribe_message(uuid)'),
      ('public.email_allowed(uuid, text)')) x(f) loop
    if has_function_privilege('authenticated', r.f, 'execute') or has_function_privilege('anon', r.f, 'execute') then
      v_fail := v_fail || format('E8 %s can be called by a browser', r.f) || E'\n';
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.claim_messages(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.send_test_email()', 'execute')
     or has_function_privilege('anon', 'public.send_test_email()', 'execute') then
    v_fail := v_fail || 'E8 the sender or the test email has the wrong grants' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where (kind = 'table' and name in ('site_contacts', 'message_outbox', 'message_suppressions'))
          or (kind = 'function' and name = 'send_test_email')) <> 4 then
    v_fail := v_fail || 'E8 the new tables and function are not registered' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'MESSAGING FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL MESSAGING CHECKS PASSED (rolled back)';
end;
$$;
