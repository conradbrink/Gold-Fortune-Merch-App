-- Welcome and trial-offer suite (10 Oct 2026).
--
--   W1  A founding application can carry an email address; a bad one is refused;
--       an earlier row without one stays valid.
--   W2  The trial offer: a company on its trial for 45 days or more is asked
--       once, by email to its administrator, with its trial's end; younger,
--       paid, read-only, exempt (Gold Fortune) and past-trial companies are
--       not; a second run asks no one again.
--   W3  The day is the owner's: platform_settings trial_offer_day.
--   W4  Grants, the daily job and the table's registration.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner_email text; v_n int; v_status text; v_j jsonb;
begin
  ---------------------------------------------------------------- W1 application email
  begin
    insert into public.founding_applications (name, business_name, whatsapp, trade, team_size, town, how_run, biggest_cost, whole_team, video_review, marketing_ok, email)
    values ('A', 'B', '27820000000', 'cleaning', '5-10', 'Town', 'paper', 'Late starts', true, true, true, 'not an email');
    v_fail := v_fail || 'W1 a bad application email was accepted' || E'\n';
  exception when check_violation then null;
  end;
  insert into public.founding_applications (name, business_name, whatsapp, trade, team_size, town, how_run, biggest_cost, whole_team, video_review, marketing_ok, email)
  values ('A', 'B', '27820000000', 'cleaning', '5-10', 'Town', 'paper', 'Late starts', true, true, true, 'a@example.com');
  insert into public.founding_applications (name, business_name, whatsapp, trade, team_size, town, how_run, biggest_cost, whole_team, video_review, marketing_ok)
  values ('C', 'D', '27820000001', 'cleaning', '5-10', 'Town', 'paper', 'Late starts', true, true, true);

  ---------------------------------------------------------------- W2 the offer
  select a.org_id into v_org from public.company_account a where a.status = 'trial' and a.org_id <> c_gf order by a.created_at limit 1;
  if v_org is null then
    raise exception 'Fixtures missing: a company on a trial';
  end if;
  update public.company_account set created_at = now() - interval '46 days', trial_ends_at = now() + interval '14 days' where org_id = v_org;
  delete from public.trial_offers;
  delete from public.message_outbox where template = 'trial_offer';
  v_n := public.queue_trial_offers();
  select to_address into v_owner_email from public.trial_offers where org_id = v_org;
  select count(*) into v_n from public.message_outbox where template = 'trial_offer' and org_id = v_org and related_kind = 'trial_offer' and related_id = v_org;
  if v_owner_email is null or v_n <> 1 then
    v_fail := v_fail || format('W2 the company due its offer got %s emails to %s, want 1', v_n, v_owner_email) || E'\n';
  end if;
  select payload into v_j from public.message_outbox where template = 'trial_offer' and org_id = v_org;
  if v_j ->> 'company_name' is null or (v_j ->> 'days_left')::int not between 13 and 14 or v_j ->> 'trial_ends_at' is null then
    v_fail := v_fail || format('W2 the offer''s payload is wrong: %s', v_j::text) || E'\n';
  end if;
  if exists (select 1 from public.message_outbox where template = 'trial_offer' and org_id = c_gf)
     or exists (select 1 from public.trial_offers where org_id = c_gf) then
    v_fail := v_fail || 'W2 Gold Fortune was sent a trial offer' || E'\n';
  end if;
  if public.queue_trial_offers() <> 0
     or (select count(*) from public.message_outbox where template = 'trial_offer' and org_id = v_org) <> 1 then
    v_fail := v_fail || 'W2 a second run asked the same company again' || E'\n';
  end if;
  -- Too young, paid, read only, past its trial: nobody.
  delete from public.trial_offers; delete from public.message_outbox where template = 'trial_offer';
  update public.company_account set created_at = now() - interval '30 days' where org_id = v_org;
  if public.queue_trial_offers() <> 0 then v_fail := v_fail || 'W2 a company of 30 days was asked' || E'\n'; end if;
  update public.company_account set created_at = now() - interval '46 days', status = 'read_only' where org_id = v_org;
  if public.queue_trial_offers() <> 0 then v_fail := v_fail || 'W2 a read-only company was asked' || E'\n'; end if;
  update public.company_account set status = 'active' where org_id = v_org;
  if public.queue_trial_offers() <> 0 then v_fail := v_fail || 'W2 a paying company was asked' || E'\n'; end if;
  update public.company_account set status = 'trial', trial_ends_at = now() - interval '1 day' where org_id = v_org;
  if public.queue_trial_offers() <> 0 then v_fail := v_fail || 'W2 a company whose trial had ended was asked' || E'\n'; end if;

  ---------------------------------------------------------------- W3 the owner's day
  update public.company_account set status = 'trial', trial_ends_at = now() + interval '14 days', created_at = now() - interval '20 days' where org_id = v_org;
  if public.queue_trial_offers() <> 0 then v_fail := v_fail || 'W3 a 20-day company was asked at 45' || E'\n'; end if;
  update public.platform_settings set value = '15' where key = 'trial_offer_day';
  v_n := public.queue_trial_offers();
  if v_n < 1 or not exists (select 1 from public.trial_offers where org_id = v_org) then
    v_fail := v_fail || format('W3 the setting did not change the day: queued %s; %s; %s', v_n,
      (select row_to_json(x)::text from (select status, created_at, trial_ends_at from public.company_account where org_id = v_org) x),
      (select value::text from public.platform_settings where key = 'trial_offer_day')) || E'\n';
  end if;
  update public.platform_settings set value = '45' where key = 'trial_offer_day';

  ---------------------------------------------------------------- W4 grants
  if has_function_privilege('authenticated', 'public.queue_trial_offers()', 'execute')
     or has_function_privilege('anon', 'public.queue_trial_offers()', 'execute')
     or has_table_privilege('authenticated', 'public.trial_offers', 'select')
     or not exists (select 1 from cron.job where jobname = 'trial-offers' and schedule = '0 7 * * *')
     or not exists (select 1 from public.module_assignments where kind = 'table' and name = 'trial_offers')
     or not exists (select 1 from public.platform_settings where key = 'trial_offer_day') then
    v_fail := v_fail || 'W4 a grant, the daily job or the registration is wrong' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'TRIAL OFFER FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL TRIAL OFFER CHECKS PASSED (rolled back)';
end;
$$;
