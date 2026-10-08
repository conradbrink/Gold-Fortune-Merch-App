-- Money for every trade (Stage 7 Part 1a).
--
-- Why: the owner wants every company, whatever its trade, to quote, invoice,
-- take payment and see who owes it, in the way its trade works (8 Oct 2026,
-- approved with the industry research: plumbers quote then invoice the job,
-- installers take a deposit, contract trades invoice their completed work).
-- Until now all of it belonged to Distribution: a quote needed a product and a
-- site, and an invoice could only come from an order.
--
--   invoicing module     built and included in every plan; on for every
--                        company and in every industry template. Quotes,
--                        invoices, credit notes and payments move to it from
--                        distribution. Orders stay distribution, so an order
--                        and its quote-to-order step need both.
--   invoicing permission quotes, invoices, payments, the price list and who
--                        owes you. Given wherever `warehouse` is today (roles
--                        and people), so nobody's access changes. The money
--                        tables stay readable with `warehouse` too, so whoever
--                        invoices an order can still see that invoice.
--   service_items        each company's price list of services (call-out,
--                        labour per hour, a standard clean…), seeded per trade
--                        from template_service_items without prices.
--   quotes               for anyone: the site is optional (a name, address and
--                        email instead), lines are a product, a price-list item
--                        or free text, quantities can be fractional (hours,
--                        square metres), prices may include VAT.
--   tax_invoices         from an order (as before), from an accepted quote (in
--                        full, a deposit, or the final balance), from completed
--                        jobs (tax_invoice_visits remembers which), or typed in
--                        directly. Still numbered, immutable and voidable, with
--                        credit notes and payments as before.
--   document settings    registration number, bank details, prices including
--                        VAT, invoice and quote prefixes, quote validity: new
--                        columns on organizations, next to the invoice fields.
--   workflow settings    money_workflow (the trade's usual route) and four
--                        switches that decide which documents and buttons a
--                        company sees; seeded per template.
--   debtors_ageing()     who owes what, by how overdue, as at a date.
--   client_statement()   invoices, credits and payments with a running balance.
--   unbilled_visits()    completed work not on a live invoice, for whoever bills.
--
-- Gold Fortune: gets the module and keeps everything it had. Its order → invoice
-- route, numbering (INV), permissions and workflow are unchanged (its settings
-- are the distribution template's: quotes on, no direct or job invoices). It
-- has no quotes, invoices or payments yet. The phone app reads none of these
-- tables.
--
-- Needs the billing gate (20261008091325_billing_gate, on production; its file
-- arrives with PR #91): new definer functions call require_writable(), and the
-- new tables get its three policies when company_writable() exists.
--
-- Rollback: supabase/rollback/<this version>_invoicing_for_every_trade.down.sql.

----------------------------------------------------------------- the module

update public.modules
   set plan_type = 'included',
       is_built = true,
       description = 'Quotes, invoices, payments and who owes you: from a quote, from completed jobs, typed in directly, or from an order.'
 where code = 'invoicing';

insert into public.template_modules (template_code, module_code)
select it.code, 'invoicing' from public.industry_templates it
on conflict do nothing;

insert into public.company_modules (org_id, module_code, enabled)
select o.id, 'invoicing', true from public.organizations o
on conflict (org_id, module_code) do update set enabled = true;

------------------------------------------------------------- the permission

insert into public.app_permissions (code, label, description, area, data_enforced, sort_order)
values ('invoicing', 'Quotes and invoices',
        'Quotes, invoices, credit notes, payments, the price list and who owes you.',
        'Money', true, 75);

-- Wherever `warehouse` is today, so nobody gains or loses a page.
insert into public.job_role_permissions (job_role_id, permission_code)
select distinct jrp.job_role_id, 'invoicing'
  from public.job_role_permissions jrp
 where jrp.permission_code = 'warehouse'
on conflict do nothing;

insert into public.profile_permissions (profile_id, permission_code)
select distinct pp.profile_id, 'invoicing'
  from public.profile_permissions pp
 where pp.permission_code = 'warehouse'
on conflict do nothing;

-- New companies' roles: the same rule.
do $migration$
declare
  v_def text := pg_get_functiondef('public.provision_organization(uuid)'::regprocedure);
  c_pairs constant text[] := array[
    $a$      ('operations_manager', 'warehouse'),
$a$, $b$      ('operations_manager', 'warehouse'),
      ('operations_manager', 'invoicing'),
$b$,
    $a$      ('cfo',                'warehouse'),
$a$, $b$      ('cfo',                'warehouse'),
      ('cfo',                'invoicing'),
$b$,
    $a$      ('warehouse_clerk',    'warehouse'),
$a$, $b$      ('warehouse_clerk',    'warehouse'),
      ('warehouse_clerk',    'invoicing'),
$b$];
  i int;
begin
  for i in 1 .. array_length(c_pairs, 1) by 2 loop
    if (length(v_def) - length(replace(v_def, c_pairs[i], ''))) / length(c_pairs[i]) <> 1 then
      raise exception 'provision_organization is not the text this migration expects (%)', btrim(c_pairs[i]);
    end if;
    v_def := replace(v_def, c_pairs[i], c_pairs[i + 1]);
  end loop;
  execute v_def;
end;
$migration$;

------------------------------------------------------------- the settings

insert into public.setting_definitions (key, label, description, value_type, default_value, pattern, sort_order) values
  ('money_workflow', 'How you get paid',
   'The usual route from first contact to payment. It picks which documents and buttons the office sees.',
   'text', '"flexible"',
   '^(quote_job_invoice|quote_deposit_final|contract_extras|contract_jobs|jobs_monthly|order_invoice|flexible)$', 110),
  ('money_quotes', 'Quotes', 'Send quotes before the work.', 'boolean', 'true', null, 120),
  ('money_deposits', 'Deposits', 'Invoice part of an accepted quote up front, and the balance at the end.',
   'boolean', 'false', null, 130),
  ('money_invoice_from_jobs', 'Invoice completed work', 'Invoice one or more finished jobs at a place.',
   'boolean', 'true', null, 140),
  ('money_invoice_direct', 'Direct invoices', 'Type an invoice in without a quote, a job or an order.',
   'boolean', 'true', null, 150);

-- Each trade's usual route. The switches follow the definitions' defaults
-- unless a trade differs.
insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'money_workflow', to_jsonb(v.workflow)
  from (values
    ('plumbing', 'quote_job_invoice'),
    ('installation', 'quote_deposit_final'),
    ('cleaning', 'contract_extras'),
    ('garden', 'contract_extras'),
    ('pool', 'contract_extras'),
    ('security', 'contract_extras'),
    ('maintenance', 'contract_extras'),
    ('pest_control', 'contract_jobs'),
    ('delivery', 'jobs_monthly'),
    ('distribution', 'order_invoice'),
    ('generic', 'flexible')
  ) as v(template_code, workflow)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, v.setting_key, v.value::jsonb
  from (values
    ('installation', 'money_deposits', 'true'),
    ('generic', 'money_deposits', 'true'),
    ('distribution', 'money_invoice_from_jobs', 'false'),
    ('distribution', 'money_invoice_direct', 'false')
  ) as v(template_code, setting_key, value)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

-- Existing companies (Gold Fortune): their first trade's values, written down
-- as create_company writes every setting.
insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key in ('money_workflow', 'money_quotes', 'money_deposits', 'money_invoice_from_jobs', 'money_invoice_direct')
on conflict (org_id, key) do nothing;

----------------------------------------------------- document details

alter table public.organizations
  add column registration_number text
    constraint organizations_registration_number_len check (registration_number is null or length(registration_number) <= 60),
  add column bank_details text
    constraint organizations_bank_details_len check (bank_details is null or length(bank_details) <= 500),
  add column prices_include_vat boolean not null default false,
  add column invoice_prefix text not null default 'INV'
    constraint organizations_invoice_prefix_format check (invoice_prefix ~ '^[A-Z]{2,6}$'),
  add column quote_prefix text not null default 'QT'
    constraint organizations_quote_prefix_format check (quote_prefix ~ '^[A-Z]{2,6}$'),
  add column quote_validity_days integer not null default 30
    constraint organizations_quote_validity_days_range check (quote_validity_days between 0 and 365);

comment on column public.organizations.bank_details is
  'Where clients pay: printed on every invoice and statement, as typed.';
comment on column public.organizations.prices_include_vat is
  'Quote and invoice prices are typed with VAT in (a new document takes the value when it is made).';

------------------------------------------------------------ the price list

create table public.template_service_items (
  template_code text not null references public.industry_templates(code) on delete cascade,
  code          text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name          text not null check (length(btrim(name)) between 1 and 120),
  description   text,
  unit          text not null check (length(btrim(unit)) between 1 and 20),
  sort_order    integer not null default 0,
  primary key (template_code, code)
);
alter table public.template_service_items enable row level security;
create policy template_service_items_select on public.template_service_items
  for select to authenticated using (true);
revoke all on public.template_service_items from anon, authenticated;
grant select on public.template_service_items to authenticated;

create table public.service_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 500),
  unit        text not null check (length(btrim(unit)) between 1 and 20),
  unit_price  numeric(12,2) check (unit_price is null or unit_price >= 0),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.service_items is
  'A company''s price list of services. A null price is "not set yet": the trade''s items arrive without prices.';
create unique index service_items_org_name_key on public.service_items (org_id, lower(btrim(name)));
create index service_items_org_sort_idx on public.service_items (org_id, sort_order);

create trigger service_items_updated_at before update on public.service_items
  for each row execute function public.set_updated_at();

alter table public.service_items enable row level security;
-- Read by whoever bills (and the warehouse, as the other money tables): what
-- the company charges is not for every login. The phone reads none of it;
-- quoting on site will come with its own permission.
create policy service_items_select on public.service_items for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
create policy service_items_insert on public.service_items for insert
  with check (org_id = (select public.current_org_id()) and (select public.has_permission('invoicing')));
create policy service_items_update on public.service_items for update
  using (org_id = (select public.current_org_id()) and (select public.has_permission('invoicing')))
  with check (org_id = (select public.current_org_id()) and (select public.has_permission('invoicing')));
create policy service_items_delete on public.service_items for delete
  using (org_id = (select public.current_org_id()) and (select public.has_permission('invoicing')));
create policy module_gate on public.service_items as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));
revoke all on public.service_items from anon;
grant select, insert, update, delete on public.service_items to authenticated;

