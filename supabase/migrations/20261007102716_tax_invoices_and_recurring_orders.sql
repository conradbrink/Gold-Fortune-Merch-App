-- Tax invoices issued from the app, with credit notes and payments; and
-- recurring orders that place themselves on a schedule.
--
-- ============================================================ tax invoices
--
-- Until now the tax invoice came from QuickBooks and the order only carried
-- its number. From here the app issues it. A tax invoice is a legal record of
-- a supply, so it is **immutable**: everything printed on it — the customer as
-- they were named, every line, every price, the VAT rate — is copied onto the
-- invoice when it is issued and never read from the live tables again. Renaming
-- a store or repricing a product must not change an invoice the customer is
-- holding.
--
-- Mistakes are corrected the way the law expects: a credit note against the
-- invoice (CN-000001), never an edit. An invoice nobody has paid and nothing
-- has been credited against can be voided with a reason; it stays in the
-- register, marked void, so the number sequence has no unexplained gap.
--
-- What is invoiced: an order that has gone out. A dispatched order is invoiced
-- on what was dispatched; a delivered order on what was delivered less what
-- came back. Lines with nothing left are not printed. One live invoice per
-- order — voiding frees the order to be invoiced again.
--
-- Payments are recorded against the invoice. Paid / part-paid / unpaid is
-- worked out from them and from the credit notes, in `tax_invoice_balances`,
-- rather than stored, so the three can never disagree.
--
-- Who: the people who work orders (`warehouse`). Every write goes through a
-- definer function below; the tables themselves are read-only to clients.
--
-- ======================================================== recurring orders
--
-- A standing order for a store: the products, how often, and when next. Once a
-- day the scheduled job places every recurring order that is due as an
-- ordinary `new` order — the warehouse confirms it like any other, which is
-- the review step. If the job misses days, a recurring order is placed once
-- and its next date moved past today, rather than placing one order for every
-- missed day. `recurring_order_runs` is unique per recurring order and date,
-- so the job running twice on one day places nothing twice.

-- -------------------------------------------------------- company details

alter table public.organizations
  add column if not exists tax_number text,
  add column if not exists vat_number text,
  add column if not exists phone text,
  add column if not exists invoice_terms_days integer not null default 30,
  add column if not exists invoice_footer text;

alter table public.organizations drop constraint if exists organizations_invoice_terms_check;
alter table public.organizations add constraint organizations_invoice_terms_check
  check (invoice_terms_days between 0 and 365);

comment on column public.organizations.tax_number is 'Taxpayer identification number printed on tax invoices.';
comment on column public.organizations.vat_number is 'VAT registration number printed on tax invoices.';
comment on column public.organizations.invoice_footer is 'Printed at the foot of every invoice: bank details, payment instructions.';

-- Two more document series. `quote` is already live (20261007095715) and is
-- listed here so this constraint does not take it away again.
alter table public.document_counters drop constraint if exists document_counters_type_check;
alter table public.document_counters add constraint document_counters_type_check
  check (doc_type in ('goods_receipt', 'order', 'dispatch', 'transfer', 'adjustment',
                      'stocktake', 'disciplinary_case', 'quote',
                      'tax_invoice', 'credit_note'));

-- ------------------------------------------------------------- invoices

create table if not exists public.tax_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_number text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_number text not null,
  store_id uuid references public.stores(id) on delete set null,

  -- As printed. Frozen at issue.
  seller_name text not null,
  seller_address text,
  seller_tax_number text,
  seller_vat_number text,
  seller_phone text,
  seller_email text,
  customer_name text not null,
  customer_address text,
  footer text,

  issue_date date not null,
  due_date date not null,
  vat_rate numeric(6,3) not null,
  subtotal numeric(14,2) not null,
  vat numeric(14,2) not null,
  total numeric(14,2) not null,

  status text not null default 'issued',
  void_reason text,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tax_invoices_status_check check (status in ('issued', 'void')),
  constraint tax_invoices_void_reason check (status <> 'void' or void_reason is not null)
);

