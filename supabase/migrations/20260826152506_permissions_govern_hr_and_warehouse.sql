-- Make the tick boxes true for HR and the warehouse.
--
-- The permission model landed in the previous migration without changing a
-- single policy, so nothing behaved differently. This is the half that matters:
-- after it, `has_permission('warehouse')` is what the database asks, and an
-- administrator ticking or unticking a box changes what somebody can *read*,
-- not just what appears in their menu.
--
-- Two modules only. Sixty-odd tables still name role strings and they convert
-- later; `app_permissions.data_enforced` says which is which, and the admin
-- screen shows it, because a tick box that silently only moves a menu item is
-- worse than no tick box.
--
-- ------------------------------------------------- no role fallback, and why
--
-- The obvious safe move is `current_role() = 'manager' or has_permission(…)`,
-- so nobody can lose access. It is the wrong move: it makes the permission
-- purely additive, and unticking "Warehouse" for somebody on a manager base
-- role would do nothing at all. A permission you cannot take away is not a
-- permission.
--
-- So the policies below ask `has_permission` and nothing else — which creates
-- exactly one hole worth closing: a user created straight in the Supabase
-- dashboard (the documented way to make an administrator) has a `role` and no
-- permission rows, and would be locked out of everything. The trigger at the
-- top gives every new profile the grants of the system template matching its
-- role, so that path keeps working and permissions stay the single answer.

-- ---------------------------------------------------------------------------
-- Every profile gets grants, however it was created
-- ---------------------------------------------------------------------------

create or replace function public.assign_default_permissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_role_id uuid;
begin
  if new.job_role_id is not null then return new; end if;

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

  -- No template means the organisation was never provisioned — which should be
  -- impossible now that `organizations` has a trigger, but leaving the profile
  -- alone is better than guessing at a grant.
  if v_role_id is null then return new; end if;

  update public.profiles set job_role_id = v_role_id where id = new.id;
  insert into public.profile_permissions (profile_id, permission_code)
  select new.id, jrp.permission_code
    from public.job_role_permissions jrp
   where jrp.job_role_id = v_role_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_assign_default_permissions on public.profiles;
create trigger profiles_assign_default_permissions after insert on public.profiles
  for each row execute function public.assign_default_permissions();

revoke all on function public.assign_default_permissions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- HR
-- ---------------------------------------------------------------------------
--
-- One function covers roughly thirty policies, which is the whole reason it
-- was written as a function in the first place.

create or replace function public.hr_is_hr()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_permission('hr')
$$;

create or replace function public.hr_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_permission('admin')
$$;

/**
 * Configuring HR is a narrower grant than running it.
 *
 * Reading somebody's salary and redefining what "late" means are different
 * jobs, and the brief separates them ("HR Manager: full HR access except
 * system-level settings"). Until now both went through `hr_is_hr()`.
 */
create or replace function public.hr_can_configure()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_permission('hr_settings')
$$;

revoke all on function public.hr_can_configure() from public, anon;
grant execute on function public.hr_can_configure() to authenticated;

-- The four vocabularies move to the narrower permission. Everything else in HR
-- keeps asking `hr_is_hr()`, which now asks `has_permission('hr')`.
drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write on public.hr_settings
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  );

drop policy if exists hr_lookups_write on public.hr_lookups;
create policy hr_lookups_write on public.hr_lookups
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  );

drop policy if exists hr_leave_types_write on public.hr_leave_types;
create policy hr_leave_types_write on public.hr_leave_types
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  );

drop policy if exists hr_review_categories_write on public.hr_review_categories;
create policy hr_review_categories_write on public.hr_review_categories
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  );

drop policy if exists hr_departments_write on public.hr_departments;
create policy hr_departments_write on public.hr_departments
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_can_configure())
  );

-- The HR half of the security trail follows the HR permission rather than the
-- role that used to imply it.
drop policy if exists security_events_hr_select on public.security_events;
create policy security_events_hr_select on public.security_events
  for select using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('hr'))
    and action like 'hr.%'
  );

-- ---------------------------------------------------------------------------
-- Warehouse: 54 policies, one expression
-- ---------------------------------------------------------------------------
--
-- Every policy in the module tests the same thing — `role IN ('manager',
-- 'warehouse')` — which was checked before this was written: 54 policies
-- across 22 tables, 54 exact matches for that fragment and no other shape. So
-- the rewrite is a substitution rather than 54 judgement calls, and the
-- assertion at the end is what makes that claim checkable rather than hopeful.
--
-- The approval distinction is NOT in the policies. `stock_adjustment_decide`
-- and `stocktake_decide` enforce it inside the function, which is why
-- `warehouse_approve` appears further down and not here — collapsing it into
-- `warehouse` would have let a clerk sign off their own stock variance.

