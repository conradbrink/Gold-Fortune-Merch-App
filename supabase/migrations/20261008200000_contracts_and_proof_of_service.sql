-- Contracts that invoice themselves, proof of service, unbilled work (Stage 7 Part 1b).
--
-- Why: most trades bill a fixed fee per site each month or quarter (cleaning,
-- garden, pool, security, maintenance, commercial pest control), and the owner
-- chose automatic invoices on a set day (8 Oct 2026). The industry research
-- found that a client-facing proof of service is what gets disputed invoices
-- paid.
--
--   service_contracts          one per site and service: a fixed fee (its
--                              lines, usually from the price list), monthly or
--                              quarterly, in advance or in arrears, invoiced on
--                              a day of the month (1–28). Periods are whole
--                              calendar months; billing starts with the first
--                              whole month, and never reaches back before the
--                              contract was entered (`bill_from`).
--   service_contract_invoices  which period each invoice covers: one per
--                              period. A void contract invoice keeps its period
--                              (nothing is reissued by itself); the office can
--                              invoice that period again.
--   contract_invoices_run()    every company's due periods, daily from pg_cron
--                              (03:20 UTC, 05:20 in South Africa and Botswana),
--                              for companies with the invoicing module, the
--                              contracts switch on, and not read-only. At most
--                              12 periods per contract per run.
--   contract_invoices_run_now() the same for the caller's company, from the
--                              Contracts page.
--   invoice_proof_of_service() the jobs on a job or contract invoice: date,
--                              who, times, minutes, GPS inside the site's
--                              radius, forms, photos; and the planned jobs in
--                              the period that were missed (or caught up).
--   tax_invoices               a `contract` source, and the period it covers.
--   money_contracts            the switch, on for the contract trades.
--
-- Also (CodeRabbit on #93, deferred from 1a):
--   invoice_write              a blank unit is no unit.
--   debtors_ageing             a tie-break, so its order is total.
--   *_json                     the ageing and a statement as one document, read
--                              in one statement (one snapshot) instead of pages.
--   unbilled_visits            leaves out work a contract already covers.
--
-- Gold Fortune: contracts are off for it (distribution template); nothing it
-- has changes. The phone reads none of these tables.
--
-- Rollback: supabase/rollback/<this version>_contracts_and_proof_of_service.down.sql.

------------------------------------------------------------------ the switch

insert into public.setting_definitions (key, label, description, value_type, default_value, pattern, sort_order) values
  ('money_contracts', 'Contracts', 'Regular work for a fixed fee per site, invoiced automatically each month or quarter.',
   'boolean', 'false', null, 115);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'money_contracts', 'true'::jsonb
  from (values ('cleaning'), ('garden'), ('pool'), ('security'), ('maintenance'), ('pest_control'), ('generic'))
       as v(template_code)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.company_settings (org_id, key, value)
select o.id, 'money_contracts', coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = 'money_contracts'),
         'false'::jsonb)
  from public.organizations o
on conflict (org_id, key) do nothing;

update public.industry_templates set version = version + 1
 where code in ('cleaning', 'garden', 'pool', 'security', 'maintenance', 'pest_control', 'generic');

-------------------------------------------------------------- invoices

alter table public.tax_invoices drop constraint tax_invoices_source_check;
alter table public.tax_invoices
  add constraint tax_invoices_source_check check (source in ('order', 'quote', 'jobs', 'direct', 'contract'));
alter table public.tax_invoices
  add column period_start date,
  add column period_end date;
alter table public.tax_invoices
  add constraint tax_invoices_period_order check (period_start is null or period_end is null or period_end >= period_start);

---------------------------------------------------------------- contracts

create table public.service_contracts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  store_id       uuid not null references public.stores(id) on delete restrict,
  name           text not null check (length(btrim(name)) between 1 and 120),
  period         text not null default 'monthly' check (period in ('monthly', 'quarterly')),
  billing        text not null default 'advance' check (billing in ('advance', 'arrears')),
  invoice_day    smallint not null default 1 check (invoice_day between 1 and 28),
  starts_on      date not null,
  ends_on        date,
  bill_from      date not null,
  active         boolean not null default true,
  reference      text check (reference is null or length(reference) <= 100),
  notes          text check (notes is null or length(notes) <= 1000),
  next_invoice_on date,
  last_run_at    timestamptz,
  last_run_error text,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint service_contracts_dates check (ends_on is null or ends_on >= starts_on)
);
comment on table public.service_contracts is
  'A fixed fee per site, invoiced automatically each period (contract_invoices_run).';