-- Each trade's usual services, without prices: every company sets its own.
insert into public.template_service_items (template_code, code, name, unit, sort_order)
select v.template_code, v.code, v.name, v.unit, v.sort_order
  from (values
    ('cleaning', 'standard_clean', 'Standard clean', 'visit', 10),
    ('cleaning', 'deep_clean', 'Deep clean', 'visit', 20),
    ('cleaning', 'window_clean', 'Window cleaning', 'visit', 30),
    ('cleaning', 'carpet_clean', 'Carpet cleaning', 'm²', 40),
    ('cleaning', 'cleaning_labour', 'Cleaning labour', 'hour', 50),
    ('cleaning', 'consumables', 'Cleaning consumables', 'each', 60),
    ('garden', 'garden_service', 'Garden service', 'visit', 10),
    ('garden', 'lawn_mowing', 'Lawn mowing', 'visit', 20),
    ('garden', 'hedge_trimming', 'Hedge trimming', 'hour', 30),
    ('garden', 'refuse_removal', 'Garden refuse removal', 'load', 40),
    ('garden', 'garden_labour', 'Garden labour', 'hour', 50),
    ('garden', 'plants_materials', 'Plants and materials', 'each', 60),
    ('plumbing', 'call_out', 'Call-out fee', 'each', 10),
    ('plumbing', 'labour', 'Labour', 'hour', 20),
    ('plumbing', 'materials', 'Materials', 'each', 30),
    ('plumbing', 'drain_unblocking', 'Drain unblocking', 'each', 40),
    ('plumbing', 'geyser_replacement', 'Geyser replacement', 'each', 50),
    ('plumbing', 'compliance_certificate', 'Certificate of compliance', 'each', 60),
    ('installation', 'site_survey', 'Site survey', 'each', 10),
    ('installation', 'installation_labour', 'Installation labour', 'hour', 20),
    ('installation', 'equipment', 'Equipment', 'each', 30),
    ('installation', 'materials', 'Materials and cabling', 'each', 40),
    ('installation', 'commissioning', 'Commissioning and handover', 'each', 50),
    ('installation', 'call_out', 'Call-out fee', 'each', 60),
    ('maintenance', 'call_out', 'Call-out fee', 'each', 10),
    ('maintenance', 'labour', 'Labour', 'hour', 20),
    ('maintenance', 'planned_maintenance', 'Planned maintenance', 'visit', 30),
    ('maintenance', 'inspection', 'Inspection', 'each', 40),
    ('maintenance', 'materials', 'Materials', 'each', 50),
    ('security', 'guard_shift_day', 'Guard shift (day)', 'shift', 10),
    ('security', 'guard_shift_night', 'Guard shift (night)', 'shift', 20),
    ('security', 'patrol', 'Patrol', 'visit', 30),
    ('security', 'armed_response', 'Armed response call-out', 'each', 40),
    ('security', 'monitoring', 'Monitoring', 'month', 50),
    ('pest_control', 'treatment', 'Treatment', 'each', 10),
    ('pest_control', 'inspection', 'Inspection', 'each', 20),
    ('pest_control', 'bait_station_service', 'Bait station service', 'station', 30),
    ('pest_control', 'follow_up', 'Follow-up treatment', 'each', 40),
    ('pest_control', 'call_out', 'Call-out fee', 'each', 50),
    ('pool', 'pool_service', 'Pool service', 'visit', 10),
    ('pool', 'chemicals', 'Chemicals', 'each', 20),
    ('pool', 'green_pool_recovery', 'Green pool recovery', 'each', 30),
    ('pool', 'repair_labour', 'Repair labour', 'hour', 40),
    ('pool', 'parts', 'Equipment and parts', 'each', 50),
    ('delivery', 'delivery', 'Delivery', 'drop', 10),
    ('delivery', 'failed_attempt', 'Failed delivery attempt', 'each', 20),
    ('delivery', 'distance', 'Distance', 'km', 30),
    ('delivery', 'dedicated_vehicle', 'Dedicated vehicle', 'day', 40),
    ('delivery', 'waiting_time', 'Waiting time', 'hour', 50),
    ('generic', 'call_out', 'Call-out fee', 'each', 10),
    ('generic', 'labour', 'Labour', 'hour', 20),
    ('generic', 'service', 'Service', 'visit', 30),
    ('generic', 'materials', 'Materials', 'each', 40)
  ) as v(template_code, code, name, unit, sort_order)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

