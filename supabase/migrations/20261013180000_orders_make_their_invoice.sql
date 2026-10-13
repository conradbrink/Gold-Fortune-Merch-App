-- Every order is its own invoice (13 Oct 2026).
--
-- Gold Fortune's owner: "when an order is created an invoice is also
-- automatically created and they are linked", numbered and final straight
-- away, and Tickd takes over invoicing from QuickBooks.
--
-- ------------------------------------------------------------- when
--
-- The invoice is issued the moment the order is confirmed. That is the
-- earliest it can be final: an order's lines arrive after the order itself
-- (the phone and the office both insert the order, then its lines), and
-- while the order is `new` its lines can still be added, changed and
-- removed. Confirmation fixes them.
--
-- It is issued on what was ordered, at the order's prices. Afterwards the
-- order can only shrink — short stock, a short dispatch, goods returned, a
-- cancellation — and every shrink is credited automatically, so the invoice
-- less its credit notes always matches what the customer got:
--
--   dispatched  credited down to what went out
--   delivered   credited down to what was delivered less what came back
--   cancelled   voided, when nothing has been paid or credited against it;
--               otherwise everything left is credited
--
-- Credits only go down. An order that goes back from dispatched to packed
-- (taken back undelivered) is not re-invoiced; its next dispatch is credited
-- against what is left.
--
-- ------------------------------------------------------------- how
--
-- A constraint trigger, deferred to the end of the transaction, so it sees the
-- order and its lines as the confirming, dispatching or delivering function
-- left them, whatever order that function wrote them in. A second trigger,
-- immediate, refuses to confirm an order with unpriced lines: an invoice needs
-- a price on every line, and after confirmation the lines cannot be changed.
--
-- Only for a company with the new `money_invoice_orders` setting on (the
-- Distribution template's default, so Gold Fortune), with the invoicing module
-- on. An order that already carries a QuickBooks number is left alone.
--
-- Orders already past `new` are not invoiced retrospectively: some of them
-- were invoiced in QuickBooks without the number being typed on the order.
--
-- ------------------------------------------------------------- numbers
--
-- Gold Fortune's QuickBooks invoices end at 1823, so its tax-invoice counter
-- starts at 1824 (INV-001824). Only when it has never issued one.
--
-- An invoice line now remembers the order line it came from
-- (`tax_invoice_lines.order_line_id`), which is how a credit finds its line.
-- The "Issue invoice" button on a dispatched order fills it in too.

------------------------------------------------------------------ the setting

insert into public.setting_definitions (key, label, description, value_type, default_value, pattern, sort_order, audience) values
  ('money_invoice_orders', 'Invoice every order',
   'Each order is invoiced the moment it is confirmed. Anything not sent, returned or cancelled is credited automatically.',
   'boolean', 'false', null, 117, 'owner');

insert into public.template_settings (template_code, setting_key, value)
select 'distribution', 'money_invoice_orders', 'true'::jsonb
 where exists (select 1 from public.industry_templates it where it.code = 'distribution');

-- Every company has every setting written down (as create_company does).
insert into public.company_settings (org_id, key, value)
select o.id, 'money_invoice_orders', coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = 'money_invoice_orders'),
         'false'::jsonb)
  from public.organizations o
on conflict (org_id, key) do nothing;

------------------------------------------------------------------- the link

alter table public.tax_invoice_lines
  add column order_line_id uuid references public.order_lines(id) on delete set null;
create index tax_invoice_lines_order_line_idx on public.tax_invoice_lines (order_line_id)
  where order_line_id is not null;

-- The "Issue invoice" button records the order line too.
do $$
declare
  def text := pg_get_functiondef('public.tax_invoice_issue(uuid,date)'::regprocedure);
  old_text constant text :=
    E'insert into public.tax_invoice_lines (invoice_id, position, product_id, description, sku, qty, unit_price, line_total)\n'
    || E'  select v_id,\n'
    || E'         row_number() over (order by p.name, ol.id),\n'
    || E'         ol.product_id,\n';
  new_text constant text :=
    E'insert into public.tax_invoice_lines (invoice_id, position, product_id, order_line_id, description, sku, qty, unit_price, line_total)\n'
    || E'  select v_id,\n'
    || E'         row_number() over (order by p.name, ol.id),\n'
    || E'         ol.product_id,\n'
    || E'         ol.id,\n';
