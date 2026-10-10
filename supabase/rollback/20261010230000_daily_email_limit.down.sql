-- Rollback of 20261010230000_daily_email_limit: the inverse replacements,
-- then the helpers, their module rows and the setting.

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
    ) v(fn, new_text, old_text)
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

delete from public.module_assignments where kind = 'function' and name in ('email_daily_limit', 'email_sent_today');
drop function public.email_daily_limit(uuid);
drop function public.email_sent_today(uuid);
delete from public.platform_settings where key = 'email_daily_limits';
