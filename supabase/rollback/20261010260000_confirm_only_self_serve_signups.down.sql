-- Rollback of 20261010260000_confirm_only_self_serve_signups.

alter table public.company_account alter column email_confirmed_at drop default;

do $$
declare
  def text := pg_get_functiondef('public.start_trial_company(jsonb,text[],uuid)'::regprocedure);
  new_text constant text := $a$  insert into public.company_account (org_id, trial_ends_at)
  values (v_org, now() + make_interval(days => v_days));$a$;
  old_text constant text := $b$  insert into public.company_account (org_id, trial_ends_at, email_confirmed_at)
  values (v_org, now() + make_interval(days => v_days), null);$b$;
  n int;
begin
  n := (length(def) - length(replace(def, old_text, ''))) / length(old_text);
  if n <> 1 then
    raise exception 'start_trial_company: expected 1 of the anchor, found %', n;
  end if;
  execute replace(def, old_text, new_text);
end;
$$;
