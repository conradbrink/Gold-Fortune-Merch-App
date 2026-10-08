-- Billing (Stage 6): plans, prices, charges and invoices, paid by card through
-- Payfast.
--
-- Why: the owner wants a company that signed up for a trial to be able to pay
-- for its plan itself, and keeps paying monthly or yearly without anyone
-- chasing it (requirements §5.5; owner's decisions 8 Oct 2026: Payfast; not
-- VAT registered yet; paid seats, more seats charged pro-rata today, fewer from
-- the next renewal; one stage with the read-only gate, which is the next
-- migration).
--
-- How the money moves. Payfast's own "subscriptions" charge a fixed amount, but
-- this bill changes with users, add-ons and pro-rata, so Payfast is used only to
-- keep the card: the first payment is made on Payfast's page with tokenization
-- on, which leaves a token here, and every later amount is charged to that token
-- by the server (Payfast's ad-hoc API). This database decides every amount.
--
--   price_list           every price, as data: base plan with its included users,
--                        extra user, add-ons (a quantity, or a tier by number of
--                        employees), setup. Amounts in cents, as charged.
--   company_account      gains the plan: status, monthly or yearly, seats and
--                        add-ons, the paid period, the card token.
--   billing_charges      an amount we are trying to collect: first payment,
--                        renewal, or more seats/add-ons today. Retries live here.
--   billing_invoices     issued only when a charge is paid (or the operator
--                        records an EFT), so every number stands for money
--                        received and the numbering has no gaps or voids.
--                        Credit notes are rows here too, never edits.
--   billing_payments     every attempt and every Payfast notification, raw.
--   billing_counters     the gap-free invoice and credit note numbers.
--
-- Functions, in three groups:
--   for the company's own pages (signed in, company settings permission):
--     billing_quote, billing_preview_change, billing_start_checkout,
--     billing_request_change, billing_set_cancel; my_account (any signed-in user)
--   for the server only (service role): billing_record_payment,
--     billing_record_failure, billing_prepare_due
--   for the operator (service role, with the operator as actor, audit row in the
--     same transaction): billing_operator_mark_paid, billing_operator_set_custom_price,
--     billing_operator_set_exempt, billing_operator_extend_trial,
--     billing_operator_credit_note, billing_operator_cancel_charge
--
-- Users: a trigger on profiles refuses a login past the company's limit: the
-- trial's user limit (platform_settings), or the plan's paid seats. Exempt
-- companies, and companies with no account row, have no limit.
--
-- Gold Fortune, and every company with no trial today, becomes `exempt`: never
-- charged, never limited, nothing on its screens changes.
--
-- Rollback: supabase/rollback/<this version>_billing.down.sql.

------------------------------------------------------------ platform settings

insert into public.platform_settings (key, value, description) values
  ('seller_name', 'null', 'The business name printed on invoices as the seller, or null until supplied.'),
  ('seller_address', 'null', 'The seller''s address printed on invoices, or null.'),
  ('seller_email', 'null', 'The seller''s contact email printed on invoices, or null.'),
  ('seller_vat_number', 'null', 'The seller''s VAT number. Null: not VAT registered, invoices carry no VAT. Set: "Tax Invoice" with VAT included in the price.'),
  ('vat_rate', '15', 'VAT rate in percent, used only when seller_vat_number is set.'),
  ('invoice_prefix', '"INV-"', 'Prefix of invoice numbers.'),
  ('credit_note_prefix', '"CN-"', 'Prefix of credit note numbers.'),
  ('billing_item_name', '"Tickd subscription"', 'What the card statement and the payment page call a charge.'),
  ('retry_days', '[1, 3, 7]', 'Days after a failed renewal charge on which it is tried again.'),
  ('grace_days', '7', 'Days after the first failed renewal before the company becomes read-only.'),
  ('read_only_days', '30', 'Days a company stays read-only before the operator is shown it as due for deletion.'),
  ('trial_user_limit', '10', 'Most active logins a company on trial may have.');

------------------------------------------------------------ price list

create table public.price_list (
  id             bigint generated always as identity primary key,
  code           text not null check (code ~ '^[a-z][a-z_]*$'),
  kind           text not null check (kind in ('base', 'extra_user', 'addon', 'setup')),
  period         text not null check (period in ('monthly', 'yearly', 'once')),
  -- add-ons only: the module this price switches on. The code is the module's.
  module_code    text references public.modules(code),
  -- company: once per company · user: per extra user · quantity: per unit the
  -- company chooses (warehouses) · employees: one tier picked by the number of
  -- active employees in HR.
  unit           text not null check (unit in ('company', 'user', 'quantity', 'employees')),
  tier_min       integer check (tier_min >= 0),
  tier_max       integer check (tier_max >= tier_min),
  amount_cents   bigint not null check (amount_cents >= 0),
  -- Logins that come with this price without using a paid seat: the base plan's
  -- included users; per unit of an add-on, logins with one of included_roles.
  included_users integer not null default 0 check (included_users >= 0),
  included_roles text[],
  label          text not null,
  active_from    date not null default current_date,
  active_to      date,
  check ((kind = 'addon') = (module_code is not null)),
  check (kind <> 'addon' or code = module_code),
  check ((unit = 'employees') = (tier_min is not null)),
  check ((kind = 'setup') = (period = 'once')),
  check (active_to is null or active_to > active_from)
);
create unique index price_list_one_price
  on public.price_list (code, period, coalesce(tier_min, -1), active_from);

alter table public.price_list enable row level security;
-- Prices are public on the sales site; any signed-in user may read them.
create policy price_list_select on public.price_list for select to authenticated using (true);
revoke insert, update, delete, truncate on public.price_list from anon, authenticated;
revoke all on public.price_list from anon;

-- From the sales site (site/lib/site.ts and ~/Downloads/pricing-implementation.md,
-- 7 Oct 2026): yearly is ten months (two months free); setup is charged once, on
-- the first monthly payment, and is free on yearly.
insert into public.price_list
  (code, kind, period, module_code, unit, tier_min, tier_max, amount_cents, included_users, included_roles, label, active_from)
values
  ('base', 'base', 'monthly', null, 'company', null, null, 149900, 3, null, 'Plan with 3 users', date '2026-10-01'),
  ('base', 'base', 'yearly',  null, 'company', null, null, 1499000, 3, null, 'Plan with 3 users', date '2026-10-01'),
  ('extra_user', 'extra_user', 'monthly', null, 'user', null, null, 34900, 0, null, 'Extra user', date '2026-10-01'),
  ('extra_user', 'extra_user', 'yearly',  null, 'user', null, null, 349000, 0, null, 'Extra user', date '2026-10-01'),
  ('hr', 'addon', 'monthly', 'hr', 'employees', 0, 5,  19900, 0, null, 'HR, up to 5 employees', date '2026-10-01'),
  ('hr', 'addon', 'monthly', 'hr', 'employees', 6, 30, 49900, 0, null, 'HR, 6 to 30 employees', date '2026-10-01'),
  ('hr', 'addon', 'yearly',  'hr', 'employees', 0, 5,  199000, 0, null, 'HR, up to 5 employees', date '2026-10-01'),
  ('hr', 'addon', 'yearly',  'hr', 'employees', 6, 30, 499000, 0, null, 'HR, 6 to 30 employees', date '2026-10-01'),
  ('warehouse', 'addon', 'monthly', 'warehouse', 'quantity', null, null, 49900, 2, '{warehouse}', 'Warehouse and deliveries, per warehouse', date '2026-10-01'),
  ('warehouse', 'addon', 'yearly',  'warehouse', 'quantity', null, null, 499000, 2, '{warehouse}', 'Warehouse and deliveries, per warehouse', date '2026-10-01'),
  ('setup', 'setup', 'once', null, 'company', null, null, 250000, 0, null, 'Setup', date '2026-10-01');

------------------------------------------------------------ company account

alter table public.company_account
  add column status text not null default 'trial'
    check (status in ('trial', 'active', 'past_due', 'read_only', 'cancelled', 'exempt')),
  add column period text check (period in ('monthly', 'yearly')),
  -- {"seats": 5, "addons": {"hr": 1, "warehouse": 2}}: what is paid for now.
  add column plan jsonb,
  -- What the next renewal charges, when the company asked for less.
  add column plan_next jsonb,
  -- Set by the operator: one amount per period instead of the price list.
  add column custom_price_cents bigint check (custom_price_cents >= 0),
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column setup_charged boolean not null default false,
  add column provider text check (provider in ('payfast')),
  add column provider_token text,
  add column billing_email text,
  add column grace_ends_at timestamptz,
  add column read_only_since timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add constraint company_account_plan_shape check (
    plan is null or (jsonb_typeof(plan) = 'object' and (plan->>'seats')::int >= 1)),
  add constraint company_account_period_order check (period_end is null or period_end > period_start);

-- The token can charge the card: nobody reads it through the API, not even
-- the company itself (column grants; the service role is unaffected).
revoke select on public.company_account from authenticated;
grant select (org_id, trial_ends_at, onboarding_dismissed_at, onboarding_dismissed_by,
              created_at, updated_at, status, period, plan, plan_next, custom_price_cents,
              period_start, period_end, setup_charged, provider, billing_email,
              grace_ends_at, read_only_since, cancel_at_period_end)
  on public.company_account to authenticated;

-- Every company with no trial today (Gold Fortune) is billed outside the app.
update public.company_account set status = 'exempt' where trial_ends_at is null;

------------------------------------------------------------ counters

create table public.billing_counters (
  key  text primary key check (key in ('invoice', 'credit_note')),
  next bigint not null check (next >= 1)
);
alter table public.billing_counters enable row level security;
revoke all on public.billing_counters from anon, authenticated;
insert into public.billing_counters (key, next) values ('invoice', 1), ('credit_note', 1);

------------------------------------------------------------ charges

create table public.billing_charges (
  id             uuid primary key default gen_random_uuid(),
  -- Kept when the company is deleted: it records money asked for.
  org_id         uuid references public.organizations(id) on delete set null,
  reason         text not null check (reason in ('subscribe', 'renewal', 'change')),
  status         text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  period         text not null check (period in ('monthly', 'yearly')),
  -- The plan this charge pays for; applied when it is paid.
  plan_after     jsonb not null,
  plan_next      jsonb,
  period_start   timestamptz,
  period_end     timestamptz,
  lines          jsonb not null,
  total_cents    bigint not null check (total_cents > 0),
  billing_email  text,
  attempts       integer not null default 0,
  next_retry_at  timestamptz,
  last_error     text,
  invoice_id     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- One renewal per company and period, however often the daily run fires.
create unique index billing_charges_one_renewal
  on public.billing_charges (org_id, period_start) where reason = 'renewal' and status <> 'cancelled';
create index billing_charges_org on public.billing_charges (org_id, created_at desc);

alter table public.billing_charges enable row level security;
create policy billing_charges_select on public.billing_charges for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));
revoke insert, update, delete, truncate on public.billing_charges from anon, authenticated;
revoke all on public.billing_charges from anon;