-- Every template changed (the module, its settings, its price list).
update public.industry_templates set version = version + 1;

-- template_defaults() proposes the price list; create_company() copies it.
do $migration$
declare
  v_def text := pg_get_functiondef('public.template_defaults(text[])'::regprocedure);
  c_anchor constant text := $a$           order by tf.code, o.n) f)
  );$a$;
  c_new constant text := $b$           order by tf.code, o.n) f),
    'service_items', (
      select coalesce(jsonb_agg(s.j order by s.n, s.sort_order), '[]'::jsonb)
        from (
          select distinct on (si.code)
                 o.n, si.sort_order,
                 jsonb_build_object('template', si.template_code, 'code', si.code, 'name', si.name,
                                    'description', si.description, 'unit', si.unit) as j
            from unnest(p_templates) with ordinality o(code, n)
            join public.template_service_items si on si.template_code = o.code
           order by si.code, o.n) s)
  );$b$;
begin
  if (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 then
    raise exception 'template_defaults is not the text this migration expects';
  end if;
  execute replace(v_def, c_anchor, c_new);
end;
$migration$;

do $migration$
declare
  v_def text := pg_get_functiondef('public.create_company(jsonb, text[], jsonb, uuid, uuid)'::regprocedure);
  c_anchor constant text := $a$  ------------------------------------------------------------------ audit
$a$;
  c_added constant text := $b$  ------------------------------------------------------------- price list
  -- The trade's usual services, without prices: the company sets its own.
  if 'invoicing' = any(v_modules) then
    insert into public.service_items (org_id, name, description, unit, sort_order)
    select v_org, s.item->>'name', nullif(s.item->>'description', ''), s.item->>'unit', (s.n * 10)::int
      from jsonb_array_elements(v_def->'service_items') with ordinality s(item, n)
    on conflict do nothing;
  end if;

$b$;
begin
  if (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 then
    raise exception 'create_company is not the text this migration expects';
  end if;
  execute replace(v_def, c_anchor, c_added || c_anchor);
end;
$migration$;

------------------------------------------------------------------ quotes

alter table public.quotes alter column store_id drop not null;
alter table public.quotes
  add column customer_name text
    constraint quotes_customer_name_len check (customer_name is null or length(btrim(customer_name)) between 1 and 200),
  add column customer_address text
    constraint quotes_customer_address_len check (customer_address is null or length(customer_address) <= 500),
  add column contact_email text
    constraint quotes_contact_email_len check (contact_email is null or length(contact_email) <= 200),
  add column prices_include_vat boolean not null default false;
alter table public.quotes
  add constraint quotes_has_client check (store_id is not null or customer_name is not null);
grant update (customer_name, customer_address, contact_email) on public.quotes to authenticated;

alter table public.quote_lines alter column product_id drop not null;
alter table public.quote_lines alter column qty type numeric(12,2);
alter table public.quote_lines
  add column service_item_id uuid references public.service_items(id) on delete set null,
  add column description text
    constraint quote_lines_description_len check (description is null or length(btrim(description)) between 1 and 500),
  add column unit text
    constraint quote_lines_unit_len check (unit is null or length(btrim(unit)) between 1 and 20),
  add column position integer;
-- A line is a product, a price-list item, or free text, and always says what it is.
alter table public.quote_lines
  add constraint quote_lines_one_kind check (
    num_nonnulls(product_id, service_item_id) <= 1 and (product_id is not null or description is not null));
grant update (service_item_id, description, unit, position) on public.quote_lines to authenticated;

-- Who may see and change a quote: whoever bills, the warehouse (as before),
-- or the quote's own field person.
drop policy quotes_select on public.quotes;
create policy quotes_select on public.quotes for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))
              or (rep_id = (select auth.uid()))));
drop policy quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert
  with check ((org_id = (select public.current_org_id())) and (status = 'draft'::text) and (converted_order_id is null)
              and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))
                   or (rep_id = (select auth.uid()))));
drop policy quotes_update on public.quotes;
create policy quotes_update on public.quotes for update
  using ((org_id = (select public.current_org_id())) and (status <> 'converted'::text)
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))
              or (rep_id = (select auth.uid()))))
  with check ((org_id = (select public.current_org_id()))
              and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))
                   or (rep_id = (select auth.uid()))));
drop policy quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete
  using ((org_id = (select public.current_org_id())) and (status <> 'converted'::text)
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))
              or (rep_id = (select auth.uid()))));

-- The VAT basis is stamped when a quote is made, like its rate; an invoiced
-- quote stays accepted.
create or replace function public.quotes_stamp()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    select coalesce(vat_rate, 0), prices_include_vat into new.vat_rate, new.prices_include_vat
    from public.organizations where id = new.org_id;
  else
    new.vat_rate := old.vat_rate;
    new.prices_include_vat := old.prices_include_vat;
    if old.status = 'accepted' and new.status is distinct from 'accepted'
       and exists (select 1 from public.tax_invoices i where i.quote_id = old.id and i.status = 'issued') then
      raise exception '% has been invoiced. Void its invoices before changing it.', old.quote_number
        using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- Quote to order (Distribution): only a quote of whole products can become one.
create or replace function public.quote_convert(p_quote_id uuid)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  q public.quotes;
  v_order uuid;
  v_number text;
begin
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.quotes where id = p_quote_id for update;
  select * into q from public.quotes where id = p_quote_id;
  if q.status = 'converted' then
    raise exception 'This quote is already order %.',
      (select order_number from public.orders where id = q.converted_order_id)
      using errcode = '23505';
  end if;
  if q.status = 'declined' then
    raise exception 'This quote was declined. Reopen it before converting it.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.quote_lines where quote_id = q.id) then
    raise exception 'This quote has no products on it.' using errcode = '22023';
  end if;
  if q.store_id is null then
    raise exception 'Choose who the order is for on the quote first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.quote_lines
              where quote_id = q.id and (product_id is null or qty <> trunc(qty))) then
    raise exception 'Only a quote of whole products can become an order. Invoice it instead.'
      using errcode = '22023';
  end if;

  v_number := public.next_document_number(q.org_id, 'order', 'SO');

  insert into public.orders (
    org_id, order_number, store_id, source, received_via,
    contact_name, contact_phone, rep_id, delivery_address, notes,
    client_generated_id
  ) values (
    q.org_id, v_number, q.store_id, 'warehouse_manual', 'other',
    q.contact_name, q.contact_phone, q.rep_id, q.delivery_address,
    concat_ws(E'\n', 'From quote ' || q.quote_number || '.', q.notes),
    gen_random_uuid()
  ) returning id into v_order;

  insert into public.order_lines (
    org_id, order_id, product_id, qty_ordered,
    unit_price, list_price, discount_pct, client_generated_id
  )
  select q.org_id, v_order, l.product_id, l.qty::integer,
         l.list_price, l.list_price, l.discount_pct, gen_random_uuid()
  from public.quote_lines l
  where l.quote_id = q.id;

  perform public.quote_mark_converted(q.id, v_order);

  return v_order;
