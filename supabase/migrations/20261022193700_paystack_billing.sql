-- Paystack takes the company's card (owner, 22 Oct 2026), in place of Payfast.
--
-- The billing engine stays as it is (20261008091250_billing): what a company
-- owes is worked out here, from price_list (`billing_lines`), into a pending
-- `billing_charges` row; the invoice is issued when it is paid
-- (`billing_record_payment`), and `billing_payments` is the log of every
-- answer from the card provider. This migration only changes what Payfast
-- shaped and what the owner decided on 22 Oct:
--
--   1. Paystack is the provider. The card Paystack hands back (its
--      authorization code, last 4 digits, expiry, brand and the customer's
--      email) is kept in `billing_cards`, which only the service role can
--      read; the Billing page sees brand, last 4 and expiry through
--      `billing_card()`. `company_account.provider_token` (Payfast's token)
--      is no longer used.
--   2. Every charge tried on Paystack carries its reference
--      (`billing_charges.provider_reference`), so a payment that is still
--      queued is looked up before the same charge is tried again.
--   3. `billing_paystack_paid` records a successful Paystack payment once:
--      the same reference twice gives one invoice. Money that buys nothing is
--      refused, logged and handed back to the caller to refund: the wrong
--      amount or currency, a second payment for a charge already paid (under
--      another reference, or by EFT), a payment for a cancelled charge. It
--      returns instead of raising, so the log row stays.
--   4. "Update card" with nothing to pay: a small card check
--      (`card_check_cents`), refunded at once, saves the new card
--      (`billing_start_card_check`, reason 'card'; no invoice).
--   5. Paying for the plan no longer switches add-ons off. Checkout bills
--      reps (and setup) only, until the add-on bundle is priced.
--   6. A failed renewal is tried again on days 3 and 7 (`retry_days`), and
--      the company is emailed each time with a link to pay; the retry and
--      grace dates fall on whole days, so the daily run never misses one by
--      a few seconds. A try is counted once, however often its failure is
--      reported. `grace_days` stays the platform setting it was, and the
--      account is not locked on a morning its card is still to be tried.
--   8. The daily run deals with each company on its own: one company's
--      pricing error is reported and the others are still renewed.
--   9. More reps cannot be added while the next payment is due (they would
--      cost nothing), nor while a payment for more reps is under way.
--   7. The end of a free pilot locks nothing unless the operator turns on
--      `trial_end_read_only` (owner, 22 Oct: "keep it working").
--
-- Rollback: supabase/rollback/20261022193700_paystack_billing.down.sql.
-- Tests: supabase/tests/billing_paystack.sql.

---------------------------------------------------------------- 1. values
alter table public.company_account drop constraint company_account_provider_check;
alter table public.company_account add constraint company_account_provider_check
  check (provider = any (array['payfast'::text, 'paystack'::text]));

alter table public.billing_payments drop constraint billing_payments_source_check;
alter table public.billing_payments add constraint billing_payments_source_check
  check (source = any (array['notify'::text, 'charge'::text, 'manual'::text,
                             'checkout'::text, 'webhook'::text, 'verify'::text, 'refund'::text]));
alter table public.billing_payments drop constraint billing_payments_outcome_check;
alter table public.billing_payments add constraint billing_payments_outcome_check
  check (outcome = any (array['paid'::text, 'failed'::text, 'cancelled'::text, 'refused'::text, 'duplicate'::text,
                              'queued'::text, 'event'::text, 'refunded'::text]));

alter table public.billing_charges drop constraint billing_charges_reason_check;
alter table public.billing_charges add constraint billing_charges_reason_check
  check (reason = any (array['subscribe'::text, 'renewal'::text, 'change'::text, 'card'::text]));

-- The Paystack reference of the latest try. One reference, one charge.
alter table public.billing_charges add column provider_reference text
  check (provider_reference is null or provider_reference ~ '^TKD-[0-9a-f]{8}-[0-9a-f]{32}-[0-9]{10,16}$');
create unique index billing_charges_provider_reference
  on public.billing_charges (provider_reference) where provider_reference is not null;
-- When that try was made: a new one waits until Paystack has had time to answer.
alter table public.billing_charges add column provider_tried_at timestamptz;

insert into public.platform_settings (key, value, description) values
  ('trial_end_read_only', 'false'::jsonb,
   'Whether a company whose free pilot ended unpaid becomes read-only in the daily billing run. Off: it keeps working (owner, 22 Oct 2026).'),
  ('card_check_cents', '100'::jsonb,
   'What "Update card" charges, in cents, to save a new card when nothing is due. Refunded at once.')
on conflict (key) do nothing;
update public.platform_settings set value = '[3, 7]'::jsonb,
       description = 'Days after a renewal was first tried on which a failed card is tried again.'
 where key = 'retry_days';

---------------------------------------------------------------- 1. the card
create table public.billing_cards (
  org_id             uuid primary key references public.organizations(id) on delete cascade,
  provider           text not null default 'paystack' check (provider = 'paystack'),
  authorization_code text not null check (authorization_code ~ '^AUTH_[A-Za-z0-9]{1,60}$'),
  signature          text check (signature is null or char_length(signature) <= 100),
  last4              text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month          smallint check (exp_month between 1 and 12),
  exp_year           smallint check (exp_year between 2000 and 2100),
  brand              text check (brand is null or char_length(brand) <= 40),
  card_type          text check (card_type is null or char_length(card_type) <= 60),
  bank               text check (bank is null or char_length(bank) <= 120),
  country_code       text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  email              text not null check (char_length(email) between 3 and 254),
  customer_code      text check (customer_code is null or char_length(customer_code) <= 60),
  -- The payment that saved it.
  reference          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.billing_cards is
  'The card a company pays with (Paystack). Service role only: the authorization code charges the card.';
alter table public.billing_cards enable row level security;
revoke all on public.billing_cards from public, anon, authenticated;
grant select, insert, update, delete on public.billing_cards to service_role;

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'billing_cards', 'core'),
  ('function', 'billing_save_card', 'core'),
  ('function', 'billing_paystack_paid', 'core'),
  ('function', 'billing_start_card_check', 'core'),
  ('function', 'billing_card', 'core')
on conflict do nothing;

-- Keeps the card a payment brought (only one Paystack says can be charged
-- again), replacing the one before.
create or replace function public.billing_save_card(p_org uuid, p_card jsonb, p_reference text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_card->>'email', '')));
begin
  if p_org is null or p_card is null or jsonb_typeof(p_card) <> 'object'
     or lower(coalesce(p_card->>'reusable', '')) <> 'true'
     or coalesce(p_card->>'authorization_code', '') !~ '^AUTH_[A-Za-z0-9]{1,60}$'
     or char_length(v_email) < 3 then
    return false;
  end if;
  insert into public.billing_cards
    (org_id, authorization_code, signature, last4, exp_month, exp_year, brand, card_type, bank,
     country_code, email, customer_code, reference)
  values (
    p_org, p_card->>'authorization_code', nullif(left(p_card->>'signature', 100), ''),
    case when p_card->>'last4' ~ '^[0-9]{4}$' then p_card->>'last4' end,
    case when p_card->>'exp_month' ~ '^[0-9]{1,2}$' and (p_card->>'exp_month')::int between 1 and 12
         then (p_card->>'exp_month')::smallint end,
    case when p_card->>'exp_year' ~ '^[0-9]{4}$' then (p_card->>'exp_year')::smallint end,
    nullif(left(btrim(lower(p_card->>'brand')), 40), ''),
    nullif(left(btrim(p_card->>'card_type'), 60), ''),
    nullif(left(btrim(p_card->>'bank'), 120), ''),
    case when upper(p_card->>'country_code') ~ '^[A-Z]{2}$' then upper(p_card->>'country_code') end,
    v_email,
    nullif(left(p_card->>'customer_code', 60), ''),
    p_reference)
  on conflict (org_id) do update set
    provider = 'paystack', authorization_code = excluded.authorization_code, signature = excluded.signature,
    last4 = excluded.last4, exp_month = excluded.exp_month, exp_year = excluded.exp_year,
    brand = excluded.brand, card_type = excluded.card_type, bank = excluded.bank,
    country_code = excluded.country_code, email = excluded.email, customer_code = excluded.customer_code,
    reference = excluded.reference, updated_at = now();
  update public.company_account set provider = 'paystack', updated_at = now() where org_id = p_org;
  return true;