------------------------------------------------------------ invoices

create table public.billing_invoices (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  kind                text not null default 'invoice' check (kind in ('invoice', 'credit_note')),
  org_id              uuid references public.organizations(id) on delete set null,
  charge_id           uuid references public.billing_charges(id),
  credit_for          uuid references public.billing_invoices(id),
  issued_at           timestamptz not null default now(),
  period_start        timestamptz,
  period_end          timestamptz,
  -- Who and what, as they were on the day: a later change of name or address
  -- does not rewrite an issued invoice.
  buyer               jsonb not null,
  seller              jsonb not null,
  lines               jsonb not null,
  total_cents         bigint not null,
  vat_cents           bigint not null default 0,
  vat_registered      boolean not null,
  paid_at             timestamptz,
  paid_method         text check (paid_method in ('card', 'eft')),
  payment_reference   text,
  reason              text,
  check ((kind = 'invoice') = (total_cents > 0)),
  check ((kind = 'credit_note') = (credit_for is not null))
);
create index billing_invoices_org on public.billing_invoices (org_id, issued_at desc);

alter table public.billing_charges
  add constraint billing_charges_invoice_fk foreign key (invoice_id) references public.billing_invoices(id);

alter table public.billing_invoices enable row level security;
create policy billing_invoices_select on public.billing_invoices for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));
revoke insert, update, delete, truncate on public.billing_invoices from anon, authenticated;
revoke all on public.billing_invoices from anon;

