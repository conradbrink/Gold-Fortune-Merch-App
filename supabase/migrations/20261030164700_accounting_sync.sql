-- Accounting sync: Tickd's invoices, credit notes and payments go into the
-- company's Sage Business Cloud Accounting (South Africa).
--
-- The add-on has been in the catalogue since 20261007112542 as "not built".
-- It stays not built here: Sage issues a live API key only after reviewing
-- calls made with the sandbox key, so until then the only companies that can
-- have it are ones switched on by hand on a test database. A later migration
-- marks it built and prices it.
--
-- ------------------------------------------------------------- the pieces
--
--   accounting_connections  one per company: which Sage company, which bank
--                           account receives payments, from which date
--                           documents are sent, and how sending is going.
--                           Managers with company_settings can read it.
--   accounting_secrets      the sealed sign-in (encrypted by the web app with
--                           ACCOUNTING_SECRET_KEY). Service role only.
--   accounting_links        Tickd row -> Sage record id, per Sage company, so
--                           nothing is sent twice and a payment can be
--                           removed again.
--   accounting_queue        one row per thing to send. Triggers on invoices,
--                           credit notes and payments fill it; the web app's
--                           cron (/api/cron/accounting) sends it.
--
-- ---------------------------------------------------------- what is queued
--
--   * An invoice issued on or after the connection's sync_from date, except
--     history imported from QuickBooks (source 'quickbooks').
--   * A credit note or payment on an invoice that is queued or sent.
--   * A payment deleted after it reached Sage: the Sage receipt is removed.
--   * An invoice voided after it reached Sage: Sage's API cannot void an
--     invoice, so the row fails at once with a message telling the office to
--     void it in Sage. Voided before it was sent, it is simply not sent.
--
-- Nothing is queued for a company without a connection, or with the add-on
-- switched off.
--
-- Rollback: supabase/rollback/20261030164700_accounting_sync.down.sql.
-- Suite: supabase/tests/accounting_sync.sql.

insert into public.module_dependencies (module_code, requires_code)
values ('accounting_sync', 'invoicing')
on conflict do nothing;

------------------------------------------------------------ the connection

create table public.accounting_connections (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  provider          text not null default 'sage_za' check (provider in ('sage_za')),
  -- 'password': a Sage login and password (the sandbox, until Sage issues
  -- client credentials); 'sage_id': signed in through Sage ID.
  sign_in           text not null check (sign_in in ('password', 'sage_id')),
  -- The Sage login, shown so the office knows whose access it is.
  sign_in_name      text check (sign_in_name is null or char_length(sign_in_name) <= 254),
  company_id        bigint not null check (company_id > 0),
  company_name      text not null check (char_length(company_name) between 1 and 200),
  bank_account_id   bigint check (bank_account_id is null or bank_account_id > 0),
  bank_account_name text check (bank_account_name is null or char_length(bank_account_name) <= 200),
  sync_from         date not null default current_date,
  -- Sage asks for no more than about 2,500 calls a day per company.
  calls_day         date,
  calls_today       integer not null default 0 check (calls_today >= 0),
  last_sent_at      timestamptz,
  last_error        text check (last_error is null or char_length(last_error) <= 500),
  -- Nothing is sent before this: an hour after Sage's rate limit, and for
  -- good ('infinity') when Sage refused the sign-in, until the office
  -- connects again. Sage locks a login for a day after 20 failed sign-ins in
  -- an hour, so a wrong password must not be tried again and again.
  paused_until      timestamptz,
  connected_by      uuid references public.profiles(id) on delete set null,
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.accounting_connections is
  'The Sage company a company sends its invoices to. Secrets live in accounting_secrets.';

alter table public.accounting_connections enable row level security;

create policy accounting_connections_select on public.accounting_connections for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));
create policy module_gate on public.accounting_connections as restrictive for all
  using ((select public.module_enabled('accounting_sync')))
  with check ((select public.module_enabled('accounting_sync')));

revoke all on public.accounting_connections from public, anon, authenticated;
grant select on public.accounting_connections to authenticated;
grant select, insert, update, delete on public.accounting_connections to service_role;

create trigger accounting_connections_set_updated_at before update on public.accounting_connections
  for each row execute function public.set_updated_at();

