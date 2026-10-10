-- Rollback of 20261010250000_confirm_owner_email: the inverse replacements,
-- then the new functions, their module rows and the column.

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

delete from public.module_assignments where kind = 'function'
   and name in ('email_confirmation_needed', 'confirm_company_email', 'my_email_confirmation', 'request_email_confirmation');
drop function public.request_email_confirmation();
drop function public.my_email_confirmation();
drop function public.confirm_company_email(uuid);
drop function public.email_confirmation_needed(uuid);
alter table public.company_account drop column email_confirmed_at;