create index service_contracts_org_store_idx on public.service_contracts (org_id, store_id);

create table public.service_contract_lines (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.service_contracts(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  position        integer,
  service_item_id uuid references public.service_items(id) on delete set null,
  description     text not null check (length(btrim(description)) between 1 and 500),
  unit            text check (unit is null or length(btrim(unit)) between 1 and 20),
  qty             numeric(12,2) not null check (qty > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0)
);
create index service_contract_lines_contract_idx on public.service_contract_lines (contract_id);

create table public.service_contract_invoices (
  contract_id  uuid not null references public.service_contracts(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  invoice_id   uuid not null references public.tax_invoices(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  active       boolean not null default true,
  primary key (contract_id, period_start, invoice_id)
);
-- One live claim per period: a void invoice keeps its period until the
-- office invoices that period again.
create unique index service_contract_invoices_period_key
  on public.service_contract_invoices (contract_id, period_start) where active;

-------------------------------------------------------- the period arithmetic

-- Billing starts with the first whole calendar month.
create function public.contract_first_period_start(p_starts_on date)
returns date
language sql
immutable
set search_path to ''
as $function$
  select case when extract(day from p_starts_on) = 1 then p_starts_on
              else (date_trunc('month', p_starts_on) + interval '1 month')::date end;
$function$;

create function public.contract_period_end(p_start date, p_period text)
returns date
language sql
immutable
set search_path to ''
as $function$
  select (p_start + case p_period when 'quarterly' then interval '3 months' else interval '1 month' end
                  - interval '1 day')::date;
$function$;

-- The day a period is invoiced: in its first month (in advance) or the month
-- after it ends (in arrears), on the contract's day.
create function public.contract_invoice_date(p_start date, p_end date, p_billing text, p_day integer)
returns date
language sql
immutable
set search_path to ''
as $function$
  select case when p_billing = 'arrears'
              then (date_trunc('month', p_end) + interval '1 month')::date + (p_day - 1)
              else date_trunc('month', p_start)::date + (p_day - 1) end;
$function$;

-- The first period not yet claimed by an invoice, from `bill_from`, or nothing
-- when the contract is paused or has ended.
create function public.contract_next_period(p_contract uuid)
returns table (period_start date, period_end date, invoice_on date)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  c public.service_contracts;
  s date;
  e date;
  n integer := 0;
begin
  select * into c from public.service_contracts where id = p_contract;
  if not found or not c.active then
    return;
  end if;
  s := c.bill_from;
  loop
    exit when (c.ends_on is not null and s > c.ends_on) or n > 1200;
    e := public.contract_period_end(s, c.period);
    if not exists (select 1 from public.service_contract_invoices ci
                    where ci.contract_id = c.id and ci.period_start = s and ci.active) then
      period_start := s;
      period_end := e;
      invoice_on := public.contract_invoice_date(s, e, c.billing, c.invoice_day);
      return next;
      return;
    end if;
    s := e + 1;
    n := n + 1;
  end loop;
end;
$function$;

-- Keeps a contract consistent: its site is the company's; `bill_from` is the
-- first period whose invoice day has not passed when the contract is entered
-- (nothing is billed backwards by itself); the billing terms are fixed once a
-- period has been invoiced; `next_invoice_on` is always current.
create function public.service_contracts_stamp()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := (now() at time zone public.org_timezone(new.org_id))::date;
  s date;
  n integer := 0;
begin
  if not exists (select 1 from public.stores st where st.id = new.store_id and st.org_id = new.org_id) then
    raise exception 'That place is not this company''s.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id then
      raise exception 'A contract cannot move to another company.' using errcode = '42501';
    end if;
    if (new.store_id, new.period, new.billing, new.invoice_day, new.starts_on)
         is distinct from (old.store_id, old.period, old.billing, old.invoice_day, old.starts_on)
       and exists (select 1 from public.service_contract_invoices ci where ci.contract_id = old.id) then
      raise exception 'This contract has been invoiced, so how it is billed is fixed. End it and start a new one to change that.'
        using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT'
     or (new.period, new.billing, new.invoice_day, new.starts_on)
          is distinct from (old.period, old.billing, old.invoice_day, old.starts_on) then
    s := public.contract_first_period_start(new.starts_on);
    while public.contract_invoice_date(s, public.contract_period_end(s, new.period), new.billing, new.invoice_day) < v_today
          and n < 1200 loop
      s := public.contract_period_end(s, new.period) + 1;
      n := n + 1;
    end loop;
    new.bill_from := s;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function public.service_contracts_stamp() from public, anon, authenticated;

create trigger service_contracts_stamp before insert or update on public.service_contracts
  for each row execute function public.service_contracts_stamp();

-- `next_invoice_on`, for the list and the contract page: after every change to
-- a contract, its lines or its invoices.
create function public.service_contracts_refresh_next(p_contract uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.service_contracts c
     set next_invoice_on = (select n.invoice_on from public.contract_next_period(c.id) n)
   where c.id = p_contract
     and c.next_invoice_on is distinct from (select n.invoice_on from public.contract_next_period(c.id) n);
$function$;
revoke all on function public.service_contracts_refresh_next(uuid) from public, anon, authenticated;

create function public.service_contracts_after_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.service_contracts_refresh_next(new.id);
  return null;
end;
$function$;
revoke all on function public.service_contracts_after_change() from public, anon, authenticated;

create trigger service_contracts_after_change after insert or update of active, bill_from, ends_on, period, billing, invoice_day
  on public.service_contracts for each row execute function public.service_contracts_after_change();

------------------------------------------------------------- who may

alter table public.service_contracts enable row level security;
create policy service_contracts_select on public.service_contracts for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
create policy service_contracts_insert on public.service_contracts for insert
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing')));
create policy service_contracts_update on public.service_contracts for update
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing')))
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing')));
create policy service_contracts_delete on public.service_contracts for delete
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing'))
         and not exists (select 1 from public.service_contract_invoices ci where ci.contract_id = service_contracts.id));
create policy module_gate on public.service_contracts as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));
-- Only what the office types: when to bill from and the run's notes are the
-- database's to keep.
revoke all on public.service_contracts from anon, authenticated;
grant select, delete on public.service_contracts to authenticated;
grant insert (org_id, store_id, name, period, billing, invoice_day, starts_on, ends_on, active, reference, notes)
  on public.service_contracts to authenticated;
grant update (store_id, name, period, billing, invoice_day, starts_on, ends_on, active, reference, notes)
  on public.service_contracts to authenticated;

alter table public.service_contract_lines enable row level security;
create policy service_contract_lines_all on public.service_contract_lines for all
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse')))
         and exists (select 1 from public.service_contracts c where c.id = service_contract_lines.contract_id))
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing'))
              and exists (select 1 from public.service_contracts c
                           where c.id = service_contract_lines.contract_id and c.org_id = (select public.current_org_id())));
