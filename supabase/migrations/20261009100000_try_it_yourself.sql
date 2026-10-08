-- Stage 7 Part 2c: the owner tries the phone app themselves, and the
-- getting-started list leads with it.
--
-- * The phone app (1.1.13) lets only field staff in, so an owner could not see
--   a check-in until a staff member did one. The owner now gets one field-staff
--   login of their own, on their own mobile number, made by the same phone-login
--   path as their staff (`<E.164>@staff.tickd.co.za`, lib/phone-login.ts).
-- * company_account.owner_test_profile_id names that login. One per company,
--   kept on company_account because the phone app never reads it (1.1.13 reads
--   profiles, which this leaves alone).
-- * It does not take one of the company's user places (owner decision, 9 Oct):
--   profiles_user_limit, billing_seats_used and my_setup leave it out of the
--   count, and my_onboarding does not count it as "staff invited".
-- * add_owner_test_profile(): the service role's one way to make it, in one
--   transaction, so the place check never sees it counted. Never for an exempt
--   company: Gold Fortune is untouched.
-- * The getting-started list leads with trying the app; the company profile
--   goes last. "first_workday" opens /try-it, and its wording drops "watch".
--
-- Patches functions from 20261008091250_billing (applied on production; its
-- file arrives with #91) and 20261008230000_setup_wizard, by exact text, so the
-- rollback restores them exactly.

alter table public.company_account
  add column owner_test_profile_id uuid;

grant select (owner_test_profile_id) on public.company_account to authenticated;

------------------------------------------------------------- 1. the login

create or replace function public.add_owner_test_profile(
  p_org uuid, p_id uuid, p_full_name text, p_email text, p_phone text, p_job_role_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a public.company_account;
  v_base text;
begin
  -- Locks the company's row first, as profiles_user_limit does, so two tries at
  -- once cannot both get through.
  select * into a from public.company_account where org_id = p_org for update;
  if a.org_id is null or a.status = 'exempt' then
    raise exception 'This company cannot have a test login.' using errcode = '42501';
  end if;
  if a.owner_test_profile_id is not null
     and exists (select 1 from public.profiles p where p.id = a.owner_test_profile_id and p.is_active) then
    raise exception 'You already have a login to try the app.' using errcode = '23505', hint = 'owner_test_exists';
  end if;
  select r.base_role into v_base from public.job_roles r where r.id = p_job_role_id and r.org_id = p_org;
  if v_base is distinct from 'rep' then
    raise exception 'A test login must be on a role that uses the phone app.' using errcode = '22023';
  end if;

  -- Named before the insert, so the place check leaves it out.
  update public.company_account set owner_test_profile_id = p_id, updated_at = now() where org_id = p_org;
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email, phone)
  values (p_id, p_org, 'rep', p_job_role_id, p_full_name, p_email, p_phone);
end;
$function$;

revoke all on function public.add_owner_test_profile(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.add_owner_test_profile(uuid, uuid, text, text, text, uuid) to service_role;

------------------------------------------------------------- 2. not a place

do $migration$
declare
  v_def text := pg_get_functiondef('public.profiles_user_limit()'::regprocedure);
  c_old constant text := $a$select count(*) into v_used from public.profiles where org_id = new.org_id and is_active;$a$;
  c_new constant text := $b$select count(*) into v_used from public.profiles where org_id = new.org_id and is_active
      and id is distinct from a.owner_test_profile_id;$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'profiles_user_limit is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

do $migration$
declare
  v_def text := pg_get_functiondef('public.billing_seats_used(uuid, jsonb)'::regprocedure);
  c_old constant text := $a$select count(*) into v_total from public.profiles where org_id = p_org and is_active;$a$;
  c_new constant text := $b$select count(*) into v_total from public.profiles where org_id = p_org and is_active
     and id is distinct from (select ca.owner_test_profile_id from public.company_account ca where ca.org_id = p_org);$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'billing_seats_used is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

-- my_setup: the places and the people count leave it out, and the wizard learns
-- which login it is.
do $migration$
declare
  v_def text := pg_get_functiondef('public.my_setup()'::regprocedure);
  c_old1 constant text := $a$select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active;$a$;
  c_new1 constant text := $b$select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active
         and p.id is distinct from a.owner_test_profile_id;$b$;
  c_old2 constant text := $a$'people', (select count(*) from public.profiles x where x.org_id = v_org and x.is_active),$a$;
  c_new2 constant text := $b$'people', (select count(*) from public.profiles x where x.org_id = v_org and x.is_active
                   and x.id is distinct from a.owner_test_profile_id),$b$;
  c_old3 constant text := $a$    'country_code', nullif(v_country, ''),$a$;
  c_new3 constant text := $b$    'owner_test_id', a.owner_test_profile_id,
    'country_code', nullif(v_country, ''),$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old1, ''))) / length(c_old1) <> 1
     or (length(v_def) - length(replace(v_def, c_old2, ''))) / length(c_old2) <> 1
     or (length(v_def) - length(replace(v_def, c_old3, ''))) / length(c_old3) <> 1 then
    raise exception 'my_setup is not the text this migration expects';
  end if;
  execute replace(replace(replace(v_def, c_old1, c_new1), c_old2, c_new2), c_old3, c_new3);
end;
$migration$;

do $migration$
declare
  v_def text := pg_get_functiondef('public.my_onboarding()'::regprocedure);
  c_old constant text := $a$when 'invite_staff' then (select count(*) from public.profiles p where p.org_id = v_org) > 1$a$;
  c_new constant text := $b$when 'invite_staff' then (select count(*) from public.profiles p where p.org_id = v_org
               and p.id is distinct from (select ca.owner_test_profile_id from public.company_account ca
                                           where ca.org_id = v_org)) > 1$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'my_onboarding is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

------------------------------------------------------------- 3. the list

update public.onboarding_steps
   set sort_order = 10,
       title = 'Try it yourself on your phone',
       description = 'Start a {workday.one|lower} on your phone, then see it on your map. About 10 minutes.',
       href = '/try-it'
 where code = 'first_workday';
update public.onboarding_steps set sort_order = 70 where code = 'company_profile';

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'add_owner_test_profile', 'core');
