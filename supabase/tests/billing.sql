-- Billing and read-only suite (Stage 6).
--
-- One trial company, followed through its life:
--   B1  quotes: base, extra users, add-ons, setup on the first monthly only,
--       yearly, a custom price, VAT only when the seller has a VAT number.
--   B2  the trial's user limit refuses one login too many.
--   B3  the trial ends unpaid: the daily run makes the company read-only, and
--       the gate refuses its writes (tables and definer functions) while
--       reads, the Billing page's functions and Gold Fortune are unaffected.
--   B4  first payment: start_checkout (only the latest can be paid; refused
--       for a field employee, and for fewer seats than active users), then
--       record_payment — invoice numbered, plan active, card token kept and
--       unreadable through the API, writable again; the same payment twice
--       gives one invoice; a wrong amount is refused.
--   B5  more seats today, pro-rata; fewer from the next renewal; the plan's
--       seats limit logins.
--   B6  renewal: written once however often the run fires; a failed charge
--       goes to past due with retries on the retry days, then read-only when
--       the grace period ends.
--   B7  operator: an EFT marked paid restores the company (period from today),
--       credit notes are capped at the invoice, exempt and back, extend trial
--       refused for a company that has paid; every action audited.
--   B8  Gold Fortune: exempt, writable, no user limit, its rows untouched.
--   B9  grants and isolation: server-only functions out of reach of signed-in
--       callers; the payment log unreadable; invoices only for the company's
--       settings managers, and only its own.
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives — including the two quiet
-- Gold Fortune logins it removes and re-creates as the trial's people.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text;
  v_gf_admin uuid; v_operator uuid;
  v_j jsonb; v_q jsonb; v_c jsonb; v_charge uuid; v_charge2 uuid; v_inv uuid; v_inv2 uuid;
  v_n int; v_t text; v_b bigint; v_ts timestamptz;
  v_gf_before text; v_gf_after text;
