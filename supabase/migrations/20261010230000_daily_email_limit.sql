-- A daily limit on the email each company can send, lower on a free trial,
-- and a sender that takes companies in turn.
--
-- Found in the 10 Oct 2026 audit: a free trial needs no email confirmation,
-- and nothing limited how much client email a company could queue. A
-- throwaway sign-up could send invoices, quotes, statements and reminders to
-- any address, five at a time, through Tickd's own domain, hurting its
-- sending reputation for every customer. And because the worker claims the
-- oldest messages first, 20 every five minutes, one company's pile of
-- messages delayed everybody else's invoices and job reports by hours.
--
-- 1. `platform_settings.email_daily_limits`: how many emails a company may
--    queue in any 24 hours, `trial` while its account is on a free trial and
--    `other` for everyone else (paid, exempt, no account row). 50 and 1,000 to
--    start; the operator can change them without a release.
-- 2. `email_daily_limit(org)` and `email_sent_today(org)`, internal.
-- 3. `queue_email`, through which every email passes, records a message over
--    the limit as `cancelled` with the reason in `last_error`, instead of
--    queueing it. Automatic mail (job reports, alerts) therefore never fails
--    a check-out or a nightly run; it is simply not sent.
-- 4. `queue_document_email`, behind the Send buttons for invoices, quotes,
--    statements and payment reminders, refuses with a plain message first,
--    so the person pressing Send is told why.
-- 5. `claim_messages` takes each company's oldest message in turn, so one
--    company's backlog cannot hold up another's.
--
-- Counting: messages queued, sending, sent or failed in the last 24 hours.
-- Suppressed (unsubscribed or bounced) and cancelled ones were never sent and
-- do not count. A per-company advisory lock makes two sends at once count
-- each other. Bodies are patched in place; the rollback reverses each patch.

insert into public.platform_settings (key, value, description) values
  ('email_daily_limits', '{"trial": 50, "other": 1000}'::jsonb,
   'Emails a company may queue in any 24 hours: "trial" while on a free trial, "other" otherwise. Over it, Send is refused and automatic mail is held back.')
on conflict (key) do nothing;

create or replace function public.email_daily_limit(p_org uuid)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((public.platform_setting('email_daily_limits') ->> x.k)::integer,
                  case x.k when 'trial' then 50 else 1000 end)
    from (select case when exists (select 1 from public.company_account a
                                    where a.org_id = p_org and a.status = 'trial')
                      then 'trial' else 'other' end as k) x;
$function$;

create or replace function public.email_sent_today(p_org uuid)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::integer
    from public.message_outbox o
   where o.org_id = p_org
     and o.created_at > now() - interval '24 hours'
     and o.status in ('queued', 'sending', 'sent', 'failed');
$function$;

revoke all on function public.email_daily_limit(uuid) from public, anon, authenticated;
revoke all on function public.email_sent_today(uuid) from public, anon, authenticated;
grant execute on function public.email_daily_limit(uuid) to service_role;
grant execute on function public.email_sent_today(uuid) to service_role;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'email_daily_limit', 'core'),
  ('function', 'email_sent_today', 'core')
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
      -- queue_email: lock the company's count, then cancel anything over it.
      ('queue_email(uuid,text,text,text,jsonb,text,uuid,timestamptz)',
       $a$  v_to text := lower(btrim(p_to));
begin
  insert into public.message_outbox (org_id, to_address, to_name, template, payload, related_kind, related_id,
                                     send_after, created_by, status)$a$,
       $b$  v_to text := lower(btrim(p_to));
  v_over boolean;
begin
  perform pg_advisory_xact_lock(hashtext('email_daily_limit:' || p_org::text));
  v_over := public.email_sent_today(p_org) >= public.email_daily_limit(p_org);
  insert into public.message_outbox (org_id, to_address, to_name, template, payload, related_kind, related_id,
                                     send_after, created_by, status, last_error)$b$),
      ('queue_email(uuid,text,text,text,jsonb,text,uuid,timestamptz)',
       $a$          case when public.email_allowed(p_org, v_to) then 'queued' else 'suppressed' end)$a$,
       $b$          case when not public.email_allowed(p_org, v_to) then 'suppressed'
               when v_over then 'cancelled' else 'queued' end,
          case when v_over and public.email_allowed(p_org, v_to)
               then 'Not sent: the company reached its daily email limit.' end)$b$),
      -- queue_document_email: refuse a Send over the limit, with the reason.
      ('queue_document_email(uuid,text,text,text,jsonb,text,uuid,uuid,uuid,text)',
       $a$begin
  v_out := public.queue_email(p_org, p_to, p_to_name, p_template, p_payload, p_kind, coalesce(p_related, p_link));$a$,
       $b$begin
  perform pg_advisory_xact_lock(hashtext('email_daily_limit:' || p_org::text));
  if public.email_sent_today(p_org) >= public.email_daily_limit(p_org) then
    raise exception 'Your company has sent its % emails for today%. More can go out once today''s first emails are 24 hours old.',
      public.email_daily_limit(p_org),
      case when exists (select 1 from public.company_account a where a.org_id = p_org and a.status = 'trial')
           then ' (the free-trial limit)' else '' end
      using errcode = '54000';
  end if;
  v_out := public.queue_email(p_org, p_to, p_to_name, p_template, p_payload, p_kind, coalesce(p_related, p_link));$b$),
      -- claim_messages: each company's oldest first, companies in turn.
      ('claim_messages(integer)',
       $a$   where m.id in (select o.id from public.message_outbox o
                   where o.status = 'queued' and o.send_after <= now()
                   order by o.send_after, o.id
                   limit greatest(1, least(coalesce(p_limit, 50), 200))
                   for update skip locked)$a$,
       $b$   where m.id in (select o.id from public.message_outbox o
                   where o.status = 'queued'
                     and o.id in (select t.id
                                    from (select q.id, q.send_after,
                                                 row_number() over (partition by q.org_id order by q.send_after, q.id) as turn
                                            from public.message_outbox q
                                           where q.status = 'queued' and q.send_after <= now()) t
                                   order by t.turn, t.send_after, t.id
                                   limit greatest(1, least(coalesce(p_limit, 50), 200)))
                   for update skip locked)$b$)
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