create policy module_gate on public.service_contract_lines as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));
revoke all on public.service_contract_lines from anon;
grant select, insert, update, delete on public.service_contract_lines to authenticated;

alter table public.service_contract_invoices enable row level security;
create policy service_contract_invoices_select on public.service_contract_invoices for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
create policy module_gate on public.service_contract_invoices as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));
revoke all on public.service_contract_invoices from anon, authenticated;
grant select on public.service_contract_invoices to authenticated;

-- The billing gate's three policies, where the gate exists (production).
do $migration$
declare
  t text;
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  foreach t in array array['service_contracts', 'service_contract_lines', 'service_contract_invoices'] loop
    execute format('create policy billing_gate_insert on public.%I as restrictive for insert to authenticated '
                   'with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_update on public.%I as restrictive for update to authenticated '
                   'using ((select public.company_writable())) with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_delete on public.%I as restrictive for delete to authenticated '
                   'using ((select public.company_writable()))', t);
  end loop;
end;
$migration$;

------------------------------------------------------------ invoicing them

-- One period of one contract, invoiced now (dated p_as_of): the contract's
-- lines for its site, recorded against the period. Internal.
create function public.contract_issue_period(p_contract uuid, p_start date, p_end date, p_as_of date)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c public.service_contracts;
  org public.organizations;
  s public.stores;
  v_lines jsonb;
  v_id uuid;
