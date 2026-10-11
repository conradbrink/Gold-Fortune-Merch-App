-- Closing a company, from the Control Centre.
--
-- Why: the owner (11 Oct 2026) asked for a way to remove a company. Closing
-- is the reversible kind: its people can't sign in to the web dashboard or
-- the app, nothing is sent on its behalf, it drops out of the Control
-- Centre's counts, and every record is kept so it can be reopened as it was.
-- Deleting for good is a separate, later decision.
--
--   company_account.closed_at       when it was closed (null = open), by whom
--                    closed_by      and why (closed_reason, optional). The
--                    closed_reason  billing status it had is kept in
--                    status_before_close   status_before_close.
--   status = 'cancelled'            while closed. Every scheduled job that
--                                   writes or sends for a company (alerts,
--                                   job reports, contract reminders, the
--                                   trial offer) already skips cancelled and
--                                   read-only companies, so closing stops
--                                   them all with no change to any of them.
--                                   Reopening puts the old status back.
--   current_org_id(), "current_role"(), has_permission(), my_permissions()
--                                   no longer recognise a person whose company
--                                   is closed. Every RLS policy funnels through
--                                   these (the same move as is_active in
--                                   20260727203059), so one change covers the
--                                   web dashboard, the app and the API: the
--                                   person signs in, and is shown nothing.
--   my_company_closed()             for the person signed in: their company's
--                                   name and when it closed, or null. The web
--                                   dashboard and the app use it to explain,
--                                   instead of showing an empty screen.
--   platform_set_company_closed()   the Control Centre's close and reopen, in
--                                   one transaction with its audit row. Also
--                                   cancels messages still queued for the
--                                   company. Service role only.
--
-- Rollback: supabase/rollback/20261011090000_close_company.down.sql.

alter table public.company_account
  add column closed_at           timestamptz,
  add column closed_by           uuid references auth.users (id) on delete set null,
  add column closed_reason       text check (closed_reason is null or char_length(closed_reason) <= 500),
  add column status_before_close text;

comment on column public.company_account.closed_at is
  'When the company was closed from the Control Centre (null = open). While closed its people are refused everywhere (current_org_id()) and its status is cancelled.';
comment on column public.company_account.status_before_close is
  'The billing status the company had when it was closed, put back when it is reopened.';

-- The four helpers every policy and permission check goes through. Same
-- bodies as before, plus "and the company isn't closed".

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.org_id from public.profiles p
   where p.id = auth.uid() and p.is_active
     and not exists (select 1 from public.company_account ca
                      where ca.org_id = p.org_id and ca.closed_at is not null)
$$;

create or replace function public."current_role"()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.role from public.profiles p
   where p.id = auth.uid() and p.is_active
     and not exists (select 1 from public.company_account ca
                      where ca.org_id = p.org_id and ca.closed_at is not null)
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.profile_permissions pp
      join public.profiles p on p.id = pp.profile_id
     where pp.profile_id = auth.uid()
       and p.is_active
       and pp.permission_code in (p_code, 'admin')
       and not exists (select 1 from public.company_account ca
                        where ca.org_id = p.org_id and ca.closed_at is not null)
  )
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(pp.permission_code order by pp.permission_code), '{}')
    from public.profile_permissions pp
    join public.profiles p on p.id = pp.profile_id
   where pp.profile_id = auth.uid() and p.is_active
     and not exists (select 1 from public.company_account ca
                      where ca.org_id = p.org_id and ca.closed_at is not null)
$$;

-- What the person signed in is told. Only their own company, only whether it
-- is closed: nothing else about it is readable once it is.
create or replace function public.my_company_closed()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('name', btrim(o.name), 'closed_at', ca.closed_at)
    from public.profiles p
    join public.company_account ca on ca.org_id = p.org_id and ca.closed_at is not null
    join public.organizations o on o.id = p.org_id
   where p.id = auth.uid()
$$;

revoke all on function public.my_company_closed() from public, anon;
grant execute on function public.my_company_closed() to authenticated, service_role;

comment on function public.my_company_closed() is
  'For the person signed in: their company''s name and when it was closed, or null when it is open. Lets the apps explain a closed company instead of showing nothing.';

-- Close or reopen, with its audit row, in one transaction. The caller (the
-- Control Centre's server action) has already checked is_platform_admin()
-- for p_actor.
create or replace function public.platform_set_company_closed(
  p_org    uuid,
  p_closed boolean,
  p_actor  uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_account   public.company_account%rowtype;
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_cancelled integer := 0;
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    return jsonb_build_object('changed', false, 'reason', 'no_company');
  end if;

  insert into public.company_account (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into v_account from public.company_account where org_id = p_org for update;

  if p_closed = (v_account.closed_at is not null) then
    return jsonb_build_object('changed', false, 'reason', case when p_closed then 'already_closed' else 'already_open' end);
  end if;

  if p_closed then
    update public.company_account
       set closed_at = now(), closed_by = p_actor, closed_reason = left(v_reason, 500),
           status_before_close = v_account.status, status = 'cancelled', updated_at = now()
     where org_id = p_org;
    -- Nothing more goes out on its behalf, including what was already waiting.
    update public.message_outbox
       set status = 'cancelled', last_error = 'company closed', updated_at = now()
     where org_id = p_org and status = 'queued';
    get diagnostics v_cancelled = row_count;
  else
    update public.company_account
       set closed_at = null, closed_by = null, closed_reason = null,
           status = coalesce(v_account.status_before_close, 'trial'), status_before_close = null,
           updated_at = now()
     where org_id = p_org;
  end if;

  insert into public.platform_audit_log (actor_id, action, target_org_id, detail)
  values (p_actor, case when p_closed then 'company.close' else 'company.reopen' end, p_org,
          jsonb_strip_nulls(jsonb_build_object(
            'reason', case when p_closed then left(v_reason, 500) end,
            'status_from', v_account.status,
            'status_to', case when p_closed then 'cancelled' else coalesce(v_account.status_before_close, 'trial') end,
            'messages_cancelled', case when p_closed then v_cancelled end,
            'closed_since', case when not p_closed then v_account.closed_at end)));

  return jsonb_build_object('changed', true, 'messages_cancelled', v_cancelled);
end;
$function$;

revoke all on function public.platform_set_company_closed(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.platform_set_company_closed(uuid, boolean, uuid, text) to service_role;

comment on function public.platform_set_company_closed(uuid, boolean, uuid, text) is
  'Control Centre: close (people refused, status cancelled, queued messages cancelled) or reopen a company, with its audit row, in one transaction. Service role only.';
