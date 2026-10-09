-- Sending money documents to the client (Stage 8.10): an invoice, a quote, a
-- statement, and a payment reminder, each as an email with a link to a page the
-- client opens without logging in (like the job report's), in the company's own
-- look, with the amount still to pay shown live.
--
-- * document_links: one row per thing a client can open: an invoice or a quote
--   (by id), or a statement (a client and a period). The id, signed by the
--   server, is the link. Valid for a year; withdrawn when the invoice is
--   voided (the view then returns null).
-- * document_sends: who it was sent to and when, for "Sent to ... · Opened ..."
--   and "Reminded 3 days ago". Written by the send functions only.
-- * The send functions (invoicing permission, company writable): queue one email
--   per address through the outbox (queue_email), so suppression, retries and
--   the "stop these emails" link all apply. Nothing is sent until Brevo is set up.
-- * Reminders are sent by a person, one client at a time: nothing here is
--   scheduled.
-- * site_contacts.receives_accounts: the people at a site who get invoices,
--   statements and reminders (next to receives_reports).
-- * For the server only (service role): document_link_view and
--   document_link_opened.
--
-- Rollback: supabase/rollback/20261009250000_send_documents.down.sql.

------------------------------------------------------------- accounts contacts

alter table public.site_contacts add column receives_accounts boolean not null default false;

---------------------------------------------------------------------- tables

create table public.document_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  kind           text not null check (kind in ('invoice', 'quote', 'statement')),
  invoice_id     uuid references public.tax_invoices(id) on delete cascade,
  quote_id       uuid references public.quotes(id) on delete cascade,
  store_id       uuid references public.stores(id) on delete cascade,
  customer_name  text,
  period_from    date,
  period_to      date,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '1 year',
  revoked_at     timestamptz,
  opened_at      timestamptz,
  last_opened_at timestamptz,
  open_count     integer not null default 0,
  check (case kind
           when 'invoice'   then invoice_id is not null and quote_id is null and store_id is null and customer_name is null
           when 'quote'     then quote_id is not null and invoice_id is null and store_id is null and customer_name is null
           else invoice_id is null and quote_id is null and period_from is not null and period_to is not null
                and period_from <= period_to and (store_id is not null) <> (customer_name is not null)
         end)
);

create index document_links_org_idx on public.document_links (org_id, created_at desc);
create index document_links_invoice_idx on public.document_links (invoice_id) where invoice_id is not null;
create index document_links_quote_idx on public.document_links (quote_id) where quote_id is not null;

create table public.document_sends (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  kind          text not null check (kind in ('invoice', 'quote', 'statement', 'reminder')),
  related_id    uuid,
  link_id       uuid not null references public.document_links(id) on delete cascade,
  store_id      uuid references public.stores(id) on delete cascade,
  customer_name text,
  to_address    text not null,
  outbox_id     uuid references public.message_outbox(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index document_sends_org_idx on public.document_sends (org_id, kind, created_at desc);
create index document_sends_related_idx on public.document_sends (related_id) where related_id is not null;

alter table public.document_links enable row level security;
alter table public.document_sends enable row level security;

create policy document_links_select on public.document_links for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('invoicing')));
create policy document_sends_select on public.document_sends for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('invoicing')));
create policy module_gate on public.document_links as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));
create policy module_gate on public.document_sends as restrictive for all
  using ((select public.module_enabled('invoicing'))) with check ((select public.module_enabled('invoicing')));

revoke all on public.document_links from anon, authenticated;
revoke all on public.document_sends from anon, authenticated;
grant select on public.document_links to authenticated;
grant select on public.document_sends to authenticated;

------------------------------------------------------------- internal helpers

-- The addresses to send to: trimmed, lower case, no repeats, each one an email
-- address, at most five, plus the caller's own when they asked for a copy.
create function public.document_recipients(p_to text[], p_copy_me boolean)
returns text[]
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out text[] := '{}';
  a text;
  v_me text;
