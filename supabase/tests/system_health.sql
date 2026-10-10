-- Control Centre system health suite.
--
--   H1  Grants: platform_system_health() can't be executed by anonymous or
--       signed-in callers; the service role can.
--   H2  It lists every scheduled job, and counts a failed email from the last
--       24 hours and an email stuck in the queue.
--
-- HOW TO RUN: paste into execute_sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  j jsonb; before_failed int; before_waiting int;
begin
  if has_function_privilege('anon', 'public.platform_system_health()', 'execute')
     or has_function_privilege('authenticated', 'public.platform_system_health()', 'execute') then
    v_fail := v_fail || 'H1 platform_system_health() is callable through the API' || E'\n';
  end if;
  if not has_function_privilege('service_role', 'public.platform_system_health()', 'execute') then
    v_fail := v_fail || 'H1 the service role cannot call platform_system_health()' || E'\n';
  end if;

  j := public.platform_system_health();
  if jsonb_array_length(j->'jobs') <> (select count(*) from cron.job) then
    v_fail := v_fail || 'H2 not every scheduled job is listed' || E'\n';
  end if;
  before_failed := (j->>'emails_failed_24h')::int;
  before_waiting := (j->>'emails_waiting')::int;

  insert into public.message_outbox (channel, to_address, template, payload, status, send_after)
  values ('email', 'h2-failed@example.com', 'health_test', '{}'::jsonb, 'failed', now() - interval '1 hour'),
         ('email', 'h2-stuck@example.com',  'health_test', '{}'::jsonb, 'queued', now() - interval '2 hours');
  j := public.platform_system_health();
  if (j->>'emails_failed_24h')::int <> before_failed + 1 then
    v_fail := v_fail || 'H2 a failed email was not counted' || E'\n';
  end if;
  if (j->>'emails_waiting')::int <> before_waiting + 1 then
    v_fail := v_fail || 'H2 a stuck email was not counted' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'SYSTEM HEALTH FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL SYSTEM HEALTH CHECKS PASSED (rolled back)';
end;
$$;