do $$
declare
  p        record;
  v_frag   constant text :=
    '( SELECT "current_role"() AS "current_role") = ANY (ARRAY[''manager''::text, ''warehouse''::text])';
  v_new    constant text := '( SELECT public.has_permission(''warehouse''::text))';
  v_using  text;
  v_check  text;
  v_done   integer := 0;
  v_left   integer;
begin
  -- Snapshotted first. The loop drops and recreates the very policies its
  -- query reads, and a cursor over a catalogue being rewritten underneath it
  -- is a way to convert some policies twice and others not at all.
  create temporary table _to_convert on commit drop as
    select tablename, policyname, cmd, permissive, roles, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and position(v_frag in coalesce(qual, '') || coalesce(with_check, '')) > 0;

  for p in select * from _to_convert loop
    v_using := replace(p.qual, v_frag, v_new);
    v_check := replace(p.with_check, v_frag, v_new);

    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format(
      'create policy %I on public.%I as %s for %s to %s %s %s',
      p.policyname, p.tablename,
      case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      case p.cmd when 'ALL' then 'all' when 'SELECT' then 'select'
                 when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                 else 'delete' end,
      array_to_string(p.roles, ', '),
      coalesce('using (' || v_using || ')', ''),
      coalesce('with check (' || v_check || ')', '')
    );
    v_done := v_done + 1;
  end loop;

  -- A partial conversion is the dangerous outcome: some policies asking the
  -- permission and some still asking the role means the tick box works for
  -- three tables out of twenty-two and nobody notices which. Fail loudly.
  select count(*) into v_left
    from pg_policies
   where schemaname = 'public'
     and position(v_frag in coalesce(qual, '') || coalesce(with_check, '')) > 0;

  if v_left > 0 then
    raise exception 'converted % policies but % still name the role', v_done, v_left;
  end if;
  raise notice 'converted % warehouse policies to has_permission()', v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Warehouse RPCs
-- ---------------------------------------------------------------------------
--
-- The functions carry their own role checks, so converting the policies alone
-- would leave `order_confirm` refusing the very person the policies now admit.
-- Same approach: substitute the exact check, then assert none survives.

do $$
declare
  f       record;
  v_def   text;
  v_new   text;
  v_done  integer := 0;
  v_left  integer;
  -- (a) the module's ordinary "warehouse staff only" gate
  v_work  constant text := 'v_role is null or v_role not in (''manager'', ''warehouse'')';
  v_workn constant text := 'not public.has_permission(''warehouse'')';
  -- (b) the approval gate, in stock_adjustment_decide and stocktake_decide
  v_appr  constant text := 'v_role <> ''manager''';
  v_apprn constant text := 'not public.has_permission(''warehouse_approve'')';
  -- (c) the two integrity reports, which were manager-only
  v_drift constant text := 'cfg.role = ''manager''';
  v_driftn constant text := 'public.has_permission(''warehouse_approve'')';
begin
  -- Snapshotted, for the same reason as the policies above: the loop rewrites
  -- the catalogue its query is reading.
  create temporary table _fns on commit drop as
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and (position(v_work in pg_get_functiondef(p.oid)) > 0
         or position(v_appr in pg_get_functiondef(p.oid)) > 0
         or position(v_drift in pg_get_functiondef(p.oid)) > 0);

  for f in select * from _fns loop
    v_def := f.def;
    v_new := replace(replace(replace(v_def, v_work, v_workn), v_appr, v_apprn), v_drift, v_driftn);
    if v_new is distinct from v_def then
      -- `create or replace` rather than drop/create: it preserves the grants,
      -- and several of these are granted to `authenticated` individually.
      execute v_new;
      v_done := v_done + 1;
    end if;
  end loop;

  select count(*) into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and (position(v_work in pg_get_functiondef(p.oid)) > 0
       or position(v_appr in pg_get_functiondef(p.oid)) > 0
       or position(v_drift in pg_get_functiondef(p.oid)) > 0);

  if v_left > 0 then
    raise exception 'converted % functions but % still name the role', v_done, v_left;
  end if;
  raise notice 'converted % warehouse functions to has_permission()', v_done;
end;
$$;

comment on function public.hr_is_hr is
  'Whether the caller runs HR. Now a permission rather than a role, so an administrator can grant HR to anybody — a CFO, an office manager — without inventing a role for them.';
comment on function public.hr_can_configure is
  'Whether the caller may change HR settings, which is narrower than running HR. Section 14: an HR manager has full HR access "except system-level settings".';
