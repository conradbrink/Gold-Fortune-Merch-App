-- A free trial confirms its email address before it emails clients.
--
-- Sign-up creates the owner's login already confirmed, so a throwaway or
-- someone else's address could start a trial and, within the daily limit
-- (20261010230000), email any address through Tickd's domain. The owner
-- chose (10 Oct 2026) to keep the trial instant and hold client email
-- instead: an owner gets straight in, and their company's email to clients
-- waits until they open the link we send them.
--
-- * `company_account.email_confirmed_at`. Every existing company is treated
--   as confirmed from now, so nobody already signed up is stopped.
-- * Until it is set, a trial company's client mail is held back:
--   `queue_document_email` (the Send buttons) refuses with the reason, and
--   `queue_email` records automatic client mail (job reports) as cancelled.
--   Mail to the company's own people goes as before: the confirmation
--   itself, test emails, alerts. Paid and exempt companies are never held.
-- * `confirm_company_email(org)`: the server, after checking the link's
--   signature (`/c/confirm/<token>`). Not callable by clients.
-- * `my_email_confirmation()` for the dashboard banner, and
--   `request_email_confirmation()` for "Send it again": at most one every
--   five minutes, to the caller's own login address.
--
-- Bodies are patched in place; the rollback reverses each patch, drops the
-- new functions and the column.

alter table public.company_account add column email_confirmed_at timestamptz;
update public.company_account set email_confirmed_at = now() where email_confirmed_at is null;

create or replace function public.email_confirmation_needed(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.company_account a
                  where a.org_id = p_org and a.status = 'trial' and a.email_confirmed_at is null);
$function$;

create or replace function public.confirm_company_email(p_org uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.company_account
     set email_confirmed_at = coalesce(email_confirmed_at, now())
   where org_id = p_org;
  return found;
end;
$function$;

create or replace function public.my_email_confirmation()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'needed', public.email_confirmation_needed(public.current_org_id()),
    'email', (select u.email from auth.users u where u.id = auth.uid()),
    'last_sent_at', (select max(o.created_at) from public.message_outbox o
                      where o.org_id = public.current_org_id() and o.template = 'confirm_email'));
$function$;

create or replace function public.request_email_confirmation()
returns text
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
    raise exception 'Only someone who manages the company can ask for this.' using errcode = '42501';
  end if;
  if not public.email_confirmation_needed(v_org) then
    return null;
  end if;
  if exists (select 1 from public.message_outbox o
              where o.org_id = v_org and o.template = 'confirm_email'
                and o.created_at > now() - interval '5 minutes') then
    raise exception 'We sent the link a few minutes ago. Check your inbox and spam folder, or try again shortly.'
      using errcode = '54000';
  end if;
  select u.email, p.full_name into v_email, v_name
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = auth.uid();
  if v_email is null or v_email ~* '@staff\.tickd\.co\.za$' then
    raise exception 'Your login has no email address to send the link to.' using errcode = '22023';
  end if;
  perform public.queue_email(v_org, v_email, v_name, 'confirm_email', '{}'::jsonb);
  return v_email;
end;
$function$;

revoke all on function public.email_confirmation_needed(uuid) from public, anon, authenticated;
revoke all on function public.confirm_company_email(uuid) from public, anon, authenticated;
revoke all on function public.my_email_confirmation() from public, anon;
revoke all on function public.request_email_confirmation() from public, anon;
grant execute on function public.email_confirmation_needed(uuid) to service_role;
grant execute on function public.confirm_company_email(uuid) to service_role;
grant execute on function public.my_email_confirmation() to authenticated, service_role;
grant execute on function public.request_email_confirmation() to authenticated, service_role;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'email_confirmation_needed', 'core'),
  ('function', 'confirm_company_email', 'core'),
  ('function', 'my_email_confirmation', 'core'),
  ('function', 'request_email_confirmation', 'core')
on conflict do nothing;

do $$
declare
  r record;
  def text;
  cur text := '';
  n int;
begin
  for r in
    select * from (values
      ('queue_email(uuid,text,text,text,jsonb,text,uuid,timestamptz)',
       $a$  v_over boolean;
begin$a$,
       $b$  v_over boolean;
  v_unconfirmed boolean;
begin$b$),
      ('queue_email(uuid,text,text,text,jsonb,text,uuid,timestamptz)',
       $a$  v_over := public.email_sent_today(p_org) >= public.email_daily_limit(p_org);$a$,
       $b$  v_over := public.email_sent_today(p_org) >= public.email_daily_limit(p_org);
  v_unconfirmed := p_template not in ('confirm_email', 'test', 'alert', 'alerts_digest')
                   and public.email_confirmation_needed(p_org);$b$),
      ('queue_email(uuid,text,text,text,jsonb,text,uuid,timestamptz)',
       $a$               when v_over then 'cancelled' else 'queued' end,
          case when v_over and public.email_allowed(p_org, v_to)
               then 'Not sent: the company reached its daily email limit.' end)$a$,
       $b$               when v_over or v_unconfirmed then 'cancelled' else 'queued' end,
          case when not public.email_allowed(p_org, v_to) then null
               when v_unconfirmed then 'Not sent: the company has not confirmed its email address yet.'
               when v_over then 'Not sent: the company reached its daily email limit.' end)$b$),
      ('queue_document_email(uuid,text,text,text,jsonb,text,uuid,uuid,uuid,text)',
       $a$begin
  perform pg_advisory_xact_lock(hashtext('email_daily_limit:' || p_org::text));$a$,
       $b$begin
  if public.email_confirmation_needed(p_org) then
    raise exception 'Confirm your email address first: open the link we emailed you when you signed up. You can send it again from your dashboard.'
      using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtext('email_daily_limit:' || p_org::text));$b$)
    ) v(fn, old_text, new_text)
  loop
    if r.fn <> cur then
      if cur <> '' then execute def; end if;
      cur := r.fn;
      def := pg_get_functiondef(('public.' || r.fn)::regprocedure);
    end if;
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then
      raise exception '%: expected 1 of the anchor, found %', r.fn, n;
    end if;
    def := replace(def, r.old_text, r.new_text);
  end loop;
  execute def;
end;
$$;
