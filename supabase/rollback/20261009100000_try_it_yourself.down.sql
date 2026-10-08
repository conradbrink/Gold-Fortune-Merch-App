-- Rollback for 20261009100000_try_it_yourself: the reverse text patches, the
-- list as it was, then the function and the column. A test login made in the
-- meantime stays as an ordinary field-staff login (and takes a place again).

update public.onboarding_steps
   set sort_order = 70,
       title = 'Start a first workday on a phone',
       description = 'Install the app and start a workday, then watch it on the map.',
       href = '/download'
 where code = 'first_workday';
update public.onboarding_steps set sort_order = 10 where code = 'company_profile';

do $migration$
declare
  v_def text := pg_get_functiondef('public.my_onboarding()'::regprocedure);
  c_new constant text := $a$when 'invite_staff' then (select count(*) from public.profiles p where p.org_id = v_org) > 1$a$;
  c_old constant text := $b$when 'invite_staff' then (select count(*) from public.profiles p where p.org_id = v_org
               and p.id is distinct from (select ca.owner_test_profile_id from public.company_account ca
                                           where ca.org_id = v_org)) > 1$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'my_onboarding is not the text this rollback expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

do $migration$
declare
  v_def text := pg_get_functiondef('public.my_setup()'::regprocedure);
  c_new1 constant text := $a$select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active;$a$;
  c_old1 constant text := $b$select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active
         and p.id is distinct from a.owner_test_profile_id;$b$;
  c_new2 constant text := $a$'people', (select count(*) from public.profiles x where x.org_id = v_org and x.is_active),$a$;
  c_old2 constant text := $b$'people', (select count(*) from public.profiles x where x.org_id = v_org and x.is_active
                   and x.id is distinct from a.owner_test_profile_id),$b$;
  c_new3 constant text := $a$    'country_code', nullif(v_country, ''),$a$;
  c_old3 constant text := $b$    'owner_test_id', a.owner_test_profile_id,
    'country_code', nullif(v_country, ''),$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old1, ''))) / length(c_old1) <> 1
     or (length(v_def) - length(replace(v_def, c_old2, ''))) / length(c_old2) <> 1
     or (length(v_def) - length(replace(v_def, c_old3, ''))) / length(c_old3) <> 1 then
    raise exception 'my_setup is not the text this rollback expects';
  end if;
  execute replace(replace(replace(v_def, c_old1, c_new1), c_old2, c_new2), c_old3, c_new3);
end;
$migration$;

do $migration$
declare
  v_def text := pg_get_functiondef('public.billing_seats_used(uuid, jsonb)'::regprocedure);
  c_new constant text := $a$select count(*) into v_total from public.profiles where org_id = p_org and is_active;$a$;
  c_old constant text := $b$select count(*) into v_total from public.profiles where org_id = p_org and is_active
     and id is distinct from (select ca.owner_test_profile_id from public.company_account ca where ca.org_id = p_org);$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'billing_seats_used is not the text this rollback expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

do $migration$
declare
  v_def text := pg_get_functiondef('public.profiles_user_limit()'::regprocedure);
  c_new constant text := $a$select count(*) into v_used from public.profiles where org_id = new.org_id and is_active;$a$;
  c_old constant text := $b$select count(*) into v_used from public.profiles where org_id = new.org_id and is_active
      and id is distinct from a.owner_test_profile_id;$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'profiles_user_limit is not the text this rollback expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

delete from public.module_assignments where kind = 'function' and name = 'add_owner_test_profile';
drop function public.add_owner_test_profile(uuid, uuid, text, text, text, uuid);

revoke select (owner_test_profile_id) on public.company_account from authenticated;
alter table public.company_account drop column owner_test_profile_id;
