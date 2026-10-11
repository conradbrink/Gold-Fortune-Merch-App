-- Closing a company (20261011090000_close_company).
--
--   C1  before: an administrator of the company is recognised everywhere
--       (current_org_id, "current_role", has_permission, my_permissions) and
--       my_company_closed() says nothing.
--   C2  closing: platform_set_company_closed() changes it once (a second close
--       is refused as already_closed), sets status cancelled and keeps the old
--       one, cancels the company's queued messages, writes one audit row.
--   C3  while closed: the same person is recognised nowhere, reads none of the
--       company's rows (profiles, organizations), and my_company_closed() names
--       the company.
--   C4  another company's people are untouched (when there is another).
--   C5  reopening: status back as it was, the person recognised again,
--       my_company_closed() null again, an audit row for the reopen.
--
-- HOW TO RUN
--
--   Supabase MCP:  paste this whole file into execute_sql
--   psql:          psql "$DATABASE_URL" -f supabase/tests/close_company.sql
--
-- One DO block that always ends in `raise exception`, so nothing survives:
-- safe against production. The message is the report: `CLOSE COMPANY FAILURES`
-- or `ALL CLOSE COMPANY CHECKS PASSED`.

do $$
declare
  v_org uuid; v_admin uuid; v_other uuid; v_other_org uuid;
  v_status text; v_res jsonb; v_n int; v_txt text; v_bool boolean; v_arr text[];
  v_msg uuid;
  v_fail text := '';
  v_info text := '';