end;
$function$;

create or replace function public.quote_mark_converted(p_quote_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  q public.quotes;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  select * into q from public.quotes where id = p_quote_id;
  if not found
     or q.org_id is distinct from public.current_org_id()
     or q.status = 'converted'
     or not (public.has_permission('warehouse') or public.has_permission('invoicing') or q.rep_id = auth.uid()) then
    raise exception 'You cannot convert this quote.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.org_id = q.org_id
      and o.store_id = q.store_id and o.status = 'new'
      and o.xmin = xid(pg_current_xact_id())
  ) or exists (select 1 from public.quotes where converted_order_id = p_order_id) then
    raise exception 'That order was not made from this quote.' using errcode = '42501';
  end if;
  update public.quotes
     set status = 'converted', converted_order_id = p_order_id, converted_at = now()
   where id = p_quote_id;
end;
$function$;

---------------------------------------------------------------- invoices

alter table public.tax_invoices alter column order_id drop not null;
alter table public.tax_invoices alter column order_number drop not null;
alter table public.tax_invoices
  add column source text not null default 'order'
    constraint tax_invoices_source_check check (source in ('order', 'quote', 'jobs', 'direct')),
  add column kind text not null default 'standard'
    constraint tax_invoices_kind_check check (kind in ('standard', 'deposit', 'final')),
  add column quote_id uuid references public.quotes(id) on delete restrict,
  add column prices_include_vat boolean not null default false,
  add column reference text
    constraint tax_invoices_reference_len check (reference is null or length(reference) <= 100),
  add column customer_email text,
  add column seller_registration_number text,
  add column bank_details text;
-- An order invoice has its order; a quote invoice its quote; only a quote's
-- invoices are deposits or finals.
alter table public.tax_invoices
  add constraint tax_invoices_source_link check (
    ((source = 'order') = (order_id is not null))
    and (source <> 'order' or order_number is not null)
    and ((source = 'quote') = (quote_id is not null))
    and (kind = 'standard' or source = 'quote'));
create index tax_invoices_quote_idx on public.tax_invoices (quote_id) where quote_id is not null;
create index tax_invoices_org_store_idx on public.tax_invoices (org_id, store_id);

alter table public.tax_invoice_lines alter column qty type numeric(12,2);
alter table public.tax_invoice_lines
  add column unit text,
  add column service_item_id uuid references public.service_items(id) on delete set null;
alter table public.credit_note_lines alter column qty type numeric(12,2);

-- The jobs an invoice covers. A job is on one live invoice at most; voiding
-- the invoice frees it (the row stays, inactive, as the record).
create table public.tax_invoice_visits (
  invoice_id uuid not null references public.tax_invoices(id) on delete cascade,
  visit_id   uuid not null references public.visits(id) on delete restrict,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  active     boolean not null default true,
  primary key (invoice_id, visit_id)
);
create unique index tax_invoice_visits_live_key on public.tax_invoice_visits (visit_id) where active;
alter table public.tax_invoice_visits enable row level security;
create policy tax_invoice_visits_select on public.tax_invoice_visits for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
create policy module_gate on public.tax_invoice_visits as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));
revoke all on public.tax_invoice_visits from anon, authenticated;
grant select on public.tax_invoice_visits to authenticated;

-- Readable by whoever bills, and by the warehouse as before.
drop policy tax_invoices_select on public.tax_invoices;
create policy tax_invoices_select on public.tax_invoices for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
drop policy credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
drop policy invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));

-- The money tables move from Distribution to Invoicing.
do $migration$
declare
  t text;
begin
  foreach t in array array['quotes', 'quote_lines', 'tax_invoices', 'tax_invoice_lines',
                           'credit_notes', 'credit_note_lines', 'invoice_payments'] loop
    execute format('drop policy module_gate on public.%I', t);
    execute format('create policy module_gate on public.%I as restrictive for all '
                   'using ((select public.module_enabled(''invoicing''))) '
                   'with check ((select public.module_enabled(''invoicing'')))', t);
  end loop;
end;
$migration$;