begin
  if (length(def) - length(replace(def, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'tax_invoice_issue: expected 1 of the anchor';
  end if;
  execute replace(def, old_text, new_text);
end;
$$;

----------------------------------------------------------------- the numbers

insert into public.document_counters (org_id, doc_type, next_value)
select o.id, 'tax_invoice', 1824
  from public.organizations o
 where o.id = '71170c8a-d53c-4a07-bdd4-97704a3cf4bc'
   and not exists (select 1 from public.tax_invoices t where t.org_id = o.id)
on conflict (org_id, doc_type) do nothing;

--------------------------------------------------------------- the functions

-- Whether this company's orders make their own invoices.
create function public.order_invoices_on(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((select (cs.value)::boolean from public.company_settings cs
                    where cs.org_id = p_org and cs.key = 'money_invoice_orders'), false)
     and (exists (select 1 from public.modules m where m.code = 'invoicing' and m.plan_type = 'core')
          or exists (select 1 from public.company_modules cm
                      where cm.org_id = p_org and cm.module_code = 'invoicing' and cm.enabled));
$function$;

-- Issues the invoice for a confirmed order, on what was ordered. Internal:
-- called only by the trigger below.
create function public.order_invoice_write(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o public.orders;
  org public.organizations;
  s public.stores;
  v_id uuid;
  v_number text;
  v_date date;
  v_sum numeric;
  t record;
begin
  select * into o from public.orders where id = p_order_id for update;
  select * into org from public.organizations where id = o.org_id;
  select * into s from public.stores where id = o.store_id;
  v_date := (now() at time zone public.org_timezone(o.org_id))::date;
  v_number := public.next_document_number_internal(o.org_id, 'tax_invoice', org.invoice_prefix);

  insert into public.tax_invoices (
    org_id, invoice_number, order_id, order_number, store_id,
    seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,
    seller_registration_number, bank_details,
    customer_name, customer_address, footer,
    issue_date, due_date, vat_rate, subtotal, vat, total, created_by
  ) values (
    o.org_id, v_number, o.id, o.order_number, o.store_id,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,
    org.registration_number, org.bank_details,
    coalesce(s.name, 'Customer'),
    coalesce(nullif(o.delivery_address, ''), concat_ws(', ', s.address, s.city)),
    org.invoice_footer,
    v_date, v_date + org.invoice_terms_days, o.vat_rate, 0, 0, 0, auth.uid()
  ) returning id into v_id;

  insert into public.tax_invoice_lines (invoice_id, position, product_id, order_line_id, description, sku, qty, unit_price, line_total)
  select v_id,
         row_number() over (order by p.name, ol.id),
         ol.product_id,
         ol.id,
         p.name || coalesce(' — ' || p.brand, ''),
         p.sku_code,
         ol.qty_ordered,
         ol.unit_price,
         round(ol.qty_ordered * ol.unit_price, 2)
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  where ol.order_id = o.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0;

  select coalesce(sum(line_total), 0) into v_sum from public.tax_invoice_lines where invoice_id = v_id;
  select * into t from public.money_totals(v_sum, o.vat_rate, false);
  update public.tax_invoices set subtotal = t.subtotal, vat = t.vat, total = t.total where id = v_id;

  update public.orders set invoice_number = v_number where id = o.id;
  return v_id;
end;
$function$;

-- Writes a credit note. Internal: called only by the trigger below. Unlike
-- credit_note_issue it does not stop at what is still owed: goods that did not
-- arrive are credited even when the invoice was paid up front, which leaves
-- the customer in credit.
-- p_lines: [{invoice_line_id, qty}], each line once.
create function public.credit_note_write(p_invoice_id uuid, p_reason text, p_lines jsonb)
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
begin
  select * into i from public.tax_invoices where id = p_invoice_id for update;
  select coalesce(sum(round(x.qty * tl.unit_price, 2)), 0) into v_sum
    from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, qty numeric)
    join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id;
  select * into t from public.money_totals(v_sum, i.vat_rate, i.prices_include_vat);

  v_number := public.next_document_number_internal(i.org_id, 'credit_note', 'CN');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total, created_by)
  values (i.org_id, v_number, i.id, p_reason,
          (now() at time zone public.org_timezone(i.org_id))::date,
          t.subtotal, t.vat, t.total, auth.uid())
  returning id into v_id;

  insert into public.credit_note_lines (credit_note_id, invoice_line_id, qty, unit_price, line_total)
  select v_id, tl.id, x.qty, tl.unit_price, round(x.qty * tl.unit_price, 2)
    from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, qty numeric)
    join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id;
  return v_id;
end;
$function$;

-- Before confirming: every line the invoice will carry has a price.
create function public.orders_invoice_ready()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_missing text;
begin
  if new.invoice_number is not null or not public.order_invoices_on(new.org_id) then
    return new;
  end if;
  select string_agg(p.name, ', ' order by p.name) into v_missing
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = new.id and ol.line_status <> 'cancelled' and ol.qty_ordered > 0
     and ol.unit_price is null;
  if v_missing is not null then
    raise exception '% has products with no price: %. Price them first: confirming the order issues its invoice.',
      new.order_number, v_missing using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- At the end of the transaction: issue on confirmation, credit what shrank.
create function public.orders_invoice_follow()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o public.orders;
  i public.tax_invoices;
  v_lines jsonb;
begin
  select * into o from public.orders where id = new.id;
  if not found or not public.order_invoices_on(o.org_id) then
    return null;
  end if;

  if old.status = 'new' and new.status = 'confirmed' and o.status <> 'cancelled'
     and o.invoice_number is null
     and not exists (select 1 from public.tax_invoices t where t.order_id = o.id and t.status = 'issued') then
    perform public.order_invoice_write(o.id);
  end if;

  select * into i from public.tax_invoices t where t.order_id = o.id and t.status = 'issued';
  if not found or o.status = 'new' then
    return null;
  end if;

  if o.status = 'cancelled'
     and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id)
     and not exists (select 1 from public.credit_notes c where c.invoice_id = i.id) then
    update public.tax_invoices
       set status = 'void', void_reason = format('%s was cancelled.', o.order_number),
           voided_by = auth.uid(), voided_at = now()
     where id = i.id;
    update public.orders set invoice_number = null
     where id = o.id and invoice_number = i.invoice_number;
    return null;
  end if;

  select jsonb_agg(jsonb_build_object('invoice_line_id', x.id, 'qty', x.net - x.target) order by x.position)
    into v_lines
    from (
      select tl.id, tl.position,
             tl.qty - coalesce((select sum(cl.qty) from public.credit_note_lines cl where cl.invoice_line_id = tl.id), 0) as net,
             greatest(case o.status
                        when 'cancelled' then 0
                        when 'dispatched' then ol.qty_dispatched
                        when 'delivered' then ol.qty_delivered - ol.qty_returned
                        else case when ol.line_status = 'cancelled' then 0 else ol.qty_ordered end
                      end, 0) as target
        from public.tax_invoice_lines tl
        join public.order_lines ol on ol.id = tl.order_line_id
       where tl.invoice_id = i.id
    ) x
   where x.net > x.target;

  if v_lines is not null then
    perform public.credit_note_write(i.id,
      case o.status
        when 'dispatched' then format('Not sent: %s went out short.', o.order_number)
        when 'delivered' then format('Not delivered or returned: %s.', o.order_number)
        when 'cancelled' then format('%s was cancelled.', o.order_number)
        else format('%s changed after it was invoiced.', o.order_number)
      end,
      v_lines);
  end if;
  return null;
end;
$function$;

revoke all on function public.order_invoices_on(uuid) from public, anon, authenticated;
revoke all on function public.order_invoice_write(uuid) from public, anon, authenticated;
revoke all on function public.credit_note_write(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.orders_invoice_ready() from public, anon, authenticated;
revoke all on function public.orders_invoice_follow() from public, anon, authenticated;

create trigger orders_invoice_ready
  before update of status on public.orders
  for each row
  when (old.status = 'new' and new.status = 'confirmed')
  execute function public.orders_invoice_ready();

create constraint trigger orders_invoice_follow
  after update of status on public.orders
  deferrable initially deferred
  for each row
  when (old.status is distinct from new.status)
  execute function public.orders_invoice_follow();

-- None of these is callable by a client, so none goes in module_assignments
-- (whose suite would expect each to start with require_module); each one
-- checks the invoicing module itself, through order_invoices_on.
