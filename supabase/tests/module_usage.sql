-- Control Centre module usage suite.
--
--   U1  Grants: platform_module_usage() can't be executed by anonymous or
--       signed-in callers; the service role can.
--   U2  A store and a route made inside the period show a company using
--       recurring jobs; outside the period they don't count; every module code
--       returned is a real, built module.
--
-- HOW TO RUN: paste into execute_sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  v_org uuid; v_store uuid; n bigint;
begin
  if has_function_privilege('anon', 'public.platform_module_usage(timestamptz, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.platform_module_usage(timestamptz, timestamptz)', 'execute') then
    v_fail := v_fail || 'U1 platform_module_usage() is callable through the API' || E'\n';
  end if;
  if not has_function_privilege('service_role', 'public.platform_module_usage(timestamptz, timestamptz)', 'execute') then
    v_fail := v_fail || 'U1 the service role cannot call platform_module_usage()' || E'\n';
  end if;

  if exists (
    select 1 from public.platform_module_usage(now() - interval '400 days', now()) u
    where not exists (select 1 from public.modules m where m.code = u.module_code and m.is_built)
  ) then
    v_fail := v_fail || 'U2 a module code that is not a built module was returned' || E'\n';
  end if;

  insert into public.organizations (name) values ('U2 Test Company') returning id into v_org;
  insert into public.stores (org_id, name) values (v_org, 'U2 Site') returning id into v_store;
  insert into public.routes (org_id, store_id, rep_id, scheduled_date)
  select v_org, v_store, p.id, current_date from public.profiles p limit 1;
  select u.n into n from public.platform_module_usage(now() - interval '1 hour', now() + interval '1 hour') u
   where u.org_id = v_org and u.module_code = 'recurring_jobs';
  if coalesce(n, 0) <> 1 then
    v_fail := v_fail || 'U2 a planned job in the period was not counted (got ' || coalesce(n, 0) || ')' || E'\n';
  end if;
  if exists (select 1 from public.platform_module_usage(now() - interval '10 days', now() - interval '5 days') u where u.org_id = v_org) then
    v_fail := v_fail || 'U2 activity outside the period was counted' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'MODULE USAGE FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL MODULE USAGE CHECKS PASSED (rolled back)';
end;
$$;