-- The billing gate's three policies on the new company tables, where the
-- gate exists (production; its migration arrives with PR #91).
do $migration$
declare
  t text;
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  foreach t in array array['service_items', 'tax_invoice_visits'] loop
    execute format('create policy billing_gate_insert on public.%I as restrictive for insert to authenticated '
                   'with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_update on public.%I as restrictive for update to authenticated '
                   'using ((select public.company_writable())) with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_delete on public.%I as restrictive for delete to authenticated '
                   'using ((select public.company_writable()))', t);
  end loop;
end;
$migration$;

----------------------------------------------------------- the arithmetic

-- An invoice's totals from the sum of its lines: the lines are before VAT,
-- or (prices including VAT) the VAT is the part of them at the rate.
create function public.money_totals(p_lines numeric, p_rate numeric, p_inclusive boolean,
                                    out subtotal numeric, out vat numeric, out total numeric)
language sql
immutable
set search_path to ''
as $function$
  select case when p_inclusive then p_lines - round(p_lines * p_rate / (100 + p_rate), 2) else p_lines end,
         case when p_inclusive then round(p_lines * p_rate / (100 + p_rate), 2) else round(p_lines * p_rate / 100, 2) end,
         case when p_inclusive then p_lines else p_lines + round(p_lines * p_rate / 100, 2) end;
$function$;
revoke all on function public.money_totals(numeric, numeric, boolean) from public, anon, authenticated;

-- An invoice's lines less what credit notes have taken off them, in the
-- invoice's own basis (before VAT, or including it).
create function public.invoice_line_net(p_invoice uuid)
returns numeric
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((select sum(tl.line_total) from public.tax_invoice_lines tl where tl.invoice_id = p_invoice), 0)
       - coalesce((select sum(cl.line_total)
                     from public.credit_note_lines cl
                     join public.credit_notes c on c.id = cl.credit_note_id
                    where c.invoice_id = p_invoice), 0);
$function$;
revoke all on function public.invoice_line_net(uuid) from public, anon, authenticated;

-- Writes a numbered invoice and its lines, and totals it. Internal: every
-- caller has checked the module, the permission and what is being invoiced.
-- p_lines: [{description, qty, unit_price, unit?, service_item_id?}]. A
-- negative price is allowed only where p_deductions (the deposits taken off a
-- final invoice).
create function public.invoice_write(
  p_org uuid, p_source text, p_kind text, p_store uuid, p_quote uuid,
  p_customer_name text, p_customer_address text, p_customer_email text, p_reference text,
  p_issue_date date, p_vat_rate numeric, p_inclusive boolean, p_lines jsonb, p_deductions boolean)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  org public.organizations;
  v_id uuid;
  v_date date;
  v_number text;
  v_sum numeric;
  t record;
  l record;
  v_pos int := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'An invoice has at most 200 lines.' using errcode = '22023';
  end if;
  if nullif(btrim(p_customer_name), '') is null then
    raise exception 'Say who the invoice is for.' using errcode = '22023';
  end if;
  for l in
    select x.description, x.qty, x.unit_price, x.unit, x.service_item_id
      from jsonb_to_recordset(p_lines)
           as x(description text, qty numeric, unit_price numeric, unit text, service_item_id uuid)
  loop
    if nullif(btrim(l.description), '') is null or length(l.description) > 500 then
      raise exception 'Every line needs a description (up to 500 characters).' using errcode = '22023';
    end if;
    if l.qty is null or l.qty <= 0 or l.qty <> round(l.qty, 2) then
      raise exception 'A quantity is more than zero, to two decimals.' using errcode = '22023';
    end if;
    if l.unit_price is null or l.unit_price <> round(l.unit_price, 2) or abs(l.unit_price) >= 10000000000 then
      raise exception 'Every line needs a price, to the cent.' using errcode = '22023';
    end if;
    if l.unit_price < 0 and not p_deductions then
      raise exception 'A price is not negative. Use a credit note to give money back.' using errcode = '22023';
    end if;
    if l.unit is not null and length(btrim(l.unit)) not between 1 and 20 then
      raise exception 'A unit is up to 20 characters.' using errcode = '22023';
    end if;
    if l.service_item_id is not null
       and not exists (select 1 from public.service_items si where si.id = l.service_item_id and si.org_id = p_org) then
      raise exception 'A price-list item on this invoice is not this company''s.' using errcode = '22023';
    end if;
  end loop;

  select * into org from public.organizations where id = p_org;
  v_date := coalesce(p_issue_date, (now() at time zone public.org_timezone(p_org))::date);
  v_number := public.next_document_number(p_org, 'tax_invoice', org.invoice_prefix);

  insert into public.tax_invoices (
    org_id, invoice_number, source, kind, quote_id, store_id,
    seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,
    seller_registration_number, bank_details,
    customer_name, customer_address, customer_email, reference, footer,
    issue_date, due_date, vat_rate, prices_include_vat, subtotal, vat, total, created_by
  ) values (
    p_org, v_number, p_source, p_kind, p_quote, p_store,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,
    org.registration_number, org.bank_details,
    btrim(p_customer_name), nullif(btrim(p_customer_address), ''), nullif(btrim(p_customer_email), ''),
    nullif(btrim(p_reference), ''), org.invoice_footer,
    v_date, v_date + org.invoice_terms_days, coalesce(p_vat_rate, 0), coalesce(p_inclusive, false), 0, 0, 0, auth.uid()
  ) returning id into v_id;

  for l in
    select x.description, x.qty, x.unit_price, x.unit, x.service_item_id
      from jsonb_to_recordset(p_lines)
           as x(description text, qty numeric, unit_price numeric, unit text, service_item_id uuid)
  loop
    v_pos := v_pos + 1;
    insert into public.tax_invoice_lines (invoice_id, position, service_item_id, description, unit, qty, unit_price, line_total)
    values (v_id, v_pos, l.service_item_id, btrim(l.description), nullif(btrim(l.unit), ''), l.qty, l.unit_price,
            round(l.qty * l.unit_price, 2));
  end loop;

  select coalesce(sum(line_total), 0) into v_sum from public.tax_invoice_lines where invoice_id = v_id;
  if v_sum < 0 then
    raise exception 'An invoice total cannot be below zero.' using errcode = '22023';
  end if;
  select * into t from public.money_totals(v_sum, coalesce(p_vat_rate, 0), coalesce(p_inclusive, false));
  update public.tax_invoices set subtotal = t.subtotal, vat = t.vat, total = t.total where id = v_id;
  return v_id;
end;
$function$;
revoke all on function public.invoice_write(uuid, text, text, uuid, uuid, text, text, text, text, date, numeric, boolean, jsonb, boolean)
  from public, anon, authenticated;

--------------------------------------------------- invoices: the four ways

-- From an order (Distribution), as before: now also stamps the document
-- details and takes the company's prefix (INV unless it changed it).
create or replace function public.tax_invoice_issue(p_order_id uuid, p_issue_date date default null::date)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  o public.orders;
  org public.organizations;
  s public.stores;
  v_id uuid;
  v_number text;
  v_date date;
  v_subtotal numeric;
  v_vat numeric;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  perform public.require_permission('warehouse');

  select * into o from public.orders where id = p_order_id and org_id = v_org for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if o.status not in ('dispatched', 'delivered') then
    raise exception 'Only an order that has gone out can be invoiced. % is %.', o.order_number, o.status
      using errcode = '22023';
  end if;
  if exists (select 1 from public.tax_invoices where order_id = o.id and status = 'issued') then
    raise exception '% already has a tax invoice. Void it first to issue another.', o.order_number
      using errcode = '23505';
  end if;
  -- Invoiced in QuickBooks before the app issued invoices: refuse, never overwrite.
  if o.invoice_number is not null
     and not exists (select 1 from public.tax_invoices
                     where order_id = o.id and invoice_number = o.invoice_number) then
    raise exception '% was already invoiced outside the app as %. Clear that number on the order first if it was wrong.',
      o.order_number, o.invoice_number using errcode = '23505';
  end if;

  select * into org from public.organizations where id = v_org;
  select * into s from public.stores where id = o.store_id;
  v_date := coalesce(p_issue_date, (now() at time zone public.org_timezone(v_org))::date);
  v_number := public.next_document_number(v_org, 'tax_invoice', org.invoice_prefix);

  insert into public.tax_invoices (
    org_id, invoice_number, order_id, order_number, store_id,
    seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,
    seller_registration_number, bank_details,
    customer_name, customer_address, footer,
    issue_date, due_date, vat_rate, subtotal, vat, total, created_by
  ) values (
    v_org, v_number, o.id, o.order_number, o.store_id,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,
    org.registration_number, org.bank_details,
    coalesce(s.name, 'Customer'),
    -- Through jsonb so this works whether or not orders.delivery_address exists yet.
    coalesce(nullif(to_jsonb(o)->>'delivery_address', ''), concat_ws(', ', s.address, s.city)),
    org.invoice_footer,
    v_date, v_date + org.invoice_terms_days, o.vat_rate, 0, 0, 0, auth.uid()
  ) returning id into v_id;

  insert into public.tax_invoice_lines (invoice_id, position, product_id, description, sku, qty, unit_price, line_total)
  select v_id,
         row_number() over (order by p.name, ol.id),
         ol.product_id,
         p.name || coalesce(' — ' || p.brand, ''),
         p.sku_code,
         q.qty,
         coalesce(ol.unit_price, 0),
         round(q.qty * coalesce(ol.unit_price, 0), 2)
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  cross join lateral (
    select case when o.status = 'delivered' then ol.qty_delivered - ol.qty_returned
                else ol.qty_dispatched end as qty
  ) q
  where ol.order_id = o.id and q.qty > 0;

  select coalesce(sum(line_total), 0) into v_subtotal from public.tax_invoice_lines where invoice_id = v_id;
  if v_subtotal = 0 and not exists (select 1 from public.tax_invoice_lines where invoice_id = v_id) then
    raise exception '% has nothing left to invoice.', o.order_number using errcode = '22023';
  end if;
  v_vat := round(v_subtotal * o.vat_rate / 100, 2);
  update public.tax_invoices set subtotal = v_subtotal, vat = v_vat, total = v_subtotal + v_vat
   where id = v_id;

  update public.orders set invoice_number = v_number where id = o.id;

  return v_id;
end;
$function$;

-- Typed in: counter sales and once-off work. p_bill_to: {store_id} for a
-- place on the books, or {name, address, email} for anyone else.
create function public.invoice_direct(p_bill_to jsonb, p_lines jsonb,
                                      p_issue_date date default null, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  org public.organizations;
  s public.stores;
  v_store uuid;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if not coalesce((public.org_setting(v_org, 'money_invoice_direct'))::boolean, false) then
    raise exception 'Direct invoices are switched off in this company''s settings.' using errcode = '42501';
  end if;

  v_store := nullif(p_bill_to->>'store_id', '')::uuid;
  if v_store is not null then
    select * into s from public.stores where id = v_store and org_id = v_org;
    if not found then
      raise exception 'Who the invoice is for was not found.' using errcode = 'P0002';
    end if;
  end if;
  select * into org from public.organizations where id = v_org;
  return public.invoice_write(
    v_org, 'direct', 'standard', v_store, null,
    coalesce(nullif(btrim(p_bill_to->>'name'), ''), s.name),
    coalesce(nullif(btrim(p_bill_to->>'address'), ''), nullif(concat_ws(', ', s.address, s.city), '')),
    nullif(btrim(p_bill_to->>'email'), ''),
    p_reference, p_issue_date, org.vat_rate, org.prices_include_vat, p_lines, false);
end;
$function$;

-- From an accepted quote: in full, a deposit (a percentage or an amount), or
-- the final balance (the quote's lines less the deposits already invoiced).
-- A quote with products on it becomes an order instead.
create function public.invoice_from_quote(p_quote_id uuid, p_mode text default 'full',
                                          p_percent numeric default null, p_amount numeric default null,
                                          p_issue_date date default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  q public.quotes;
  s public.stores;
  v_quote_total numeric;
  v_invoiced numeric;
  v_amount numeric;
  v_lines jsonb;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_mode is null or p_mode not in ('full', 'deposit', 'final') then
    raise exception 'Invoice a quote in full, as a deposit, or as the final balance.' using errcode = '22023';
  end if;
  if not coalesce((public.org_setting(v_org, 'money_quotes'))::boolean, false) then
    raise exception 'Quotes are switched off in this company''s settings.' using errcode = '42501';
  end if;
  if p_mode <> 'full' and not coalesce((public.org_setting(v_org, 'money_deposits'))::boolean, false) then
    raise exception 'Deposits are switched off in this company''s settings.' using errcode = '42501';
  end if;

  select * into q from public.quotes where id = p_quote_id and org_id = v_org for update;
  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
  if q.status <> 'accepted' then
    raise exception 'Only an accepted quote can be invoiced. % is %.', q.quote_number, q.status using errcode = '22023';
  end if;
  if not exists (select 1 from public.quote_lines where quote_id = q.id) then
    raise exception '% has no lines.', q.quote_number using errcode = '22023';
  end if;
  if exists (select 1 from public.quote_lines where quote_id = q.id and product_id is not null) then
    raise exception '% has products on it: make it an order, and invoice the order.', q.quote_number
      using errcode = '22023';
  end if;

  select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) into v_quote_total
    from public.quote_lines l where l.quote_id = q.id;
  -- What the quote's live invoices still charge, after their credit notes.
  select coalesce(sum(public.invoice_line_net(i.id)), 0) into v_invoiced
    from public.tax_invoices i
   where i.quote_id = q.id and i.status = 'issued';

  if p_mode = 'full' then
    if exists (select 1 from public.tax_invoices where quote_id = q.id and status = 'issued') then
      raise exception '% has already been invoiced.', q.quote_number using errcode = '23505';
    end if;
  elsif p_mode = 'deposit' then
    if exists (select 1 from public.tax_invoices where quote_id = q.id and status = 'issued' and kind <> 'deposit') then
      raise exception '% has already been invoiced in full.', q.quote_number using errcode = '23505';
    end if;
    if p_percent is not null and (p_percent <= 0 or p_percent >= 100) then
      raise exception 'A deposit percentage is between 0 and 100.' using errcode = '22023';
    end if;
    v_amount := coalesce(p_amount, round(v_quote_total * p_percent / 100, 2));
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
      raise exception 'A deposit is a percentage, or an amount above zero.' using errcode = '22023';
    end if;
    if v_invoiced + v_amount > v_quote_total then
      raise exception 'Only % of % is left to invoice on %.', v_quote_total - v_invoiced, v_quote_total, q.quote_number
        using errcode = '22023';
    end if;
  else
    if not exists (select 1 from public.tax_invoices where quote_id = q.id and status = 'issued' and kind = 'deposit') then
      raise exception '% has no deposit invoice. Invoice it in full instead.', q.quote_number using errcode = '22023';
    end if;
    if exists (select 1 from public.tax_invoices where quote_id = q.id and status = 'issued' and kind <> 'deposit') then
      raise exception '% already has its final invoice.', q.quote_number using errcode = '23505';
    end if;
  end if;

  if p_mode = 'deposit' then
    v_lines := jsonb_build_array(jsonb_build_object(
      'description', case when p_amount is null
                          then format('Deposit (%s%%) on quote %s', trim_scale(p_percent), q.quote_number)
                          else format('Deposit on quote %s', q.quote_number) end,
      'qty', 1, 'unit_price', v_amount));
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'description', l.description, 'qty', l.qty, 'unit_price', l.unit_price,
             'unit', l.unit, 'service_item_id', l.service_item_id)
             order by l.position nulls last, l.created_at, l.id), '[]'::jsonb)
      into v_lines
      from public.quote_lines l where l.quote_id = q.id;
    if p_mode = 'final' then
      select v_lines || coalesce(jsonb_agg(jsonb_build_object(
               'description', format('Less deposit invoiced on %s', d.invoice_number),
               'qty', 1, 'unit_price', -d.amount) order by d.issue_date, d.invoice_number), '[]'::jsonb)
        into v_lines
        from (select i.invoice_number, i.issue_date, public.invoice_line_net(i.id) as amount
                from public.tax_invoices i
               where i.quote_id = q.id and i.status = 'issued' and i.kind = 'deposit') d
       where d.amount > 0;
    end if;
  end if;

  if q.store_id is not null then
    select * into s from public.stores where id = q.store_id;
  end if;
  return public.invoice_write(
    v_org, 'quote', case p_mode when 'full' then 'standard' else p_mode end, q.store_id, q.id,
    coalesce(q.customer_name, s.name),
    coalesce(q.customer_address, q.delivery_address, nullif(concat_ws(', ', s.address, s.city), '')),
    q.contact_email, q.quote_number, p_issue_date, q.vat_rate, q.prices_include_vat, v_lines, p_mode = 'final');
