-- Rollback of 20261022193700_paystack_billing: Payfast's shapes again.
-- The three replaced functions are restored from 20261008091250_billing
-- (production's bodies before this migration); the card table, the card check
-- and the two settings go. Refuses once Paystack has been used for real, so a
-- kept card or a logged payment is never thrown away by accident.

do $guard$
begin
  if exists (select 1 from public.billing_cards)
     or exists (select 1 from public.billing_payments where provider = 'paystack')
     or exists (select 1 from public.billing_charges where reason = 'card' or provider_reference is not null) then
    raise exception 'Paystack has been used: cards, payments or references exist. Roll back by hand.';
  end if;
end
$guard$;

drop function public.billing_paystack_paid(uuid, text, bigint, text, jsonb, text, jsonb);
drop function public.billing_start_card_check(text);
drop function public.billing_card();
drop function public.billing_save_card(uuid, jsonb, text);
drop table public.billing_cards;
delete from public.module_assignments
 where name in ('billing_cards', 'billing_save_card', 'billing_paystack_paid', 'billing_start_card_check', 'billing_card');

delete from public.platform_settings where key in ('trial_end_read_only', 'card_check_cents');
update public.platform_settings set value = '[1, 3, 7]'::jsonb,
       description = 'Days after a failed renewal charge on which it is tried again.'
 where key = 'retry_days';

drop index public.billing_charges_provider_reference;
alter table public.billing_charges drop column provider_reference;
alter table public.billing_charges drop constraint billing_charges_reason_check;
alter table public.billing_charges add constraint billing_charges_reason_check
  check (reason = any (array['subscribe'::text, 'renewal'::text, 'change'::text]));
alter table public.billing_payments drop constraint billing_payments_outcome_check;
alter table public.billing_payments add constraint billing_payments_outcome_check
  check (outcome = any (array['paid'::text, 'failed'::text, 'cancelled'::text, 'refused'::text, 'duplicate'::text]));
alter table public.billing_payments drop constraint billing_payments_source_check;
alter table public.billing_payments add constraint billing_payments_source_check
  check (source = any (array['notify'::text, 'charge'::text, 'manual'::text]));
alter table public.company_account drop constraint company_account_provider_check;
alter table public.company_account add constraint company_account_provider_check
  check (provider = 'payfast'::text);

-- A charge was paid (Payfast notification, our ad-hoc call, or the operator's
-- EFT). Idempotent: the same charge or the same Payfast payment twice gives
-- the same invoice. Refuses an amount that is not the charge's total.
create or replace function public.billing_record_payment(
  p_charge uuid, p_provider_payment_id text, p_amount_cents bigint, p_token text,
  p_source text, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  c        public.billing_charges;
  a        public.company_account;
  v_inv    uuid;
  v_start  timestamptz;
  v_end    timestamptz;
  v_step   interval;
  v_off    text[];
begin
  select * into c from public.billing_charges where id = p_charge for update;
  if c.id is null then
    raise exception 'No such charge.' using errcode = '22023';
  end if;
  if c.status = 'paid' then
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, payload)
    values (c.id, c.org_id, case when p_source = 'manual' then 'manual' else 'payfast' end, p_source,
            'duplicate', case when p_source = 'manual' then null else p_provider_payment_id end, p_amount_cents, p_payload);
    return c.invoice_id;
  end if;
  if p_amount_cents is distinct from c.total_cents then
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, detail, payload)
    values (c.id, c.org_id, 'payfast', p_source, 'refused', p_provider_payment_id, p_amount_cents,
            format('Amount %s is not the charge total %s.', p_amount_cents, c.total_cents), p_payload);
    raise exception 'Amount % is not the charge total %.', p_amount_cents, c.total_cents using errcode = '22023';
  end if;
  if c.org_id is null then
    raise exception 'The company of this charge no longer exists.' using errcode = '22023';
  end if;

  select * into a from public.company_account where org_id = c.org_id for update;
  v_step := case c.period when 'yearly' then interval '1 year' else interval '1 month' end;

  if c.reason = 'subscribe' then
    -- A trial that is still running is not cut short: the paid period starts
    -- when it ends.
    v_start := greatest(now(), coalesce(a.trial_ends_at, now()));
    v_end := v_start + v_step;
  elsif a.status in ('read_only', 'cancelled') then
    -- Paid after the account lapsed: the period starts now, not when the
    -- unpaid one did, so nobody pays for weeks they could not use.
    v_start := now();
    v_end := v_start + v_step;
  else
    v_start := c.period_start;
    v_end := c.period_end;
  end if;

  v_inv := public.billing_issue_invoice(c.org_id, 'invoice', c.id, null, c.lines, c.total_cents,
             v_start, v_end, case when p_source = 'manual' then 'eft' else 'card' end,
             p_provider_payment_id, c.reason);

  update public.billing_charges
     set status = 'paid', invoice_id = v_inv, next_retry_at = null, last_error = null,
         period_start = v_start, period_end = v_end, updated_at = now()
   where id = c.id;

  insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, detail, payload)
  values (c.id, c.org_id, case when p_source = 'manual' then 'manual' else 'payfast' end, p_source, 'paid',
          case when p_source = 'manual' then null else p_provider_payment_id end, p_amount_cents,
          case when p_source = 'manual' then 'Reference: ' || p_provider_payment_id end, p_payload);

  if c.reason = 'subscribe' then
    -- Add-ons left out of the plan are switched off; those in it, on.
    select coalesce(array_agg(cm.module_code), '{}') into v_off
      from public.company_modules cm join public.modules m on m.code = cm.module_code
     where cm.org_id = c.org_id and cm.enabled and m.plan_type = 'addon'
       and not (c.plan_after->'addons' ? cm.module_code);
    perform public.billing_apply_addons(c.org_id, c.plan_after->'addons', v_off);
    update public.company_account
       set status = 'active', period = c.period, plan = c.plan_after, plan_next = null,
           period_start = v_start, period_end = v_end,
           setup_charged = setup_charged or exists (
             select 1 from jsonb_array_elements(c.lines) l where l->>'code' = 'setup'),
           provider = case when p_token is not null then 'payfast' else provider end,
           provider_token = coalesce(p_token, provider_token),
           billing_email = c.billing_email,
           grace_ends_at = null, read_only_since = null, cancel_at_period_end = false,
           updated_at = now()
     where org_id = c.org_id;
  elsif c.reason = 'change' then
    perform public.billing_apply_addons(c.org_id, c.plan_after->'addons', null);
    update public.company_account
       set plan = c.plan_after, plan_next = c.plan_next, updated_at = now()
     where org_id = c.org_id;
  else
    -- Renewal: the new period, and whatever the company asked to drop.
    select coalesce(array_agg(k), '{}') into v_off
      from jsonb_object_keys(coalesce(a.plan->'addons', '{}'::jsonb)) k
     where not (c.plan_after->'addons' ? k);
    perform public.billing_apply_addons(c.org_id, c.plan_after->'addons', v_off);
    update public.company_account
       set status = 'active', plan = c.plan_after, plan_next = null,
           period_start = v_start, period_end = v_end,
           provider_token = coalesce(p_token, provider_token),
           grace_ends_at = null, read_only_since = null, updated_at = now()
     where org_id = c.org_id;
  end if;
  return v_inv;
