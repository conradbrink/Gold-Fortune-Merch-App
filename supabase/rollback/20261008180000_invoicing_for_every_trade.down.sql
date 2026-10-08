-- Rollback of 20261008180000_invoicing_for_every_trade.
--
-- Puts back exactly what was there: the money tables, functions and policies
-- under Distribution and the `warehouse` permission, quotes that need a product
-- and a site, invoices that need an order, and no price list, workflow or
-- document settings. Drops whatever was written with the new features (price
-- lists, invoices from quotes, jobs or typed in): run it only before anyone
-- has used them, or keep a copy first.

------------------------------------------------------- module assignments

delete from public.module_assignments
 where (kind, name) in (('table', 'service_items'), ('table', 'tax_invoice_visits'),
                        ('table', 'template_service_items'),
                        ('function', 'invoice_direct'), ('function', 'invoice_from_quote'),
                        ('function', 'invoice_from_visits'), ('function', 'debtors_ageing'),
                        ('function', 'client_statement'), ('function', 'unbilled_visits'));
update public.module_assignments set module_code = 'distribution'
 where kind = 'function'
   and name in ('credit_note_issue', 'invoice_payment_record', 'invoice_payment_delete', 'tax_invoice_void');
update public.module_assignments set module_code = 'distribution'
 where kind = 'table'
   and name in ('quotes', 'quote_lines', 'tax_invoices', 'tax_invoice_lines',
                'credit_notes', 'credit_note_lines', 'invoice_payments');

---------------------------------------------------------- new functions

drop function public.unbilled_visits(uuid, date, date);
drop function public.client_statement(uuid, text, date, date);
drop function public.debtors_ageing(date);
drop function public.invoice_from_visits(uuid[], jsonb, date, text);
drop function public.invoice_from_quote(uuid, text, numeric, numeric, date);
drop function public.invoice_direct(jsonb, jsonb, date, text);
drop function public.invoice_write(uuid, text, text, uuid, uuid, text, text, text, text, date, numeric, boolean, jsonb, boolean);
drop function public.invoice_line_net(uuid);
drop function public.money_totals(numeric, numeric, boolean);

---------------------------------------------- the functions as they were

