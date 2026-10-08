-- Require the `admin` permission to insert a profile, and stop the
-- default-permission trigger from granting `admin` on a signed-in
-- non-admin's insert.
--
-- The hole, confirmed on production 8 October 2026 inside a rolled-back
-- transaction: `profiles_insert` admitted any row whose `org_id` was the
-- caller's and whose caller was base role `manager`. The AFTER INSERT trigger
-- `assign_default_permissions` then copied the named job role's permissions
-- into `profile_permissions`. So an Operations Manager (base `manager`, no
-- `admin`) who held an auth user with no profile yet could insert a profile on
-- the company's `administrator` job role and receive `admin`. That auth user is
-- not hard to come by: self-service sign-up is enabled on the project, so the
-- attacker can mint one whose email they control.
--
-- Two independent guards, either of which closes it:
--
--   1. The insert policy now asks `has_permission('admin')` rather than the
--      base role. No legitimate path is affected: the invite route and the
--      `create_company` / `start_trial_company` definer functions all insert
--      through the service role, which bypasses RLS, so this policy is only
--      ever evaluated for a signed-in user acting through PostgREST — exactly
--      the attacker. `has_permission` is the same function every other policy
--      and the invite route already use, so they cannot drift apart.
--
--   2. The trigger copies `admin` only for a trusted insert — one with no
--      signed-in user (`auth.uid()` null: the service role, the owner created
--      inside create_company, a migration) or one whose actor already holds
--      `admin`. This also covers the narrower vector of a manager naming a job
--      role that itself grants `admin`, and it holds even if the policy above
--      is ever loosened again.
--
-- `profiles_update` is deliberately left as it is. Its policy is broad (a
-- manager may update any profile in the org) but column-level UPDATE grants to
-- `authenticated` cover only full_name, job_title and phone, so a manager
-- cannot change a role, job role, org or active flag through it today; the
-- escalation here is the INSERT, and this migration keeps to it.

alter policy profiles_insert on public.profiles
  with check (
    org_id = (select public.current_org_id())
    and (select public.has_permission('admin'))
  );

create or replace function public.assign_default_permissions()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_role_id uuid;
  -- A trusted insert is one no signed-in user is driving — the service role,
  -- the owner created inside create_company, a migration (auth.uid() null) —
  -- or one whose actor is already an administrator. Only these may be handed
  -- `admin` by the copy below; for anyone else the grant is dropped while the
  -- rest of the role's permissions are still applied.
  v_trusted boolean := (
    auth.uid() is null
    or current_setting('role', true) = 'service_role'
    or public.has_permission('admin')
  );
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
     and (jrp.permission_code <> 'admin' or v_trusted)
  on conflict do nothing;
  return new;
end;
$$;