------------------------------------------------------------ payment log

create table public.billing_payments (
  id                  bigint generated always as identity primary key,
  charge_id           uuid references public.billing_charges(id),
  org_id              uuid references public.organizations(id) on delete set null,
  provider            text not null,
  -- notify: Payfast's server-to-server notification · charge: our ad-hoc call ·
  -- manual: the operator recorded an EFT
  source              text not null check (source in ('notify', 'charge', 'manual')),
  outcome             text not null check (outcome in ('paid', 'failed', 'cancelled', 'refused', 'duplicate')),
  provider_payment_id text,
  amount_cents        bigint,
  detail              text,
  payload             jsonb,
  created_at          timestamptz not null default now()
);
create index billing_payments_charge on public.billing_payments (charge_id);
create unique index billing_payments_once
  on public.billing_payments (provider, provider_payment_id) where outcome = 'paid';

alter table public.billing_payments enable row level security;
-- Payloads stay with the service; the company sees its invoices and charges.
revoke all on public.billing_payments from anon, authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'price_list', 'core'),
  ('table', 'billing_counters', 'core'),
  ('table', 'billing_charges', 'core'),
  ('table', 'billing_invoices', 'core'),
  ('table', 'billing_payments', 'core');

------------------------------------------------------------ helpers

create or replace function public.platform_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select value from public.platform_settings where key = p_key
$function$;
revoke all on function public.platform_setting(text) from public, anon, authenticated;
grant execute on function public.platform_setting(text) to service_role;

-- Logins that use a paid seat: every active login, less those an add-on brings
-- with it (each warehouse brings two warehouse logins).
create or replace function public.billing_seats_used(p_org uuid, p_plan jsonb)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_total int;
  v_free  int := 0;
  r       record;
begin
  select count(*) into v_total from public.profiles where org_id = p_org and is_active;
  for r in
    select p.included_users * greatest(coalesce((p_plan->'addons'->>p.code)::int, 0), 0) as slots,
           p.included_roles
      from public.price_list p
     where p.kind = 'addon' and p.included_users > 0 and p.included_roles is not null
       and p.period = 'monthly'
       and p.active_from <= current_date and (p.active_to is null or p.active_to > current_date)
  loop
    if r.slots > 0 then
      v_free := v_free + least(r.slots, (select count(*) from public.profiles
                                          where org_id = p_org and is_active and role = any (r.included_roles)));
    end if;
  end loop;
  return v_total - v_free;
end;
$function$;
revoke all on function public.billing_seats_used(uuid, jsonb) from public, anon, authenticated;