CREATE OR REPLACE FUNCTION public.tax_invoice_issue(p_order_id uuid, p_issue_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_number := public.next_document_number(v_org, 'tax_invoice', 'INV');

  insert into public.tax_invoices (
    org_id, invoice_number, order_id, order_number, store_id,
    seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,
    customer_name, customer_address, footer,
    issue_date, due_date, vat_rate, subtotal, vat, total, created_by
  ) values (
    v_org, v_number, o.id, o.order_number, o.store_id,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,
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

CREATE OR REPLACE FUNCTION public.credit_note_issue(p_invoice_id uuid, p_reason text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  i public.tax_invoices;
  v_id uuid;
  v_number text;
  v_subtotal numeric;
  v_vat numeric;
  v_outstanding numeric;
  l record;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_permission('warehouse');
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
    select x.invoice_line_id, x.qty, tl.qty as invoiced, tl.description,
           coalesce((select sum(cl.qty) from public.credit_note_lines cl where cl.invoice_line_id = tl.id), 0) as credited
    from (select r.invoice_line_id, sum(r.qty)::integer as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty integer)
          where r.qty > 0 group by r.invoice_line_id) x
    left join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id
  loop
    if l.invoiced is null then
      raise exception 'A line on this credit note is not on %.', i.invoice_number using errcode = '22023';
    end if;
    if l.qty + l.credited > l.invoiced then
      raise exception 'Only % of "%" is left to credit.', l.invoiced - l.credited, l.description
        using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(round(x.qty * tl.unit_price, 2)), 0) into v_subtotal
  from (select r.invoice_line_id, sum(r.qty)::integer as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty integer)
          where r.qty > 0 group by r.invoice_line_id) x join public.tax_invoice_lines tl on tl.id = x.invoice_line_id;
  if v_subtotal = 0 then
    raise exception 'Choose at least one line to credit.' using errcode = '22023';
  end if;
  v_vat := round(v_subtotal * i.vat_rate / 100, 2);
  select outstanding into v_outstanding from public.tax_invoice_balances where invoice_id = i.id;
  if v_subtotal + v_vat > v_outstanding then
    raise exception 'This credit (%) is more than the % still owed on %. A credit after payment needs a refund, which is not recorded here.',
      v_subtotal + v_vat, v_outstanding, i.invoice_number using errcode = '22023';
  end if;

  v_number := public.next_document_number(i.org_id, 'credit_note', 'CN');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total, created_by)
  values (i.org_id, v_number, i.id, trim(p_reason),
          (now() at time zone public.org_timezone(i.org_id))::date,
          v_subtotal, v_vat, v_subtotal + v_vat, auth.uid())
  returning id into v_id;

  insert into public.credit_note_lines (credit_note_id, invoice_line_id, qty, unit_price, line_total)
  select v_id, tl.id, x.qty, tl.unit_price, round(x.qty * tl.unit_price, 2)
  from (select r.invoice_line_id, sum(r.qty)::integer as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty integer)
          where r.qty > 0 group by r.invoice_line_id) x
  join public.tax_invoice_lines tl on tl.id = x.invoice_line_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.invoice_payment_record(p_invoice_id uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  i public.tax_invoices;
  v_outstanding numeric;
  v_id uuid;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_permission('warehouse');
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

CREATE OR REPLACE FUNCTION public.invoice_payment_delete(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_permission('warehouse');
  delete from public.invoice_payments where id = p_payment_id and org_id = public.current_org_id();
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tax_invoice_void(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  i public.tax_invoices;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  perform public.require_permission('warehouse');
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
  update public.tax_invoices
     set status = 'void', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = i.id;
  update public.orders set invoice_number = null
   where id = i.order_id and invoice_number = i.invoice_number;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_convert(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q public.quotes;
  v_order uuid;
  v_number text;
begin
  perform public.require_module('distribution');
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
  select q.org_id, v_order, l.product_id, l.qty,
         l.list_price, l.list_price, l.discount_pct, gen_random_uuid()
  from public.quote_lines l
  where l.quote_id = q.id;

  perform public.quote_mark_converted(q.id, v_order);

  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_mark_converted(p_quote_id uuid, p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q public.quotes;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  select * into q from public.quotes where id = p_quote_id;
  if not found
     or q.org_id is distinct from public.current_org_id()
     or q.status = 'converted'
     or not (public.has_permission('warehouse') or q.rep_id = auth.uid()) then
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

CREATE OR REPLACE FUNCTION public.quotes_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    select coalesce(vat_rate, 0) into new.vat_rate
    from public.organizations where id = new.org_id;
  else
    new.vat_rate := old.vat_rate;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

----------------------------------------------------------- the policies

do $rollback$
declare
  t text;
begin
  foreach t in array array['quotes', 'quote_lines', 'tax_invoices', 'tax_invoice_lines',
                           'credit_notes', 'credit_note_lines', 'invoice_payments'] loop
    execute format('drop policy module_gate on public.%I', t);
    execute format('create policy module_gate on public.%I as restrictive for all '
                   'using ((select public.module_enabled(''distribution''))) '
                   'with check ((select public.module_enabled(''distribution'')))', t);
  end loop;
end;
$rollback$;

drop policy tax_invoices_select on public.tax_invoices;
create policy tax_invoices_select on public.tax_invoices for select
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('warehouse')));
drop policy credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes for select
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('warehouse')));
drop policy invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments for select
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('warehouse')));

drop policy quotes_select on public.quotes;
create policy quotes_select on public.quotes for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('warehouse')) or (rep_id = (select auth.uid()))));
drop policy quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert
  with check ((org_id = (select public.current_org_id())) and (status = 'draft'::text) and (converted_order_id is null)
              and ((select public.has_permission('warehouse')) or (rep_id = (select auth.uid()))));
drop policy quotes_update on public.quotes;
create policy quotes_update on public.quotes for update
  using ((org_id = (select public.current_org_id())) and (status <> 'converted'::text)
         and ((select public.has_permission('warehouse')) or (rep_id = (select auth.uid()))))
  with check ((org_id = (select public.current_org_id()))
              and ((select public.has_permission('warehouse')) or (rep_id = (select auth.uid()))));
drop policy quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete
  using ((org_id = (select public.current_org_id())) and (status <> 'converted'::text)
         and ((select public.has_permission('warehouse')) or (rep_id = (select auth.uid()))));