create unique index if not exists tax_invoices_number_key
  on public.tax_invoices (org_id, invoice_number);
-- One live invoice per order.
create unique index if not exists tax_invoices_live_order_key
  on public.tax_invoices (order_id) where status = 'issued';
create index if not exists tax_invoices_org_date_idx
  on public.tax_invoices (org_id, issue_date desc);

create table if not exists public.tax_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.tax_invoices(id) on delete cascade,
  position integer not null,
  product_id uuid references public.products(id) on delete set null,
  description text not null,
  sku text,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(14,2) not null
);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  credit_number text not null,
  invoice_id uuid not null references public.tax_invoices(id) on delete restrict,
  reason text not null,
  issue_date date not null,
  subtotal numeric(14,2) not null,
  vat numeric(14,2) not null,
  total numeric(14,2) not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists credit_notes_number_key
  on public.credit_notes (org_id, credit_number);

create table if not exists public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  invoice_line_id uuid not null references public.tax_invoice_lines(id) on delete restrict,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(14,2) not null
);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.tax_invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  method text not null default 'eft',
  reference text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_payments_method_check
    check (method in ('eft', 'cash', 'card', 'cheque', 'other'))
);

create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

-- Read-only to clients; the definer functions below are the only writers.
alter table public.tax_invoices enable row level security;
alter table public.tax_invoice_lines enable row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.invoice_payments enable row level security;

drop policy if exists tax_invoices_select on public.tax_invoices;
create policy tax_invoices_select on public.tax_invoices
  for select using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('warehouse'))
  );

drop policy if exists tax_invoice_lines_select on public.tax_invoice_lines;
create policy tax_invoice_lines_select on public.tax_invoice_lines
  for select using (
    exists (select 1 from public.tax_invoices i where i.id = tax_invoice_lines.invoice_id)
  );

drop policy if exists credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes
  for select using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('warehouse'))
  );

drop policy if exists credit_note_lines_select on public.credit_note_lines;
create policy credit_note_lines_select on public.credit_note_lines
  for select using (
    exists (select 1 from public.credit_notes c where c.id = credit_note_lines.credit_note_id)
  );

drop policy if exists invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments
  for select using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('warehouse'))
  );

grant select on public.tax_invoices, public.tax_invoice_lines, public.credit_notes,
  public.credit_note_lines, public.invoice_payments to authenticated;
revoke insert, update, delete on public.tax_invoices, public.tax_invoice_lines,
  public.credit_notes, public.credit_note_lines, public.invoice_payments
  from authenticated, anon;

-- Credited, paid and outstanding, worked out rather than stored. Invoker, so
-- the policies above decide who sees which rows.
create or replace view public.tax_invoice_balances
with (security_invoker = true) as
select i.id as invoice_id,
       coalesce((select sum(c.total) from public.credit_notes c where c.invoice_id = i.id), 0) as credited,
       coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = i.id), 0) as paid,
       case when i.status = 'void' then 0
            else i.total
                 - coalesce((select sum(c.total) from public.credit_notes c where c.invoice_id = i.id), 0)
                 - coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = i.id), 0)
       end as outstanding
from public.tax_invoices i;

grant select on public.tax_invoice_balances to authenticated;

-- --------------------------------------------------------------- issue