-- The price of one plan for one period, line by line. The only place an
-- amount is worked out: the Billing page's quote, the first payment, renewals
-- and pro-rata all come from here.
create or replace function public.billing_lines(p_org uuid, p_period text, p_plan jsonb, p_with_setup boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_seats    int := (p_plan->>'seats')::int;
  v_custom   bigint;
  v_lines    jsonb := '[]'::jsonb;
  v_base     public.price_list;
  v_row      public.price_list;
  v_extra    int;
  v_qty      int;
  v_count    int;
  a          record;
begin
  if p_period is null or p_period not in ('monthly', 'yearly') then
    raise exception 'Choose monthly or yearly.' using errcode = '22023';
  end if;
  if v_seats is null or v_seats < 1 or v_seats > 1000 then
    raise exception 'The number of users must be between 1 and 1000.' using errcode = '22023';
  end if;
  if p_plan->'addons' is not null and jsonb_typeof(p_plan->'addons') <> 'object' then
    raise exception 'Add-ons are not understood.' using errcode = '22023';
  end if;

  select custom_price_cents into v_custom from public.company_account where org_id = p_org;
  if v_custom is not null then
    return jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'code', 'custom', 'label', 'Plan as agreed', 'quantity', 1,
        'unit_cents', v_custom, 'amount_cents', v_custom)),
      'total_cents', v_custom, 'custom', true);
  end if;

  select * into v_base from public.price_list
   where code = 'base' and kind = 'base' and period = p_period
     and active_from <= current_date and (active_to is null or active_to > current_date)
   order by active_from desc limit 1;
  if v_base.id is null then
    raise exception 'No % base price is set.' , p_period using errcode = '22023';
  end if;
  v_lines := v_lines || jsonb_build_object('code', 'base', 'label', v_base.label, 'quantity', 1,
               'unit_cents', v_base.amount_cents, 'amount_cents', v_base.amount_cents);

  v_extra := greatest(v_seats - v_base.included_users, 0);
  if v_extra > 0 then
    select * into v_row from public.price_list
     where kind = 'extra_user' and period = p_period
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_row.id is null then
      raise exception 'No % extra-user price is set.', p_period using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', v_extra,
                 'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents * v_extra);
  end if;

  for a in select key, value from jsonb_each(coalesce(p_plan->'addons', '{}'::jsonb)) order by key loop
    if jsonb_typeof(a.value) <> 'number' then
      raise exception 'Add-on % has no quantity.', a.key using errcode = '22023';
    end if;
    v_qty := (a.value #>> '{}')::int;
    continue when v_qty = 0;
    if v_qty < 0 or v_qty > 100 then
      raise exception 'Add-on % quantity must be between 0 and 100.', a.key using errcode = '22023';
    end if;
    if not exists (select 1 from public.modules m
                    where m.code = a.key and m.plan_type = 'addon' and m.is_built) then
      raise exception '% is not an add-on that can be bought.', a.key using errcode = '22023';
    end if;

    select * into v_row from public.price_list
     where code = a.key and kind = 'addon' and period = p_period
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_row.id is null then
      raise exception 'No % price is set for add-on %.', p_period, a.key using errcode = '22023';
    end if;

    if v_row.unit = 'employees' then
      if v_qty <> 1 then
        raise exception 'Add-on % is on or off (quantity 1).', a.key using errcode = '22023';
      end if;
      select count(*) into v_count from public.hr_employees e
       where e.org_id = p_org and e.employment_status = 'active';
      select * into v_row from public.price_list
       where code = a.key and kind = 'addon' and period = p_period
         and v_count between tier_min and coalesce(tier_max, 2147483647)
         and active_from <= current_date and (active_to is null or active_to > current_date)
       order by active_from desc limit 1;
      if v_row.id is null then
        raise exception '% for % employees is priced on request. Talk to us.', a.key, v_count
          using errcode = '22023', hint = 'quote';
      end if;
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'tier_min', v_row.tier_min,
                   'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents);
    elsif v_row.unit = 'quantity' then
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', v_qty,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents * v_qty);
    else
      if v_qty <> 1 then
        raise exception 'Add-on % is on or off (quantity 1).', a.key using errcode = '22023';
      end if;
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents);
    end if;
  end loop;

  if p_with_setup and p_period = 'monthly' then
    select * into v_row from public.price_list
     where kind = 'setup'
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_row.id is not null and v_row.amount_cents > 0 then
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents, 'once', true);
    end if;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'total_cents', (select coalesce(sum((l->>'amount_cents')::bigint), 0) from jsonb_array_elements(v_lines) l),
    'custom', false);
end;
$function$;
revoke all on function public.billing_lines(uuid, text, jsonb, boolean) from public, anon, authenticated;
-- The operator's console prices each company's plan for its revenue column.
grant execute on function public.billing_lines(uuid, text, jsonb, boolean) to service_role;