create table public.accounting_secrets (
  org_id     uuid primary key references public.accounting_connections(org_id) on delete cascade,
  -- AES-256-GCM, sealed and opened only by the web app's server code.
  sealed     text not null check (char_length(sealed) between 20 and 8000),
  updated_at timestamptz not null default now()
);
comment on table public.accounting_secrets is
  'The sealed Sage sign-in for a company. Service role only.';

alter table public.accounting_secrets enable row level security;
create policy module_gate on public.accounting_secrets as restrictive for all
  using ((select public.module_enabled('accounting_sync')))
  with check ((select public.module_enabled('accounting_sync')));
revoke all on public.accounting_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.accounting_secrets to service_role;

create trigger accounting_secrets_set_updated_at before update on public.accounting_secrets
  for each row execute function public.set_updated_at();

------------------------------------------------------------------ the links

create table public.accounting_links (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  provider   text not null default 'sage_za' check (provider in ('sage_za')),
  company_id bigint not null check (company_id > 0),
  -- 'allocation': the Sage allocation that ties a payment or credit note
  -- (local_id) to its invoice.
  kind       text not null check (kind in ('customer', 'item', 'invoice', 'credit_note', 'payment', 'allocation')),
  local_id   uuid not null,
  remote_id  bigint not null check (remote_id > 0),
  created_at timestamptz not null default now(),
  primary key (org_id, provider, company_id, kind, local_id)
);
comment on table public.accounting_links is
  'Which Sage record a Tickd store, product, invoice, credit note or payment became.';

alter table public.accounting_links enable row level security;
create policy accounting_links_select on public.accounting_links for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));
create policy module_gate on public.accounting_links as restrictive for all
  using ((select public.module_enabled('accounting_sync')))
  with check ((select public.module_enabled('accounting_sync')));
revoke all on public.accounting_links from public, anon, authenticated;
grant select on public.accounting_links to authenticated;
grant select, insert, update, delete on public.accounting_links to service_role;

------------------------------------------------------------------ the queue

create table public.accounting_queue (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null
                check (kind in ('invoice', 'credit_note', 'payment', 'payment_removed', 'invoice_voided')),
  local_id    uuid not null,
  -- What the office sees: the document number, or the invoice a payment was for.
  label       text not null check (char_length(label) between 1 and 120),
  -- For payment_removed: the Sage receipt to remove (the payment row is gone).
  remote_id   bigint check (remote_id is null or remote_id > 0),
  status      text not null default 'queued'
                check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts    integer not null default 0,
  last_error  text check (last_error is null or char_length(last_error) <= 500),
  -- A minute's grace, so an invoice and its lines are all written first.
  send_after  timestamptz not null default now() + interval '1 minute',
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, kind, local_id)
);
comment on table public.accounting_queue is
  'Invoices, credit notes and payments waiting to go to Sage, and how each went.';

create index accounting_queue_due_idx on public.accounting_queue (send_after) where status = 'queued';
create index accounting_queue_org_idx on public.accounting_queue (org_id, created_at desc);

alter table public.accounting_queue enable row level security;
create policy accounting_queue_select on public.accounting_queue for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));
create policy module_gate on public.accounting_queue as restrictive for all
  using ((select public.module_enabled('accounting_sync')))
  with check ((select public.module_enabled('accounting_sync')));
revoke all on public.accounting_queue from public, anon, authenticated;
grant select on public.accounting_queue to authenticated;
grant select, insert, update, delete on public.accounting_queue to service_role;

create trigger accounting_queue_set_updated_at before update on public.accounting_queue
  for each row execute function public.set_updated_at();

------------------------------------------------------------- queueing helpers

-- Whether a company sends to Sage: connected, and the add-on on. Read with the
-- company's id, not the caller's, because triggers run for whoever wrote.
create function public.accounting_sync_on(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.accounting_connections c where c.org_id = p_org)
     and exists (select 1 from public.company_modules m
                  where m.org_id = p_org and m.module_code = 'accounting_sync' and m.enabled);
$function$;

revoke all on function public.accounting_sync_on(uuid) from public, anon, authenticated;