end;
$function$;

-- From completed jobs at one place: the office chooses the lines (from the
-- price list, the time on site, or typed), the jobs are remembered so none is
-- invoiced twice.
create function public.invoice_from_visits(p_visit_ids uuid[], p_lines jsonb,
                                           p_issue_date date default null, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  org public.organizations;
  s public.stores;
  v_ids uuid[];
  v_store uuid;
  v_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if not coalesce((public.org_setting(v_org, 'money_invoice_from_jobs'))::boolean, false) then
    raise exception 'Invoicing completed work is switched off in this company''s settings.' using errcode = '42501';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_visit_ids) x where x is not null;
  if v_ids is null then
    raise exception 'Choose the work to invoice.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Invoice at most 500 jobs at a time.' using errcode = '22023';
  end if;
  if (select count(*) from public.visits v where v.id = any(v_ids) and v.org_id = v_org) <> cardinality(v_ids) then
    raise exception 'Some of that work was not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.visits v where v.id = any(v_ids) and v.status <> 'checked_out') then
    raise exception 'Only finished work can be invoiced.' using errcode = '22023';
  end if;
  if (select count(distinct v.store_id) from public.visits v where v.id = any(v_ids)) > 1 then
    raise exception 'The work on one invoice must all be at the same place.' using errcode = '22023';
  end if;
  if exists (select 1 from public.tax_invoice_visits tv where tv.visit_id = any(v_ids) and tv.active) then
    raise exception 'Some of that work is already on an invoice.' using errcode = '23505';
  end if;

  select v.store_id into v_store from public.visits v where v.id = v_ids[1];
  select * into s from public.stores where id = v_store;
  select * into org from public.organizations where id = v_org;
  v_id := public.invoice_write(
    v_org, 'jobs', 'standard', v_store, null,
    s.name, nullif(concat_ws(', ', s.address, s.city), ''), null,
    p_reference, p_issue_date, org.vat_rate, org.prices_include_vat, p_lines, false);
  insert into public.tax_invoice_visits (invoice_id, visit_id, org_id)
  select v_id, x, v_org from unnest(v_ids) x;
  return v_id;
