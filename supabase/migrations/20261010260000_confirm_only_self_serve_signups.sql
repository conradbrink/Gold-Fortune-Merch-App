-- Only a self-serve sign-up has to confirm its email address.
--
-- 20261010250000 added `company_account.email_confirmed_at` with no default,
-- so any account row created later started unconfirmed. Self-serve sign-up
-- is closed (#131) and new companies are made by the operator for the
-- Founding offer; such a company gets its account row later, when the
-- operator extends its trial or someone dismisses the getting-started list,
-- and that row would have counted as an unconfirmed trial: its client email
-- blocked, with no confirmation ever sent. The operator has already vetted
-- those companies.
--
-- * A new account row is confirmed unless it says otherwise (default now()).
-- * `start_trial_company`, the self-serve sign-up, creates its row
--   unconfirmed, and sign-up sends the confirmation link.
--
-- Patched in place; the rollback reverses it.

alter table public.company_account alter column email_confirmed_at set default now();

do $$
declare
  def text := pg_get_functiondef('public.start_trial_company(jsonb,text[],uuid)'::regprocedure);
  old_text constant text := $a$  insert into public.company_account (org_id, trial_ends_at)
  values (v_org, now() + make_interval(days => v_days));$a$;
  new_text constant text := $b$  insert into public.company_account (org_id, trial_ends_at, email_confirmed_at)
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
