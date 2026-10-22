-- Paying by card with Paystack (20261022193700).
--
--   P1  Amounts: the plan for the reps (the band in price_list), setup on the
--       first monthly payment only, no VAT while the seller has no VAT number,
--       whole cents; fewer places than active reps refused.
--   P2  A payment in the wrong currency, or for the wrong amount, is refused,
--       logged, handed back to refund, and leaves the charge unpaid; a
--       reference for another charge is refused outright.
--   P3  The first payment: one invoice, the company active with the paid
--       period, setup marked paid, the card kept; the same reference again
--       (webhook after verify) is one invoice and one payment, logged as a
--       duplicate. Add-on modules are left as they were.
--   P4  The card: unreadable for a signed-in caller except brand, last 4 and
--       expiry through billing_card(); a card Paystack cannot charge again is
--       not kept.
--   P5  The card check: a small charge, no invoice, the new card kept.
--   P6  Renewal: written once however often the run fires, priced without
--       setup, handed out with the reference of its last try.
--   P7  A failed renewal: past due, the company emailed, tried again on days 3
--       and 7 (whole days), then failed; read-only when the grace period
--       ends; paying it afterwards restores the company with a period from
--       today.
--   P8  The end of a pilot locks nothing unless trial_end_read_only is on.
--   P9  Grants: the service-role functions and the card table are out of a
--       signed-in caller's reach.
--   P10 Money that buys nothing is handed back to refund: a second payment
--       for a paid charge (another reference), a payment for a replaced
--       charge; neither issues an invoice or keeps the card.
--   P11 One try, one failure: the same failed try reported again counts
--       nothing and emails nobody; the account is not locked on a morning
--       its card is still to be tried.
--   P12 More reps cannot be added while the next payment is due, nor while
--       a payment for more reps is under way.
--   P13 One company's renewal error is reported; the daily run goes on.
--
-- HOW TO RUN: as rep_plans.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. Gold Fortune stands in for a
-- company; everything it changes rolls back.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_reps int; v_band bigint;
  v_j jsonb; v_charge uuid; v_renewal uuid; v_ref text; v_inv uuid;
  v_n int; v_t text; v_ts timestamptz; v_day timestamptz;
  v_card jsonb := jsonb_build_object(
    'authorization_code', 'AUTH_pstest001', 'reusable', true, 'last4', '4081', 'exp_month', '12',
    'exp_year', '2030', 'brand', 'Visa', 'card_type', 'visa DEBIT', 'bank', 'TEST BANK', 'country_code', 'ZA',
    'signature', 'SIG_test', 'email', 'Pay@Example.com', 'customer_code', 'CUS_test');
  v_modules_before text; v_modules_after text;
  v_old uuid; v_cards text; v_emails int; v_att int;