create or replace function public.tax_invoice_issue(p_order_id uuid, p_issue_date date default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- Invoiced in QuickBooks before the app issued invoices. A second invoice for
  -- the same supply is the one thing this must never do, so it refuses and
  -- names the number rather than quietly overwriting it.
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
    seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email,
    customer_name, customer_address, footer,
    issue_date, due_date, vat_rate, subtotal, vat, total, created_by
  ) values (
    v_org, v_number, o.id, o.order_number, o.store_id,
    coalesce(org.legal_name, org.name), org.address, org.tax_number, org.vat_number, org.phone, org.support_email,
    coalesce(s.name, 'Customer'),
    -- Read through jsonb so this works whether or not orders.delivery_address
    -- (20261007095133) is in the schema yet.
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
  -- Rounded once on the total, as orderTotals does, so the invoice agrees with
  -- the order screen to the cent.
  v_vat := round(v_subtotal * o.vat_rate / 100, 2);
  update public.tax_invoices set subtotal = v_subtotal, vat = v_vat, total = v_subtotal + v_vat
   where id = v_id;

  -- The order's invoice number is where every existing screen looks for it.
  update public.orders set invoice_number = v_number where id = o.id;

  return v_id;
end;
$$;

-- --------------------------------------------------------------- void

create or replace function public.tax_invoice_void(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.tax_invoices;
begin
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
$$;

-- -------------------------------------------------------- credit notes

/**
 * `p_lines` is `[{"invoice_line_id": "…", "qty": 2}, …]`. A line can never be
 * credited for more than was invoiced on it, counting earlier credit notes.
 */
create or replace function public.credit_note_issue(p_invoice_id uuid, p_reason text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.tax_invoices;
  v_id uuid;
  v_number text;
  v_subtotal numeric;
  v_vat numeric;
  l record;
begin
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

  for l in
    select x.invoice_line_id, x.qty, tl.qty as invoiced, tl.description,
           coalesce((select sum(cl.qty) from public.credit_note_lines cl where cl.invoice_line_id = tl.id), 0) as credited
    from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, qty integer)
    left join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id
    where x.qty > 0
  loop
    if l.invoiced is null then
      raise exception 'A line on this credit note is not on %.', i.invoice_number using errcode = '22023';
    end if;
    if l.qty + l.credited > l.invoiced then
      raise exception 'Only % of "%" is left to credit.', l.invoiced - l.credited, l.description
        using errcode = '22023';
    end if;
  end loop;

  v_number := public.next_document_number(i.org_id, 'credit_note', 'CN');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total, created_by)
  values (i.org_id, v_number, i.id, trim(p_reason),
          (now() at time zone public.org_timezone(i.org_id))::date, 0, 0, 0, auth.uid())
  returning id into v_id;

  insert into public.credit_note_lines (credit_note_id, invoice_line_id, qty, unit_price, line_total)
  select v_id, tl.id, x.qty, tl.unit_price, round(x.qty * tl.unit_price, 2)
  from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, qty integer)
  join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id
  where x.qty > 0;

  select coalesce(sum(line_total), 0) into v_subtotal from public.credit_note_lines where credit_note_id = v_id;
  if v_subtotal = 0 then
    raise exception 'Choose at least one line to credit.' using errcode = '22023';
  end if;
  v_vat := round(v_subtotal * i.vat_rate / 100, 2);
  update public.credit_notes set subtotal = v_subtotal, vat = v_vat, total = v_subtotal + v_vat where id = v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------ payments