end;
$function$;

-- A charge failed or the customer cancelled on Payfast's page. A renewal is
-- tried again on the retry days and puts the company in its grace period; a
-- first payment or a change simply did not happen.
create or replace function public.billing_record_failure(
  p_charge uuid, p_outcome text, p_detail text, p_source text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  c        public.billing_charges;
  v_days   jsonb := public.platform_setting('retry_days');
  v_grace  int := coalesce((public.platform_setting('grace_days') #>> '{}')::int, 7);
  v_next   timestamptz;
begin
  if p_outcome not in ('failed', 'cancelled') then
    raise exception 'Outcome must be failed or cancelled.' using errcode = '22023';
  end if;
  select * into c from public.billing_charges where id = p_charge for update;
  if c.id is null then
    raise exception 'No such charge.' using errcode = '22023';
  end if;

  insert into public.billing_payments (charge_id, org_id, provider, source, outcome, detail, payload)
  values (c.id, c.org_id, 'payfast', p_source, p_outcome, p_detail, p_payload);

  if c.status <> 'pending' then
    return;  -- already settled; the log row is enough
  end if;

  if c.reason <> 'renewal' then
    update public.billing_charges
       set status = case when p_outcome = 'cancelled' then 'cancelled' else 'failed' end,
           attempts = attempts + 1, last_error = p_detail, updated_at = now()
     where id = c.id;
    return;
  end if;

  -- Retry day N counts from when the renewal was first tried.
  v_next := case when c.attempts < jsonb_array_length(coalesce(v_days, '[]'::jsonb))
                 then c.created_at + make_interval(days => (v_days->>c.attempts)::int) end;
  update public.billing_charges
     set attempts = attempts + 1, last_error = p_detail, next_retry_at = v_next,
         status = case when v_next is null then 'failed' else 'pending' end,
         updated_at = now()
   where id = c.id;
  update public.company_account
     set status = 'past_due',
         grace_ends_at = coalesce(grace_ends_at, now() + make_interval(days => v_grace)),
         updated_at = now()
   where org_id = c.org_id and status in ('active', 'past_due');
end;
$function$;

-- The daily run: moves companies whose trial or grace ran out to read-only,
-- ends cancelled plans, writes renewal charges, and returns the charges to put
-- to the card now. Running it twice changes nothing more.
create or replace function public.billing_prepare_due(p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_trials   int;
  v_grace    int;
  v_ended    int;
  v_renew    int := 0;
  a          public.company_account;
  v_plan     jsonb;
  v_used     int;
  v_q        jsonb;
  v_step     interval;
  v_due      jsonb;
begin
  update public.company_account
     set status = 'read_only', read_only_since = p_now, updated_at = now()
   where status = 'trial' and trial_ends_at <= p_now;
  get diagnostics v_trials = row_count;

  update public.company_account
     set status = 'read_only', read_only_since = p_now, updated_at = now()
   where status = 'past_due' and grace_ends_at <= p_now;
  get diagnostics v_grace = row_count;

  update public.company_account
     set status = 'cancelled', read_only_since = p_now, updated_at = now()
   where status in ('active', 'past_due') and cancel_at_period_end and period_end <= p_now;
  get diagnostics v_ended = row_count;

  for a in
    select * from public.company_account
     where status in ('active', 'past_due') and period_end <= p_now and not cancel_at_period_end
     for update
  loop
    continue when exists (select 1 from public.billing_charges
                           where org_id = a.org_id and reason = 'renewal'
                             and period_start = a.period_end and status <> 'cancelled');
    v_plan := coalesce(a.plan_next, a.plan);
    -- Users added since a smaller plan was asked for are paid for, not dropped.
    v_used := public.billing_seats_used(a.org_id, v_plan);
    v_plan := public.billing_plan(greatest((v_plan->>'seats')::int, v_used), v_plan->'addons');
    v_q := public.billing_lines(a.org_id, a.period, v_plan, false);
    v_step := case a.period when 'yearly' then interval '1 year' else interval '1 month' end;
    insert into public.billing_charges
      (org_id, reason, period, plan_after, period_start, period_end, lines, total_cents, billing_email)
    values (a.org_id, 'renewal', a.period, v_plan, a.period_end, a.period_end + v_step,
            v_q->'lines', (v_q->>'total_cents')::bigint, a.billing_email);
    v_renew := v_renew + 1;
  end loop;

  -- Pending renewals due now, for companies with a card. Without one (paid by
  -- EFT) the charge waits for the operator, and the grace period still runs.
  select coalesce(jsonb_agg(jsonb_build_object(
           'charge_id', c.id, 'org_id', c.org_id, 'token', a2.provider_token,
           'total_cents', c.total_cents, 'attempts', c.attempts,
           'item_name', public.platform_setting('billing_item_name') #>> '{}') order by c.created_at), '[]'::jsonb)
    into v_due
    from public.billing_charges c
    join public.company_account a2 on a2.org_id = c.org_id
   where c.reason = 'renewal' and c.status = 'pending'
     and (c.next_retry_at is null or c.next_retry_at <= p_now)
     and (c.attempts = 0 or c.next_retry_at is not null)
     and a2.provider_token is not null;

  -- No card: past due straight away, so the grace period counts.
  update public.company_account a3
     set status = 'past_due',
         grace_ends_at = coalesce(a3.grace_ends_at,
           p_now + make_interval(days => coalesce((public.platform_setting('grace_days') #>> '{}')::int, 7))),
         updated_at = now()
   where a3.status = 'active' and a3.provider_token is null
     and exists (select 1 from public.billing_charges c
                  where c.org_id = a3.org_id and c.reason = 'renewal' and c.status = 'pending');

  return jsonb_build_object('trials_ended', v_trials, 'grace_ended', v_grace, 'cancelled', v_ended,
                            'renewals_written', v_renew, 'charge', v_due);
end;
$function$;