begin
  select p.id into v_gf_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select user_id into v_operator from public.platform_admins limit 1;
  if v_gf_admin is null or v_operator is null then
    raise exception 'Fixtures missing: a Gold Fortune administrator and a platform operator are needed.';
  end if;

  select p.id, p.email into v_owner, v_owner_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id <> v_gf_admin
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  select p.id, p.email into v_staff, v_staff_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id not in (v_owner, v_gf_admin)
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  if v_owner is null or v_staff is null then
    raise exception 'Fixtures missing: two quiet logins are needed.';
  end if;
  delete from public.profiles where id in (v_owner, v_staff);

  -- Gold Fortune's own rows, to compare at the end (less the two borrowed logins).
  select md5(string_agg(t::text, '|' order by t::text)) into v_gf_before
    from (select status, plan, period, provider_token from public.company_account where org_id = c_gf
          union all select null, to_jsonb(cm.*), null, null from public.company_modules cm where cm.org_id = c_gf) t;

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Billing check', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg',
                       'owner', jsonb_build_object('full_name', 'Billing Owner', 'email', v_owner_email)),
    array['installation'], v_owner);
  if (select status from public.company_account where org_id = v_org) <> 'trial' then
    v_fail := v_fail || 'setup: a new sign-up is not on trial' || E'\n';
  end if;

  ------------------------------------------------------------------ B1 quotes
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.billing_quote('monthly', 3, '{}');
  if (v_q->>'total_cents')::bigint <> 149900 + 250000 then
    v_fail := v_fail || format('B1 monthly 3 users = %s, expected base + setup 399900%s', v_q->>'total_cents', E'\n');
  end if;
  v_q := public.billing_quote('yearly', 3, '{}');
  if (v_q->>'total_cents')::bigint <> 1499000 then
    v_fail := v_fail || format('B1 yearly 3 users = %s, expected 1499000 (no setup)%s', v_q->>'total_cents', E'\n');
  end if;
  v_q := public.billing_quote('monthly', 10, '{"warehouse": 2, "hr": 1}');
  -- base + 7 extra + 2 warehouses + HR up to 5 employees (none yet) + setup
  if (v_q->>'total_cents')::bigint <> 149900 + 7 * 34900 + 2 * 49900 + 19900 + 250000 then
    v_fail := v_fail || format('B1 monthly 10 users + 2 warehouses + HR = %s%s', v_q->>'total_cents', E'\n');
  end if;
  if (v_q->'vat'->>'vat_cents')::bigint <> 0 or (v_q->'vat'->>'registered')::boolean then
    v_fail := v_fail || 'B1 VAT charged although the seller has no VAT number' || E'\n';
  end if;
  begin
    perform public.billing_quote('monthly', 3, '{"assets": 1}');
    v_fail := v_fail || 'B1 an unbuilt add-on was priced' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.billing_quote('weekly', 3, '{}');
    v_fail := v_fail || 'B1 a weekly plan was priced' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  -- HR tier from the number of active employees: Gold Fortune has 5.
  v_q := public.billing_lines(c_gf, 'yearly', '{"seats": 3, "addons": {"hr": 1}}', false);
  if (v_q->>'total_cents')::bigint <> 1499000 + 199000 then
    v_fail := v_fail || format('B1 yearly HR tier for 5 employees: %s%s', v_q->>'total_cents', E'\n');
  end if;
  -- VAT inside the price once the seller is registered.
  update public.platform_settings set value = '"4123456789"' where key = 'seller_vat_number';
  if (public.billing_vat(399900)->>'vat_cents')::bigint <> 52161 then
    v_fail := v_fail || format('B1 VAT in R3,999: %s, expected 52161%s', public.billing_vat(399900)->>'vat_cents', E'\n');
  end if;
  update public.platform_settings set value = 'null' where key = 'seller_vat_number';
  -- A custom price replaces the list.
  update public.company_account set custom_price_cents = 777700 where org_id = v_org;
  if (public.billing_lines(v_org, 'monthly', '{"seats": 50}', true)->>'total_cents')::bigint <> 777700 then
    v_fail := v_fail || 'B1 the custom price did not replace the price list' || E'\n';
  end if;
  update public.company_account set custom_price_cents = null where org_id = v_org;

  ------------------------------------------------------------ B2 trial limit
  update public.platform_settings set value = '1' where key = 'trial_user_limit';
  begin
    insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
    values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
            'Billing Staff', v_staff_email);
    v_fail := v_fail || 'B2 a second login was accepted on a one-user trial' || E'\n';
  exception when raise_exception then
    get stacked diagnostics v_t = pg_exception_hint;
    if v_t is distinct from 'user_limit' then v_fail := v_fail || 'B2 refused, but not by the user limit' || E'\n'; end if;
  end;
  update public.platform_settings set value = '10' where key = 'trial_user_limit';
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Billing Staff', v_staff_email);

  -------------------------------------------------- B3 trial ends: read-only
  -- Writable while on trial.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.stores (org_id, name) values (v_org, 'Billing check site before');
  reset role;

  update public.company_account set trial_ends_at = now() - interval '1 minute' where org_id = v_org;
  v_j := public.billing_prepare_due(now());
  if (select status from public.company_account where org_id = v_org) <> 'read_only' then
    v_fail := v_fail || 'B3 an ended trial did not become read-only' || E'\n';
  end if;
  if (v_j->>'trials_ended')::int < 1 then v_fail := v_fail || 'B3 the run did not count the ended trial' || E'\n'; end if;

  set local role authenticated;
  if (public.my_account()->>'writable')::boolean then v_fail := v_fail || 'B3 my_account says writable' || E'\n'; end if;
  begin
    insert into public.stores (org_id, name) values (v_org, 'Billing check site after');
    v_fail := v_fail || 'B3 a read-only company inserted a row' || E'\n';
  exception when insufficient_privilege then null;
  end;
  update public.stores set name = 'renamed' where org_id = v_org;
  get diagnostics v_n = row_count;
  if v_n <> 0 then v_fail := v_fail || 'B3 a read-only company updated a row' || E'\n'; end if;
  delete from public.stores where org_id = v_org;
  get diagnostics v_n = row_count;
  if v_n <> 0 then v_fail := v_fail || 'B3 a read-only company deleted a row' || E'\n'; end if;
  if (select count(*) from public.stores where org_id = v_org) <> 1 then
    v_fail := v_fail || 'B3 a read-only company cannot read its own rows' || E'\n';
  end if;
  begin
    perform public.save_job_role(null, 'Billing check role', null, 'rep', true, '{}'::text[]);
    v_fail := v_fail || 'B3 a definer function wrote for a read-only company' || E'\n';
  exception when insufficient_privilege then
    get stacked diagnostics v_t = pg_exception_hint;
    if v_t is distinct from 'read_only' then v_fail := v_fail || format('B3 save_job_role refused, hint %s%s', v_t, E'\n'); end if;
  end;
  -- The way out stays open.
  perform public.billing_quote('monthly', 3, '{}');
  reset role;
  -- Gold Fortune is not touched by another company's state.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.company_writable() then v_fail := v_fail || 'B3 Gold Fortune is not writable' || E'\n'; end if;
  insert into public.stores (org_id, name) values (c_gf, 'Billing check GF site');
  reset role;

  -------------------------------------------------------- B4 first payment
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.billing_start_checkout('monthly', 3, '{}', 'owner@example.com');
    v_fail := v_fail || 'B4 a field employee started a payment' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.billing_start_checkout('monthly', 1, '{}', 'owner@example.com');
    v_fail := v_fail || 'B4 fewer seats than active users were accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  v_c := public.billing_start_checkout('monthly', 3, '{}', 'first@example.com');
  v_charge := (v_c->>'charge_id')::uuid;
  v_c := public.billing_start_checkout('monthly', 3, '{}', 'owner@example.com');
  v_charge2 := (v_c->>'charge_id')::uuid;
  if (v_c->>'total_cents')::bigint <> 399900 then
    v_fail := v_fail || format('B4 first payment %s, expected 399900%s', v_c->>'total_cents', E'\n');
  end if;
  reset role;
  if (select status from public.billing_charges where id = v_charge) <> 'cancelled' then
    v_fail := v_fail || 'B4 an earlier unpaid start was not cancelled' || E'\n';
  end if;
  begin
    perform public.billing_record_payment(v_charge2, 'pf-test-1', 399800, 'tok-test', 'notify', '{}');
    v_fail := v_fail || 'B4 a wrong amount was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  select coalesce(max(number), '') into v_t from public.billing_invoices;
  v_inv := public.billing_record_payment(v_charge2, 'pf-test-1', 399900, 'tok-test', 'notify', '{"payment_status":"COMPLETE"}');
  v_inv2 := public.billing_record_payment(v_charge2, 'pf-test-1', 399900, 'tok-test', 'charge', '{}');
  if v_inv is distinct from v_inv2 then v_fail := v_fail || 'B4 the same payment twice gave two invoices' || E'\n'; end if;
  if (select count(*) from public.billing_invoices where charge_id = v_charge2) <> 1 then
    v_fail := v_fail || 'B4 more than one invoice for one charge' || E'\n';
  end if;
  if (select number from public.billing_invoices where id = v_inv) <= v_t then
    v_fail := v_fail || 'B4 the invoice number did not move forward' || E'\n';
  end if;
  if not exists (select 1 from public.company_account
                  where org_id = v_org and status = 'active' and period = 'monthly'
                    and (plan->>'seats')::int = 3 and provider_token = 'tok-test' and setup_charged
                    and abs(extract(epoch from period_start - now())) < 5
                    and period_end = period_start + interval '1 month'
                    and billing_email = 'owner@example.com' and read_only_since is null) then
    v_fail := v_fail || 'B4 the paid plan was not recorded as expected' || E'\n';
  end if;
  if (select total_cents from public.billing_invoices where id = v_inv) <> 399900
     or (select vat_cents from public.billing_invoices where id = v_inv) <> 0 then
    v_fail := v_fail || 'B4 the invoice total or VAT is wrong' || E'\n';
  end if;
  set local role authenticated;
  if not public.company_writable() then v_fail := v_fail || 'B4 still read-only after paying' || E'\n'; end if;
  insert into public.stores (org_id, name) values (v_org, 'Billing check site paid');
  begin
    perform provider_token from public.company_account where org_id = v_org;
    v_fail := v_fail || 'B4 the card token is readable through the API' || E'\n';
  exception when insufficient_privilege then null;
  end;
  -- No setup a second time.
  if exists (select 1 from jsonb_array_elements(public.billing_quote('monthly', 3, '{}')->'lines') l
              where l->>'code' = 'setup') then
    v_fail := v_fail || 'B4 setup offered again after it was paid' || E'\n';
  end if;

  ---------------------------------------------------------- B5 change plan
  v_j := public.billing_preview_change(5, '{}');
  -- The period started a moment ago: two extra users for (almost) the whole month.
  if (v_j->>'total_cents')::bigint not between 69790 and 69800 then
    v_fail := v_fail || format('B5 two more users today: %s, expected about 69800%s', v_j->>'total_cents', E'\n');
  end if;
  v_c := public.billing_request_change(5, '{}');
  reset role;
  perform public.billing_record_payment((v_c->>'charge_id')::uuid, 'pf-test-2', (v_c->>'total_cents')::bigint,
                                        null, 'charge', '{}');
  if (select (plan->>'seats')::int from public.company_account where org_id = v_org) <> 5 then
    v_fail := v_fail || 'B5 paid seats did not go up' || E'\n';
  end if;
  set local role authenticated;
  if public.billing_request_change(4, '{}') is not null then
    v_fail := v_fail || 'B5 fewer seats were charged' || E'\n';
  end if;
  reset role;
  if not exists (select 1 from public.company_account where org_id = v_org
                  and (plan->>'seats')::int = 5 and (plan_next->>'seats')::int = 4) then
    v_fail := v_fail || 'B5 fewer seats did not wait for the renewal' || E'\n';
  end if;
  -- The plan's seats limit logins.
  update public.profiles set is_active = false where id = v_staff;
  update public.company_account set plan = '{"seats": 1, "addons": {}}', plan_next = null where org_id = v_org;
  begin
    update public.profiles set is_active = true where id = v_staff;
    v_fail := v_fail || 'B5 a login past the paid seats was activated' || E'\n';
  exception when raise_exception then null;
  end;
  update public.company_account set plan = '{"seats": 5, "addons": {}}' where org_id = v_org;
  update public.profiles set is_active = true where id = v_staff;

  --------------------------------------------------------------- B6 renewal
  update public.company_account
     set period_start = now() - interval '1 month 1 day', period_end = now() - interval '1 day'
   where org_id = v_org;
  v_j := public.billing_prepare_due(now());
  v_j := public.billing_prepare_due(now());
  if (select count(*) from public.billing_charges where org_id = v_org and reason = 'renewal') <> 1 then
    v_fail := v_fail || 'B6 the renewal was not written exactly once' || E'\n';
  end if;
  select id into v_charge from public.billing_charges where org_id = v_org and reason = 'renewal';
  if not exists (select 1 from jsonb_array_elements(v_j->'charge') x
                  where (x->>'charge_id')::uuid = v_charge and x->>'token' = 'tok-test') then
    v_fail := v_fail || 'B6 the renewal was not handed out to charge' || E'\n';
  end if;
  if (select total_cents from public.billing_charges where id = v_charge) <> 149900 + 2 * 34900 then
    v_fail := v_fail || 'B6 the renewal is not 5 users monthly' || E'\n';
  end if;
  perform public.billing_record_failure(v_charge, 'failed', 'Declined', 'charge', '{}');
  if not exists (select 1 from public.company_account where org_id = v_org and status = 'past_due'
                  and abs(extract(epoch from grace_ends_at - (now() + interval '7 days'))) < 5) then
    v_fail := v_fail || 'B6 a failed renewal did not start the grace period' || E'\n';
  end if;
  if (public.billing_prepare_due(now())->'charge') @> jsonb_build_array(jsonb_build_object('charge_id', v_charge)) then
    v_fail := v_fail || 'B6 a failed renewal was retried the same day' || E'\n';
  end if;
  if not ((public.billing_prepare_due(now() + interval '2 days')->'charge') @> jsonb_build_array(jsonb_build_object('charge_id', v_charge))) then
    v_fail := v_fail || 'B6 the day-1 retry was not handed out' || E'\n';
  end if;
  perform public.billing_record_failure(v_charge, 'failed', 'Declined', 'charge', '{}');
  perform public.billing_record_failure(v_charge, 'failed', 'Declined', 'charge', '{}');
  perform public.billing_record_failure(v_charge, 'failed', 'Declined', 'charge', '{}');
  if (select status from public.billing_charges where id = v_charge) <> 'failed'
     or (select attempts from public.billing_charges where id = v_charge) <> 4 then
    v_fail := v_fail || 'B6 retries did not stop after the retry days' || E'\n';
  end if;
  -- After a new card, "try again now" reaches a renewal whose retries ran out;
  -- the daily run does not pick it up again by itself.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_c := public.billing_retry_now();
  reset role;
  if (v_c->>'charge_id')::uuid is distinct from v_charge
     or (select status from public.billing_charges where id = v_charge) <> 'pending' then
    v_fail := v_fail || 'B6 try-again-now did not reopen the exhausted renewal' || E'\n';
  end if;
  if (public.billing_prepare_due(now() + interval '2 days')->'charge') @> jsonb_build_array(jsonb_build_object('charge_id', v_charge)) then
    v_fail := v_fail || 'B6 the daily run picked up a renewal whose retries ran out' || E'\n';
  end if;
  perform public.billing_record_failure(v_charge, 'failed', 'Declined again', 'charge', '{}');
  if (select status from public.billing_charges where id = v_charge) <> 'failed' then
    v_fail := v_fail || 'B6 a failed try-again-now did not settle back to failed' || E'\n';
  end if;
  perform public.billing_prepare_due(now() + interval '8 days');
  if (select status from public.company_account where org_id = v_org) <> 'read_only' then
    v_fail := v_fail || 'B6 the company did not become read-only after the grace period' || E'\n';
  end if;

  ------------------------------------------------------------- B7 operator
  begin
    perform public.billing_operator_mark_paid(v_charge, 'EFT 123', v_owner);
    v_fail := v_fail || 'B7 a company login acted as operator' || E'\n';
  exception when insufficient_privilege then null;
  end;
  v_inv2 := public.billing_operator_mark_paid(v_charge, 'EFT 123', v_operator);
  if not exists (select 1 from public.company_account where org_id = v_org and status = 'active'
                  and abs(extract(epoch from period_start - now())) < 5 and read_only_since is null) then
    v_fail := v_fail || 'B7 an EFT did not restore the company with a period from today' || E'\n';
  end if;
  if (select paid_method from public.billing_invoices where id = v_inv2) <> 'eft' then
    v_fail := v_fail || 'B7 the EFT invoice is not marked EFT' || E'\n';
  end if;
  perform public.billing_operator_credit_note(v_inv, 100000, 'Guarantee', v_operator);
  begin
    perform public.billing_operator_credit_note(v_inv, 300000, 'Too much', v_operator);
    v_fail := v_fail || 'B7 credit beyond the invoice was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.billing_invoices where credit_for = v_inv and total_cents = -100000) <> 1 then
    v_fail := v_fail || 'B7 the credit note was not issued' || E'\n';
  end if;
  begin
    perform public.billing_operator_extend_trial(v_org, 7, v_operator);
    v_fail := v_fail || 'B7 a paying company was put back on trial' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  perform public.billing_operator_set_exempt(v_org, true, null, v_operator);
  if (select status from public.company_account where org_id = v_org) <> 'exempt' then
    v_fail := v_fail || 'B7 exempt was not set' || E'\n';
  end if;
  if (select count(*) from public.platform_audit_log
       where target_org_id = v_org and action in ('billing.mark_paid', 'billing.credit_note', 'billing.exempt')) <> 3 then
    v_fail := v_fail || 'B7 operator actions were not all audited' || E'\n';
  end if;

  ---------------------------------------------------------- B8 Gold Fortune
  delete from public.stores where org_id = c_gf and name = 'Billing check GF site';
  select md5(string_agg(t::text, '|' order by t::text)) into v_gf_after
    from (select status, plan, period, provider_token from public.company_account where org_id = c_gf
          union all select null, to_jsonb(cm.*), null, null from public.company_modules cm where cm.org_id = c_gf) t;
  if v_gf_after is distinct from v_gf_before then
    v_fail := v_fail || 'B8 Gold Fortune''s account or modules changed' || E'\n';
  end if;
  if (select status from public.company_account where org_id = c_gf) <> 'exempt' then
    v_fail := v_fail || 'B8 Gold Fortune is not exempt' || E'\n';
  end if;
  begin
    perform public.billing_operator_extend_trial(c_gf, 7, v_operator);
    v_fail := v_fail || 'B8 Gold Fortune was given a trial' || E'\n';
  exception when invalid_parameter_value then null;
  end;

  -------------------------------------------------- B9 grants and isolation
  select string_agg(f, ', ') into v_t from unnest(array[
    'public.billing_record_payment(uuid,text,bigint,text,text,jsonb)',
    'public.billing_record_failure(uuid,text,text,text,jsonb)',
    'public.billing_prepare_due(timestamptz)',
    'public.billing_lines(uuid,text,jsonb,boolean)',
    'public.billing_issue_invoice(uuid,text,uuid,uuid,jsonb,bigint,timestamptz,timestamptz,text,text,text)',
    'public.billing_operator_mark_paid(uuid,text,uuid)',
    'public.billing_operator_set_custom_price(uuid,bigint,uuid)',
    'public.billing_operator_set_exempt(uuid,boolean,integer,uuid)',
    'public.billing_operator_extend_trial(uuid,integer,uuid)',
    'public.billing_operator_credit_note(uuid,bigint,text,uuid)',
    'public.billing_operator_cancel_charge(uuid,uuid)',
    'public.platform_setting(text)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute');
  if v_t is not null then v_fail := v_fail || 'B9 callable by signed-in or anonymous users: ' || v_t || E'\n'; end if;
  select string_agg(f, ', ') into v_t from unnest(array[
    'public.billing_quote(text,integer,jsonb)', 'public.billing_start_checkout(text,integer,jsonb,text)',
    'public.billing_request_change(integer,jsonb)', 'public.my_account()']) f
   where has_function_privilege('anon', f, 'execute');
  if v_t is not null then v_fail := v_fail || 'B9 callable anonymously: ' || v_t || E'\n'; end if;

  update public.company_account set status = 'active' where org_id = v_org;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform 1 from public.billing_payments limit 1;
    v_fail := v_fail || 'B9 the payment log is readable through the API' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.billing_invoices) < 3 then
    v_fail := v_fail || 'B9 the owner cannot see the company''s invoices' || E'\n';
  end if;
  if exists (select 1 from public.billing_invoices where org_id is distinct from v_org) then
    v_fail := v_fail || 'B9 the owner sees another company''s invoices' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.billing_invoices) + (select count(*) from public.billing_charges) <> 0 then
    v_fail := v_fail || 'B9 a field employee sees invoices or charges' || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.billing_invoices where org_id = v_org)
     or exists (select 1 from public.billing_charges where org_id = v_org) then
    v_fail := v_fail || 'B9 another company''s administrator sees this company''s billing' || E'\n';
  end if;
  reset role;

  if v_fail = '' then
    raise exception 'BILLING SUITE: ALL PASS (B1-B9) — rolled back';
  end if;
  raise exception E'BILLING SUITE FAILURES:\n%', v_fail;
end;
$$;