-- Internal: queue one thing to send, once.
create function public.accounting_enqueue(p_org uuid, p_kind text, p_local uuid, p_label text,
                                          p_remote bigint default null)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  insert into public.accounting_queue (org_id, kind, local_id, label, remote_id)
  values (p_org, p_kind, p_local, left(coalesce(nullif(btrim(p_label), ''), p_kind), 120), p_remote)
  on conflict (org_id, kind, local_id) do nothing;
$function$;

revoke all on function public.accounting_enqueue(uuid, text, uuid, text, bigint) from public, anon, authenticated;

-- Whether an invoice is on its way to Sage, or there already.
create function public.accounting_invoice_going(p_org uuid, p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.accounting_queue q
                  where q.org_id = p_org and q.kind = 'invoice' and q.local_id = p_invoice
                    and q.status in ('queued', 'sending', 'sent', 'failed'));
$function$;

revoke all on function public.accounting_invoice_going(uuid, uuid) from public, anon, authenticated;

----------------------------------------------------------------- the triggers

create function public.accounting_after_invoice()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_from date;
  v_row public.accounting_queue;
begin
  if not public.accounting_sync_on(new.org_id) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select sync_from into v_from from public.accounting_connections where org_id = new.org_id;
    if new.status = 'issued' and new.source is distinct from 'quickbooks' and new.issue_date >= v_from then
      perform public.accounting_enqueue(new.org_id, 'invoice', new.id, new.invoice_number);
    end if;
    return null;
  end if;

  -- Voided.
  if old.status = 'issued' and new.status = 'void' then
    select * into v_row from public.accounting_queue
     where org_id = new.org_id and kind = 'invoice' and local_id = new.id;
    if not found then
      return null;
    end if;
    if v_row.status in ('queued', 'failed') then
      update public.accounting_queue set status = 'skipped', last_error = 'Voided before it was sent.'
       where id = v_row.id;
      update public.accounting_queue set status = 'skipped', last_error = 'Its invoice was voided.'
       where org_id = new.org_id and status in ('queued', 'failed')
         and ((kind = 'credit_note' and local_id in (select id from public.credit_notes where invoice_id = new.id))
           or (kind = 'payment' and local_id in (select id from public.invoice_payments where invoice_id = new.id)));
    else
      -- Sent, or being sent now: Sage keeps it, so the office must void it there.
      perform public.accounting_enqueue(new.org_id, 'invoice_voided', new.id, new.invoice_number);
    end if;
  end if;
  return null;
end;
$function$;

create trigger tax_invoices_accounting after insert or update of status on public.tax_invoices
  for each row execute function public.accounting_after_invoice();

create function public.accounting_after_credit_note()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if public.accounting_sync_on(new.org_id) and public.accounting_invoice_going(new.org_id, new.invoice_id) then
    perform public.accounting_enqueue(new.org_id, 'credit_note', new.id, new.credit_number);
  end if;
  return null;
end;
$function$;

create trigger credit_notes_accounting after insert on public.credit_notes
  for each row execute function public.accounting_after_credit_note();

create function public.accounting_after_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_number text;
  v_row public.accounting_queue;
  v_remote bigint;
begin
  if tg_op = 'INSERT' then
    if public.accounting_sync_on(new.org_id) and public.accounting_invoice_going(new.org_id, new.invoice_id) then
      select invoice_number into v_number from public.tax_invoices where id = new.invoice_id;
      perform public.accounting_enqueue(new.org_id, 'payment', new.id,
                                        'Payment on ' || coalesce(v_number, 'an invoice'));
    end if;
    return null;
  end if;

  -- Deleted.
  select * into v_row from public.accounting_queue
   where org_id = old.org_id and kind = 'payment' and local_id = old.id;
  if not found then
    return null;
  end if;
  if v_row.status in ('queued', 'failed') then
    update public.accounting_queue set status = 'skipped', last_error = 'Deleted before it was sent.'
     where id = v_row.id;
    return null;
  end if;
  select l.remote_id into v_remote
    from public.accounting_links l
   where l.org_id = old.org_id and l.kind = 'payment' and l.local_id = old.id
   order by l.created_at desc
   limit 1;
  if v_remote is not null or v_row.status = 'sending' then
    perform public.accounting_enqueue(old.org_id, 'payment_removed', old.id, v_row.label, v_remote);
  end if;
  return null;
end;
$function$;