begin
  foreach a in array coalesce(p_to, '{}'::text[]) loop
    a := lower(btrim(a));
    if a = '' then
      continue;
    end if;
    if length(a) > 254 or a !~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$' then
      raise exception '% is not an email address.', a using errcode = '22023';
    end if;
    if not (a = any (v_out)) then
      v_out := v_out || a;
    end if;
  end loop;
  if coalesce(array_length(v_out, 1), 0) = 0 then
    raise exception 'Add an email address to send to.' using errcode = '22023';
  end if;
  if array_length(v_out, 1) > 5 then
    raise exception 'Send to at most 5 addresses at a time.' using errcode = '22023';
  end if;
  if coalesce(p_copy_me, false) then
    select lower(btrim(p.email)) into v_me from public.profiles p where p.id = auth.uid();
    if v_me is not null and v_me <> '' and not (v_me = any (v_out)) then
      v_out := v_out || v_me;
    end if;
  end if;
  return v_out;
end;
$function$;

-- One email through the outbox, and the record that it was sent. Returns the
-- outbox row's status: queued, or suppressed for an address that must not be
-- emailed.
create function public.queue_document_email(
  p_org uuid, p_to text, p_to_name text, p_template text, p_payload jsonb,
  p_kind text, p_related uuid, p_link uuid, p_store uuid, p_name text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out uuid;
  v_status text;
begin
  v_out := public.queue_email(p_org, p_to, p_to_name, p_template, p_payload, p_kind, coalesce(p_related, p_link));
  select o.status into v_status from public.message_outbox o where o.id = v_out;
  insert into public.document_sends (org_id, kind, related_id, link_id, store_id, customer_name, to_address, outbox_id, created_by)
  values (p_org, p_kind, p_related, p_link, p_store, p_name, lower(btrim(p_to)), v_out, auth.uid());
  return v_status;
end;
$function$;

-- The link for a document, the one already made while it is still valid.
create function public.ensure_document_link(
  p_org uuid, p_kind text, p_invoice uuid, p_quote uuid, p_store uuid, p_name text, p_from date, p_to date)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
begin
  select l.id into v_id
    from public.document_links l
   where l.org_id = p_org and l.kind = p_kind and l.revoked_at is null and l.expires_at > now()
     and l.invoice_id is not distinct from p_invoice
     and l.quote_id is not distinct from p_quote
     and l.store_id is not distinct from p_store
     and lower(btrim(l.customer_name)) is not distinct from lower(btrim(p_name))
     and l.period_from is not distinct from p_from
     and l.period_to is not distinct from p_to
   order by l.created_at desc
   limit 1;
  if v_id is null then
    insert into public.document_links (org_id, kind, invoice_id, quote_id, store_id, customer_name, period_from, period_to, created_by)
    values (p_org, p_kind, p_invoice, p_quote, p_store, nullif(btrim(p_name), ''), p_from, p_to, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;

-- A client's statement, as client_statement writes it but for a given company
-- (for the page the client opens, where there is no signed-in person).
create function public.statement_rows(p_org uuid, p_store uuid, p_name text, p_from date, p_to date)
returns table (
  entry_date date, entry_kind text, document_number text, detail text,
  debit numeric, credit numeric, balance numeric, document_id uuid)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_name text := lower(btrim(p_name));
begin
  return query
  with mine as (
    select i.id, i.invoice_number, i.issue_date, i.total, i.reference
      from public.tax_invoices i
     where i.org_id = p_org and i.status = 'issued'
       and case when p_store is not null then i.store_id = p_store
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

-- What one client owes as at a date, in the ageing's columns.
create function public.statement_client_ageing(p_org uuid, p_store uuid, p_name text, p_as_of date)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with owed as (
    select i.due_date as due,
           i.total
             - coalesce((select sum(c.total) from public.credit_notes c
                          where c.invoice_id = i.id and c.issue_date <= p_as_of), 0)
             - coalesce((select sum(p.amount) from public.invoice_payments p
                          where p.invoice_id = i.id and p.paid_on <= p_as_of), 0) as amount
      from public.tax_invoices i
     where i.org_id = p_org and i.status = 'issued' and i.issue_date <= p_as_of
       and case when p_store is not null then i.store_id = p_store
                else i.store_id is null and lower(btrim(i.customer_name)) = lower(btrim(p_name)) end
  )
  select jsonb_build_object(
    'not_due',      coalesce(sum(o.amount) filter (where p_as_of - o.due <= 0), 0),
    'days_1_30',    coalesce(sum(o.amount) filter (where p_as_of - o.due between 1 and 30), 0),
    'days_31_60',   coalesce(sum(o.amount) filter (where p_as_of - o.due between 31 and 60), 0),
    'days_61_90',   coalesce(sum(o.amount) filter (where p_as_of - o.due between 61 and 90), 0),
    'days_over_90', coalesce(sum(o.amount) filter (where p_as_of - o.due > 90), 0),
    'total',        coalesce(sum(o.amount), 0))
    from owed o
   where o.amount > 0;
$function$;

-- A client's overdue invoices as at a date: what is still to pay on each.
create function public.client_overdue_invoices_for(p_org uuid, p_store uuid, p_name text, p_as_of date)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice_id', x.id, 'number', x.invoice_number, 'issue_date', x.issue_date, 'due_date', x.due_date,
           'total', x.total, 'outstanding', x.amount, 'days_overdue', p_as_of - x.due_date)
         order by x.due_date, x.invoice_number), '[]'::jsonb)
    from (
      select i.id, i.invoice_number, i.issue_date, i.due_date, i.total,
             i.total
               - coalesce((select sum(c.total) from public.credit_notes c
                            where c.invoice_id = i.id and c.issue_date <= p_as_of), 0)
               - coalesce((select sum(p.amount) from public.invoice_payments p
                            where p.invoice_id = i.id and p.paid_on <= p_as_of), 0) as amount
        from public.tax_invoices i
       where i.org_id = p_org and i.status = 'issued' and i.issue_date <= p_as_of
         and case when p_store is not null then i.store_id = p_store
                  else i.store_id is null and lower(btrim(i.customer_name)) = lower(btrim(p_name)) end
    ) x
   where x.amount > 0 and x.due_date < p_as_of;