begin
  if to_regclass('public.billing_cards') is null then
    raise exception 'BILLING PAYSTACK: SKIPPED (20261022193700 is not on this database)';
  end if;

  select p.id into v_admin from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
   where p.org_id = c_gf and jr.code = 'administrator' and p.is_active order by p.created_at limit 1;
  select count(*) into v_reps from public.profiles where org_id = c_gf and is_active and role = 'rep';
  if v_admin is null or v_reps not between 1 and 5 then
    raise exception 'Fixtures missing: a Gold Fortune administrator and 1 to 5 active reps are needed (reps: %).', v_reps;
  end if;
  select amount_cents into v_band from public.price_list
   where code = 'base' and kind = 'base' and period = 'monthly' and tier_min = 0
     and active_from <= current_date and (active_to is null or active_to > current_date);

  -- Gold Fortune as a company on its pilot, never charged before.
  update public.company_account
     set status = 'trial', trial_ends_at = now() + interval '5 days', plan = null, period = null,
         period_start = null, period_end = null, custom_price_cents = null, setup_charged = false,
         grace_ends_at = null, read_only_since = null, billing_email = null, provider = null
   where org_id = c_gf;
  select md5(string_agg(module_code || enabled::text, ',' order by module_code)) into v_modules_before
    from public.company_modules where org_id = c_gf;

  ---------------------------------------------------------------- P1 amounts
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.billing_quote('monthly', v_reps, '{}'::jsonb);
  if (v_j->>'total_cents')::bigint <> v_band + 250000
     or (select count(*) from jsonb_array_elements(v_j->'lines') l where l->>'code' = 'setup') <> 1
     or (v_j->'vat'->>'vat_cents')::bigint <> 0 then
    v_fail := v_fail || format('P1 first monthly payment: %s', v_j) || E'\n';
  end if;
  v_j := public.billing_quote('yearly', v_reps, '{}'::jsonb);
  if (v_j->>'total_cents')::bigint <> v_band * 10 then
    v_fail := v_fail || format('P1 yearly: %s, expected %s with no setup', v_j->>'total_cents', v_band * 10) || E'\n';
  end if;
  if exists (select 1 from jsonb_array_elements(v_j->'lines') l
              where jsonb_typeof(l->'amount_cents') <> 'number' or (l->>'amount_cents') !~ '^[0-9]+$') then
    v_fail := v_fail || 'P1 a line is not whole cents' || E'\n';
  end if;
  if v_reps > 1 then
    begin
      perform public.billing_start_checkout('monthly', v_reps - 1, '{}'::jsonb, 'pay@example.com');
      v_fail := v_fail || 'P1 fewer places than active reps were accepted' || E'\n';
    exception when sqlstate '22023' then null;
    end;
  end if;
  v_j := public.billing_start_checkout('monthly', v_reps, '{}'::jsonb, 'pay@example.com');
  v_charge := (v_j->>'charge_id')::uuid;
  if (v_j->>'total_cents')::bigint <> v_band + 250000 then
    v_fail := v_fail || format('P1 checkout charge %s, expected %s', v_j->>'total_cents', v_band + 250000) || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  v_ref := 'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_charge::text, '-', '') || '-1761150000000';
  update public.billing_charges set provider_reference = v_ref where id = v_charge;

  ---------------------------------------------------------------- P2 refusals
  -- Each its own transaction (reference), as Paystack reports them.
  v_j := public.billing_paystack_paid(v_charge, replace(v_ref, '-1761150000000', '-1761150000020'), v_band + 250000, 'NGN', v_card, 'webhook', '{}'::jsonb);
  if v_j->>'outcome' <> 'refund' then v_fail := v_fail || format('P2 another currency: %s', v_j) || E'\n'; end if;
  v_j := public.billing_paystack_paid(v_charge, replace(v_ref, '-1761150000000', '-1761150000021'), v_band + 249999, 'ZAR', v_card, 'webhook', '{}'::jsonb);
  if v_j->>'outcome' <> 'refund' then v_fail := v_fail || format('P2 another amount: %s', v_j) || E'\n'; end if;
  if (select status from public.billing_charges where id = v_charge) <> 'pending'
     or exists (select 1 from public.billing_invoices where charge_id = v_charge)
     or exists (select 1 from public.billing_cards where org_id = c_gf) then
    v_fail := v_fail || 'P2 a refused payment changed the charge, issued an invoice or kept the card' || E'\n';
  end if;
  select count(*) into v_n from public.billing_payments where charge_id = v_charge and outcome = 'refused' and provider = 'paystack';
  if v_n <> 2 then v_fail := v_fail || format('P2 %s refusals logged, expected 2', v_n) || E'\n'; end if;
  begin
    perform public.billing_paystack_paid(v_charge, 'TKD-00000000-' || repeat('0', 32) || '-1761150000000',
                                         v_band + 250000, 'ZAR', v_card, 'webhook', '{}'::jsonb);
    v_fail := v_fail || 'P2 a reference for another charge was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------- P3 the first payment
  v_ts := now();
  v_j := public.billing_paystack_paid(v_charge, v_ref, v_band + 250000, 'ZAR', v_card, 'verify', '{"n": 1}'::jsonb);
  v_inv := (v_j->>'invoice_id')::uuid;
  if v_j->>'outcome' <> 'paid' or v_inv is null or not (v_j->>'card_saved')::boolean then
    v_fail := v_fail || format('P3 first payment: %s', v_j) || E'\n';
  end if;
  if not exists (select 1 from public.company_account
                  where org_id = c_gf and status = 'active' and period = 'monthly' and setup_charged
                    and (plan->>'seats')::int = v_reps and provider = 'paystack' and billing_email = 'pay@example.com'
                    -- The pilot is not cut short: the paid month starts when it ends.
                    and period_start >= v_ts + interval '4 days' and period_end = period_start + interval '1 month') then
    v_fail := v_fail || format('P3 the account after paying: %s', (select to_jsonb(a) - 'provider_token' from public.company_account a where org_id = c_gf)) || E'\n';
  end if;
  if not exists (select 1 from public.billing_invoices
                  where id = v_inv and total_cents = v_band + 250000 and vat_cents = 0 and paid_method = 'card'
                    and payment_reference = v_ref) then
    v_fail := v_fail || 'P3 the invoice is not as paid' || E'\n';
  end if;
  v_j := public.billing_paystack_paid(v_charge, v_ref, v_band + 250000, 'ZAR', v_card, 'webhook', '{"n": 2}'::jsonb);
  if v_j->>'outcome' <> 'duplicate' or (v_j->>'invoice_id')::uuid is distinct from v_inv then
    v_fail := v_fail || format('P3 the same reference again: %s', v_j) || E'\n';
  end if;
  select count(*) into v_n from public.billing_invoices where charge_id = v_charge;
  if v_n <> 1 then v_fail := v_fail || format('P3 %s invoices for one charge', v_n) || E'\n'; end if;
  if (select count(*) from public.billing_payments where charge_id = v_charge and outcome = 'paid') <> 1
     or (select count(*) from public.billing_payments where charge_id = v_charge and outcome = 'duplicate') <> 1 then
    v_fail := v_fail || 'P3 not one payment and one duplicate in the log' || E'\n';
  end if;
  ---------------------------------------------------------------- P10 money back (a second payment)
  v_j := public.billing_paystack_paid(v_charge, replace(v_ref, '-1761150000000', '-1761150000009'),
                                      v_band + 250000, 'ZAR', v_card, 'webhook', '{}'::jsonb);
  if v_j->>'outcome' <> 'refund' or (select count(*) from public.billing_invoices where charge_id = v_charge) <> 1 then
    v_fail := v_fail || format('P10 a second payment for a paid charge: %s', v_j) || E'\n';
  end if;
  -- Reported again (a webhook resent): refunded once, not twice.
  v_j := public.billing_paystack_paid(v_charge, replace(v_ref, '-1761150000000', '-1761150000009'),
                                      v_band + 250000, 'ZAR', v_card, 'webhook', '{}'::jsonb);
  if v_j->>'outcome' <> 'duplicate' then
    v_fail := v_fail || format('P10 a refused payment reported again was refunded again: %s', v_j) || E'\n';
  end if;

  select md5(string_agg(module_code || enabled::text, ',' order by module_code)) into v_modules_after
    from public.company_modules where org_id = c_gf;
  if v_modules_after is distinct from v_modules_before then
    v_fail := v_fail || 'P3 paying for reps switched an add-on module' || E'\n';
  end if;

  ---------------------------------------------------------------- P4 the card
  if not exists (select 1 from public.billing_cards
                  where org_id = c_gf and authorization_code = 'AUTH_pstest001' and last4 = '4081'
                    and exp_month = 12 and exp_year = 2030 and brand = 'visa' and email = 'pay@example.com'
                    and reference = v_ref) then
    v_fail := v_fail || format('P4 the card kept: %s', (select to_jsonb(k) from public.billing_cards k where org_id = c_gf)) || E'\n';
  end if;
  if public.billing_save_card(c_gf, v_card || '{"reusable": false, "authorization_code": "AUTH_other"}'::jsonb, v_ref) then
    v_fail := v_fail || 'P4 a card that cannot be charged again was kept' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.billing_card();
  if v_j->>'last4' <> '4081' or v_j->>'brand' <> 'visa' or v_j ? 'authorization_code' or v_j ? 'email' then
    v_fail := v_fail || format('P4 billing_card(): %s', v_j) || E'\n';
  end if;
  begin
    select count(*) into v_n from public.billing_cards;
    v_fail := v_fail || 'P4 a signed-in caller read billing_cards' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    select provider_token into v_t from public.company_account where org_id = c_gf;
    v_fail := v_fail || 'P4 a signed-in caller read provider_token' || E'\n';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------- P5 the card check
  -- A first card check, replaced by a second before it was paid (P10).
  v_old := (public.billing_start_card_check('first@example.com')->>'charge_id')::uuid;
  v_j := public.billing_start_card_check('cards@example.com');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  v_charge := (v_j->>'charge_id')::uuid;
  if (v_j->>'total_cents')::bigint <> 100
     or (select reason from public.billing_charges where id = v_charge) <> 'card' then
    v_fail := v_fail || format('P5 card check: %s', v_j) || E'\n';
  end if;
  select md5(string_agg(authorization_code, ',')) into v_cards from public.billing_cards where org_id = c_gf;
  v_j := public.billing_paystack_paid(v_old,
           'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_old::text, '-', '') || '-1761150000010',
           100, 'ZAR', v_card || '{"authorization_code": "AUTH_pstestold"}'::jsonb, 'webhook', '{}'::jsonb);
  if (select status from public.billing_charges where id = v_old) <> 'cancelled' or v_j->>'outcome' <> 'refund'
     or (select md5(string_agg(authorization_code, ',')) from public.billing_cards where org_id = c_gf) is distinct from v_cards then
    v_fail := v_fail || format('P10 a payment for a replaced charge: %s', v_j) || E'\n';
  end if;
  select count(*) into v_n from public.billing_invoices where org_id = c_gf;
  v_ref := 'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_charge::text, '-', '') || '-1761150000001';
  v_j := public.billing_paystack_paid(v_charge, v_ref, 100, 'ZAR',
           v_card || '{"authorization_code": "AUTH_pstest002", "last4": "1111", "email": "cards@example.com"}'::jsonb,
           'webhook', '{}'::jsonb);
  if v_j->>'outcome' <> 'paid' or v_j->>'invoice_id' is not null
     or (select count(*) from public.billing_invoices where org_id = c_gf) <> v_n then
    v_fail := v_fail || format('P5 the card check issued an invoice: %s', v_j) || E'\n';
  end if;
  if not exists (select 1 from public.billing_cards where org_id = c_gf and authorization_code = 'AUTH_pstest002' and last4 = '1111') then
    v_fail := v_fail || 'P5 the checked card was not kept' || E'\n';
  end if;
  begin
    perform public.billing_record_payment(v_charge, v_ref, 100, null, 'webhook', null);
    v_fail := v_fail || 'P5 a card check went through billing_record_payment' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------- P6 renewal
  update public.company_account
     set period_start = now() - interval '1 month', period_end = now() - interval '1 minute'
   where org_id = c_gf;
  v_j := public.billing_prepare_due(now());
  select id into v_renewal from public.billing_charges where org_id = c_gf and reason = 'renewal' and status = 'pending';
  if (v_j->>'renewals_written')::int <> 1 or v_renewal is null
     or not exists (select 1 from jsonb_array_elements(v_j->'charge') x where (x->>'charge_id')::uuid = v_renewal and x ? 'reference')
     or exists (select 1 from jsonb_array_elements(v_j->'charge') x where x ? 'token') then
    v_fail := v_fail || format('P6 first run: %s', v_j) || E'\n';
  end if;
  v_j := public.billing_prepare_due(now());
  if (v_j->>'renewals_written')::int <> 0
     or (select count(*) from public.billing_charges where org_id = c_gf and reason = 'renewal') <> 1 then
    v_fail := v_fail || 'P6 the renewal was written twice' || E'\n';
  end if;
  if (select total_cents from public.billing_charges where id = v_renewal) <> v_band then
    v_fail := v_fail || format('P6 renewal %s, expected %s (no setup)', (select total_cents from public.billing_charges where id = v_renewal), v_band) || E'\n';
  end if;

  ---------------------------------------------------------------- P7 a failed renewal
  v_day := date_trunc('day', (select created_at from public.billing_charges where id = v_renewal));
  update public.billing_charges set provider_reference =
    'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_renewal::text, '-', '') || '-1761150000002'
   where id = v_renewal;
  select count(*) into v_n from public.message_outbox where related_id = v_renewal;
  perform public.billing_record_failure(v_renewal, 'failed', 'Insufficient funds', 'charge', null);
  if not exists (select 1 from public.company_account
                  where org_id = c_gf and status = 'past_due' and grace_ends_at = date_trunc('day', now()) + interval '7 days') then
    v_fail := v_fail || 'P7 a failed renewal did not start a whole-day grace period' || E'\n';
  end if;
  if (select next_retry_at from public.billing_charges where id = v_renewal) <> v_day + interval '3 days' then
    v_fail := v_fail || format('P7 first retry on %s, expected day 3', (select next_retry_at from public.billing_charges where id = v_renewal)) || E'\n';
  end if;
  if (select count(*) from public.message_outbox
       where related_id = v_renewal and related_kind = 'billing_charge' and template = 'billing_payment_failed'
         and (payload->>'amount_cents')::bigint = v_band and payload ? 'retry_on' and payload ? 'read_only_on') <> v_n + 1 then
    v_fail := v_fail || 'P7 the company was not emailed about the failed payment' || E'\n';
  end if;
  if not exists (select 1 from public.billing_payments where charge_id = v_renewal and outcome = 'failed'
                    and provider = 'paystack' and provider_payment_id like 'TKD-%') then
    v_fail := v_fail || 'P7 the failure was not logged with its reference' || E'\n';
  end if;
  -- P11 the same try reported failed again: nothing more.
  select attempts into v_att from public.billing_charges where id = v_renewal;
  select count(*) into v_emails from public.message_outbox where related_id = v_renewal;
  perform public.billing_record_failure(v_renewal, 'failed', 'Insufficient funds', 'verify', null);
  if (select attempts from public.billing_charges where id = v_renewal) <> v_att
     or (select count(*) from public.message_outbox where related_id = v_renewal) <> v_emails then
    v_fail := v_fail || 'P11 one failed try was counted or emailed twice' || E'\n';
  end if;
  v_j := public.billing_prepare_due(now());
  if exists (select 1 from jsonb_array_elements(v_j->'charge') x where (x->>'charge_id')::uuid = v_renewal) then
    v_fail := v_fail || 'P7 a failed renewal was tried again the same day' || E'\n';
  end if;
  v_j := public.billing_prepare_due(v_day + interval '3 days' + interval '6 hours');
  if not exists (select 1 from jsonb_array_elements(v_j->'charge') x where (x->>'charge_id')::uuid = v_renewal) then
    v_fail := v_fail || 'P7 the day-3 retry was not handed out' || E'\n';
  end if;
  update public.billing_charges set provider_reference =
    'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_renewal::text, '-', '') || '-1761150000004'
   where id = v_renewal;
  perform public.billing_record_failure(v_renewal, 'failed', 'Insufficient funds', 'charge', null);
  if (select next_retry_at from public.billing_charges where id = v_renewal) <> v_day + interval '7 days' then
    v_fail := v_fail || 'P7 the second retry is not on day 7' || E'\n';
  end if;
  -- P11 day 7: the grace period has run out, but the card is still to be
  -- tried that morning, so the account is not locked yet.
  v_j := public.billing_prepare_due(v_day + interval '7 days' + interval '6 hours');
  if (select status from public.company_account where org_id = c_gf) <> 'past_due'
     or not exists (select 1 from jsonb_array_elements(v_j->'charge') x where (x->>'charge_id')::uuid = v_renewal) then
    v_fail := v_fail || format('P11 day 7: locked before the last try, or not tried: %s', (select status from public.company_account where org_id = c_gf)) || E'\n';
  end if;
  -- ...but a retry day that passed unsettled (stuck with Paystack, say)
  -- does not keep the account open.
  v_j := public.billing_prepare_due(v_day + interval '8 days' + interval '6 hours');
  if (select status from public.company_account where org_id = c_gf) <> 'read_only' then
    v_fail := v_fail || 'P11 a retry day that passed unsettled kept the account open' || E'\n';
  end if;
  update public.company_account set status = 'past_due', read_only_since = null where org_id = c_gf;
  update public.billing_charges set provider_reference =
    'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_renewal::text, '-', '') || '-1761150000005'
   where id = v_renewal;
  perform public.billing_record_failure(v_renewal, 'failed', 'Insufficient funds', 'charge', null);
  if (select status from public.billing_charges where id = v_renewal) <> 'failed'
     or (select next_retry_at from public.billing_charges where id = v_renewal) is not null then
    v_fail := v_fail || 'P7 retries did not stop after day 7' || E'\n';
  end if;
  v_j := public.billing_prepare_due(date_trunc('day', now()) + interval '8 days');
  if (select status from public.company_account where org_id = c_gf) <> 'read_only'
     or exists (select 1 from jsonb_array_elements(v_j->'charge') x where (x->>'charge_id')::uuid = v_renewal) then
    v_fail := v_fail || 'P7 not read-only after the grace period, or still being charged' || E'\n';
  end if;
  v_ref := 'TKD-' || left(replace(c_gf::text, '-', ''), 8) || '-' || replace(v_renewal::text, '-', '') || '-1761150000003';
  v_ts := now();
  v_j := public.billing_paystack_paid(v_renewal, v_ref, v_band, 'ZAR', v_card, 'verify', '{}'::jsonb);
  if v_j->>'outcome' <> 'paid'
     or not exists (select 1 from public.company_account
                     where org_id = c_gf and status = 'active' and grace_ends_at is null and read_only_since is null
                       and period_start >= v_ts and period_end = period_start + interval '1 month') then
    v_fail := v_fail || format('P7 paying after the lapse: %s', v_j) || E'\n';
  end if;

  ---------------------------------------------------------------- P12 more reps
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- 6 places: always the next band up from a company of 1 to 5 reps.
  v_j := public.billing_request_change(6, '{}'::jsonb);
  reset role;
  if v_j is null then
    v_fail := v_fail || 'P12 more reps mid-period were not charged' || E'\n';
  else
    update public.billing_charges set provider_tried_at = now() where id = (v_j->>'charge_id')::uuid;
    set local role authenticated;
    begin
      perform public.billing_request_change(7, '{}'::jsonb);
      v_fail := v_fail || 'P12 a second change while one is being paid was accepted' || E'\n';
    exception when sqlstate '22023' then null;
    end;
    reset role;
  end if;
  update public.billing_charges set status = 'cancelled' where org_id = c_gf and reason = 'change' and status = 'pending';
  update public.company_account set period_start = now() - interval '1 month', period_end = now() - interval '1 minute'
   where org_id = c_gf;
  set local role authenticated;
  begin
    perform public.billing_request_change(6, '{}'::jsonb);
    v_fail := v_fail || 'P12 more reps were accepted after the period ended (free)' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- P13 one company's error
  update public.company_account
     set status = 'active', plan = public.billing_plan(16, '{}'::jsonb), cancel_at_period_end = false,
         period_start = now() - interval '1 month', period_end = now() - interval '2 minutes'
   where org_id = c_gf;
  begin
    v_j := public.billing_prepare_due(now());
    if not exists (select 1 from jsonb_array_elements(v_j->'errors') e where (e->>'org_id')::uuid = c_gf) then
      v_fail := v_fail || format('P13 a renewal that cannot be priced was not reported: %s', v_j) || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || format('P13 one company''s error stopped the daily run: %s', sqlerrm) || E'\n';
  end;

  ---------------------------------------------------------------- P8 pilot end
  update public.company_account set status = 'trial', trial_ends_at = now() - interval '1 hour' where org_id = c_gf;
  v_j := public.billing_prepare_due(now());
  if (select status from public.company_account where org_id = c_gf) <> 'trial' or (v_j->>'trials_ended')::int <> 0 then
    v_fail := v_fail || 'P8 an ended pilot was locked with trial_end_read_only off' || E'\n';
  end if;
  update public.platform_settings set value = 'true'::jsonb where key = 'trial_end_read_only';
  v_j := public.billing_prepare_due(now());
  if (select status from public.company_account where org_id = c_gf) <> 'read_only' then
    v_fail := v_fail || 'P8 trial_end_read_only on did not lock an ended pilot' || E'\n';
  end if;

  ---------------------------------------------------------------- P9 grants
  if has_function_privilege('authenticated', 'public.billing_paystack_paid(uuid, text, bigint, text, jsonb, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.billing_paystack_paid(uuid, text, bigint, text, jsonb, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_save_card(uuid, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_prepare_due(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_record_failure(uuid, text, text, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.billing_card()', 'execute')
     or has_function_privilege('anon', 'public.billing_start_card_check(text)', 'execute') then
    v_fail := v_fail || 'P9 a service-role function is callable by a signed-in or anonymous caller' || E'\n';
  end if;
  if not has_function_privilege('authenticated', 'public.billing_card()', 'execute')
     or not has_function_privilege('authenticated', 'public.billing_start_card_check(text)', 'execute') then
    v_fail := v_fail || 'P9 the Billing page cannot call its functions' || E'\n';
  end if;
  if has_table_privilege('authenticated', 'public.billing_cards', 'select')
     or has_table_privilege('anon', 'public.billing_cards', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.billing_cards'::regclass)
     or not exists (select 1 from public.module_assignments where kind = 'table' and name = 'billing_cards') then
    v_fail := v_fail || 'P9 billing_cards is readable, unprotected or unregistered' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'BILLING PAYSTACK FAILED:\n%', v_fail;
  end if;
  raise exception 'BILLING PAYSTACK: ALL PASSED (rolled back)';
end
$$;
