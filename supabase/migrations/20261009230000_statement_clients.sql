-- Money → Statements: every client the company has invoiced, with their
-- balance as at a date, so a statement can be made for anyone, not only
-- clients who owe money (Who owes you lists those).
--
-- statement_clients(as_of) has one row per client: by place on the books, or
-- by the name on the invoices when there is none (the same two ways
-- client_statement chooses a client). It counts issued invoices to the date,
-- less credit notes and payments to the date. statement_clients_json is the
-- same as one document, as debtors_ageing_json is, so no page limit applies.
--
-- Rollback: supabase/rollback/20261009230000_statement_clients.down.sql.

create function public.statement_clients(p_as_of date default null)
returns table (
  store_id    uuid,
  client_name text,
  invoices    integer,
  invoiced    numeric,
  credited    numeric,
  paid        numeric,
  balance     numeric,
  first_date  date,
  last_date   date
)
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
  with inv as (
    select i.id,
           i.store_id as sid,
           case when i.store_id is null then lower(btrim(i.customer_name)) end as name_key,
           coalesce(st.name, i.customer_name) as client,
           i.issue_date,
           i.total
      from public.tax_invoices i
      left join public.stores st on st.id = i.store_id
     where i.org_id = v_org and i.status = 'issued' and i.issue_date <= v_as_of
  ), cr as (
    select c.invoice_id, sum(c.total) as amt, max(c.issue_date) as last
      from public.credit_notes c
     where c.issue_date <= v_as_of
     group by c.invoice_id
  ), pay as (
    select p.invoice_id, sum(p.amount) as amt, max(p.paid_on) as last
      from public.invoice_payments p
     where p.paid_on <= v_as_of
     group by p.invoice_id
  )
  select inv.sid,
         min(inv.client),
         count(*)::integer,
         sum(inv.total),
         coalesce(sum(cr.amt), 0),
         coalesce(sum(pay.amt), 0),
         sum(inv.total) - coalesce(sum(cr.amt), 0) - coalesce(sum(pay.amt), 0),
         min(inv.issue_date),
         greatest(max(inv.issue_date), max(cr.last), max(pay.last))
    from inv
    left join cr on cr.invoice_id = inv.id
    left join pay on pay.invoice_id = inv.id
   group by inv.sid, inv.name_key
   order by min(inv.client), inv.sid nulls last, inv.name_key nulls last;
end;
$function$;

create function public.statement_clients_json(p_as_of date default null)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  return (select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb)
            from public.statement_clients(p_as_of) with ordinality as r);
end;
$function$;

revoke all on function public.statement_clients(date) from public, anon;
revoke all on function public.statement_clients_json(date) from public, anon;
grant execute on function public.statement_clients(date) to authenticated;
grant execute on function public.statement_clients_json(date) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'statement_clients', 'invoicing'),
  ('function', 'statement_clients_json', 'invoicing');