create trigger invoice_payments_accounting after insert or delete on public.invoice_payments
  for each row execute function public.accounting_after_payment();

------------------------------------------------------ connecting (service role)

-- Queue what was issued since sync_from before the connection existed, or
-- since an earlier date the office chose. Returns how many were queued.
create function public.accounting_queue_since(p_org uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_from date;
  v_n integer := 0;
  v_added integer;
begin
  if not public.accounting_sync_on(p_org) then
    return 0;
  end if;
  select sync_from into v_from from public.accounting_connections where org_id = p_org;

  insert into public.accounting_queue (org_id, kind, local_id, label, send_after)
  select i.org_id, 'invoice', i.id, i.invoice_number, now()
    from public.tax_invoices i
   where i.org_id = p_org and i.status = 'issued' and i.source is distinct from 'quickbooks'
     and i.issue_date >= v_from
  on conflict (org_id, kind, local_id) do nothing;
  get diagnostics v_added = row_count;
  v_n := v_n + v_added;

  insert into public.accounting_queue (org_id, kind, local_id, label, send_after)
  select c.org_id, 'credit_note', c.id, c.credit_number, now()
    from public.credit_notes c
   where c.org_id = p_org and public.accounting_invoice_going(p_org, c.invoice_id)
  on conflict (org_id, kind, local_id) do nothing;
  get diagnostics v_added = row_count;
  v_n := v_n + v_added;

  insert into public.accounting_queue (org_id, kind, local_id, label, send_after)
  select p.org_id, 'payment', p.id, 'Payment on ' || i.invoice_number, now()
    from public.invoice_payments p
    join public.tax_invoices i on i.id = p.invoice_id
   where p.org_id = p_org and public.accounting_invoice_going(p_org, p.invoice_id)
  on conflict (org_id, kind, local_id) do nothing;
  get diagnostics v_added = row_count;
  return v_n + v_added;
end;
$function$;

revoke all on function public.accounting_queue_since(uuid) from public, anon, authenticated;
grant execute on function public.accounting_queue_since(uuid) to service_role;

------------------------------------------------------- sending (service role)

-- The order things of one invoice must reach Sage in when they fall due
-- together: the invoice, then its credit notes, then payments, then removals.
create function public.accounting_kind_rank(p_kind text)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case p_kind when 'invoice' then 0 when 'credit_note' then 1 when 'payment' then 2
                     when 'payment_removed' then 3 else 4 end;
$function$;

revoke all on function public.accounting_kind_rank(text) from public, anon, authenticated;

-- Take due rows, oldest first: at most p_per_company for any one company per
-- run (Sage allows about 100 calls a minute per company, and one document can
-- take several calls), and nothing for a company over its day's calls or
-- paused.
-- Documents of one invoice go in order: an invoice before its credit notes
-- and payments, a payment before its removal.
create function public.accounting_claim(p_limit integer default 60, p_per_company integer default 15,
                                        p_daily_calls integer default 2400)
returns setof public.accounting_queue
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.accounting_queue q
     set status = 'sending', attempts = q.attempts + 1, updated_at = now()
   where q.id in (
     select r.id from (
       select o.id, o.send_after,
              row_number() over (partition by o.org_id
                                 order by o.send_after, public.accounting_kind_rank(o.kind), o.created_at, o.id) as n,
              public.accounting_kind_rank(o.kind) as rank
         from public.accounting_queue o
         join public.accounting_connections c on c.org_id = o.org_id
        where o.status = 'queued' and o.send_after <= now()
          and (c.paused_until is null or c.paused_until <= now())
          and (c.calls_day is distinct from current_date or c.calls_today < p_daily_calls)
     ) r
      where r.n <= greatest(1, least(coalesce(p_per_company, 15), 50))
      order by r.send_after, r.rank, r.id
      limit greatest(1, least(coalesce(p_limit, 60), 200)))
     and q.status = 'queued'
  returning q.*;
$function$;

revoke all on function public.accounting_claim(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.accounting_claim(integer, integer, integer) to service_role;

-- The result of one send, and the calls it took. A failure is tried again
-- later (1, 5, 30 minutes, 2 then 6 hours) up to six attempts, unless Sage
-- refused it for good (p_permanent: wrong data does not get better). A
-- document whose invoice has not reached Sage yet, or a company paused
-- meanwhile, waits (p_wait) without spending an attempt. Something with
-- nothing left to do (a payment deleted meanwhile) is skipped (p_skip), with
-- p_error saying why.
create function public.accounting_finish(p_id uuid, p_ok boolean, p_remote_id bigint default null,
                                         p_error text default null, p_permanent boolean default false,
                                         p_calls integer default 1, p_wait boolean default false,
                                         p_skip boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  q public.accounting_queue;
  c public.accounting_connections;
  v_kind text;
begin
  select * into q from public.accounting_queue where id = p_id for update;
  if not found then
    return;
  end if;
  select * into c from public.accounting_connections where org_id = q.org_id for update;

  if found then
    update public.accounting_connections
       set calls_today = case when calls_day = current_date then calls_today else 0 end
                         + greatest(coalesce(p_calls, 0), 0),
           calls_day = current_date,
           last_sent_at = case when p_ok then now() else last_sent_at end,
           last_error = case when p_ok or p_skip then null when p_wait then last_error else left(p_error, 500) end
     where org_id = q.org_id;
  end if;

  if p_skip then
    update public.accounting_queue set status = 'skipped', last_error = left(p_error, 500) where id = p_id;
  elsif p_ok then
    update public.accounting_queue
       set status = 'sent', sent_at = now(), last_error = null,
           remote_id = coalesce(p_remote_id, remote_id)
     where id = p_id;
    v_kind := case q.kind when 'invoice' then 'invoice' when 'credit_note' then 'credit_note'
                          when 'payment' then 'payment' end;
    if v_kind is not null and p_remote_id is not null and c.org_id is not null then
      insert into public.accounting_links (org_id, provider, company_id, kind, local_id, remote_id)
      values (q.org_id, c.provider, c.company_id, v_kind, q.local_id, p_remote_id)
      on conflict (org_id, provider, company_id, kind, local_id) do update set remote_id = excluded.remote_id;
    elsif q.kind = 'payment_removed' then
      delete from public.accounting_links
       where org_id = q.org_id and kind in ('payment', 'allocation') and local_id = q.local_id;
    end if;
  elsif p_wait then
    update public.accounting_queue
       set status = 'queued', attempts = greatest(q.attempts - 1, 0), last_error = left(p_error, 500),
           send_after = now() + interval '5 minutes'
     where id = p_id;
  elsif q.attempts >= 6 or p_permanent then
    update public.accounting_queue set status = 'failed', last_error = left(p_error, 500) where id = p_id;
  else
    update public.accounting_queue
       set status = 'queued', last_error = left(p_error, 500),
           send_after = now() + (array[interval '1 minute', interval '5 minutes', interval '30 minutes',
                                       interval '2 hours', interval '6 hours'])[least(q.attempts, 5)]
     where id = p_id;
  end if;
end;
$function$;

revoke all on function public.accounting_finish(uuid, boolean, bigint, text, boolean, integer, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.accounting_finish(uuid, boolean, bigint, text, boolean, integer, boolean, boolean)
  to service_role;

----------------------------------------------------------- the office's retry

-- The office's answer to something that failed: "Try again" puts it back in
-- the queue now, with its attempts reset; for an invoice voided after it
-- reached Sage, "Done" records that it was voided in Sage too.
create function public.accounting_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_module('accounting_sync');
  perform public.require_permission('company_settings');
  perform public.require_writable();
  update public.accounting_queue
     set status = case when kind = 'invoice_voided' then 'skipped' else 'queued' end,
         attempts = case when kind = 'invoice_voided' then attempts else 0 end,
         send_after = now(),
         last_error = case when kind = 'invoice_voided' then 'Voided in Sage too.' end
   where id = p_id and org_id = public.current_org_id() and status = 'failed';
  if not found then
    raise exception 'Nothing to try again.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.accounting_retry(uuid) from public, anon;
grant execute on function public.accounting_retry(uuid) to authenticated;

------------------------------------------------------------- registration

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'accounting_connections', 'accounting_sync'),
  ('table', 'accounting_secrets', 'accounting_sync'),
  ('table', 'accounting_links', 'accounting_sync'),
  ('table', 'accounting_queue', 'accounting_sync'),
  ('function', 'accounting_retry', 'accounting_sync')
on conflict do nothing;