end;
$$;
revoke all on function public.billing_save_card(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.billing_save_card(uuid, jsonb, text) to service_role;

-- The card on file, as the Billing page shows it: never the code.
create or replace function public.billing_card()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.billing_my_org();
  c     public.billing_cards;
begin
  select * into c from public.billing_cards where org_id = v_org;
  if c.org_id is null then
    return null;
  end if;
  return jsonb_build_object('brand', c.brand, 'last4', c.last4, 'exp_month', c.exp_month, 'exp_year', c.exp_year,
                            'updated_at', c.updated_at);
end;
$$;
revoke all on function public.billing_card() from public, anon;
grant execute on function public.billing_card() to authenticated, service_role;

---------------------------------------------------------------- 4. the card check
create or replace function public.billing_start_card_check(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.billing_my_org();
  a       public.company_account;
  v_cents bigint;
  v_id    uuid;
begin
  select * into a from public.company_account where org_id = v_org for update;
  if a.status is null or a.status not in ('active', 'past_due') then
    raise exception 'Choose a plan first; the card you pay with is kept.' using errcode = '22023';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter the email address for receipts.' using errcode = '22023';
  end if;
  v_cents := coalesce((public.platform_setting('card_check_cents') #>> '{}')::bigint, 100);
  if v_cents < 1 then
    v_cents := 100;
  end if;

  update public.billing_charges set status = 'cancelled', updated_at = now()
   where org_id = v_org and reason = 'card' and status = 'pending';

  insert into public.billing_charges (org_id, reason, period, plan_after, lines, total_cents, billing_email)
  values (v_org, 'card', coalesce(a.period, 'monthly'), coalesce(a.plan, '{}'::jsonb),
          jsonb_build_array(jsonb_build_object('code', 'card_check', 'label', 'Card check, refunded at once',
                                               'quantity', 1, 'unit_cents', v_cents, 'amount_cents', v_cents)),
          v_cents, btrim(p_email))
  returning id into v_id;
  return jsonb_build_object('charge_id', v_id, 'total_cents', v_cents);
end;
$$;
revoke all on function public.billing_start_card_check(text) from public, anon;
grant execute on function public.billing_start_card_check(text) to authenticated, service_role;

---------------------------------------------------------------- 3. a payment
-- A successful Paystack payment for one charge, from the webhook, the
-- callback's verify or a saved-card charge, in any order and any number of
-- times. Refusals are logged and returned, not raised, so the log row stays.
create or replace function public.billing_paystack_paid(
  p_charge uuid, p_reference text, p_amount_cents bigint, p_currency text,
  p_card jsonb, p_source text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.billing_charges;
  v_inv    uuid;
  v_saved  boolean := false;
  v_why    text;
begin
  select * into c from public.billing_charges where id = p_charge for update;
  if c.id is null then
    raise exception 'No such charge.' using errcode = '22023';
  end if;
  -- The reference names the charge it pays (TKD-<org>-<charge>-<time>).
  if p_reference is null
     or p_reference !~ ('^TKD-[0-9a-f]{8}-' || replace(c.id::text, '-', '') || '-[0-9]{10,16}$') then
    raise exception 'Reference % is not for this charge.', p_reference using errcode = '22023';
  end if;

  -- The same payment reported again (webhook after verify, say): nothing new.
  if c.status = 'paid' and exists (select 1 from public.billing_payments
                                    where charge_id = c.id and outcome = 'paid' and provider_payment_id = p_reference) then
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, payload)
    values (c.id, c.org_id, 'paystack', p_source, 'duplicate', p_reference, p_amount_cents, p_payload);
    return jsonb_build_object('outcome', 'duplicate', 'reason', c.reason, 'invoice_id', c.invoice_id);
  end if;

  -- A refused payment reported again: refunded the first time, not again.
  if exists (select 1 from public.billing_payments
              where charge_id = c.id and outcome = 'refused' and provider_payment_id = p_reference) then
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, detail, payload)
    values (c.id, c.org_id, 'paystack', p_source, 'duplicate', p_reference, p_amount_cents, 'Refused before; already refunded.', p_payload);
    return jsonb_build_object('outcome', 'duplicate', 'reason', c.reason);
  end if;

  -- Money that buys nothing goes back: the caller refunds it.
  v_why := case
    when p_currency is distinct from 'ZAR' or p_amount_cents is distinct from c.total_cents
      then format('Paid %s %s; the charge is %s ZAR.', p_amount_cents, coalesce(p_currency, '?'), c.total_cents)
    when c.status = 'paid' then 'A second payment for a charge already paid.'
    when c.status = 'cancelled' then 'A payment for a charge that was replaced or cancelled.'
  end;
  if v_why is not null then
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, detail, payload)
    values (c.id, c.org_id, 'paystack', p_source, 'refused', p_reference, p_amount_cents, v_why || ' Refunding.', p_payload);
    return jsonb_build_object('outcome', 'refund', 'reason', c.reason, 'why', v_why);
  end if;
  if c.org_id is null then
    raise exception 'The company of this charge no longer exists.' using errcode = '22023';
  end if;

  if c.reason = 'card' then
    -- A card check: nothing bought, so no invoice; the caller refunds it.
    update public.billing_charges
       set status = 'paid', next_retry_at = null, last_error = null, updated_at = now()
     where id = c.id;
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, detail, payload)
    values (c.id, c.org_id, 'paystack', p_source, 'paid', p_reference, p_amount_cents, 'Card check', p_payload);
  else
    v_inv := public.billing_record_payment(c.id, p_reference, p_amount_cents, null, p_source, p_payload);
  end if;

  v_saved := public.billing_save_card(c.org_id, p_card, p_reference);
  if c.billing_email is not null then
    update public.company_account set billing_email = c.billing_email, updated_at = now()
     where org_id = c.org_id and billing_email is distinct from c.billing_email;
  end if;
  return jsonb_build_object('outcome', 'paid', 'reason', c.reason, 'invoice_id', v_inv, 'card_saved', v_saved);
end;
$$;
revoke all on function public.billing_paystack_paid(uuid, text, bigint, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_paystack_paid(uuid, text, bigint, text, jsonb, text, jsonb) to service_role;

---------------------------------------------------------------- 1, 5. record_payment
-- As 20261008091250, but the provider is Paystack and paying for the plan
-- leaves the company's add-on modules as they are.
create or replace function public.billing_record_payment(p_charge uuid, p_provider_payment_id text, p_amount_cents bigint, p_token text, p_source text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.billing_charges;
  a        public.company_account;
  v_inv    uuid;
  v_start  timestamptz;
  v_end    timestamptz;
  v_step   interval;
  v_off    text[];
  v_prov   text := case when p_source = 'manual' then 'manual' else 'paystack' end;
begin
  select * into c from public.billing_charges where id = p_charge for update;
  if c.id is null then
    raise exception 'No such charge.' using errcode = '22023';
  end if;
  if c.reason = 'card' then
    raise exception 'A card check is recorded by billing_paystack_paid.' using errcode = '22023';
  end if;
  if c.status = 'paid' then
    insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, amount_cents, payload)
    values (c.id, c.org_id, v_prov, p_source,
            'duplicate', case when p_source = 'manual' then null else p_provider_payment_id end, p_amount_cents, p_payload);
    return c.invoice_id;
  end if;
  if p_amount_cents is distinct from c.total_cents then
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
  values (c.id, c.org_id, v_prov, p_source, 'paid',
          case when p_source = 'manual' then null else p_provider_payment_id end, p_amount_cents,
          case when p_source = 'manual' then 'Reference: ' || p_provider_payment_id end, p_payload);

  if c.reason = 'subscribe' then
    -- Add-ons in the plan are switched on; none is switched off (22 Oct 2026:
    -- checkout bills reps only until the add-on bundle is priced).
    perform public.billing_apply_addons(c.org_id, c.plan_after->'addons', null);
    update public.company_account
       set status = 'active', period = c.period, plan = c.plan_after, plan_next = null,
           period_start = v_start, period_end = v_end,
           setup_charged = setup_charged or exists (
             select 1 from jsonb_array_elements(c.lines) l where l->>'code' = 'setup'),
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
           grace_ends_at = null, read_only_since = null, updated_at = now()
     where org_id = c.org_id;
  end if;
  return v_inv;
end;
$$;

---------------------------------------------------------------- 6. record_failure
-- As 20261008091250, with Paystack as the provider, the retry and grace dates
-- on whole days, and an email to the company each time a renewal fails.
create or replace function public.billing_record_failure(p_charge uuid, p_outcome text, p_detail text, p_source text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.billing_charges;
  v_days   jsonb := public.platform_setting('retry_days');
  v_grace  int := coalesce((public.platform_setting('grace_days') #>> '{}')::int, 7);
  v_next   timestamptz;
  v_ends   timestamptz;
  v_email  text;
  v_name   text;
  v_org    public.organizations;
  v_tz     text;
begin
  if p_outcome not in ('failed', 'cancelled') then
    raise exception 'Outcome must be failed or cancelled.' using errcode = '22023';
  end if;
  select * into c from public.billing_charges where id = p_charge for update;
  if c.id is null then
    raise exception 'No such charge.' using errcode = '22023';
  end if;
  -- One try, one failure: reported again (a reload, a resent answer), it
  -- counts nothing more and emails nobody.
  if c.provider_reference is not null
     and exists (select 1 from public.billing_payments
                  where charge_id = c.id and outcome in ('failed', 'cancelled')
                    and provider_payment_id = c.provider_reference) then
    return;
  end if;

  insert into public.billing_payments (charge_id, org_id, provider, source, outcome, provider_payment_id, detail, payload)
  values (c.id, c.org_id, 'paystack', p_source, p_outcome, c.provider_reference, p_detail, p_payload);

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

  -- Retry day N counts from the day the renewal was first tried.
  v_next := case when c.attempts < jsonb_array_length(coalesce(v_days, '[]'::jsonb))
                 then date_trunc('day', c.created_at) + make_interval(days => (v_days->>c.attempts)::int) end;
  update public.billing_charges
     set attempts = attempts + 1, last_error = p_detail, next_retry_at = v_next,
         status = case when v_next is null then 'failed' else 'pending' end,
         updated_at = now()
   where id = c.id;
  update public.company_account
     set status = 'past_due',
         grace_ends_at = coalesce(grace_ends_at, date_trunc('day', now()) + make_interval(days => v_grace)),
         updated_at = now()
   where org_id = c.org_id and status in ('active', 'past_due')
  returning grace_ends_at into v_ends;

  -- The company is told, with a link to pay. An email that cannot be queued
  -- never stops the failure being recorded.
  begin
    select * into v_org from public.organizations where id = c.org_id;
    v_tz := coalesce(nullif(btrim(v_org.timezone), ''), 'UTC');
    -- The address the company pays from, else its administrator's.
    select lower(e.email), p.full_name into v_email, v_name
      from public.profiles p
      left join auth.users u on u.id = p.id
      cross join lateral (select coalesce(nullif(btrim(p.email), ''), u.email) as email) e
     where p.org_id = c.org_id and p.is_active and e.email is not null
       and e.email !~* '@staff\.tickd\.co\.za$'
       and exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_code = 'admin')
     order by p.created_at, p.id
     limit 1;
    if nullif(btrim(c.billing_email), '') is not null then
      v_email := lower(btrim(c.billing_email));
    end if;
    if v_email is not null then
      perform public.queue_email(
        c.org_id, v_email, v_name, 'billing_payment_failed',
        jsonb_build_object(
          'first_name', split_part(btrim(coalesce(v_name, '')), ' ', 1),
          'company_name', v_org.name,
          'amount_cents', c.total_cents,
          'reason', left(coalesce(p_detail, ''), 200),
          'retry_on', case when v_next is null then null else (v_next at time zone v_tz)::date end,
          'read_only_on', case when v_ends is null then null else (v_ends at time zone v_tz)::date end),
        'billing_charge', c.id, null);
    end if;
  exception when others then
    raise warning 'billing: payment-failed email for % was not queued: %', c.id, sqlerrm;
  end;
end;
$$;

---------------------------------------------------------------- 1, 7. prepare_due
-- As 20261008091250, with these changes: an ended pilot becomes read-only
-- only when `trial_end_read_only` is on; a grace period that ran out locks
-- the account only once no try of its card is due that day; "has a card"
-- means a Paystack card in billing_cards; each company's renewal is written
-- on its own (an error is reported in `errors`, the others go on); and each
-- charge handed out names the reference of its last try, which the caller
-- looks up before trying again.
create or replace function public.billing_prepare_due(p_now timestamp with time zone default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trials   int := 0;
  v_grace    int;
  v_ended    int;
  v_renew    int := 0;
  a          public.company_account;
  v_plan     jsonb;
  v_used     int;
  v_q        jsonb;
  v_step     interval;
  v_due      jsonb;
  v_errors   jsonb := '[]'::jsonb;
begin
  if coalesce((public.platform_setting('trial_end_read_only') #>> '{}')::boolean, false) then
    update public.company_account
       set status = 'read_only', read_only_since = p_now, updated_at = now()
     where status = 'trial' and trial_ends_at <= p_now;
    get diagnostics v_trials = row_count;
  end if;

  update public.company_account a0
     set status = 'read_only', read_only_since = p_now, updated_at = now()
   where a0.status = 'past_due' and a0.grace_ends_at <= p_now
     and not exists (select 1 from public.billing_charges c
                      where c.org_id = a0.org_id and c.reason = 'renewal' and c.status = 'pending'
                        -- today's try only: a retry day that has passed unsettled locks.
                        and date_trunc('day', c.next_retry_at) = date_trunc('day', p_now)
                        and exists (select 1 from public.billing_cards k where k.org_id = a0.org_id));
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
    -- One company's error (a price missing, a plan priced on request) is
    -- reported, and the others are still renewed.
    begin
      v_plan := coalesce(a.plan_next, a.plan);
      -- Reps added since a smaller plan was asked for are paid for, not dropped.
      v_used := public.billing_seats_used(a.org_id, v_plan);
      v_plan := public.billing_plan(greatest((v_plan->>'seats')::int, v_used), v_plan->'addons');
      v_q := public.billing_lines(a.org_id, a.period, v_plan, false);
      v_step := case a.period when 'yearly' then interval '1 year' else interval '1 month' end;
      insert into public.billing_charges
        (org_id, reason, period, plan_after, period_start, period_end, lines, total_cents, billing_email)
      values (a.org_id, 'renewal', a.period, v_plan, a.period_end, a.period_end + v_step,
              v_q->'lines', (v_q->>'total_cents')::bigint, a.billing_email);
      v_renew := v_renew + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('org_id', a.org_id, 'error', left(sqlerrm, 300));
      raise warning 'billing: renewal for % not written: %', a.org_id, sqlerrm;
    end;
  end loop;

  -- Pending renewals due now, for companies with a card. Without one (paid by
  -- EFT) the charge waits for the operator, and the grace period still runs.
  select coalesce(jsonb_agg(jsonb_build_object(
           'charge_id', c.id, 'org_id', c.org_id, 'total_cents', c.total_cents,
           'attempts', c.attempts, 'reference', c.provider_reference) order by c.created_at), '[]'::jsonb)
    into v_due
    from public.billing_charges c
   where c.reason = 'renewal' and c.status = 'pending'
     and (c.next_retry_at is null or c.next_retry_at <= p_now)
     and (c.attempts = 0 or c.next_retry_at is not null)
     and exists (select 1 from public.billing_cards k where k.org_id = c.org_id);

  -- No card: past due straight away, so the grace period counts.
  update public.company_account a3
     set status = 'past_due',
         grace_ends_at = coalesce(a3.grace_ends_at,
           date_trunc('day', p_now) + make_interval(days => coalesce((public.platform_setting('grace_days') #>> '{}')::int, 7))),
         updated_at = now()
   where a3.status = 'active'
     and not exists (select 1 from public.billing_cards k where k.org_id = a3.org_id)
     and exists (select 1 from public.billing_charges c
                  where c.org_id = a3.org_id and c.reason = 'renewal' and c.status = 'pending');

  return jsonb_build_object('trials_ended', v_trials, 'grace_ended', v_grace, 'cancelled', v_ended,
                            'renewals_written', v_renew, 'charge', v_due, 'errors', v_errors);
end;
$$;

---------------------------------------------------------------- 9. request_change
-- As 20261008091250, with two refusals: while the next payment is due (the
-- period has ended, or a renewal is unpaid) more reps would cost nothing for
-- a period nobody has paid; and while a payment for more reps is under way,
-- a second one would charge the card again.
create or replace function public.billing_request_change(p_seats integer, p_addons jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_org  uuid := public.billing_my_org();
  a      public.company_account;
  v_plan jsonb := public.billing_plan(p_seats, p_addons);
  v_c    jsonb;
  v_used int;
  v_id   uuid;
begin
  select * into a from public.company_account where org_id = v_org for update;
  if a.status <> 'active' then
    raise exception 'The plan can be changed once the account is paid up.' using errcode = '22023';
  end if;
  if a.period_end is null or a.period_end <= now()
     or exists (select 1 from public.billing_charges
                 where org_id = v_org and reason = 'renewal' and status in ('pending', 'failed')) then
    raise exception 'Your next payment is due. Once it is paid, you can change the number of places.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.billing_charges
              where org_id = v_org and reason = 'change' and status = 'pending'
                and provider_tried_at > now() - interval '30 minutes') then
    raise exception 'A payment for more places is still being processed. Try again in a few minutes.'
      using errcode = '22023';
  end if;
  v_used := public.billing_seats_used(v_org, v_plan);
  if (v_plan->>'seats')::int < v_used then
    raise exception 'Your company has % active reps; deactivate some before choosing fewer.', v_used
      using errcode = '22023';
  end if;

  v_c := public.billing_change_lines(v_org, v_plan, now());

  if not (v_c->>'more')::boolean then
    update public.company_account
       set plan_next = case when (v_c->>'less')::boolean then v_c->'plan_next' end, updated_at = now()
     where org_id = v_org;
    return null;
  end if;
  if (v_c->>'total_cents')::bigint <= 0 then
    -- More, but nothing left of the period to charge for.
    update public.company_account
       set plan = v_c->'plan_after', plan_next = v_c->'plan_next', updated_at = now()
     where org_id = v_org;
    return null;
  end if;

  update public.billing_charges set status = 'cancelled', updated_at = now()
   where org_id = v_org and reason = 'change' and status = 'pending';
  insert into public.billing_charges
    (org_id, reason, period, plan_after, plan_next, period_start, period_end, lines, total_cents, billing_email)
  values (v_org, 'change', a.period, v_c->'plan_after', v_c->'plan_next', a.period_start, a.period_end,
          v_c->'lines', (v_c->>'total_cents')::bigint, a.billing_email)
  returning id into v_id;
  return jsonb_build_object('charge_id', v_id, 'total_cents', (v_c->>'total_cents')::bigint,
    'item_name', public.platform_setting('billing_item_name') #>> '{}');
end;
$function$;
