-- Rollback for tighten_service_bypass: both functions as they were (the
-- claim-based bypass), verbatim from 20261007112542 and 20261007101033.

create or replace function public.module_enabled(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(auth.role(), 'service_role') = 'service_role'
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
  select coalesce(auth.role(), '') <> 'authenticated'
      or p_org = public.current_org_id()
$function$;
