-- Rollback of 20261008200000_contracts_and_proof_of_service.
--
-- Puts back Part 1a as it was: no contracts, no contract invoices, no proof
-- of service, no money_contracts switch, invoice_write / debtors_ageing /
-- unbilled_visits as 1a left them, and no daily contract run. The contracts
-- themselves (terms and lines) are dropped with their tables.
--
-- It refuses to start once a contract invoice exists: the 1a schema has no
-- `contract` source to hold it. Copy and remove those first; nothing here
-- deletes an invoice.
--
-- Run it as ONE transaction (`psql --single-transaction -f …`, or inside
-- begin … commit).

do $guard$
begin
  if exists (select 1 from public.tax_invoices where source = 'contract' or period_start is not null or period_end is not null) then
    raise exception 'Contract invoices exist: copy and remove them before rolling back.';
  end if;
end;
$guard$;

select cron.unschedule('contract-invoices');

delete from public.module_assignments
 where (kind, name) in (('table', 'service_contracts'), ('table', 'service_contract_lines'),
                        ('table', 'service_contract_invoices'),
                        ('function', 'contract_invoices_run_now'), ('function', 'contract_reinvoice_period'),
                        ('function', 'invoice_proof_of_service'), ('function', 'debtors_ageing_json'),
                        ('function', 'client_statement_json'));

drop function public.client_statement_json(uuid, text, date, date);
drop function public.debtors_ageing_json(date);
drop function public.invoice_proof_of_service(uuid);
drop function public.contract_reinvoice_period(uuid, date);
drop function public.contract_invoices_run_now(uuid);
drop function public.contract_invoices_run();
drop function public.contract_invoices_due(uuid, date, uuid);
drop function public.contract_issue_period(uuid, date, date, date);

do $rollback$
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
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'unbilled_visits is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;

do $rollback$
declare
  v_def text := pg_get_functiondef('public.debtors_ageing(date)'::regprocedure);
  c_old constant text := $a$   order by sum(o.amount) desc, min(o.client);$a$;
  c_new constant text := $b$   order by sum(o.amount) desc, min(o.client), o.sid nulls last, o.name_key nulls last;$b$;
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'debtors_ageing is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;

do $rollback$
declare
  v_def text := pg_get_functiondef('public.invoice_write(uuid, text, text, uuid, uuid, text, text, text, text, date, numeric, boolean, jsonb, boolean)'::regprocedure);
  c_old constant text := $a$    if l.unit is not null and length(btrim(l.unit)) not between 1 and 20 then$a$;
  c_new constant text := $b$    if nullif(btrim(l.unit), '') is not null and length(btrim(l.unit)) > 20 then$b$;
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'invoice_write is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;

-- The contracts' delete policy reads the invoices table: it goes first.
drop policy service_contracts_delete on public.service_contracts;
drop table public.service_contract_invoices;
drop table public.service_contract_lines;
drop table public.service_contracts;

drop function public.service_contracts_after_change();
drop function public.service_contracts_refresh_next(uuid);
drop function public.service_contracts_stamp();
drop function public.contract_next_period(uuid);
drop function public.contract_invoice_date(date, date, text, integer);
drop function public.contract_period_end(date, text);
drop function public.contract_first_period_start(date);

alter table public.tax_invoices drop constraint tax_invoices_period_order;
alter table public.tax_invoices drop column period_start, drop column period_end;
alter table public.tax_invoices drop constraint tax_invoices_source_check;
alter table public.tax_invoices
  add constraint tax_invoices_source_check check (source in ('order', 'quote', 'jobs', 'direct'));

update public.industry_templates set version = version - 1
 where code in ('cleaning', 'garden', 'pool', 'security', 'maintenance', 'pest_control', 'generic');
delete from public.company_settings where key = 'money_contracts';
delete from public.template_settings where setting_key = 'money_contracts';
delete from public.setting_definitions where key = 'money_contracts';
