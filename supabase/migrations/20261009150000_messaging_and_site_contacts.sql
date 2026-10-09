-- Stage 8.1 and 8.2: one outbox for every email Tickd sends, and the people
-- at each site who receive them.
--
-- * site_contacts: a name, an email and/or a phone per person at a site, and
--   whether they get the job reports (8.3). Every company, every trade.
-- * message_outbox: one row per email to send. Rows are only ever written by
--   the database (queue_email, called from other functions) or the server
--   (service role); nobody signed in writes them directly. A company's people
--   who manage its settings can read their own company's rows: what was sent,
--   to whom, and whether it arrived.
-- * message_suppressions: addresses that must not be emailed. org_id null for
--   every company (a hard bounce, a spam complaint), a company's own id when
--   the person asked that company to stop (POPIA: their choice, per sender).
-- * The server sends: /api/cron/messages claims due rows (claim_messages),
--   sends them through Brevo and records the result (finish_message). With no
--   Brevo key on the server nothing is sent and rows wait.
-- * send_test_email(): a settings manager emails themselves, to see the whole
--   path work before anything goes to a client.
--
-- Gold Fortune: nothing it has changes, and nothing is sent for it unless
-- someone at Gold Fortune asks for it.
--
-- Rollback: supabase/rollback/20261009150000_messaging_and_site_contacts.down.sql.

------------------------------------------------------------- site contacts

create table public.site_contacts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  store_id         uuid not null references public.stores(id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 120),
  email            text check (email is null or (length(email) <= 254 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone            text check (phone is null or phone ~ '^\+[0-9]{6,15}$'),
  role             text check (role is null or length(btrim(role)) between 1 and 60),
  receives_reports boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create index site_contacts_store_idx on public.site_contacts (store_id);
create index site_contacts_org_idx on public.site_contacts (org_id);

alter table public.site_contacts enable row level security;

-- Everyone in the company may see who to call at a site; the people who may
-- edit sites (managers) or manage the company's settings may change them.
create policy site_contacts_select on public.site_contacts for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy site_contacts_insert on public.site_contacts for insert to authenticated
  with check (org_id = (select public.current_org_id())
              and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings')))
              and exists (select 1 from public.stores s where s.id = store_id and s.org_id = org_id));
create policy site_contacts_update on public.site_contacts for update to authenticated
  using (org_id = (select public.current_org_id())
         and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings'))))
  with check (org_id = (select public.current_org_id())
              and exists (select 1 from public.stores s where s.id = store_id and s.org_id = org_id));
create policy site_contacts_delete on public.site_contacts for delete to authenticated
  using (org_id = (select public.current_org_id())
         and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings'))));

grant select, insert, update, delete on public.site_contacts to authenticated;

create trigger site_contacts_set_updated_at before update on public.site_contacts
  for each row execute function public.set_updated_at();

---------------------------------------------------------------- the outbox

create table public.message_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references public.organizations(id) on delete cascade,
  channel             text not null default 'email' check (channel in ('email')),
  to_address          text not null check (length(to_address) between 3 and 254),
  to_name             text,
  template            text not null check (template ~ '^[a-z_]{1,40}$'),
  payload             jsonb not null default '{}'::jsonb,
  related_kind        text check (related_kind is null or related_kind ~ '^[a-z_]{1,40}$'),
  related_id          uuid,
  status              text not null default 'queued'
                        check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed', 'cancelled')),
  attempts            integer not null default 0,
  last_error          text,
  provider_message_id text,
  send_after          timestamptz not null default now(),
  sent_at             timestamptz,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index message_outbox_due_idx on public.message_outbox (send_after) where status = 'queued';
create index message_outbox_org_idx on public.message_outbox (org_id, created_at desc);
create index message_outbox_related_idx on public.message_outbox (related_kind, related_id);
create index message_outbox_provider_idx on public.message_outbox (provider_message_id) where provider_message_id is not null;

alter table public.message_outbox enable row level security;

create policy message_outbox_select on public.message_outbox for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));

grant select on public.message_outbox to authenticated;

create trigger message_outbox_set_updated_at before update on public.message_outbox
  for each row execute function public.set_updated_at();

create table public.message_suppressions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade,
  address     text not null check (address = lower(btrim(address)) and length(address) between 3 and 254),
  reason      text not null check (reason in ('unsubscribed', 'hard_bounce', 'complaint', 'blocked')),
  created_at  timestamptz not null default now()
);

create unique index message_suppressions_one on public.message_suppressions (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), address);

