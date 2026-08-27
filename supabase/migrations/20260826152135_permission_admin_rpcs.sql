-- The only two ways a grant moves, and the guard that stops a tenant locking
-- itself out of its own account.
--
-- `profile_permissions` has no write policy and the privilege is revoked, so
-- everything goes through these. That is not belt-and-braces: a permission
-- table a user can INSERT into is not a permission system, and the two rules
-- below cannot be expressed as policies at all.
--
--   * **Nobody may remove the last administrator.** A policy sees one row at a
--     time and cannot count what would be left. Without this an admin can
--     untick their own box, and the only way back in is the Supabase dashboard
--     — which a customer does not have.
--   * **`admin` is not grantable from the app.** Everything else here is an
--     administrator handing out less access than they hold; granting `admin` is
--     handing out their own, which is the one action worth making somebody do
--     somewhere deliberate and attributable. It is the same rule `/api/reps/invite`
--     already applies to the `manager` role, kept rather than quietly dropped
--     now that permissions exist.

/** True when the org would still have a working administrator afterwards. */
create or replace function public.hr_would_orphan_org(p_profile uuid, p_removing_admin boolean)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_removing_admin
     and not exists (
       select 1
         from public.profile_permissions pp
         join public.profiles p on p.id = pp.profile_id
        where pp.permission_code = 'admin'
          and p.is_active
          and p.id <> p_profile
          and p.org_id = (select org_id from public.profiles where id = p_profile)
     )
$$;

/**
 * Put somebody on a job role: sets their base role and replaces their grants
 * with the template's.
 *
 * Replaces rather than merges. A template is what this person's access should
 * now be, and merging would leave whatever an admin had ticked on before,
 * quietly, under a role name that says otherwise.
 */
create or replace function public.set_job_role(p_profile uuid, p_job_role uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org      uuid := public.current_org_id();
  v_target   record;
  v_role     record;
  v_had_admin boolean;
  v_gets_admin boolean;
begin
  if not public.has_permission('admin') then
    raise exception 'Only an administrator can change somebody''s job role.'
      using errcode = '42501';
  end if;

  select id, org_id, full_name, role into v_target
    from public.profiles where id = p_profile;
  if v_target is null or v_target.org_id is distinct from v_org then
    raise exception 'That person is not in your organisation.' using errcode = '42501';
  end if;

  select id, name, base_role, org_id into v_role
    from public.job_roles where id = p_job_role;
  if v_role is null or v_role.org_id is distinct from v_org then
    raise exception 'That job role does not exist.' using errcode = '42501';
  end if;

  select exists (select 1 from public.profile_permissions
                  where profile_id = p_profile and permission_code = 'admin')
    into v_had_admin;
  select exists (select 1 from public.job_role_permissions
                  where job_role_id = p_job_role and permission_code = 'admin')
    into v_gets_admin;

  if v_gets_admin and not v_had_admin then
    raise exception 'Full administrator cannot be granted from the app. Do it in the Supabase dashboard.'
      using errcode = '42501';
  end if;
  if public.hr_would_orphan_org(p_profile, v_had_admin and not v_gets_admin) then
    raise exception 'That would leave the organisation with no administrator.'
      using errcode = '42501';
  end if;

  update public.profiles
     set job_role_id = p_job_role, role = v_role.base_role
   where id = p_profile;

  delete from public.profile_permissions where profile_id = p_profile;
  insert into public.profile_permissions (profile_id, permission_code, granted_by)
  select p_profile, jrp.permission_code, auth.uid()
    from public.job_role_permissions jrp
   where jrp.job_role_id = p_job_role;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, auth.uid(), 'access.job_role_set', 'profile', p_profile,
          jsonb_build_object('name', v_target.full_name, 'job_role', v_role.name,
                             'base_role', jsonb_build_object('from', v_target.role,
                                                             'to', v_role.base_role),
                             'via', current_user));
end;
$$;

/** Tick or untick one permission for one person. */
create or replace function public.set_profile_permission(
  p_profile uuid, p_code text, p_granted boolean
)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org    uuid := public.current_org_id();
  v_target record;
begin
  if not public.has_permission('admin') then
    raise exception 'Only an administrator can change permissions.' using errcode = '42501';
  end if;

  select id, org_id, full_name into v_target
    from public.profiles where id = p_profile;
  if v_target is null or v_target.org_id is distinct from v_org then
    raise exception 'That person is not in your organisation.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.app_permissions where code = p_code) then
    raise exception 'There is no permission called %.', p_code using errcode = '22023';
  end if;

  if p_code = 'admin' and p_granted then
    raise exception 'Full administrator cannot be granted from the app. Do it in the Supabase dashboard.'
      using errcode = '42501';
  end if;
  if public.hr_would_orphan_org(p_profile, p_code = 'admin' and not p_granted) then
    raise exception 'That would leave the organisation with no administrator.'
      using errcode = '42501';
  end if;

  if p_granted then
    insert into public.profile_permissions (profile_id, permission_code, granted_by)
    values (p_profile, p_code, auth.uid())
    on conflict (profile_id, permission_code) do nothing;
  else
    delete from public.profile_permissions
     where profile_id = p_profile and permission_code = p_code;
  end if;

  -- Every grant and revoke, with the person and the permission named. This is
  -- the trail somebody reads after asking "who gave her the salaries?".
  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, auth.uid(),
          case when p_granted then 'access.permission_granted' else 'access.permission_revoked' end,
          'profile', p_profile,
          jsonb_build_object('name', v_target.full_name, 'permission', p_code,
                             'via', current_user));
end;
$$;

revoke all on function public.hr_would_orphan_org(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_job_role(uuid, uuid) from public, anon;
revoke all on function public.set_profile_permission(uuid, text, boolean) from public, anon;
grant execute on function public.set_job_role(uuid, uuid) to authenticated;
grant execute on function public.set_profile_permission(uuid, text, boolean) to authenticated;

-- Administrators read the access trail, like the rest of `security_events`.
-- The existing manager policy already covers today's admins; this names the
-- permission so it keeps working once `manager` stops being the test.
drop policy if exists security_events_admin_select on public.security_events;
create policy security_events_admin_select on public.security_events
  for select using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('admin'))
  );

comment on function public.set_job_role(uuid, uuid) is
  'Applies a job-role template: sets profiles.role from base_role and replaces the person''s grants. Refuses to grant admin or to remove the last administrator.';
comment on function public.set_profile_permission(uuid, text, boolean) is
  'Ticks or unticks one permission. Refuses to grant admin — that is a Supabase-dashboard act — and refuses to remove the last administrator.';