---------------------------------------------------------------- invoices

drop table public.tax_invoice_visits;

alter table public.tax_invoices drop constraint tax_invoices_source_link;
drop index public.tax_invoices_quote_idx;
drop index public.tax_invoices_org_store_idx;
alter table public.tax_invoices
  drop column source,
  drop column kind,
  drop column quote_id,
  drop column prices_include_vat,
  drop column reference,
  drop column customer_email,
  drop column seller_registration_number,
  drop column bank_details;
alter table public.tax_invoices alter column order_id set not null;
alter table public.tax_invoices alter column order_number set not null;

alter table public.tax_invoice_lines drop column unit, drop column service_item_id;
-- Back to whole numbers. Each check is re-made: changing the type rewrote it.
alter table public.tax_invoice_lines alter column qty type integer using qty::integer;
alter table public.tax_invoice_lines drop constraint tax_invoice_lines_qty_check,
  add constraint tax_invoice_lines_qty_check check (qty > 0);
alter table public.credit_note_lines alter column qty type integer using qty::integer;
alter table public.credit_note_lines drop constraint credit_note_lines_qty_check,
  add constraint credit_note_lines_qty_check check (qty > 0);

------------------------------------------------------------------ quotes

alter table public.quote_lines drop constraint quote_lines_one_kind;
alter table public.quote_lines
  drop column service_item_id,
  drop column description,
  drop column unit,
  drop column position;
alter table public.quote_lines alter column qty type integer using qty::integer;
alter table public.quote_lines drop constraint quote_lines_qty_check,
  add constraint quote_lines_qty_check check (qty > 0);
alter table public.quote_lines alter column product_id set not null;

alter table public.quotes drop constraint quotes_has_client;
alter table public.quotes
  drop column customer_name,
  drop column customer_address,
  drop column contact_email,
  drop column prices_include_vat;
alter table public.quotes alter column store_id set not null;

------------------------------------------------------------ the price list

do $rollback$
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
  if (length(v_def) - length(replace(v_def, c_added || c_anchor, ''))) / length(c_added || c_anchor) <> 1 then
    raise exception 'create_company is not the text this rollback expects';
  end if;
  execute replace(v_def, c_added || c_anchor, c_anchor);
end;
$rollback$;

do $rollback$
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
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'template_defaults is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_anchor);
end;
$rollback$;

update public.industry_templates set version = version - 1;
drop table public.service_items;
drop table public.template_service_items;

----------------------------------------------------- document details

alter table public.organizations
  drop column registration_number,
  drop column bank_details,
  drop column prices_include_vat,
  drop column invoice_prefix,
  drop column quote_prefix,
  drop column quote_validity_days;

------------------------------------------------------------- the settings

delete from public.company_settings
 where key in ('money_workflow', 'money_quotes', 'money_deposits', 'money_invoice_from_jobs', 'money_invoice_direct');
delete from public.template_settings
 where setting_key in ('money_workflow', 'money_quotes', 'money_deposits', 'money_invoice_from_jobs', 'money_invoice_direct');
delete from public.setting_definitions
 where key in ('money_workflow', 'money_quotes', 'money_deposits', 'money_invoice_from_jobs', 'money_invoice_direct');

------------------------------------------------------------- the permission

do $rollback$
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
    if (length(v_def) - length(replace(v_def, c_pairs[i + 1], ''))) / length(c_pairs[i + 1]) <> 1 then
      raise exception 'provision_organization is not the text this rollback expects (%)', btrim(c_pairs[i]);
    end if;
    v_def := replace(v_def, c_pairs[i + 1], c_pairs[i]);
  end loop;
  execute v_def;
end;
$rollback$;

delete from public.profile_permissions where permission_code = 'invoicing';
delete from public.job_role_permissions where permission_code = 'invoicing';
delete from public.app_permissions where code = 'invoicing';

----------------------------------------------------------------- the module

delete from public.company_modules where module_code = 'invoicing';
delete from public.template_modules where module_code = 'invoicing' and template_code <> 'plumbing';
update public.modules
   set plan_type = 'addon',
       is_built = false,
       description = 'Quote to invoice from a completed job, tax invoice fields, sequential numbering.'
 where code = 'invoicing';