alter table public.message_suppressions enable row level security;

create policy message_suppressions_select on public.message_suppressions for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('company_settings')));

grant select on public.message_suppressions to authenticated;

------------------------------------------------------------- queue and send

-- Whether an address may be emailed for a company: not suppressed for every
-- company, nor by that company.
create function public.email_allowed(p_org uuid, p_address text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select not exists (
    select 1 from public.message_suppressions s
     where s.address = lower(btrim(p_address))
       and (s.org_id is null or s.org_id = p_org)
  );
$function$;

revoke all on function public.email_allowed(uuid, text) from public, anon, authenticated;

-- Internal: other functions queue mail through this, never the browser. A
-- suppressed address is recorded as such rather than silently dropped, so the
-- company can see why a client got nothing.
create function public.queue_email(p_org uuid, p_to text, p_to_name text, p_template text, p_payload jsonb,
                                   p_related_kind text default null, p_related_id uuid default null,
                                   p_send_after timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_to text := lower(btrim(p_to));
begin
  insert into public.message_outbox (org_id, to_address, to_name, template, payload, related_kind, related_id,
                                     send_after, created_by, status)
  values (p_org, v_to, nullif(btrim(p_to_name), ''), p_template, coalesce(p_payload, '{}'::jsonb), p_related_kind,
          p_related_id, coalesce(p_send_after, now()), auth.uid(),
          case when public.email_allowed(p_org, v_to) then 'queued' else 'suppressed' end)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.queue_email(uuid, text, text, text, jsonb, text, uuid, timestamptz) from public, anon, authenticated;

-- The sender's half (service role only): take up to p_limit due rows, each by
-- one sender at a time, and mark them as being sent.
create function public.claim_messages(p_limit integer default 50)
returns setof public.message_outbox
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.message_outbox m
     set status = 'sending', attempts = m.attempts + 1, updated_at = now()
   where m.id in (select o.id from public.message_outbox o
                   where o.status = 'queued' and o.send_after <= now()
                   order by o.send_after, o.id
                   limit greatest(1, least(coalesce(p_limit, 50), 200))
                   for update skip locked)
  returning m.*;
$function$;

revoke all on function public.claim_messages(integer) from public, anon, authenticated;
grant execute on function public.claim_messages(integer) to service_role;

-- The result of one send. A failure is tried again later (1, 5, 30 minutes,
-- then 2 hours) up to five attempts, unless the provider refused it for good
-- (p_permanent: a bad address will not get better); an address that became
-- suppressed meanwhile is not sent at all.
create function public.finish_message(p_id uuid, p_ok boolean, p_provider_id text default null,
                                      p_error text default null, p_suppressed boolean default false,
                                      p_permanent boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  m public.message_outbox;
begin
  select * into m from public.message_outbox where id = p_id for update;
  if not found then
    return;
  end if;
  if p_suppressed then
    update public.message_outbox set status = 'suppressed', last_error = p_error where id = p_id;
  elsif p_ok then
    update public.message_outbox
       set status = 'sent', sent_at = now(), provider_message_id = p_provider_id, last_error = null
     where id = p_id;
  elsif m.attempts >= 5 or p_permanent then
    update public.message_outbox set status = 'failed', last_error = left(p_error, 500) where id = p_id;
  else
    update public.message_outbox
       set status = 'queued', last_error = left(p_error, 500),
           send_after = now() + (array[interval '1 minute', interval '5 minutes', interval '30 minutes',
                                       interval '2 hours'])[least(m.attempts, 4)]
     where id = p_id;
  end if;
end;
$function$;

revoke all on function public.finish_message(uuid, boolean, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.finish_message(uuid, boolean, text, text, boolean, boolean) to service_role;

-- Delivery news from Brevo (service role only): a hard bounce, complaint or
-- block stops every company emailing the address; an unsubscribe stops the
-- company that sent it.
create function public.record_message_event(p_provider_id text, p_event text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  m public.message_outbox;
  v_reason text := case p_event
                     when 'hard_bounce' then 'hard_bounce'
                     when 'spam' then 'complaint'
                     when 'complaint' then 'complaint'
                     when 'blocked' then 'blocked'
                     when 'unsubscribed' then 'unsubscribed'
                   end;
begin
  select * into m from public.message_outbox where provider_message_id = p_provider_id limit 1;
  if not found or v_reason is null then
    return;
  end if;
  if v_reason in ('hard_bounce', 'blocked') then
    update public.message_outbox set status = 'failed', last_error = p_event where id = m.id;
  end if;
  insert into public.message_suppressions (org_id, address, reason)
  values (case when v_reason = 'unsubscribed' then m.org_id end, m.to_address, v_reason)
  on conflict do nothing;
end;
$function$;

revoke all on function public.record_message_event(text, text) from public, anon, authenticated;
grant execute on function public.record_message_event(text, text) to service_role;

-- The unsubscribe link (service role only, after the server checked the
-- link's signature): this company stops emailing this address.
create function public.unsubscribe_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  m public.message_outbox;
begin
  select * into m from public.message_outbox where id = p_message_id;
  if not found then
    return null;
  end if;
  insert into public.message_suppressions (org_id, address, reason)
  values (m.org_id, m.to_address, 'unsubscribed')
  on conflict do nothing;
  update public.message_outbox set status = 'cancelled', last_error = 'unsubscribed'
   where org_id is not distinct from m.org_id and to_address = m.to_address and status = 'queued';
  return (select o.name from public.organizations o where o.id = m.org_id);
end;
$function$;

revoke all on function public.unsubscribe_message(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_message(uuid) to service_role;

-- A settings manager emails themselves, to see the path work.
create function public.send_test_email()
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_email text;
  v_name text;
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can send a test email.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(p.email), ''), u.email), p.full_name into v_email, v_name
    from public.profiles p left join auth.users u on u.id = p.id
   where p.id = auth.uid();
  if v_email is null or v_email ~* '@staff\.tickd\.co\.za$' then
    raise exception 'Your login has no email address to send to.' using errcode = '22023';
  end if;
  if (select count(*) from public.message_outbox
       where org_id = v_org and template = 'test' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Five test emails an hour is the limit. Try again later.' using errcode = '54000';
  end if;
  return public.queue_email(v_org, v_email, v_name, 'test', '{}'::jsonb);
end;
$function$;

revoke all on function public.send_test_email() from public, anon;
grant execute on function public.send_test_email() to authenticated;

------------------------------------------------------------- registration

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'site_contacts', 'core'),
  ('table', 'message_outbox', 'core'),
  ('table', 'message_suppressions', 'core'),
  ('function', 'send_test_email', 'core');

-- The billing gate's three policies on the new company table, where the gate
-- exists (production; its migration arrives with PR #91).
do $migration$
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  execute 'create policy billing_gate_insert on public.site_contacts as restrictive for insert to authenticated '
          'with check ((select public.company_writable()))';
  execute 'create policy billing_gate_update on public.site_contacts as restrictive for update to authenticated '
          'using ((select public.company_writable())) with check ((select public.company_writable()))';
  execute 'create policy billing_gate_delete on public.site_contacts as restrictive for delete to authenticated '
          'using ((select public.company_writable()))';
end;
$migration$;