end;
$function$;

------------------------------------------- credits, payments, voiding

create or replace function public.credit_note_issue(p_invoice_id uuid, p_reason text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  i public.tax_invoices;
  v_id uuid;
  v_number text;
  v_sum numeric;
  t record;
  v_outstanding numeric;
  l record;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the credit is being given.' using errcode = '22023';
  end if;
  select * into i from public.tax_invoices where id = p_invoice_id and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception '% is void; there is nothing to credit.', i.invoice_number using errcode = '22023';
  end if;

  -- Every statement below reads the request summed per line, so a line sent
  -- twice counts once, with both quantities.
  for l in
    select x.invoice_line_id, x.qty, tl.qty as invoiced, tl.description, tl.unit_price,
           coalesce((select sum(cl.qty) from public.credit_note_lines cl where cl.invoice_line_id = tl.id), 0) as credited
    from (select r.invoice_line_id, sum(r.qty) as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty numeric)
          where r.qty > 0 group by r.invoice_line_id) x
    left join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id
  loop
    if l.invoiced is null then
      raise exception 'A line on this credit note is not on %.', i.invoice_number using errcode = '22023';
    end if;
    if l.unit_price < 0 then
      raise exception '"%" is a deduction; it cannot be credited.', l.description using errcode = '22023';
    end if;
    if l.qty <> round(l.qty, 2) then
      raise exception 'A quantity is to two decimals.' using errcode = '22023';
    end if;
    if l.qty + l.credited > l.invoiced then
      raise exception 'Only % of "%" is left to credit.', l.invoiced - l.credited, l.description
        using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(round(x.qty * tl.unit_price, 2)), 0) into v_sum
  from (select r.invoice_line_id, sum(r.qty) as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty numeric)
          where r.qty > 0 group by r.invoice_line_id) x join public.tax_invoice_lines tl on tl.id = x.invoice_line_id;
  if v_sum = 0 then
    raise exception 'Choose at least one line to credit.' using errcode = '22023';
  end if;
  -- The same VAT basis as the invoice it credits.
  select * into t from public.money_totals(v_sum, i.vat_rate, i.prices_include_vat);
  select outstanding into v_outstanding from public.tax_invoice_balances where invoice_id = i.id;
  if t.total > v_outstanding then
    raise exception 'This credit (%) is more than the % still owed on %. A credit after payment needs a refund, which is not recorded here.',
      t.total, v_outstanding, i.invoice_number using errcode = '22023';
  end if;

  v_number := public.next_document_number(i.org_id, 'credit_note', 'CN');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total, created_by)
  values (i.org_id, v_number, i.id, trim(p_reason),
          (now() at time zone public.org_timezone(i.org_id))::date,
          t.subtotal, t.vat, t.total, auth.uid())
  returning id into v_id;

  insert into public.credit_note_lines (credit_note_id, invoice_line_id, qty, unit_price, line_total)
  select v_id, tl.id, x.qty, tl.unit_price, round(x.qty * tl.unit_price, 2)
  from (select r.invoice_line_id, sum(r.qty) as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty numeric)
          where r.qty > 0 group by r.invoice_line_id) x
  join public.tax_invoice_lines tl on tl.id = x.invoice_line_id;

  return v_id;
end;
$function$;