-- VAT inside a total, when the seller is registered; none when not.
create or replace function public.billing_vat(p_total bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_number text := public.platform_setting('seller_vat_number') #>> '{}';
  v_rate   numeric := coalesce((public.platform_setting('vat_rate') #>> '{}')::numeric, 0);
begin
  if v_number is null or btrim(v_number) = '' then
    return jsonb_build_object('registered', false, 'vat_cents', 0, 'rate', 0);
  end if;
  return jsonb_build_object('registered', true, 'rate', v_rate,
    'vat_cents', round(p_total * v_rate / (100 + v_rate))::bigint);
end;
$function$;
revoke all on function public.billing_vat(bigint) from public, anon, authenticated;

-- The caller's company, if they may manage its settings; refuses otherwise.
create or replace function public.billing_my_org()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can see or change the plan.'
      using errcode = '42501';
  end if;
  return v_org;
end;
$function$;
revoke all on function public.billing_my_org() from public, anon, authenticated;

-- Normalises a plan from the page: seats, and add-ons with a quantity above 0.
create or replace function public.billing_plan(p_seats integer, p_addons jsonb)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('seats', p_seats, 'addons', coalesce((
    select jsonb_object_agg(key, value order by key)
      from jsonb_each(coalesce(p_addons, '{}'::jsonb))
     where jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0), '{}'::jsonb))
$function$;
revoke all on function public.billing_plan(integer, jsonb) from public, anon;
grant execute on function public.billing_plan(integer, jsonb) to authenticated, service_role;

-- How far into the paid period now is: the share still to come, 0 to 1.
create or replace function public.billing_remaining_share(p_start timestamptz, p_end timestamptz, p_now timestamptz)
returns numeric
language sql
immutable
as $function$
  select case
    when p_start is null or p_end is null or p_end <= p_start then 0
    else least(greatest(extract(epoch from (p_end - greatest(p_now, p_start)))
                        / extract(epoch from (p_end - p_start)), 0), 1)
  end
$function$;
revoke all on function public.billing_remaining_share(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- What a change costs today: each line that grows is charged for the part of
-- the period that is left; lines that shrink are not refunded (they apply
-- from the next renewal).
create or replace function public.billing_change_lines(p_org uuid, p_plan jsonb, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  a        public.company_account;
  v_up     jsonb;
  v_old    jsonb;
  v_new    jsonb;
  v_share  numeric;
  v_lines  jsonb := '[]'::jsonb;
  v_more   boolean := false;
  v_less   boolean := false;
  n        record;
  v_was    bigint;
  v_amount bigint;
begin
  select * into a from public.company_account where org_id = p_org;
  if a.status not in ('active', 'past_due') or a.plan is null then
    raise exception 'There is no plan to change yet.' using errcode = '22023';
  end if;
  if a.custom_price_cents is not null then
    raise exception 'Your plan was arranged with us. Talk to us to change it.' using errcode = '22023';
  end if;

  -- Seats and every add-on quantity: the larger of now and asked for is what
  -- is paid for until the renewal.
  v_up := jsonb_build_object(
    'seats', greatest((a.plan->>'seats')::int, (p_plan->>'seats')::int),
    'addons', coalesce((
      select jsonb_object_agg(k, greatest(coalesce((a.plan->'addons'->>k)::int, 0),
                                          coalesce((p_plan->'addons'->>k)::int, 0)) order by k)
        from (select jsonb_object_keys(coalesce(a.plan->'addons', '{}'::jsonb)) k
              union select jsonb_object_keys(coalesce(p_plan->'addons', '{}'::jsonb))) keys), '{}'::jsonb));
  v_up := public.billing_plan((v_up->>'seats')::int, v_up->'addons');

  v_more := v_up <> a.plan;
  v_less := public.billing_plan((p_plan->>'seats')::int, p_plan->'addons') <> v_up;

  v_old := public.billing_lines(p_org, a.period, a.plan, false);
  v_new := public.billing_lines(p_org, a.period, v_up, false);
  v_share := public.billing_remaining_share(a.period_start, a.period_end, p_now);

  for n in select l from jsonb_array_elements(v_new->'lines') l loop
    select coalesce(sum((o->>'amount_cents')::bigint), 0) into v_was
      from jsonb_array_elements(v_old->'lines') o where o->>'code' = n.l->>'code';
    v_amount := round(((n.l->>'amount_cents')::bigint - v_was) * v_share);
    if v_amount > 0 then
      v_lines := v_lines || (n.l || jsonb_build_object(
        'label', (n.l->>'label') || ', to ' || to_char(a.period_end at time zone 'UTC', 'FMDD Mon YYYY'),
        'amount_cents', v_amount, 'prorated', true));
    end if;
  end loop;

  return jsonb_build_object(
    'plan_after', v_up,
    'plan_next', case when v_less then public.billing_plan((p_plan->>'seats')::int, p_plan->'addons') end,
    'more', v_more, 'less', v_less,
    'lines', v_lines,
    'total_cents', (select coalesce(sum((l->>'amount_cents')::bigint), 0) from jsonb_array_elements(v_lines) l),
    'next_total_cents', (public.billing_lines(p_org, a.period,
        public.billing_plan((p_plan->>'seats')::int, p_plan->'addons'), false)->>'total_cents')::bigint,
    'period_end', a.period_end);
end;
$function$;
revoke all on function public.billing_change_lines(uuid, jsonb, timestamptz) from public, anon, authenticated;

------------------------------------------------------------ for the company's pages

-- The status every signed-in user's screens need (banners, read-only), with
-- no amounts. A company with no account row is managed outside the app.
create or replace function public.my_account()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
  a     public.company_account;
begin
  if v_org is null then
    raise exception 'Not signed in to a company.' using errcode = '42501';
  end if;
  select * into a from public.company_account where org_id = v_org;
  return jsonb_build_object(
    'status', coalesce(a.status, 'exempt'),
    'writable', coalesce(a.status, 'exempt') not in ('read_only', 'cancelled'),
    'trial_ends_at', a.trial_ends_at,
    'period_end', a.period_end,
    'grace_ends_at', a.grace_ends_at,
    'read_only_since', a.read_only_since,
    'cancel_at_period_end', coalesce(a.cancel_at_period_end, false),
    'can_manage', public.has_permission('company_settings'));
end;
$function$;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

-- The price of a plan for the caller's company, for the Billing page.
create or replace function public.billing_quote(p_period text, p_seats integer, p_addons jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org   uuid := public.billing_my_org();
  v_plan  jsonb := public.billing_plan(p_seats, p_addons);
  v_q     jsonb;
  v_setup boolean;
begin
  select not coalesce(setup_charged, false) into v_setup from public.company_account where org_id = v_org;
  v_q := public.billing_lines(v_org, p_period, v_plan, coalesce(v_setup, true));
  return v_q || jsonb_build_object(
    'plan', v_plan,
    'seats_used', public.billing_seats_used(v_org, v_plan),
    'vat', public.billing_vat((v_q->>'total_cents')::bigint));
end;
$function$;
revoke all on function public.billing_quote(text, integer, jsonb) from public, anon;
grant execute on function public.billing_quote(text, integer, jsonb) to authenticated;

-- What changing the current plan would cost today and from the next renewal.
create or replace function public.billing_preview_change(p_seats integer, p_addons jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.billing_my_org();
begin
  return public.billing_change_lines(v_org, public.billing_plan(p_seats, p_addons), now())
    || jsonb_build_object('seats_used', public.billing_seats_used(v_org, public.billing_plan(p_seats, p_addons)));
end;
$function$;
revoke all on function public.billing_preview_change(integer, jsonb) from public, anon;
grant execute on function public.billing_preview_change(integer, jsonb) to authenticated;

-- Starts the first payment: a pending charge for the first period (with the
-- setup on monthly), which the server sends to Payfast's page. An earlier
-- unpaid start is cancelled, so only the latest can be paid.
create or replace function public.billing_start_checkout(p_period text, p_seats integer, p_addons jsonb, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_org    uuid := public.billing_my_org();
  a        public.company_account;
  v_plan   jsonb := public.billing_plan(p_seats, p_addons);
  v_q      jsonb;
  v_used   int;
  v_id     uuid;
begin
  select * into a from public.company_account where org_id = v_org for update;
  -- Exempt is billed outside the app, unless the operator quoted a price for
  -- it to pay by card here.
  if coalesce(a.status, 'exempt') = 'exempt' and a.custom_price_cents is null then
    raise exception 'Your company''s plan is managed by us. Talk to us to change it.' using errcode = '22023';
  end if;
  if a.status in ('active', 'past_due') then
    raise exception 'Your company already has a plan.' using errcode = '22023';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter the email address for receipts.' using errcode = '22023';
  end if;
  v_used := public.billing_seats_used(v_org, v_plan);
  if (v_plan->>'seats')::int < v_used then
    raise exception 'Your company has % active users; choose at least that many, or deactivate some first.', v_used
      using errcode = '22023';
  end if;

  v_q := public.billing_lines(v_org, p_period, v_plan, not a.setup_charged);

  update public.billing_charges set status = 'cancelled', updated_at = now()
   where org_id = v_org and reason = 'subscribe' and status = 'pending';

  insert into public.billing_charges (org_id, reason, period, plan_after, lines, total_cents, billing_email)
  values (v_org, 'subscribe', p_period, v_plan, v_q->'lines', (v_q->>'total_cents')::bigint, btrim(p_email))
  returning id into v_id;

  return jsonb_build_object('charge_id', v_id, 'total_cents', (v_q->>'total_cents')::bigint,
    'item_name', public.platform_setting('billing_item_name') #>> '{}');
end;
$function$;
revoke all on function public.billing_start_checkout(text, integer, jsonb, text) from public, anon;
grant execute on function public.billing_start_checkout(text, integer, jsonb, text) to authenticated;

-- Changes the plan. Less takes effect at the next renewal (recorded now);
-- more is a pending charge for the rest of this period, which the server
-- charges to the card at once. Returns the charge, or null when nothing is
-- charged today.
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
  v_used := public.billing_seats_used(v_org, v_plan);
  if (v_plan->>'seats')::int < v_used then
    raise exception 'Your company has % active users; deactivate some before choosing fewer.', v_used
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
revoke all on function public.billing_request_change(integer, jsonb) from public, anon;
grant execute on function public.billing_request_change(integer, jsonb) to authenticated;

-- Cancel at the end of the paid period, or take that back.
create or replace function public.billing_set_cancel(p_cancel boolean)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.billing_my_org();
begin
  update public.company_account
     set cancel_at_period_end = coalesce(p_cancel, false), updated_at = now()
   where org_id = v_org and status in ('active', 'past_due');
  if not found then
    raise exception 'There is no plan to cancel.' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function public.billing_set_cancel(boolean) from public, anon;
grant execute on function public.billing_set_cancel(boolean) to authenticated;

-- After updating the card: puts the company's unpaid renewal to the card
-- again now, instead of waiting for the next retry day. Returns the charge for
-- the server to put to the card, or null when there is none.
create or replace function public.billing_retry_now()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.billing_my_org();
  c     public.billing_charges;
begin
  -- The latest unpaid renewal, including one whose retries have run out.
  select * into c from public.billing_charges
   where org_id = v_org and reason = 'renewal' and status in ('pending', 'failed')
   order by created_at desc limit 1 for update;
  if c.id is null then
    return null;
  end if;
  if c.status = 'failed' then
    update public.billing_charges set status = 'pending', updated_at = now() where id = c.id;
  end if;
  return jsonb_build_object('charge_id', c.id, 'total_cents', c.total_cents,
    'item_name', public.platform_setting('billing_item_name') #>> '{}');
end;
$function$;
revoke all on function public.billing_retry_now() from public, anon;
grant execute on function public.billing_retry_now() to authenticated;

------------------------------------------------------------ for the server

-- Issues the invoice for a paid charge (or a credit note). Numbers come from
-- billing_counters under a row lock, in the paying transaction: no gaps.
create or replace function public.billing_issue_invoice(
  p_org uuid, p_kind text, p_charge uuid, p_credit_for uuid, p_lines jsonb, p_total bigint,
  p_period_start timestamptz, p_period_end timestamptz, p_paid_method text, p_reference text, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_no   bigint;
  v_id   uuid;
  v_vat  jsonb := public.billing_vat(abs(p_total));
  v_org  public.organizations;
begin
  update public.billing_counters set next = next + 1 where key = p_kind returning next - 1 into v_no;
  select * into v_org from public.organizations where id = p_org;

  insert into public.billing_invoices
    (number, kind, org_id, charge_id, credit_for, period_start, period_end, buyer, seller, lines,
     total_cents, vat_cents, vat_registered, paid_at, paid_method, payment_reference, reason)
  values (
    (public.platform_setting(case p_kind when 'invoice' then 'invoice_prefix' else 'credit_note_prefix' end) #>> '{}')
      || lpad(v_no::text, 6, '0'),
    p_kind, p_org, p_charge, p_credit_for, p_period_start, p_period_end,
    jsonb_build_object('name', coalesce(nullif(btrim(v_org.legal_name), ''), v_org.name),
                       'address', v_org.address, 'vat_number', v_org.vat_number,
                       'tax_number', v_org.tax_number),
    jsonb_build_object('name', public.platform_setting('seller_name') #>> '{}',
                       'address', public.platform_setting('seller_address') #>> '{}',
                       'email', public.platform_setting('seller_email') #>> '{}',
                       'vat_number', public.platform_setting('seller_vat_number') #>> '{}'),
    p_lines, p_total, sign(p_total)::bigint * (v_vat->>'vat_cents')::bigint, (v_vat->>'registered')::boolean,
    case when p_kind = 'invoice' then now() end, p_paid_method, p_reference, p_reason)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.billing_issue_invoice(uuid, text, uuid, uuid, jsonb, bigint, timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;

-- Switches the company's add-on modules to match a plan: on for every add-on
-- in it. Turning off is done only for add-ons the company itself took out
-- (p_off); one the operator switched on outside the plan stays on.
create or replace function public.billing_apply_addons(p_org uuid, p_on jsonb, p_off text[])
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  k text;
begin
  for k in select jsonb_object_keys(coalesce(p_on, '{}'::jsonb)) loop
    insert into public.company_modules (org_id, module_code, enabled)
    values (p_org, k, true)
    on conflict (org_id, module_code) do update set enabled = true
      where public.company_modules.enabled is distinct from true;
  end loop;
  foreach k in array coalesce(p_off, '{}'::text[]) loop
    update public.company_modules set enabled = false
     where org_id = p_org and module_code = k and enabled;
  end loop;
end;
$function$;
revoke all on function public.billing_apply_addons(uuid, jsonb, text[]) from public, anon, authenticated;

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
revoke all on function public.billing_record_payment(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_record_payment(uuid, text, bigint, text, text, jsonb) to service_role;

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
revoke all on function public.billing_record_failure(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_record_failure(uuid, text, text, text, jsonb) to service_role;

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
revoke all on function public.billing_prepare_due(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_prepare_due(timestamptz) to service_role;

------------------------------------------------------------ for the operator

-- Every operator change writes its audit row in the same transaction.
create or replace function public.billing_audit(p_actor uuid, p_action text, p_org uuid, p_detail jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  if p_actor is null or not exists (select 1 from public.platform_admins where user_id = p_actor) then
    raise exception 'Only a platform operator can do this.' using errcode = '42501';
  end if;
  insert into public.platform_audit_log (actor_id, action, target_org_id, detail)
  values (p_actor, p_action, p_org, p_detail);
end;
$function$;
revoke all on function public.billing_audit(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- An EFT or other payment received outside the card: settles a pending charge.
create or replace function public.billing_operator_mark_paid(p_charge uuid, p_reference text, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  c public.billing_charges;
begin
  select * into c from public.billing_charges where id = p_charge;
  if c.id is null or c.status not in ('pending', 'failed') then
    raise exception 'Only an unpaid charge can be marked paid.' using errcode = '22023';
  end if;
  if nullif(btrim(p_reference), '') is null then
    raise exception 'Enter the payment reference.' using errcode = '22023';
  end if;
  perform public.billing_audit(p_actor, 'billing.mark_paid', c.org_id,
    jsonb_build_object('charge', c.id, 'total_cents', c.total_cents, 'reference', p_reference));
  if c.status = 'failed' then
    update public.billing_charges set status = 'pending' where id = c.id;
  end if;
  return public.billing_record_payment(c.id, btrim(p_reference), c.total_cents, null, 'manual', null);
end;
$function$;
revoke all on function public.billing_operator_mark_paid(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.billing_operator_mark_paid(uuid, text, uuid) to service_role;

-- A quoted price instead of the price list (null: back to the list).
create or replace function public.billing_operator_set_custom_price(p_org uuid, p_cents bigint, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_was bigint;
begin
  if p_cents is not null and p_cents <= 0 then
    raise exception 'A custom price must be more than zero.' using errcode = '22023';
  end if;
  -- A company with no account row is billed outside the app (exempt); it gets
  -- one, still exempt, which the quoted price lets it pay by card.
  select custom_price_cents into v_was from public.company_account where org_id = p_org;
  perform public.billing_audit(p_actor, 'billing.custom_price', p_org,
    jsonb_build_object('from', v_was, 'to', p_cents));
  insert into public.company_account (org_id, custom_price_cents, status)
  values (p_org, p_cents, 'exempt')
  on conflict (org_id) do update set custom_price_cents = p_cents, updated_at = now();
end;
$function$;
revoke all on function public.billing_operator_set_custom_price(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.billing_operator_set_custom_price(uuid, bigint, uuid) to service_role;

-- Exempt: never charged, never limited. Back from exempt: a trial of p_days.
create or replace function public.billing_operator_set_exempt(p_org uuid, p_exempt boolean, p_days integer, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  a public.company_account;
begin
  select * into a from public.company_account where org_id = p_org for update;
  if p_exempt then
    perform public.billing_audit(p_actor, 'billing.exempt', p_org,
      jsonb_build_object('from', coalesce(a.status, 'none')));
    insert into public.company_account (org_id, status) values (p_org, 'exempt')
    on conflict (org_id) do update
      set status = 'exempt', grace_ends_at = null, read_only_since = null, updated_at = now();
  else
    if coalesce(a.status, 'exempt') <> 'exempt' then
      raise exception 'This company is not exempt.' using errcode = '22023';
    end if;
    if p_days is null or p_days < 1 or p_days > 365 then
      raise exception 'Give a trial of 1 to 365 days.' using errcode = '22023';
    end if;
    perform public.billing_audit(p_actor, 'billing.unexempt', p_org, jsonb_build_object('trial_days', p_days));
    insert into public.company_account (org_id, status, trial_ends_at)
    values (p_org, 'trial', now() + make_interval(days => p_days))
    on conflict (org_id) do update
      set status = 'trial', trial_ends_at = now() + make_interval(days => p_days), updated_at = now();
  end if;
end;
$function$;
revoke all on function public.billing_operator_set_exempt(uuid, boolean, integer, uuid) from public, anon, authenticated;
grant execute on function public.billing_operator_set_exempt(uuid, boolean, integer, uuid) to service_role;

-- Extends a trial (Stage 5's operator button, now status-aware): a trial that
-- ended and left the company read-only becomes a trial again.
create or replace function public.billing_operator_extend_trial(p_org uuid, p_days integer, p_actor uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  a     public.company_account;
  v_end timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Extend by a whole number of days, 1 to 365.' using errcode = '22023';
  end if;
  select * into a from public.company_account where org_id = p_org for update;
  if a.status = 'exempt' then
    raise exception 'This company is exempt; take it off exempt to give it a trial.' using errcode = '22023';
  end if;
  if a.status in ('active', 'past_due', 'cancelled') or a.period is not null then
    raise exception 'This company has had a paid plan; its trial cannot be extended.' using errcode = '22023';
  end if;
  v_end := greatest(coalesce(a.trial_ends_at, now()), now()) + make_interval(days => p_days);
  perform public.billing_audit(p_actor, 'trial.extend', p_org,
    jsonb_build_object('days', p_days, 'from', a.trial_ends_at, 'to', v_end, 'status_was', a.status));
  insert into public.company_account (org_id, status, trial_ends_at)
  values (p_org, 'trial', v_end)
  on conflict (org_id) do update
    set trial_ends_at = v_end, status = 'trial', read_only_since = null, updated_at = now();
  return v_end;
end;
$function$;
revoke all on function public.billing_operator_extend_trial(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.billing_operator_extend_trial(uuid, integer, uuid) to service_role;

-- A credit note against a paid invoice (the guarantee, a mistake). The refund
-- itself is made in Payfast's dashboard; this is the record.
create or replace function public.billing_operator_credit_note(p_invoice uuid, p_cents bigint, p_reason text, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  i        public.billing_invoices;
  v_credited bigint;
begin
  select * into i from public.billing_invoices where id = p_invoice for update;
  if i.id is null or i.kind <> 'invoice' then
    raise exception 'Choose a paid invoice.' using errcode = '22023';
  end if;
  select coalesce(-sum(total_cents), 0) into v_credited
    from public.billing_invoices where credit_for = i.id;
  if p_cents is null or p_cents <= 0 or p_cents > i.total_cents - v_credited then
    raise exception 'The credit must be more than zero and at most %.', i.total_cents - v_credited
      using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason for the credit note.' using errcode = '22023';
  end if;
  perform public.billing_audit(p_actor, 'billing.credit_note', i.org_id,
    jsonb_build_object('invoice', i.number, 'cents', p_cents, 'reason', p_reason));
  return public.billing_issue_invoice(i.org_id, 'credit_note', null, i.id,
    jsonb_build_array(jsonb_build_object('code', 'credit', 'label', 'Credit against ' || i.number,
      'quantity', 1, 'unit_cents', -p_cents, 'amount_cents', -p_cents)),
    -p_cents, i.period_start, i.period_end, null, null, btrim(p_reason));
end;
$function$;
revoke all on function public.billing_operator_credit_note(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.billing_operator_credit_note(uuid, bigint, text, uuid) to service_role;

-- Stops trying to collect a charge (agreed with the customer).
create or replace function public.billing_operator_cancel_charge(p_charge uuid, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  c public.billing_charges;
begin
  select * into c from public.billing_charges where id = p_charge for update;
  if c.id is null or c.status not in ('pending', 'failed') then
    raise exception 'Only an unpaid charge can be cancelled.' using errcode = '22023';
  end if;
  perform public.billing_audit(p_actor, 'billing.cancel_charge', c.org_id,
    jsonb_build_object('charge', c.id, 'total_cents', c.total_cents, 'reason', c.reason));
  update public.billing_charges set status = 'cancelled', next_retry_at = null, updated_at = now()
   where id = c.id;
end;
$function$;
revoke all on function public.billing_operator_cancel_charge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_operator_cancel_charge(uuid, uuid) to service_role;

------------------------------------------------------------ user limit

create or replace function public.profiles_user_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a       public.company_account;
  v_limit int;
  v_used  int;
begin
  -- Serialises logins being added to one company, so two at once cannot both
  -- take the last place.
  select * into a from public.company_account where org_id = new.org_id for update;
  if a.org_id is null or a.status = 'exempt' then
    return null;
  end if;
  if a.status = 'trial' or a.plan is null then
    v_limit := coalesce((public.platform_setting('trial_user_limit') #>> '{}')::int, 10);
    select count(*) into v_used from public.profiles where org_id = new.org_id and is_active;
  else
    v_limit := (a.plan->>'seats')::int;
    v_used := public.billing_seats_used(new.org_id, a.plan);
  end if;
  if v_used > v_limit then
    raise exception 'All % user places on your plan are taken.', v_limit
      using errcode = 'P0001', hint = 'user_limit';
  end if;
  return null;
end;
$function$;
revoke all on function public.profiles_user_limit() from public, anon, authenticated;

create trigger profiles_user_limit
  after insert or update of is_active, org_id, role on public.profiles
  for each row when (new.is_active)
  execute function public.profiles_user_limit();

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'my_account', 'core'),
  ('function', 'billing_quote', 'core'),
  ('function', 'billing_preview_change', 'core'),
  ('function', 'billing_start_checkout', 'core'),
  ('function', 'billing_request_change', 'core'),
  ('function', 'billing_set_cancel', 'core'),
  ('function', 'billing_retry_now', 'core'),
  ('function', 'billing_plan', 'core'),
  ('function', 'billing_record_payment', 'core'),
  ('function', 'billing_record_failure', 'core'),
  ('function', 'billing_prepare_due', 'core'),
  ('function', 'billing_operator_mark_paid', 'core'),
  ('function', 'billing_operator_set_custom_price', 'core'),
  ('function', 'billing_operator_set_exempt', 'core'),
  ('function', 'billing_operator_extend_trial', 'core'),
  ('function', 'billing_operator_credit_note', 'core'),
  ('function', 'billing_operator_cancel_charge', 'core');
