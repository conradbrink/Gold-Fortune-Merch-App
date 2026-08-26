-- Fix: `save_job_role` could not create a new job role.
--
-- The admin guard read `v_existing.code` to decide whether `admin` was allowed
-- on this template. On the create path `v_existing` is never assigned, and
-- plpgsql refuses to read a field from an unassigned record — "the tuple
-- structure of a not-yet-assigned record is indeterminate", raised before the
-- comparison it was guarding ever ran. Every attempt to create a job role
-- failed; editing one worked, which is why it took an actual create to find it.
--
-- The lesson is the shape rather than the typo: a `record` variable is
-- null-unsafe in a way a scalar is not. `coalesce(v_existing.code, '')` reads
-- like it handles the empty case and does not — the coalesce never gets a
-- chance. A plain `text` holds null happily, so that is what it is now.

create or replace function public.save_job_role(
  p_id uuid,
  p_name text,
  p_description text,
  p_base_role text,
  p_active boolean,
  p_permissions text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org       uuid := public.current_org_id();
  v_id        uuid;
  -- Scalars, not a record: null is a value these can hold, and on the create
  -- path they stay null all the way to the checks below.
  v_code      text;
  v_org_check uuid;
  v_name      text := btrim(coalesce(p_name, ''));
  v_perms     text[] := coalesce(p_permissions, '{}');
begin
  if not public.has_permission('admin') then
    raise exception 'Only an administrator can change job roles.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'A job role needs a name.' using errcode = '22023';
  end if;
  if p_base_role not in ('rep', 'manager', 'warehouse', 'hr_manager') then
    raise exception '% is not a base role.', p_base_role using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_perms) c
              where c not in (select code from public.app_permissions)) then
    raise exception 'That permission list contains something this application does not have.'
      using errcode = '22023';
  end if;

  if p_id is not null then
    select jr.code, jr.org_id into v_code, v_org_check
      from public.job_roles jr where jr.id = p_id;
    if v_org_check is null or v_org_check is distinct from v_org then
      raise exception 'That job role does not exist.' using errcode = '42501';
    end if;
  end if;

  -- `admin` belongs to the built-in administrator template and nowhere else.
  -- Otherwise an administrator could mint a template that grants their own
  -- level of access and hand it out from the create dialog, which is the rule
  -- `set_profile_permission` and the invite route already enforce.
  if 'admin' = any (v_perms) and coalesce(v_code, '') <> 'administrator' then
    raise exception 'Full administrator cannot be added to a job role. It is granted in the Supabase dashboard.'
      using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.job_roles (org_id, name, description, base_role, active, is_system, sort_order)
    values (v_org, v_name, nullif(btrim(coalesce(p_description, '')), ''), p_base_role,
            coalesce(p_active, true), false,
            coalesce((select max(sort_order) + 10 from public.job_roles where org_id = v_org), 100))
    returning id into v_id;
  else
    v_id := p_id;
    -- `code` and `is_system` are untouched on purpose: the default-permission
    -- trigger matches on the code, so letting it move would be a way to lock
    -- new accounts out by renaming something.
    update public.job_roles
       set name = v_name,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           base_role = p_base_role,
           active = coalesce(p_active, true)
     where id = v_id;
  end if;

  delete from public.job_role_permissions where job_role_id = v_id;
  insert into public.job_role_permissions (job_role_id, permission_code)
  select v_id, c from unnest(v_perms) c;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, auth.uid(),
          case when p_id is null then 'access.job_role_created' else 'access.job_role_changed' end,
          'job_role', v_id,
          jsonb_build_object('name', v_name, 'base_role', p_base_role,
                             'permissions', to_jsonb(v_perms), 'via', current_user));
  return v_id;
end;
$$;
