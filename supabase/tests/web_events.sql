-- Website events suite.
--
--   W1  Grants: web_events and platform_web_stats() are out of reach of
--       anonymous and signed-in callers; the service role can use both.
--   W2  The table refuses what it shouldn't hold: a path that isn't a path,
--       an unknown click type, a lower-case country, a made-up device.
--   W3  The numbers: two visitors, three page views, two visits; one started
--       applying on /founding; a returning visitor isn't new; a filter by device
--       keeps only that device; sources count people, per source.
--
-- HOW TO RUN: paste into execute_sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  t0 timestamptz := now() - interval '1 hour';
  j jsonb; v_bad text;
begin
  ------------------------------------------------------------ W1 grants
  if has_table_privilege('anon', 'public.web_events', 'insert') or has_table_privilege('anon', 'public.web_events', 'select')
     or has_table_privilege('authenticated', 'public.web_events', 'insert') or has_table_privilege('authenticated', 'public.web_events', 'select') then
    v_fail := v_fail || 'W1 web_events is reachable through the API' || E'\n';
  end if;
  if has_function_privilege('anon', 'public.platform_web_stats(timestamptz, timestamptz, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.platform_web_stats(timestamptz, timestamptz, text, text, text)', 'execute') then
    v_fail := v_fail || 'W1 platform_web_stats() is callable through the API' || E'\n';
  end if;
  if not has_function_privilege('service_role', 'public.platform_web_stats(timestamptz, timestamptz, text, text, text)', 'execute') then
    v_fail := v_fail || 'W1 the service role cannot call platform_web_stats()' || E'\n';
  end if;

  ------------------------------------------------------------ W2 refusals
  foreach v_bad in array array[
    $q$('page_view', 'founding', 'x', null, null)$q$,
    $q$('page_view', '/', 'x', 'abc123', null)$q$,
    $q$('page_view', '/', 'x', null, 'za')$q$,
    $q$('Page View', '/', null, null, null)$q$
  ] loop
    begin
      execute format('insert into public.web_events (visitor_id, session_id, name, path, device, click_id, country) select %L, %L, v.*',
                     a, s1) || ' from (values ' || v_bad || ') v(name, path, device, click_id, country)';
      v_fail := v_fail || 'W2 a bad row was accepted: ' || v_bad || E'\n';
    exception when check_violation then null;
    end;
  end loop;

  ------------------------------------------------------------ W3 numbers
  -- b visited before the period: not new.
  insert into public.web_events (at, name, visitor_id, session_id, path, device) values
    (t0 - interval '3 days', 'page_view', b, gen_random_uuid(), '/', 'desktop');
  insert into public.web_events (at, name, visitor_id, session_id, path, device, utm_source, utm_medium, utm_campaign, click_id) values
    (t0 + interval '1 minute', 'page_view',      a, s1, '/',         'mobile', 'facebook', 'paid_social', 'founding-oct', 'fbclid'),
    (t0 + interval '2 minute', 'page_view',      a, s1, '/founding', 'mobile', 'facebook', 'paid_social', 'founding-oct', 'fbclid'),
    (t0 + interval '3 minute', 'signup_started', a, s1, '/founding', 'mobile', 'facebook', 'paid_social', 'founding-oct', 'fbclid');
  insert into public.web_events (at, name, visitor_id, session_id, path, device, referrer_host) values
    (t0 + interval '5 minute', 'page_view', b, s2, '/', 'desktop', 'www.google.co.za');

  j := public.platform_web_stats(t0, now() + interval '1 minute');
  if (j->>'visitors')::int < 2 or (j->>'page_views')::int < 3 or (j->>'sessions')::int < 2 then
    v_fail := v_fail || 'W3 totals too low: ' || (j - 'daily' - 'pages' - 'sources')::text || E'\n';
  end if;
  -- Only test rows in this window, so exact counts hold when the table is otherwise quiet; check the test rows' share.
  if not exists (select 1 from jsonb_array_elements(j->'pages') p where p->>'path' = '/founding' and (p->>'started')::int >= 1) then
    v_fail := v_fail || 'W3 /founding has no one starting an application' || E'\n';
  end if;
  if (select count(*) from jsonb_array_elements(j->'sources') s where s->>'utm_campaign' = 'founding-oct' and (s->>'visitors')::int = 1 and (s->>'started')::int = 1) <> 1 then
    v_fail := v_fail || 'W3 the founding-oct source does not count one visitor who started' || E'\n';
  end if;
  j := public.platform_web_stats(t0, now() + interval '1 minute', 'Africa/Johannesburg', 'mobile');
  if exists (select 1 from jsonb_array_elements(j->'sources') s where s->>'referrer' = 'www.google.co.za') then
    v_fail := v_fail || 'W3 the mobile filter kept a desktop visit' || E'\n';
  end if;
  j := public.platform_web_stats(t0, now() + interval '1 minute');
  if (j->>'new_visitors')::int > (j->>'visitors')::int - 1 then
    v_fail := v_fail || 'W3 a returning visitor was counted as new' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'WEB EVENTS FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL WEB EVENTS CHECKS PASSED (rolled back)';
end;
$$;