begin
  select * into c from public.service_contracts where id = p_contract;
  select * into org from public.organizations where id = c.org_id;
  select * into s from public.stores where id = c.store_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', l.description, 'qty', l.qty, 'unit_price', l.unit_price,
           'unit', l.unit, 'service_item_id', l.service_item_id)
           order by l.position nulls last, l.id), '[]'::jsonb)
    into v_lines
    from public.service_contract_lines l where l.contract_id = c.id;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'This contract has no lines to invoice.' using errcode = '22023';
  end if;
  v_id := public.invoice_write(
    c.org_id, 'contract', 'standard', c.store_id, null,
    s.name, nullif(concat_ws(', ', s.address, s.city), ''), null,
    left(coalesce(c.reference, c.name), 100), p_as_of, org.vat_rate, org.prices_include_vat, v_lines, false);
  update public.tax_invoices set period_start = p_start, period_end = p_end where id = v_id;
  insert into public.service_contract_invoices (contract_id, period_start, period_end, invoice_id, org_id)
  values (c.id, p_start, p_end, v_id, c.org_id);
  return v_id;
end;
$function$;
revoke all on function public.contract_issue_period(uuid, date, date, date) from public, anon, authenticated;

-- Every due period of one company's active contracts (or one contract), up to
-- 12 per contract, dated p_as_of. A contract that fails is noted on it and the
-- others carry on. Internal: the daily run and the Contracts page call it.
create function public.contract_invoices_due(p_org uuid, p_as_of date, p_contract uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c record;
  p record;
  k integer;
  n integer := 0;
begin
  for c in select * from public.service_contracts
            where org_id = p_org and active and (p_contract is null or id = p_contract)
            order by id
            for update skip locked loop
    k := 0;
    begin
      loop
        select * into p from public.contract_next_period(c.id);
        exit when p.period_start is null or p.invoice_on > p_as_of or k >= 12;
        perform public.contract_issue_period(c.id, p.period_start, p.period_end, p_as_of);
        k := k + 1;
        n := n + 1;
      end loop;
      update public.service_contracts set last_run_at = now(), last_run_error = null where id = c.id;
      perform public.service_contracts_refresh_next(c.id);
    exception when others then
      update public.service_contracts set last_run_at = now(), last_run_error = left(sqlerrm, 500) where id = c.id;
    end;
  end loop;
  return n;
end;
$function$;
revoke all on function public.contract_invoices_due(uuid, date, uuid) from public, anon, authenticated;

-- The daily run, for every company with the module and the switch on that is
-- not read-only. Each company's own date, in its own timezone.
create function public.contract_invoices_run()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o record;
  n integer := 0;
begin
  for o in select org.id from public.organizations org
            where exists (select 1 from public.company_modules cm
                           where cm.org_id = org.id and cm.module_code = 'invoicing' and cm.enabled)
              and coalesce((public.org_setting(org.id, 'money_contracts') #>> '{}')::boolean, false)
              and not exists (select 1 from public.company_account a
                               where a.org_id = org.id and a.status in ('read_only', 'cancelled'))
  loop
    n := n + public.contract_invoices_due(o.id, (now() at time zone public.org_timezone(o.id))::date);
  end loop;
  return n;
end;
$function$;
revoke all on function public.contract_invoices_run() from public, anon, authenticated;

-- "Invoice what is due now", from the Contracts page: the same for the
-- caller's company, or one of its contracts.
create function public.contract_invoices_run_now(p_contract uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if not coalesce((public.org_setting(v_org, 'money_contracts') #>> '{}')::boolean, false) then
    raise exception 'Contracts are switched off in this company''s settings.' using errcode = '42501';
  end if;
  if p_contract is not null and not exists (select 1 from public.service_contracts where id = p_contract and org_id = v_org) then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  return public.contract_invoices_due(v_org, (now() at time zone public.org_timezone(v_org))::date, p_contract);
end;
$function$;

-- A period whose invoice was voided, invoiced again now (it was due once
-- already, so its scheduled day does not matter). Returns the new invoice.
create function public.contract_reinvoice_period(p_contract uuid, p_period_start date)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_end date;
  v_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if not exists (select 1 from public.service_contracts where id = p_contract and org_id = v_org) then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  update public.service_contract_invoices ci
     set active = false
   where ci.contract_id = p_contract and ci.period_start = p_period_start and ci.active
     and exists (select 1 from public.tax_invoices i where i.id = ci.invoice_id and i.status = 'void')
  returning ci.period_end into v_end;
  if v_end is null then
    raise exception 'Only a period whose invoice was voided can be invoiced again.' using errcode = '22023';
  end if;
  v_id := public.contract_issue_period(p_contract, p_period_start, v_end,
                                       (now() at time zone public.org_timezone(v_org))::date);
  perform public.service_contracts_refresh_next(p_contract);
  return v_id;
end;
$function$;

-------------------------------------------------------- proof of service

-- The jobs behind a job or contract invoice, for the client: each finished job
-- (when, who, how long, GPS inside the site's radius, forms, photos), and for a
-- contract the planned jobs in its period that were missed or caught up later.
create function public.invoice_proof_of_service(p_invoice_id uuid)
returns table (visit_id uuid, day date, staff_name text, checkin_at timestamptz, checkout_at timestamptz,
               minutes integer, gps_ok boolean, forms integer, photos integer, status text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
  i public.tax_invoices;
  v_today date;
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  v_org := public.current_org_id();
  select * into i from public.tax_invoices t where t.id = p_invoice_id and t.org_id = v_org;
  if not found or i.source not in ('jobs', 'contract') then
    return;
  end if;
  v_tz := public.org_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;
  return query
  with done as (
    select v.id, v.store_id, v.rep_id, v.route_id, v.checkin_at, v.checkout_at, v.checkin_distance_from_store_m
      from public.visits v
     where v.org_id = v_org and v.status = 'checked_out'
       and case when i.source = 'jobs'
                then exists (select 1 from public.tax_invoice_visits tv where tv.invoice_id = i.id and tv.visit_id = v.id)
                else v.store_id = i.store_id
                     and (v.checkin_at at time zone v_tz)::date between i.period_start and i.period_end end
  ), caught as (
    select rc.route_id
      from public.route_catchups((i.period_start::timestamp at time zone v_tz),
                                 ((i.period_end + 1)::timestamp at time zone v_tz)) rc
     where i.source = 'contract'
  ), missed as (
    select r.id, r.scheduled_date, r.rep_id
      from public.routes r
     where i.source = 'contract' and r.org_id = v_org and r.store_id = i.store_id
       and r.scheduled_date between i.period_start and least(i.period_end, v_today - 1)
       and not exists (select 1 from public.visits v where v.route_id = r.id and v.status = 'checked_out')
  )
  select d.id,
         (d.checkin_at at time zone v_tz)::date,
         p.full_name,
         d.checkin_at,
         d.checkout_at,
         round(extract(epoch from d.checkout_at - d.checkin_at) / 60)::integer,
         d.checkin_distance_from_store_m is not null and d.checkin_distance_from_store_m <= st.geofence_radius_m,
         (select count(*) from public.form_submissions f where f.visit_id = d.id)::integer,
         (select count(*) from public.photos ph where ph.visit_id = d.id)::integer,
         'done'::text
    from done d
    join public.stores st on st.id = d.store_id
    left join public.profiles p on p.id = d.rep_id
  union all
  select null::uuid, m.scheduled_date, p.full_name, null::timestamptz, null::timestamptz, null::integer, null::boolean,
         null::integer, null::integer,
         case when exists (select 1 from caught c where c.route_id = m.id) then 'caught_up' else 'missed' end
    from missed m
    left join public.profiles p on p.id = m.rep_id
  order by 2, 4 nulls last;
end;
$function$;

----------------------------------------- deferred from 1a (CodeRabbit on #93)

-- A blank unit is no unit (it was refused as "up to 20 characters").
do $migration$
declare
  v_def text := pg_get_functiondef(
    'public.invoice_write(uuid, text, text, uuid, uuid, text, text, text, text, date, numeric, boolean, jsonb, boolean)'::regprocedure);
  c_old constant text := $a$    if l.unit is not null and length(btrim(l.unit)) not between 1 and 20 then$a$;
  c_new constant text := $b$    if nullif(btrim(l.unit), '') is not null and length(btrim(l.unit)) > 20 then$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'invoice_write is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

-- A total order: clients with the same total and name keep their places.
do $migration$
declare
  v_def text := pg_get_functiondef('public.debtors_ageing(date)'::regprocedure);
  c_old constant text := $a$   order by sum(o.amount) desc, min(o.client);$a$;
  c_new constant text := $b$   order by sum(o.amount) desc, min(o.client), o.sid nulls last, o.name_key nulls last;$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'debtors_ageing is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

-- Work a contract covers is billed by the contract, not invoiced as jobs.
do $migration$
declare
  v_def text := pg_get_functiondef('public.unbilled_visits(uuid, date, date)'::regprocedure);
  c_old constant text := $a$     and not exists (select 1 from public.tax_invoice_visits tv where tv.visit_id = v.id and tv.active)
$a$;
  c_new constant text := $b$     and not exists (select 1 from public.tax_invoice_visits tv where tv.visit_id = v.id and tv.active)
     and not exists (select 1 from public.service_contracts sc
                      where sc.store_id = v.store_id and sc.active
                        and (v.checkin_at at time zone v_tz)::date >= sc.starts_on
                        and (sc.ends_on is null or (v.checkin_at at time zone v_tz)::date <= sc.ends_on))
$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'unbilled_visits is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

-- The ageing and a statement as one document each: read in one statement, so
-- a payment recorded meanwhile cannot shift a row between pages.
create function public.debtors_ageing_json(p_as_of date default null)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  return (select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb)
            from public.debtors_ageing(p_as_of) with ordinality as r);
end;
$function$;

create function public.client_statement_json(p_store_id uuid, p_customer_name text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  return (select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb)
            from public.client_statement(p_store_id, p_customer_name, p_from, p_to) with ordinality as r);
end;
$function$;

------------------------------------------------------------------- grants

revoke all on function public.contract_first_period_start(date) from public, anon, authenticated;
revoke all on function public.contract_period_end(date, text) from public, anon, authenticated;
revoke all on function public.contract_invoice_date(date, date, text, integer) from public, anon, authenticated;
revoke all on function public.contract_next_period(uuid) from public, anon, authenticated;
revoke all on function public.contract_invoices_run_now(uuid) from public, anon;
revoke all on function public.contract_reinvoice_period(uuid, date) from public, anon;
revoke all on function public.invoice_proof_of_service(uuid) from public, anon;
revoke all on function public.debtors_ageing_json(date) from public, anon;
revoke all on function public.client_statement_json(uuid, text, date, date) from public, anon;
grant execute on function public.contract_invoices_run_now(uuid) to authenticated;
grant execute on function public.contract_reinvoice_period(uuid, date) to authenticated;
grant execute on function public.invoice_proof_of_service(uuid) to authenticated;
grant execute on function public.debtors_ageing_json(date) to authenticated;
grant execute on function public.client_statement_json(uuid, text, date, date) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'service_contracts', 'invoicing'),
  ('table', 'service_contract_lines', 'invoicing'),
  ('table', 'service_contract_invoices', 'invoicing'),
  ('function', 'contract_invoices_run_now', 'invoicing'),
  ('function', 'contract_reinvoice_period', 'invoicing'),
  ('function', 'invoice_proof_of_service', 'invoicing'),
  ('function', 'debtors_ageing_json', 'invoicing'),
  ('function', 'client_statement_json', 'invoicing');

----------------------------------------------------------------- the run

-- Daily at 03:20 UTC (05:20 in South Africa and Botswana): each company's
-- contracts due that day, in its own timezone.
select cron.schedule('contract-invoices', '20 3 * * *', 'select public.contract_invoices_run()');
