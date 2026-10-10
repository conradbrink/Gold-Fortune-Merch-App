-- Founding 10 suite.
--
--   F1  An application saves with the defaults (status new, not notified);
--       a bad WhatsApp number, team size, trade or status is refused by the
--       table itself.
--   F2  founding_spots(): total from platform_settings, taken counts only the
--       accepted applications, left never goes below 0.
--   F3  Grants: the table and the function are out of reach of signed-in and
--       anonymous callers.
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  v_total int; v_before jsonb; v_after jsonb; v_id uuid; v_status text;
  v_bad text;
begin
  select (value #>> '{}')::int into v_total from public.platform_settings where key = 'founding_spots';
  if v_total is null then v_fail := v_fail || 'F2 platform_settings.founding_spots is not set' || E'\n'; end if;
  v_before := public.founding_spots();

  ------------------------------------------------------------ F1 the table
  insert into public.founding_applications (name, whatsapp, business_name, trade, team_size)
  values ('Test Owner', '27821234567', 'Test Cleaning', 'cleaning', '3-5') returning id, status into v_id, v_status;
  if v_status <> 'new' then v_fail := v_fail || 'F1 a new application did not start as new' || E'\n'; end if;
  if (select notified_at from public.founding_applications where id = v_id) is not null then
    v_fail := v_fail || 'F1 a new application was already marked notified' || E'\n';
  end if;

  foreach v_bad in array array[
    $q$('A', '082 123 4567', 'B', 'cleaning', '3-5', 'new')$q$,
    $q$('A', '27821234567', 'B', 'Cleaning', '3-5', 'new')$q$,
    $q$('A', '27821234567', 'B', 'cleaning', '4', 'new')$q$,
    $q$('A', '27821234567', 'B', 'cleaning', '3-5', 'done')$q$,
    $q$('', '27821234567', 'B', 'cleaning', '3-5', 'new')$q$
  ] loop
    begin
      execute 'insert into public.founding_applications (name, whatsapp, business_name, trade, team_size, status) values ' || v_bad;
      v_fail := v_fail || 'F1 a bad row was accepted: ' || v_bad || E'\n';
    exception when check_violation then null;
    end;
  end loop;

  ------------------------------------------------------------ F2 spots left
  v_after := public.founding_spots();
  if (v_after->>'taken')::int <> (v_before->>'taken')::int then
    v_fail := v_fail || 'F2 a new (not accepted) application took a spot' || E'\n';
  end if;
  update public.founding_applications set status = 'contacted' where id = v_id;
  if (public.founding_spots()->>'taken')::int <> (v_before->>'taken')::int then
    v_fail := v_fail || 'F2 a contacted application took a spot' || E'\n';
  end if;
  update public.founding_applications set status = 'accepted' where id = v_id;
  v_after := public.founding_spots();
  if (v_after->>'taken')::int <> (v_before->>'taken')::int + 1 then
    v_fail := v_fail || 'F2 an accepted application did not take a spot' || E'\n';
  end if;
  if (v_after->>'left')::int <> greatest(v_total - (v_after->>'taken')::int, 0) then
    v_fail := v_fail || 'F2 left is not total minus taken' || E'\n';
  end if;
  update public.platform_settings set value = '0' where key = 'founding_spots';
  if (public.founding_spots()->>'left')::int <> 0 then
    v_fail := v_fail || 'F2 left went below zero or ignored the setting' || E'\n';
  end if;

  ------------------------------------------------------------ F3 grants
  if has_table_privilege('authenticated', 'public.founding_applications', 'select')
     or has_table_privilege('anon', 'public.founding_applications', 'select')
     or has_table_privilege('authenticated', 'public.founding_applications', 'insert')
     or has_table_privilege('anon', 'public.founding_applications', 'insert') then
    v_fail := v_fail || 'F3 founding_applications is reachable through the API' || E'\n';
  end if;
  if has_function_privilege('authenticated', 'public.founding_spots()', 'execute')
     or has_function_privilege('anon', 'public.founding_spots()', 'execute') then
    v_fail := v_fail || 'F3 founding_spots() is callable through the API' || E'\n';
  end if;
  if not has_function_privilege('service_role', 'public.founding_spots()', 'execute') then
    v_fail := v_fail || 'F3 the service role cannot call founding_spots()' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'FOUNDING FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL FOUNDING CHECKS PASSED (rolled back)';
end;
$$;