begin
  -- An active administrator, and the company they belong to.
  select p.id, p.org_id into v_admin, v_org
    from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'admin'
   where p.is_active
   order by p.created_at
   limit 1;
  if v_admin is null then raise exception 'fixture: no active administrator'; end if;

  select p.id, p.org_id into v_other, v_other_org
    from public.profiles p
   where p.is_active and p.org_id <> v_org
   limit 1;

  insert into public.company_account (org_id) values (v_org) on conflict (org_id) do nothing;
  select status into v_status from public.company_account where org_id = v_org;

  -- A message waiting to go out for the company, so closing has one to cancel.
  insert into public.message_outbox (org_id, channel, to_address, template, payload, status)
  values (v_org, 'email', 'closing-test@example.com', 'closing_test', '{}'::jsonb, 'queued')
  returning id into v_msg;

  -- C1
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.current_org_id() is distinct from v_org then v_fail := v_fail || 'C1 current_org_id is not the company' || E'\n'; end if;
  if public."current_role"() is null then v_fail := v_fail || 'C1 current_role is null' || E'\n'; end if;
  if not public.has_permission('admin') then v_fail := v_fail || 'C1 has_permission(admin) is false' || E'\n'; end if;
  if cardinality(public.my_permissions()) = 0 then v_fail := v_fail || 'C1 my_permissions is empty' || E'\n'; end if;
  if public.my_company_closed() is not null then v_fail := v_fail || 'C1 my_company_closed is not null while open' || E'\n'; end if;
  reset role;

  -- C2
  v_res := public.platform_set_company_closed(v_org, true, v_admin, '  Test close  ');
  if (v_res ->> 'changed')::boolean is not true then v_fail := v_fail || 'C2 close did not change: ' || v_res::text || E'\n'; end if;
  v_res := public.platform_set_company_closed(v_org, true, v_admin, null);
  if v_res ->> 'reason' is distinct from 'already_closed' then v_fail := v_fail || 'C2 second close not refused: ' || v_res::text || E'\n'; end if;
  select status into v_txt from public.company_account where org_id = v_org;
  if v_txt <> 'cancelled' then v_fail := v_fail || 'C2 status is ' || v_txt || E'\n'; end if;
  select status_before_close into v_txt from public.company_account where org_id = v_org;
  if v_txt is distinct from v_status then v_fail := v_fail || 'C2 status_before_close is ' || coalesce(v_txt, 'null') || E'\n'; end if;
  select closed_reason into v_txt from public.company_account where org_id = v_org;
  if v_txt is distinct from 'Test close' then v_fail := v_fail || 'C2 reason is ' || coalesce(v_txt, 'null') || E'\n'; end if;
  select status into v_txt from public.message_outbox where id = v_msg;
  if v_txt <> 'cancelled' then v_fail := v_fail || 'C2 queued message is ' || v_txt || E'\n'; end if;
  select count(*) into v_n from public.platform_audit_log
   where target_org_id = v_org and action = 'company.close' and created_at >= now();
  if v_n <> 1 then v_fail := v_fail || format('C2 %s close audit rows', v_n) || E'\n'; end if;

  -- C3
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.current_org_id() is not null then v_fail := v_fail || 'C3 current_org_id still set' || E'\n'; end if;
  if public."current_role"() is not null then v_fail := v_fail || 'C3 current_role still set' || E'\n'; end if;
  if public.has_permission('admin') then v_fail := v_fail || 'C3 has_permission(admin) still true' || E'\n'; end if;
  if cardinality(public.my_permissions()) <> 0 then v_fail := v_fail || 'C3 my_permissions not empty' || E'\n'; end if;
  select count(*) into v_n from public.profiles;
  if v_n <> 0 then v_fail := v_fail || format('C3 reads %s profiles', v_n) || E'\n'; end if;
  select count(*) into v_n from public.organizations;
  if v_n <> 0 then v_fail := v_fail || format('C3 reads %s organizations', v_n) || E'\n'; end if;
  if public.my_company_config() is not null then v_fail := v_fail || 'C3 my_company_config not null' || E'\n'; end if;
  v_res := public.my_company_closed();
  if v_res ->> 'name' is null or v_res ->> 'closed_at' is null then v_fail := v_fail || 'C3 my_company_closed: ' || coalesce(v_res::text, 'null') || E'\n'; end if;
  reset role;

  -- C4
  if v_other is null then
    v_info := v_info || 'C4 not run: only one company has active people' || E'\n';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if public.current_org_id() is distinct from v_other_org then v_fail := v_fail || 'C4 another company''s person lost their company' || E'\n'; end if;
    if public.my_company_closed() is not null then v_fail := v_fail || 'C4 another company shows as closed' || E'\n'; end if;
    reset role;
  end if;

  -- C5
  v_res := public.platform_set_company_closed(v_org, false, v_admin, null);
  if (v_res ->> 'changed')::boolean is not true then v_fail := v_fail || 'C5 reopen did not change: ' || v_res::text || E'\n'; end if;
  select status into v_txt from public.company_account where org_id = v_org;
  if v_txt is distinct from v_status then v_fail := v_fail || 'C5 status back as ' || v_txt || ', was ' || v_status || E'\n'; end if;
  select count(*) into v_n from public.company_account where org_id = v_org and (closed_at is not null or status_before_close is not null);
  if v_n <> 0 then v_fail := v_fail || 'C5 closed fields not cleared' || E'\n'; end if;
  select count(*) into v_n from public.platform_audit_log
   where target_org_id = v_org and action = 'company.reopen' and created_at >= now();
  if v_n <> 1 then v_fail := v_fail || format('C5 %s reopen audit rows', v_n) || E'\n'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.current_org_id() is distinct from v_org then v_fail := v_fail || 'C5 current_org_id not back' || E'\n'; end if;
  if not public.has_permission('admin') then v_fail := v_fail || 'C5 has_permission(admin) not back' || E'\n'; end if;
  if public.my_company_closed() is not null then v_fail := v_fail || 'C5 my_company_closed not null after reopen' || E'\n'; end if;
  reset role;

  if v_fail <> '' then
    raise exception E'CLOSE COMPANY FAILURES\n%\n%', v_fail, v_info;
  end if;
  raise exception E'ALL CLOSE COMPANY CHECKS PASSED\n%', v_info;
end
$$;