create or replace function public.invoice_payment_record(
  p_invoice_id uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.tax_invoices;
  v_outstanding numeric;
  v_id uuid;
begin
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
$$;

create or replace function public.invoice_payment_delete(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('warehouse');
  delete from public.invoice_payments where id = p_payment_id and org_id = public.current_org_id();
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.tax_invoice_issue(uuid, date) from public, anon;
revoke all on function public.tax_invoice_void(uuid, text) from public, anon;
revoke all on function public.credit_note_issue(uuid, text, jsonb) from public, anon;
revoke all on function public.invoice_payment_record(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.invoice_payment_delete(uuid) from public, anon;
grant execute on function public.tax_invoice_issue(uuid, date) to authenticated;
grant execute on function public.tax_invoice_void(uuid, text) to authenticated;
grant execute on function public.credit_note_issue(uuid, text, jsonb) to authenticated;
grant execute on function public.invoice_payment_record(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.invoice_payment_delete(uuid) to authenticated;

-- ===================================================== recurring orders

create table if not exists public.recurring_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  store_id uuid not null references public.stores(id) on delete restrict,
  rep_id uuid references public.profiles(id) on delete set null,
  contact_name text,
  contact_phone text,
  frequency text not null,
  next_run date not null,
  max_runs integer check (max_runs is null or max_runs > 0),
  runs integer not null default 0,
  status text not null default 'active',
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_orders_frequency_check
    check (frequency in ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly')),
  constraint recurring_orders_status_check check (status in ('active', 'paused', 'ended'))
);

create index if not exists recurring_orders_due_idx
  on public.recurring_orders (next_run) where status = 'active';

create table if not exists public.recurring_order_lines (
  id uuid primary key default gen_random_uuid(),
  recurring_order_id uuid not null references public.recurring_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty integer not null check (qty > 0),
  -- Null means "the catalogue price on the day the order is placed".
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  unique (recurring_order_id, product_id)
);

create table if not exists public.recurring_order_runs (
  id uuid primary key default gen_random_uuid(),
  recurring_order_id uuid not null references public.recurring_orders(id) on delete cascade,
  run_date date not null,
  order_id uuid references public.orders(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  unique (recurring_order_id, run_date)
);

alter table public.orders
  add column if not exists recurring_order_id uuid references public.recurring_orders(id) on delete set null;

alter table public.recurring_orders enable row level security;
alter table public.recurring_order_lines enable row level security;
alter table public.recurring_order_runs enable row level security;

drop policy if exists recurring_orders_all on public.recurring_orders;
create policy recurring_orders_all on public.recurring_orders
  for all using (
    org_id = (select public.current_org_id()) and (select public.has_permission('warehouse'))
  ) with check (
    org_id = (select public.current_org_id()) and (select public.has_permission('warehouse'))
  );

drop policy if exists recurring_order_lines_all on public.recurring_order_lines;
create policy recurring_order_lines_all on public.recurring_order_lines
  for all using (
    exists (select 1 from public.recurring_orders r where r.id = recurring_order_lines.recurring_order_id)
  ) with check (
    exists (select 1 from public.recurring_orders r where r.id = recurring_order_lines.recurring_order_id)
  );

drop policy if exists recurring_order_runs_select on public.recurring_order_runs;
create policy recurring_order_runs_select on public.recurring_order_runs
  for select using (
    exists (select 1 from public.recurring_orders r where r.id = recurring_order_runs.recurring_order_id)
  );

grant select, insert, delete on public.recurring_orders to authenticated;
revoke update on public.recurring_orders from authenticated, anon;
-- `runs` and the org are the job's; everything else is the manager's.
grant update (name, store_id, rep_id, contact_name, contact_phone, frequency, next_run,
              max_runs, status, notes, updated_at) on public.recurring_orders to authenticated;
grant select, insert, update, delete on public.recurring_order_lines to authenticated;
grant select on public.recurring_order_runs to authenticated;
revoke insert, update, delete on public.recurring_order_runs from authenticated, anon;

create or replace function public.recurring_next_date(p_from date, p_frequency text)
returns date
language sql
immutable
as $$
  select case p_frequency
    when 'weekly' then p_from + 7
    when 'biweekly' then p_from + 14
    when 'monthly' then (p_from + interval '1 month')::date
    when 'bimonthly' then (p_from + interval '2 months')::date
    else (p_from + interval '3 months')::date
  end
$$;

/**
 * Places one recurring order as a new order, for `p_run_date`. Internal.
 *
 * Returns the order id, or null when this recurring order already ran that day.
 */
create or replace function public.recurring_order_place(p_id uuid, p_run_date date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.recurring_orders;
  v_order uuid;
  v_next date;
begin
  select * into r from public.recurring_orders where id = p_id for update;
  if not found or r.status <> 'active' then return null; end if;

  insert into public.recurring_order_runs (recurring_order_id, run_date)
  values (r.id, p_run_date)
  on conflict (recurring_order_id, run_date) do nothing;
  if not found then return null; end if;

  if not exists (select 1 from public.recurring_order_lines where recurring_order_id = r.id) then
    update public.recurring_order_runs set error = 'No products on this recurring order.'
     where recurring_order_id = r.id and run_date = p_run_date;
    return null;
  end if;

  insert into public.orders (
    org_id, order_number, store_id, source, received_via, contact_name, contact_phone,
    rep_id, notes, recurring_order_id, client_generated_id
  ) values (
    r.org_id, public.next_document_number(r.org_id, 'order', 'SO'), r.store_id,
    'warehouse_manual', 'other', r.contact_name, r.contact_phone, r.rep_id,
    concat_ws(E'\n', 'Recurring order: ' || r.name || '.', r.notes),
    r.id, gen_random_uuid()
  ) returning id into v_order;

  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  select r.org_id, v_order, l.product_id, l.qty,
         round(coalesce(l.unit_price,
                        p.shrink_price_excl_vat / nullif(p.units_per_shrink, 0)) * (1 - l.discount_pct / 100), 2),
         gen_random_uuid()
  from public.recurring_order_lines l
  join public.products p on p.id = l.product_id
  where l.recurring_order_id = r.id;

  update public.recurring_order_runs set order_id = v_order
   where recurring_order_id = r.id and run_date = p_run_date;

  -- Moved past the run date, however many dates were missed.
  v_next := r.next_run;
  while v_next <= p_run_date loop
    v_next := public.recurring_next_date(v_next, r.frequency);
  end loop;
  update public.recurring_orders
     set runs = runs + 1,
         next_run = v_next,
         status = case when max_runs is not null and runs + 1 >= max_runs then 'ended' else status end,
         updated_at = now()
   where id = r.id;
  return v_order;
end;
$$;

revoke all on function public.recurring_order_place(uuid, date) from public, anon, authenticated;

/**
 * The daily job: every active recurring order whose next date has come, across
 * every organisation, each on its own organisation's today. Called by the
 * Vercel cron with the service role; not callable by a signed-in user.
 */
create or replace function public.recurring_orders_run_due()
-- Output names deliberately unlike any column: an OUT parameter called
-- `order_id` would make every query below that names the column ambiguous.
returns table (placed_recurring_order uuid, placed_order uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_order uuid;
begin
  for r in
    select ro.id, (now() at time zone public.org_timezone(ro.org_id))::date as today
    from public.recurring_orders ro
    where ro.status = 'active'
      and ro.next_run <= (now() at time zone public.org_timezone(ro.org_id))::date
  loop
    begin
      v_order := public.recurring_order_place(r.id, r.today);
      if v_order is not null then
        placed_recurring_order := r.id;
        placed_order := v_order;
        return next;
      end if;
    exception when others then
      -- One broken recurring order must not stop the rest.
      insert into public.recurring_order_runs (recurring_order_id, run_date, error)
      values (r.id, r.today, sqlerrm)
      on conflict (recurring_order_id, run_date) do update set error = excluded.error;
    end;
  end loop;
end;
$$;

revoke all on function public.recurring_orders_run_due() from public, anon, authenticated;
grant execute on function public.recurring_orders_run_due() to service_role;

/** "Place it now" from the screen, for a manager who does not want to wait. */
create or replace function public.recurring_order_run_now(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_order uuid;
begin
  perform public.require_permission('warehouse');
  if not exists (select 1 from public.recurring_orders where id = p_id and org_id = v_org) then
    raise exception 'Recurring order not found.' using errcode = 'P0002';
  end if;
  v_order := public.recurring_order_place(p_id, (now() at time zone public.org_timezone(v_org))::date);
  if v_order is null then
    raise exception 'It has already been placed today, or it is not active.' using errcode = '22023';
  end if;
  return v_order;
end;
$$;

revoke all on function public.recurring_order_run_now(uuid) from public, anon;
grant execute on function public.recurring_order_run_now(uuid) to authenticated;