$function$;

-- The client's name as the statement shows it: the place's name, else the name
-- on the invoices.
create function public.statement_client_name(p_org uuid, p_store uuid, p_name text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select s.name from public.stores s where s.id = p_store and s.org_id = p_org),
    (select min(i.customer_name) from public.tax_invoices i
      where i.org_id = p_org and i.store_id is null and lower(btrim(i.customer_name)) = lower(btrim(p_name))),
    btrim(p_name));
$function$;

revoke all on function public.document_recipients(text[], boolean) from public, anon, authenticated;
revoke all on function public.queue_document_email(uuid, text, text, text, jsonb, text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ensure_document_link(uuid, text, uuid, uuid, uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.statement_rows(uuid, uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.statement_client_ageing(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.client_overdue_invoices_for(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.statement_client_name(uuid, uuid, text) from public, anon, authenticated;

----------------------------------------------------------------- in the app

-- Overdue invoices of one client, for the reminder box.
create function public.client_overdue_invoices(p_store_id uuid, p_customer_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_store_id is null and nullif(btrim(p_customer_name), '') is null then
    raise exception 'Choose whose invoices these are.' using errcode = '22023';
  end if;
  return public.client_overdue_invoices_for(v_org, p_store_id, p_customer_name,
                                            (now() at time zone public.org_timezone(v_org))::date);
end;
$function$;

-- Send an invoice. Returns {link_id, queued, suppressed: [addresses]}.
create function public.send_invoice_email(
  p_invoice_id uuid, p_to text[], p_note text default null, p_copy_me boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  i public.tax_invoices;
  v_to text[];
  v_link uuid;
  v_payload jsonb;
  v_addr text;
  v_queued integer := 0;
  v_suppressed text[] := '{}';
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  select * into i from public.tax_invoices where id = p_invoice_id and org_id = v_org;
  if not found then
    raise exception 'That invoice was not found.' using errcode = 'P0002';
  end if;
  if i.status <> 'issued' then
    raise exception '% was voided, so it cannot be sent.', i.invoice_number using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note to 1,000 characters or fewer.' using errcode = '22023';
  end if;
  v_to := public.document_recipients(p_to, p_copy_me);
  v_link := public.ensure_document_link(v_org, 'invoice', i.id, null, null, null, null, null);
  v_payload := jsonb_build_object(
    'link_id', v_link, 'number', i.invoice_number, 'customer_name', i.customer_name,
    'total', i.total, 'issue_date', i.issue_date, 'due_date', i.due_date, 'reference', i.reference,
    'currency', public.org_setting(v_org, 'currency_code') #>> '{}',
    'company_name', (select coalesce(nullif(btrim(o.legal_name), ''), o.name) from public.organizations o where o.id = v_org),
    'note', v_note);
  foreach v_addr in array v_to loop
    if public.queue_document_email(v_org, v_addr, null, 'invoice', v_payload, 'invoice', i.id, v_link, null, null) = 'queued' then
      v_queued := v_queued + 1;
    else
      v_suppressed := v_suppressed || v_addr;
    end if;
  end loop;
  return jsonb_build_object('link_id', v_link, 'queued', v_queued, 'suppressed', to_jsonb(v_suppressed));
end;
$function$;

-- Send a quote, and mark a draft as sent. Same answer as send_invoice_email.
create function public.send_quote_email(
  p_quote_id uuid, p_to text[], p_note text default null, p_copy_me boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  q public.quotes;
  v_to text[];
  v_link uuid;
  v_sum numeric;
  v_t record;
  v_payload jsonb;
  v_addr text;
  v_queued integer := 0;
  v_suppressed text[] := '{}';
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  select * into q from public.quotes where id = p_quote_id and org_id = v_org;
  if not found then
    raise exception 'That quote was not found.' using errcode = 'P0002';
  end if;
  if q.status = 'declined' then
    raise exception '% was declined, so it cannot be sent.', q.quote_number using errcode = '22023';
  end if;
  if not exists (select 1 from public.quote_lines where quote_id = q.id) then
    raise exception 'Add at least one line to % before sending it.', q.quote_number using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note to 1,000 characters or fewer.' using errcode = '22023';
  end if;
  v_to := public.document_recipients(p_to, p_copy_me);
  v_link := public.ensure_document_link(v_org, 'quote', null, q.id, null, null, null, null);
  select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) into v_sum from public.quote_lines l where l.quote_id = q.id;
  select * into v_t from public.money_totals(v_sum, q.vat_rate, q.prices_include_vat);
  v_payload := jsonb_build_object(
    'link_id', v_link, 'number', q.quote_number,
    'customer_name', coalesce(q.customer_name, (select s.name from public.stores s where s.id = q.store_id)),
    'total', v_t.total, 'valid_until', q.valid_until,
    'currency', public.org_setting(v_org, 'currency_code') #>> '{}',
    'company_name', (select coalesce(nullif(btrim(o.legal_name), ''), o.name) from public.organizations o where o.id = v_org),
    'note', v_note);
  foreach v_addr in array v_to loop
    if public.queue_document_email(v_org, v_addr, q.contact_name, 'quote', v_payload, 'quote', q.id, v_link, null, null) = 'queued' then
      v_queued := v_queued + 1;
    else
      v_suppressed := v_suppressed || v_addr;
    end if;
  end loop;
  if q.status = 'draft' then
    update public.quotes set status = 'sent', sent_at = coalesce(sent_at, now()) where id = q.id;
  end if;
  return jsonb_build_object('link_id', v_link, 'queued', v_queued, 'suppressed', to_jsonb(v_suppressed));
end;
$function$;

-- Send a client's statement for a period.
create function public.send_statement_email(
  p_store_id uuid, p_customer_name text, p_from date, p_to date, p_to_addrs text[],
  p_note text default null, p_copy_me boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_name text := nullif(btrim(p_customer_name), '');
  v_to text[];
  v_link uuid;
  v_closing numeric;
  v_payload jsonb;
  v_addr text;
  v_queued integer := 0;
  v_suppressed text[] := '{}';
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if (p_store_id is null) = (v_name is null) then
    raise exception 'Choose whose statement this is.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100 then
    raise exception 'Choose the statement''s dates.' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (select 1 from public.stores s where s.id = p_store_id and s.org_id = v_org) then
    raise exception 'That client was not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.tax_invoices i
     where i.org_id = v_org and i.status = 'issued'
       and case when p_store_id is not null then i.store_id = p_store_id
                else i.store_id is null and lower(btrim(i.customer_name)) = lower(v_name) end) then
    raise exception 'There are no invoices for that client yet.' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note to 1,000 characters or fewer.' using errcode = '22023';
  end if;
  v_to := public.document_recipients(p_to_addrs, p_copy_me);
  v_link := public.ensure_document_link(v_org, 'statement', null, null, p_store_id, v_name, p_from, p_to);
  select x.balance into v_closing
    from public.statement_rows(v_org, p_store_id, v_name, p_from, p_to) with ordinality as x
   order by x.ordinality desc limit 1;
  v_payload := jsonb_build_object(
    'link_id', v_link, 'client_name', public.statement_client_name(v_org, p_store_id, v_name),
    'from', p_from, 'to', p_to, 'balance', coalesce(v_closing, 0),
    'ageing', public.statement_client_ageing(v_org, p_store_id, v_name, p_to),
    'currency', public.org_setting(v_org, 'currency_code') #>> '{}',
    'company_name', (select coalesce(nullif(btrim(o.legal_name), ''), o.name) from public.organizations o where o.id = v_org),
    'note', v_note);
  foreach v_addr in array v_to loop
    if public.queue_document_email(v_org, v_addr, null, 'statement', v_payload, 'statement', null, v_link,
                                   p_store_id, v_name) = 'queued' then
      v_queued := v_queued + 1;
    else
      v_suppressed := v_suppressed || v_addr;
    end if;
  end loop;
  return jsonb_build_object('link_id', v_link, 'queued', v_queued, 'suppressed', to_jsonb(v_suppressed));
end;
$function$;

-- Remind a client of what is overdue: one email listing every overdue invoice,
-- with a link to their statement. Sent by a person, never on a schedule.
create function public.send_payment_reminder(
  p_store_id uuid, p_customer_name text, p_to_addrs text[], p_tone text, p_message text,
  p_copy_me boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_name text := nullif(btrim(p_customer_name), '');
  v_today date := (now() at time zone public.org_timezone(public.current_org_id()))::date;
  v_overdue jsonb;
  v_to text[];
  v_link uuid;
  v_from date;
  v_payload jsonb;
  v_addr text;
  v_queued integer := 0;
  v_suppressed text[] := '{}';
  v_message text := nullif(btrim(p_message), '');
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if (p_store_id is null) = (v_name is null) then
    raise exception 'Choose whose reminder this is.' using errcode = '22023';
  end if;
  if p_tone is null or p_tone not in ('friendly', 'firm', 'final') then
    raise exception 'Choose a tone: friendly, firm or final notice.' using errcode = '22023';
  end if;
  if v_message is null or length(v_message) > 2000 then
    raise exception 'Write a message of up to 2,000 characters.' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (select 1 from public.stores s where s.id = p_store_id and s.org_id = v_org) then
    raise exception 'That client was not found.' using errcode = 'P0002';
  end if;
  v_overdue := public.client_overdue_invoices_for(v_org, p_store_id, v_name, v_today);
  if jsonb_array_length(v_overdue) = 0 then
    raise exception 'This client has nothing overdue.' using errcode = '22023';
  end if;
  v_to := public.document_recipients(p_to_addrs, p_copy_me);
  select min((e ->> 'issue_date')::date) into v_from from jsonb_array_elements(v_overdue) e;
  v_link := public.ensure_document_link(v_org, 'statement', null, null, p_store_id, v_name, v_from, v_today);
  v_payload := jsonb_build_object(
    'link_id', v_link, 'client_name', public.statement_client_name(v_org, p_store_id, v_name),
    'tone', p_tone, 'message', v_message, 'today', v_today,
    'total_overdue', (select coalesce(sum((e ->> 'outstanding')::numeric), 0) from jsonb_array_elements(v_overdue) e),
    'invoices', (select jsonb_agg(jsonb_build_object('number', e -> 'number', 'due_date', e -> 'due_date',
                                                      'outstanding', e -> 'outstanding', 'days_overdue', e -> 'days_overdue'))
                   from jsonb_array_elements(v_overdue) e),
    'currency', public.org_setting(v_org, 'currency_code') #>> '{}',
    'company_name', (select coalesce(nullif(btrim(o.legal_name), ''), o.name) from public.organizations o where o.id = v_org));
  foreach v_addr in array v_to loop
    if public.queue_document_email(v_org, v_addr, null, 'payment_reminder', v_payload, 'reminder', null, v_link,
                                   p_store_id, v_name) = 'queued' then
      v_queued := v_queued + 1;
    else
      v_suppressed := v_suppressed || v_addr;
    end if;
  end loop;
  return jsonb_build_object('link_id', v_link, 'queued', v_queued, 'suppressed', to_jsonb(v_suppressed),
                            'invoices', jsonb_array_length(v_overdue));
end;
$function$;

-- Who a document was sent to, newest first: for one invoice or quote (by id), or
-- for a client's statements or reminders (by place or name).
create function public.document_sends_for(
  p_kind text, p_related_id uuid default null, p_store_id uuid default null, p_customer_name text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_kind is null or p_kind not in ('invoice', 'quote', 'statement', 'reminder') then
    raise exception 'Choose invoice, quote, statement or reminder.' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'to', s.to_address, 'sent_on', s.created_at, 'status', o.status,
             'sent_at', o.sent_at, 'error', o.last_error,
             'opened_at', l.opened_at, 'open_count', l.open_count)
           order by s.created_at desc), '[]'::jsonb)
      from public.document_sends s
      join public.document_links l on l.id = s.link_id
      left join public.message_outbox o on o.id = s.outbox_id
     where s.org_id = v_org and s.kind = p_kind
       and (p_related_id is null or s.related_id = p_related_id)
       and (p_store_id is null or s.store_id = p_store_id)
       and (nullif(btrim(p_customer_name), '') is null or lower(btrim(s.customer_name)) = lower(btrim(p_customer_name)))
  );
end;
$function$;

-- The latest send of each document or client of a kind: for the "Sent" column,
-- "Last sent" and "Reminded 3 days ago". Keyed by related_id (invoice, quote)
-- or by store_id / customer_name (statement, reminder).
create function public.document_send_summary(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_kind is null or p_kind not in ('invoice', 'quote', 'statement', 'reminder') then
    raise exception 'Choose invoice, quote, statement or reminder.' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(g) order by g.last_sent_at desc), '[]'::jsonb)
      from (
        select s.related_id, s.store_id, min(s.customer_name) as customer_name,
               max(s.created_at) as last_sent_at,
               (array_agg(o.status order by s.created_at desc))[1] as last_status,
               max(l.opened_at) as last_opened_at,
               count(*)::integer as sends
          from public.document_sends s
          join public.document_links l on l.id = s.link_id
          left join public.message_outbox o on o.id = s.outbox_id
         where s.org_id = v_org and s.kind = p_kind
         group by s.related_id, s.store_id, lower(btrim(s.customer_name))
      ) g
  );
end;
$function$;

------------------------------------------------------------- for the server

-- Everything the client's page shows, or null when the link is unknown, expired,
-- withdrawn, or its invoice was voided. Service role only: the server checked
-- the signature first.
create function public.document_link_view(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  l public.document_links;
  i public.tax_invoices;
  q public.quotes;
  v_org uuid;
  v_company jsonb;
  v_look jsonb;
  v_body jsonb;
  v_sum numeric;
  v_t record;
  v_name text;
begin
  select * into l from public.document_links where id = p_link_id;
  if not found or l.revoked_at is not null or l.expires_at < now() then
    return null;
  end if;
  v_org := l.org_id;
  select jsonb_build_object(
           'name', coalesce(nullif(btrim(o.legal_name), ''), o.name), 'address', o.address, 'phone', o.phone,
           'email', o.support_email, 'vat_number', o.vat_number, 'tax_number', o.tax_number,
           'registration_number', o.registration_number, 'logo_path', o.logo_path, 'bank_details', o.bank_details)
    into v_company from public.organizations o where o.id = v_org;
  v_look := jsonb_build_object(
    'style', public.org_setting(v_org, 'document_style') #>> '{}',
    'primary', public.org_setting(v_org, 'brand_primary_color') #>> '{}',
    'accent', public.org_setting(v_org, 'brand_accent_color') #>> '{}',
    'currency', public.org_setting(v_org, 'currency_code') #>> '{}');

  if l.kind = 'invoice' then
    select * into i from public.tax_invoices where id = l.invoice_id;
    if not found or i.status <> 'issued' then
      return null;
    end if;
    v_body := jsonb_build_object(
      'invoice', to_jsonb(i) - 'created_by' - 'voided_by',
      'lines', (select coalesce(jsonb_agg(to_jsonb(tl) order by tl.position, tl.id), '[]'::jsonb)
                  from public.tax_invoice_lines tl where tl.invoice_id = i.id),
      'credit_notes', (select coalesce(jsonb_agg(to_jsonb(c) - 'created_by' order by c.issue_date, c.credit_number), '[]'::jsonb)
                         from public.credit_notes c where c.invoice_id = i.id),
      'payments', (select coalesce(jsonb_agg(to_jsonb(p) - 'created_by' order by p.paid_on, p.created_at), '[]'::jsonb)
                     from public.invoice_payments p where p.invoice_id = i.id),
      'paid', (select coalesce(sum(p.amount), 0) from public.invoice_payments p where p.invoice_id = i.id),
      'credited', (select coalesce(sum(c.total), 0) from public.credit_notes c where c.invoice_id = i.id),
      'outstanding', i.total
                     - (select coalesce(sum(p.amount), 0) from public.invoice_payments p where p.invoice_id = i.id)
                     - (select coalesce(sum(c.total), 0) from public.credit_notes c where c.invoice_id = i.id));
  elsif l.kind = 'quote' then
    select * into q from public.quotes where id = l.quote_id;
    if not found then
      return null;
    end if;
    select coalesce(sum(round(x.qty * x.unit_price, 2)), 0) into v_sum from public.quote_lines x where x.quote_id = q.id;
    select * into v_t from public.money_totals(v_sum, q.vat_rate, q.prices_include_vat);
    v_body := jsonb_build_object(
      'quote', to_jsonb(q) - 'created_by' - 'rep_id',
      'customer_name', coalesce(q.customer_name, (select s.name from public.stores s where s.id = q.store_id)),
      'customer_address', coalesce(q.customer_address, q.delivery_address,
                                   (select nullif(concat_ws(', ', nullif(btrim(s.address), ''), nullif(btrim(s.city), '')), '')
                                      from public.stores s where s.id = q.store_id)),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                   'position', x.position, 'description', coalesce(x.description, p.name), 'sku', p.sku_code, 'brand', p.brand, 'unit', x.unit,
                   'qty', x.qty, 'list_price', x.list_price, 'discount_pct', x.discount_pct,
                   'discount_amount', x.discount_amount, 'unit_price', x.unit_price)
                 order by x.position nulls last, x.created_at, x.id), '[]'::jsonb)
                  from public.quote_lines x left join public.products p on p.id = x.product_id
                 where x.quote_id = q.id),
      'subtotal', v_t.subtotal, 'vat', v_t.vat, 'total', v_t.total);
  else
    v_name := public.statement_client_name(v_org, l.store_id, l.customer_name);
    v_body := jsonb_build_object(
      'statement', jsonb_build_object(
        'client_name', v_name,
        'client_address', coalesce(
          (select nullif(concat_ws(', ', nullif(btrim(s.address), ''), nullif(btrim(s.city), '')), '')
             from public.stores s where s.id = l.store_id),
          (select i2.customer_address from public.tax_invoices i2
            where i2.org_id = v_org and i2.store_id is null and lower(btrim(i2.customer_name)) = lower(btrim(l.customer_name))
            order by i2.issue_date desc limit 1)),
        'from', l.period_from, 'to', l.period_to,
        'rows', (select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb)
                   from public.statement_rows(v_org, l.store_id, l.customer_name, l.period_from, l.period_to)
                        with ordinality as r),
        'ageing', public.statement_client_ageing(v_org, l.store_id, l.customer_name, l.period_to)));
  end if;

  return jsonb_build_object(
    'link_id', l.id, 'kind', l.kind, 'company', v_company, 'look', v_look,
    'timezone', public.org_timezone(v_org)) || v_body;
