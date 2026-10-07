-- Tighten the "not a signed-in user" bypass in module_enabled and
-- caller_may_read_org.
--
-- Both let the service role and database sessions through: the crons and the
-- operator act across companies on purpose. Both decided that from the JWT's
-- `role` claim alone:
--
--   module_enabled:      coalesce(auth.role(), 'service_role') = 'service_role'
--   caller_may_read_org: coalesce(auth.role(), '') <> 'authenticated'
--
-- So a request whose claims carried no `role` read as the service role, and
-- every module gate and company-id helper opened for it; and for
-- caller_may_read_org a signed-out caller (`anon`) counted as "not a signed-in
-- user" too. CodeRabbit raised the first on #74. Demonstrated on 7 Oct 2026:
-- under `set local role authenticated` with claims lacking `role`,
-- auth.role() is NULL.
--
-- Now the bypass needs the caller's **database role** to be one that is not a
-- user at all: `current_setting('role')` is 'none' in a database session
-- (pg_cron, migrations, the SQL editor) and 'service_role' for the service
-- key, and is 'authenticated' / 'anon' for every request PostgREST makes on a
-- user's behalf — whatever the claims say. Checked the same day: inside a
-- SECURITY DEFINER function `current_user` is always the owner, but
-- `current_setting('role')` still names the caller, which is why it is used
-- here rather than `current_user`.
--
-- Rollback: supabase/rollback/20261007150920_tighten_service_bypass.down.sql.

create or replace function public.module_enabled(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select current_setting('role', true) in ('none', 'service_role')
      or exists (select 1 from public.modules m
                  where m.code = p_code and m.plan_type = 'core')
      or exists (select 1 from public.company_modules cm
                  where cm.org_id = public.current_org_id()
                    and cm.module_code = p_code
                    and cm.enabled)
$function$;

create or replace function public.caller_may_read_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select current_setting('role', true) in ('none', 'service_role')
      or p_org = public.current_org_id()
$function$;
