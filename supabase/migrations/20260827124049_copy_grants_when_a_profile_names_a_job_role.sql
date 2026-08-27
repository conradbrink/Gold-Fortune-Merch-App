-- Give an account created *on a job role* the job role's permissions.
--
-- `assign_default_permissions` was written for the one path that existed when
-- it landed: a profile created in the Supabase dashboard, which names a `role`
-- and no template, and would otherwise hold no permission rows at all. It
-- returned early whenever `job_role_id` was already set, on the assumption that
-- something else had done the copying.
--
-- Nothing else does. `/api/reps/invite` writes `job_role_id` on the INSERT
-- precisely so that this trigger would see it, and its own comment says so.
-- The result was that every account created in Settings → Users — the only way
-- the app creates one — landed with an empty `profile_permissions`, every
-- converted policy denied it, and `proxy.ts` sent the person to `/rep-notice`.
-- The screen showed the job role next to their name the whole time.
--
-- Found by CodeRabbit on #38, before the first such account was created.
--
-- The template branch keeps its previous behaviour exactly, including writing
-- `job_role_id` back onto the profile. The only new thing is that the branch
-- which already has one now copies from it instead of returning.
--
-- Both branches take the grants through `job_roles`, so a profile inserted
-- naming another organisation's template copies nothing rather than borrowing
-- that organisation's access. Nothing can currently insert such a row — the
-- route resolves the template through the caller's own RLS-confined client —
-- but the trigger is `security definer` and should not depend on its callers
-- being careful.

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
       and jr.name = case new.role
         when 'manager'    then 'Administrator'
         when 'warehouse'  then 'Warehouse Clerk'
         when 'hr_manager' then 'HR Manager'
         else 'Sales Rep'
       end;

    -- No template means the organisation was never provisioned — which should
    -- be impossible now that `organizations` has a trigger, but leaving the
    -- profile alone is better than guessing at a grant.
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

revoke all on function public.assign_default_permissions() from public, anon, authenticated;

comment on function public.assign_default_permissions() is
  'Copies a new profile''s permissions from its job role — the one it names, or the system template matching its base role. Runs on INSERT only; set_job_role() owns every later change.';

-- ---------------------------------------------------------------------------
-- Repair anybody already created this way
-- ---------------------------------------------------------------------------
--
-- This matches nobody in production today — all five accounts predate the
-- permission model and were granted by the other branch of the trigger. It is
-- here because the migrations ran ahead of the merge and the preview deployment
-- could reach the screen in the meantime, and because an account with a job
-- role and no grants is invisible: it looks exactly like a person whose boxes
-- were all unticked.
--
-- Which is the one case this could get wrong. Somebody deliberately reduced to
-- nothing has no rows either, and would have the template pushed back onto
-- them. That is a real edit only `set_profile_permission` can make, only from a
-- screen that has not been merged, and leaving a locked-out account behind is
-- the worse of the two — but it is the reason this is a one-off statement here
-- rather than anything that runs again.

insert into public.profile_permissions (profile_id, permission_code)
select p.id, jrp.permission_code
  from public.profiles p
  join public.job_roles jr on jr.id = p.job_role_id and jr.org_id = p.org_id
  join public.job_role_permissions jrp on jrp.job_role_id = jr.id
 where not exists (
   select 1 from public.profile_permissions pp where pp.profile_id = p.id
 )
on conflict do nothing;
