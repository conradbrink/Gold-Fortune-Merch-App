-- Founding 10 suite.
--
--   F1  A full application saves with the defaults (status new, not notified);
--       a bad WhatsApp number, team size, trade, "how I run jobs", status, or a
--       missing marketing consent is refused by the table itself.
--   F2  founding_spots_left() is the platform setting, never below 0, and does
--       not move when applications arrive or are accepted.
--   F3  Grants: the table and the function are out of reach of signed-in and
--       anonymous callers; the service role can call the function.
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  v_left int; v_id uuid; v_status text; v_bad text;
begin
  select (value #>> '{}')::int into v_left from public.platform_settings where key = 'founding_spots_left';
  if v_left is null then v_fail := v_fail || 'F2 platform_settings.founding_spots_left is not set' || E'\n'; end if;

  ------------------------------------------------------------ F1 the table
  insert into public.founding_applications
    (name, business_name, whatsapp, trade, team_size, town, how_run, biggest_cost, whole_team, video_review, marketing_ok)
  values ('Test Owner', 'Test Cleaning', '27821234567', 'cleaning', '5-10', 'Gaborone', 'whatsapp', 'Staff say they were there.', true, true, true)
  returning id, status into v_id, v_status;
  if v_status <> 'new' then v_fail := v_fail || 'F1 a new application did not start as new' || E'\n'; end if;
  if (select notified_at from public.founding_applications where id = v_id) is not null then
    v_fail := v_fail || 'F1 a new application was already marked notified' || E'\n';
  end if;

  -- name, business, whatsapp, trade, team_size, town, how_run, biggest_cost, whole_team, video_review, marketing_ok, status
  foreach v_bad in array array[
    $q$('A', 'B', '082 123 4567', 'cleaning', '5-10', 'T', 'paper', 'x', true, true, true, 'new')$q$,
    $q$('A', 'B', '27821234567', 'Cleaning', '5-10', 'T', 'paper', 'x', true, true, true, 'new')$q$,
    $q$('A', 'B', '27821234567', 'cleaning', '4', 'T', 'paper', 'x', true, true, true, 'new')$q$,
    $q$('A', 'B', '27821234567', 'cleaning', '5-10', 'T', 'post', 'x', true, true, true, 'new')$q$,
    $q$('A', 'B', '27821234567', 'cleaning', '5-10', 'T', 'paper', 'x', true, true, false, 'new')$q$,
    $q$('A', 'B', '27821234567', 'cleaning', '5-10', 'T', 'paper', 'x', true, true, true, 'done')$q$,
    $q$('', 'B', '27821234567', 'cleaning', '5-10', 'T', 'paper', 'x', true, true, true, 'new')$q$,
    $q$('A', 'B', '27821234567', 'cleaning', '5-10', ' ', 'paper', 'x', true, true, true, 'new')$q$
  ] loop
    begin
      execute 'insert into public.founding_applications (name, business_name, whatsapp, trade, team_size, town, how_run, biggest_cost, whole_team, video_review, marketing_ok, status) values ' || v_bad;
      v_fail := v_fail || 'F1 a bad row was accepted: ' || v_bad || E'\n';
    exception when check_violation then null;
    end;
  end loop;

  ------------------------------------------------------------ F2 spots left
  if public.founding_spots_left() <> greatest(v_left, 0) then
    v_fail := v_fail || 'F2 founding_spots_left() is not the setting' || E'\n';
  end if;
  update public.founding_applications set status = 'accepted' where id = v_id;
  if public.founding_spots_left() <> greatest(v_left, 0) then
    v_fail := v_fail || 'F2 an accepted application moved the spots left' || E'\n';
  end if;
  update public.platform_settings set value = '-3' where key = 'founding_spots_left';
  if public.founding_spots_left() <> 0 then v_fail := v_fail || 'F2 spots left went below zero' || E'\n'; end if;
  update public.platform_settings set value = '7' where key = 'founding_spots_left';
  if public.founding_spots_left() <> 7 then v_fail := v_fail || 'F2 a changed setting was not read' || E'\n'; end if;

  ------------------------------------------------------------ F3 grants
  if has_table_privilege('authenticated', 'public.founding_applications', 'select')
     or has_table_privilege('anon', 'public.founding_applications', 'select')
     or has_table_privilege('authenticated', 'public.founding_applications', 'insert')
     or has_table_privilege('anon', 'public.founding_applications', 'insert') then
    v_fail := v_fail || 'F3 founding_applications is reachable through the API' || E'\n';
  end if;
  if has_function_privilege('authenticated', 'public.founding_spots_left()', 'execute')
     or has_function_privilege('anon', 'public.founding_spots_left()', 'execute') then
    v_fail := v_fail || 'F3 founding_spots_left() is callable through the API' || E'\n';
  end if;
  if not has_function_privilege('service_role', 'public.founding_spots_left()', 'execute') then
    v_fail := v_fail || 'F3 the service role cannot call founding_spots_left()' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'FOUNDING FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL FOUNDING CHECKS PASSED (rolled back)';
end;
$$;
