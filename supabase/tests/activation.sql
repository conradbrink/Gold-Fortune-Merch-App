-- Control Centre activation suite.
--
--   A1  Grants: platform_company_activation() can't be executed by anon or
--       signed-in callers; the service role can.
--   A2  One row per company, and Gold Fortune (real use since July) reads as
--       activated, with a team, clients and a recent sign-in.
--   A3  A fresh company with one client and nothing else: first client set,
--       everything after it empty, no people.
--   A4  Asking for one company returns only that company.
--
-- HOW TO RUN: paste into execute_sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  v_org uuid;
  r record;
begin
  ------------------------------------------------------------ A1 grants
  if has_function_privilege('anon', 'public.platform_company_activation(uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.platform_company_activation(uuid[])', 'execute') then
    v_fail := v_fail || 'A1 platform_company_activation() is callable through the API' || E'\n';
  end if;
  if not has_function_privilege('service_role', 'public.platform_company_activation(uuid[])', 'execute') then
    v_fail := v_fail || 'A1 the service role cannot call platform_company_activation()' || E'\n';
  end if;

  ------------------------------------------------------------ A2 every company
  if (select count(*) from public.platform_company_activation()) <> (select count(*) from public.organizations) then
    v_fail := v_fail || 'A2 not one row per company' || E'\n';
  end if;
  select * into r from public.platform_company_activation() a
   where a.org_id = (select o.id from public.organizations o order by o.created_at limit 1);
  if r.first_job_finished_at is null or r.people < 2 or r.first_client_at is null or r.last_sign_in_at is null then
    v_fail := v_fail || 'A2 the first company (Gold Fortune) does not read as activated with a team' || E'\n';
  end if;

  ------------------------------------------------------------ A3 a fresh company
  insert into public.organizations (name) values ('A3 Test Company') returning id into v_org;
  insert into public.stores (org_id, name) values (v_org, 'A3 Test Site');
  select * into r from public.platform_company_activation() a where a.org_id = v_org;
  if r.first_client_at is null then v_fail := v_fail || 'A3 first client not seen' || E'\n'; end if;
  if r.people <> 0 or r.team_on_at is not null or r.first_workday_at is not null
     or r.first_job_started_at is not null or r.first_job_finished_at is not null or r.finished_days_14 <> 0 then
    v_fail := v_fail || 'A3 a fresh company shows milestones it has not reached' || E'\n';
  end if;

  ------------------------------------------------------------ A4 only the ones asked for
  if (select count(*) from public.platform_company_activation(array[v_org])) <> 1
     or (select a.org_id from public.platform_company_activation(array[v_org]) a) <> v_org then
    v_fail := v_fail || 'A4 asking for one company did not return just that company' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'ACTIVATION FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL ACTIVATION CHECKS PASSED (rolled back)';
end;
$$;