create or replace function public.invoice_payment_record(p_invoice_id uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  i public.tax_invoices;
  v_outstanding numeric;
  v_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  select * into i from public.tax_invoices where id = p_invoice_id and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception '% is void.', i.invoice_number using errcode = '22023';
  end if;
  select outstanding into v_outstanding from public.tax_invoice_balances where invoice_id = i.id;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment is more than zero.' using errcode = '22023';
  end if;
  if p_amount > v_outstanding then
    raise exception 'Only % is outstanding on %.', v_outstanding, i.invoice_number using errcode = '22023';
  end if;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method, reference, created_by)
  values (i.org_id, i.id, p_amount, coalesce(p_paid_on, current_date), coalesce(p_method, 'eft'),
          nullif(trim(p_reference), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.invoice_payment_delete(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  delete from public.invoice_payments where id = p_payment_id and org_id = public.current_org_id();
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.tax_invoice_void(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  i public.tax_invoices;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the invoice is being voided.' using errcode = '22023';
  end if;
  select * into i from public.tax_invoices where id = p_id and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception '% is already void.', i.invoice_number using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_payments where invoice_id = i.id)
     or exists (select 1 from public.credit_notes where invoice_id = i.id) then
    raise exception '% has payments or credit notes against it. Issue a credit note instead.', i.invoice_number
      using errcode = '22023';
  end if;
  if i.kind = 'deposit' and exists (select 1 from public.tax_invoices f
                                     where f.quote_id = i.quote_id and f.status = 'issued' and f.kind = 'final') then
    raise exception 'The final invoice for this quote takes % off. Void the final invoice first.', i.invoice_number
      using errcode = '22023';
  end if;
  update public.tax_invoices
     set status = 'void', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = i.id;
  -- Its jobs can be invoiced again.
  update public.tax_invoice_visits set active = false where invoice_id = i.id;
  update public.orders set invoice_number = null
   where id = i.order_id and invoice_number = i.invoice_number;
end;
$function$;

------------------------------------------------------------ who owes you

-- What each client owes as at a date, by how long it has been due: not yet
-- due, 1–30, 31–60, 61–90 and over 90 days. Credits and payments count from
-- the day they were made, so an earlier date shows the book as it stood.
create function public.debtors_ageing(p_as_of date default null)
returns table (store_id uuid, client_name text, not_due numeric, days_1_30 numeric, days_31_60 numeric,
               days_61_90 numeric, days_over_90 numeric, total numeric, invoices integer,
               oldest_due date, last_paid_on date)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_as_of date;
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  v_org := public.current_org_id();
  v_as_of := coalesce(p_as_of, (now() at time zone public.org_timezone(v_org))::date);
  return query
  with owed as (
    select i.store_id as sid,
           case when i.store_id is null then lower(btrim(i.customer_name)) end as name_key,
           coalesce(st.name, i.customer_name) as client,
           i.due_date as due,
           i.total
             - coalesce((select sum(c.total) from public.credit_notes c
                          where c.invoice_id = i.id and c.issue_date <= v_as_of), 0)
             - coalesce((select sum(p.amount) from public.invoice_payments p
                          where p.invoice_id = i.id and p.paid_on <= v_as_of), 0) as amount,
           (select max(p.paid_on) from public.invoice_payments p
             where p.invoice_id = i.id and p.paid_on <= v_as_of) as paid
      from public.tax_invoices i
      left join public.stores st on st.id = i.store_id
     where i.org_id = v_org and i.status = 'issued' and i.issue_date <= v_as_of
  )
  select o.sid,
         min(o.client),
         coalesce(sum(o.amount) filter (where v_as_of - o.due <= 0), 0),
         coalesce(sum(o.amount) filter (where v_as_of - o.due between 1 and 30), 0),
         coalesce(sum(o.amount) filter (where v_as_of - o.due between 31 and 60), 0),
         coalesce(sum(o.amount) filter (where v_as_of - o.due between 61 and 90), 0),
         coalesce(sum(o.amount) filter (where v_as_of - o.due > 90), 0),
         sum(o.amount),
         count(*)::integer,
         min(o.due),
         max(o.paid)
    from owed o
   where o.amount > 0
   group by o.sid, o.name_key
   order by sum(o.amount) desc, min(o.client);
end;
$function$;

-- One client's account between two dates: the balance brought forward, then
-- every invoice, credit note and payment in date order with a running balance.
-- A place on the books by p_store_id; anyone else by the name on the invoices.
create function public.client_statement(p_store_id uuid, p_customer_name text, p_from date, p_to date)
returns table (entry_date date, entry_kind text, document_number text, detail text,
               debit numeric, credit numeric, balance numeric, document_id uuid)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_name text := lower(btrim(p_customer_name));
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_store_id is null and nullif(v_name, '') is null then
    raise exception 'Choose whose statement this is.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose the statement''s dates.' using errcode = '22023';
  end if;
  v_org := public.current_org_id();
  return query
  with mine as (
    select i.id, i.invoice_number, i.issue_date, i.total, i.reference
      from public.tax_invoices i
     where i.org_id = v_org and i.status = 'issued'
       and case when p_store_id is not null then i.store_id = p_store_id
                else i.store_id is null and lower(btrim(i.customer_name)) = v_name end
  ), moves as (
    select m.issue_date as d, 1 as o, 'invoice'::text as k, m.invoice_number as n, m.reference as x,
           m.total as dr, 0::numeric as cr, m.id as ref
      from mine m
    union all
    select c.issue_date, 2, 'credit_note', c.credit_number, c.reason, 0, c.total, c.id
      from public.credit_notes c join mine m on m.id = c.invoice_id
    union all
    select p.paid_on, 3, 'payment', m.invoice_number, concat_ws(' · ', p.method, p.reference), 0, p.amount, p.id
      from public.invoice_payments p join mine m on m.id = p.invoice_id
  ), opening as (
    select coalesce(sum(mv.dr - mv.cr), 0) as ob from moves mv where mv.d < p_from
  )
  select r.d, r.k, r.n, r.x, r.dr, r.cr, r.bal, r.ref
    from (
      select p_from as d, 0 as o, 'opening'::text as k, null::text as n, null::text as x,
             null::numeric as dr, null::numeric as cr, (select ob from opening) as bal, null::uuid as ref
      union all
      select mv.d, mv.o, mv.k, mv.n, mv.x, mv.dr, mv.cr,
             (select ob from opening) + sum(mv.dr - mv.cr) over (order by mv.d, mv.o, mv.n, mv.ref rows unbounded preceding),
             mv.ref
        from moves mv
       where mv.d between p_from and p_to
    ) r
   order by r.d, r.o, r.n, r.ref;
end;
$function$;

-- Completed work not on a live invoice, for whoever bills: the job list of
-- "invoice completed work" (visits themselves are readable by managers and
-- their own staff only).
create function public.unbilled_visits(p_store_id uuid, p_from date, p_to date)
returns table (visit_id uuid, store_id uuid, store_name text, checkin_at timestamptz,
               checkout_at timestamptz, minutes integer, staff_name text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  v_org := public.current_org_id();
  v_tz := public.org_timezone(v_org);
  return query
  select v.id, v.store_id, s.name, v.checkin_at, v.checkout_at,
         case when v.checkin_at is not null and v.checkout_at is not null
              then round(extract(epoch from v.checkout_at - v.checkin_at) / 60)::integer end,
         p.full_name
    from public.visits v
    join public.stores s on s.id = v.store_id
    left join public.profiles p on p.id = v.rep_id
   where v.org_id = v_org and v.status = 'checked_out'
     and (p_store_id is null or v.store_id = p_store_id)
     and (p_from is null or (v.checkin_at at time zone v_tz)::date >= p_from)
     and (p_to is null or (v.checkin_at at time zone v_tz)::date <= p_to)
     and not exists (select 1 from public.tax_invoice_visits tv where tv.visit_id = v.id and tv.active)
   order by s.name, v.checkin_at
   limit 2000;
end;
$function$;

revoke all on function public.invoice_direct(jsonb, jsonb, date, text) from public, anon;
revoke all on function public.invoice_from_quote(uuid, text, numeric, numeric, date) from public, anon;
revoke all on function public.invoice_from_visits(uuid[], jsonb, date, text) from public, anon;
revoke all on function public.debtors_ageing(date) from public, anon;
revoke all on function public.client_statement(uuid, text, date, date) from public, anon;
revoke all on function public.unbilled_visits(uuid, date, date) from public, anon;
grant execute on function public.invoice_direct(jsonb, jsonb, date, text) to authenticated;
grant execute on function public.invoice_from_quote(uuid, text, numeric, numeric, date) to authenticated;
grant execute on function public.invoice_from_visits(uuid[], jsonb, date, text) to authenticated;
grant execute on function public.debtors_ageing(date) to authenticated;
grant execute on function public.client_statement(uuid, text, date, date) to authenticated;
grant execute on function public.unbilled_visits(uuid, date, date) to authenticated;

------------------------------------------------------- module assignments

update public.module_assignments set module_code = 'invoicing'
 where kind = 'table'
   and name in ('quotes', 'quote_lines', 'tax_invoices', 'tax_invoice_lines',
                'credit_notes', 'credit_note_lines', 'invoice_payments');
update public.module_assignments set module_code = 'invoicing'
 where kind = 'function'
   and name in ('credit_note_issue', 'invoice_payment_record', 'invoice_payment_delete', 'tax_invoice_void');

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'service_items', 'invoicing'),
  ('table', 'tax_invoice_visits', 'invoicing'),
  ('table', 'template_service_items', 'core'),
  ('function', 'invoice_direct', 'invoicing'),
  ('function', 'invoice_from_quote', 'invoicing'),
  ('function', 'invoice_from_visits', 'invoicing'),
  ('function', 'debtors_ageing', 'invoicing'),
  ('function', 'client_statement', 'invoicing'),
  ('function', 'unbilled_visits', 'invoicing');