end;
$function$;

-- Counts one opening of the page.
create function public.document_link_opened(p_link_id uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.document_links
     set opened_at = coalesce(opened_at, now()), last_opened_at = now(), open_count = open_count + 1
   where id = p_link_id and revoked_at is null and expires_at >= now();
$function$;

------------------------------------------------------------------- grants

revoke all on function public.client_overdue_invoices(uuid, text) from public, anon;
revoke all on function public.send_invoice_email(uuid, text[], text, boolean) from public, anon;
revoke all on function public.send_quote_email(uuid, text[], text, boolean) from public, anon;
revoke all on function public.send_statement_email(uuid, text, date, date, text[], text, boolean) from public, anon;
revoke all on function public.send_payment_reminder(uuid, text, text[], text, text, boolean) from public, anon;
revoke all on function public.document_sends_for(text, uuid, uuid, text) from public, anon;
revoke all on function public.document_send_summary(text) from public, anon;
revoke all on function public.document_link_view(uuid) from public, anon, authenticated;
revoke all on function public.document_link_opened(uuid) from public, anon, authenticated;
grant execute on function public.client_overdue_invoices(uuid, text) to authenticated;
grant execute on function public.send_invoice_email(uuid, text[], text, boolean) to authenticated;
grant execute on function public.send_quote_email(uuid, text[], text, boolean) to authenticated;
grant execute on function public.send_statement_email(uuid, text, date, date, text[], text, boolean) to authenticated;
grant execute on function public.send_payment_reminder(uuid, text, text[], text, text, boolean) to authenticated;
grant execute on function public.document_sends_for(text, uuid, uuid, text) to authenticated;
grant execute on function public.document_send_summary(text) to authenticated;
grant execute on function public.document_link_view(uuid) to service_role;
grant execute on function public.document_link_opened(uuid) to service_role;

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'document_links', 'invoicing'),
  ('table', 'document_sends', 'invoicing'),
  ('function', 'client_overdue_invoices', 'invoicing'),
  ('function', 'send_invoice_email', 'invoicing'),
  ('function', 'send_quote_email', 'invoicing'),
  ('function', 'send_statement_email', 'invoicing'),
  ('function', 'send_payment_reminder', 'invoicing'),
  ('function', 'document_sends_for', 'invoicing'),
  ('function', 'document_send_summary', 'invoicing');
