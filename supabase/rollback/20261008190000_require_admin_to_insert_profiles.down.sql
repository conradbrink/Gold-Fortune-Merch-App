-- Reverses 20261008190000_require_admin_to_insert_profiles.
--
-- Restores `profiles_insert` to the base-role check and
-- `assign_default_permissions` to the body defined by
-- 20261007165133_country_and_neutral_defaults (the live definition at the time
-- this migration was written). Run only this file to roll the migration back.
--
-- ⚠️ This reopens the manager-to-admin escalation the migration closed. It
-- exists for a controlled revert, not as an option to leave in place.

alter policy profiles_insert on public.profiles
  with check (
    org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager'
  );

create or replace function public.assign_default_permissions()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare v_role_id uuid;
begin
  if new.job_role_id is not null then
    v_role_id := new.job_role_id;
  else
    select jr.id into v_role_id
      from public.job_roles jr
     where jr.org_id = new.org_id
       and jr.is_system
       and jr.code = case new.role
         when 'manager'    then 'administrator'
         when 'warehouse'  then 'warehouse_clerk'
         when 'hr_manager' then 'hr_manager'
         else 'sales_rep'
       end;

    if v_role_id is null then return new; end if;

    update public.profiles set job_role_id = v_role_id where id = new.id;
  end if;

  insert into public.profile_permissions (profile_id, permission_code)
  select new.id, jrp.permission_code
    from public.job_role_permissions jrp
    join public.job_roles jr on jr.id = jrp.job_role_id
   where jrp.job_role_id = v_role_id
     and jr.org_id = new.org_id
  on conflict do nothing;
  return new;
end;
$$;
