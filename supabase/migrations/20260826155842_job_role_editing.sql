-- Let a tenant edit their own job roles — and fix what that would have broken.
--
-- 🔴 `assign_default_permissions` matched the system templates **by name**:
--
--     jr.name = case new.role when 'manager' then 'Administrator' … end
--
-- That was fine while nobody could rename them. The moment the admin screen
-- offers renaming — and a tenant calls "Sales Rep" something they actually say,
-- "Field Merchandiser" — the match fails, a profile created in the Supabase
-- dashboard gets no grants, and since the permission conversion has no role
-- fallback that account is locked out of everything with nothing to explain it.
--
-- So templates get a stable `code` that a tenant cannot change, the trigger
-- matches on that, and the name becomes free text. This has to land in the same
-- migration as the editing, not after it.

alter table public.job_roles add column if not exists code text;

create unique index if not exists job_roles_org_code_idx
  on public.job_roles (org_id, code) where code is not null;

update public.job_roles
   set code = case name
     when 'Administrator'      then 'administrator'
     when 'Operations Manager' then 'operations_manager'
     when 'CFO'                then 'cfo'
     when 'HR Manager'         then 'hr_manager'
     when 'Warehouse Clerk'    then 'warehouse_clerk'
     when 'Sales Rep'          then 'sales_rep'
   end
 where is_system and code is null;

comment on column public.job_roles.code is
  'Stable identifier for the seeded templates. Null for a role a tenant created. Never editable — the default-permission trigger matches on it, so a rename must not be able to orphan a new account.';

create or replace function public.assign_default_permissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_role_id uuid;
begin
  if new.job_role_id is not null then return new; end if;

  -- Matched on `code`, not on the name a tenant is now free to change.
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
  insert into public.profile_permissions (profile_id, permission_code)
  select new.id, jrp.permission_code
    from public.job_role_permissions jrp
   where jrp.job_role_id = v_role_id
  on conflict do nothing;
  return new;
end;
$$;

-- Provisioning writes the codes too, so a new tenant is not seeded into the
-- state this migration had to repair.
create or replace function public.provision_organization(p_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare r record;
begin
  if p_org is null then return; end if;

  insert into public.job_roles (org_id, name, code, description, base_role, is_system, sort_order)
  values
    (p_org, 'Administrator', 'administrator',
     'Everything, including creating people and granting permissions.', 'manager', true, 10),
    (p_org, 'Operations Manager', 'operations_manager',
     'Runs the field: schedule, visits, stores, reps and the warehouse.', 'manager', true, 20),
    (p_org, 'CFO', 'cfo',
     'Finance oversight: the warehouse and fulfilment side, and HR.', 'warehouse', true, 30),
    (p_org, 'HR Manager', 'hr_manager',
     'The HR module only. Reads salaries, dates of birth and disciplinary files.', 'hr_manager', true, 40),
    (p_org, 'Warehouse Clerk', 'warehouse_clerk',
     'Receiving, picking, dispatch and stock counts.', 'warehouse', true, 50),
    (p_org, 'Sales Rep', 'sales_rep',
     'Works in the mobile app. Their own working day and their own HR record.', 'rep', true, 60)
  on conflict do nothing;

  for r in
    select * from (values
      ('administrator',      'admin'),
      ('operations_manager', 'dashboard'),
      ('operations_manager', 'insights'),
      ('operations_manager', 'sales_coverage'),
      ('operations_manager', 'field_ops'),
      ('operations_manager', 'team'),
      ('operations_manager', 'resources'),
      ('operations_manager', 'warehouse'),
      ('operations_manager', 'warehouse_approve'),
      ('operations_manager', 'workday'),
      ('cfo',                'warehouse'),
      ('cfo',                'warehouse_approve'),
      ('cfo',                'hr'),
      ('cfo',                'workday'),
      ('hr_manager',         'hr'),
      ('hr_manager',         'hr_settings'),
      ('hr_manager',         'workday'),
      ('warehouse_clerk',    'warehouse'),
      ('warehouse_clerk',    'workday'),
      ('sales_rep',          'workday')
    ) as v(role_code, permission_code)
  loop
    insert into public.job_role_permissions (job_role_id, permission_code)
    select jr.id, r.permission_code
      from public.job_roles jr
     where jr.org_id = p_org and jr.code = r.role_code
    on conflict do nothing;
  end loop;

  -- HR defaults, unchanged.
  insert into public.hr_settings (org_id) values (p_org) on conflict (org_id) do nothing;

  insert into public.hr_departments (org_id, name, code, sort_order)
  select p_org, v.name, v.code, v.sort_order from (values
    ('Field Sales', 'FIELD', 10), ('Warehouse & Logistics', 'WHSE', 20),
    ('Management', 'MGMT', 30),   ('Administration', 'ADMIN', 40)
  ) as v(name, code, sort_order)
  on conflict do nothing;

  insert into public.hr_leave_types (org_id, name, code, is_paid, requires_document, deducts_from_balance, sort_order)
  select p_org, v.name, v.code, v.is_paid, v.requires_document, v.deducts, v.sort_order from (values
    ('Annual Leave', 'annual', true, false, true, 10),
    ('Sick Leave', 'sick', true, true, true, 20),
    ('Family Responsibility Leave', 'family', true, false, true, 30),
    ('Unpaid Leave', 'unpaid', false, false, false, 40),
    ('Other', 'other', true, false, true, 50)
  ) as v(name, code, is_paid, requires_document, deducts, sort_order)
  on conflict (org_id, code) do nothing;

  insert into public.hr_review_categories (org_id, name, description, sort_order)
  select p_org, v.name, v.description, v.sort_order from (values
    ('Sales Performance', 'Volume, value and target achievement in the territory.', 10),
    ('Store Coverage', 'Visiting the stores on the call cycle, at the agreed frequency.', 20),
    ('Merchandising Execution', 'Shelf presence, facings, planogram compliance, promotional set-up.', 30),
    ('Attendance & Reliability', 'Starting and ending the working day, punctuality, availability.', 40),
    ('Reporting Accuracy', 'Forms, photos and stock counts completed correctly and on time.', 50),
    ('Product Knowledge', 'Range, pack sizes, pricing and promotions.', 60),
    ('Customer/Store Relationships', 'Standing with store managers and buyers.', 70),
    ('Teamwork', 'Working with colleagues, the warehouse and the office.', 80),
    ('Professional Conduct', 'Presentation, company property, and adherence to policy.', 90)
  ) as v(name, description, sort_order)
  on conflict (org_id, lower(name)) do nothing;

  insert into public.hr_lookups (org_id, kind, code, label, sort_order, meta)
  select p_org, v.kind, v.code, v.label, v.sort_order, v.meta::jsonb from (values
    ('incident_type','attendance','Attendance',10,'{}'),
    ('incident_type','late_arrival','Late Arrival',20,'{}'),
    ('incident_type','absence','Absence',30,'{}'),
    ('incident_type','misconduct','Misconduct',40,'{}'),
    ('incident_type','poor_performance','Poor Performance',50,'{}'),
    ('incident_type','policy_violation','Policy Violation',60,'{}'),
    ('incident_type','customer_complaint','Customer Complaint',70,'{}'),
    ('incident_type','asset_issue','Property/Asset Issue',80,'{}'),
    ('incident_type','insubordination','Insubordination',90,'{}'),
    ('incident_type','other','Other',100,'{}'),
    ('severity','minor','Minor',10,'{"rank": 1}'),
    ('severity','moderate','Moderate',20,'{"rank": 2}'),
    ('severity','serious','Serious',30,'{"rank": 3}'),
    ('severity','gross_misconduct','Gross Misconduct',40,'{"rank": 4}'),
    ('case_status','open','Open',10,'{}'),
    ('case_status','under_investigation','Under Investigation',20,'{}'),
    ('case_status','employee_response_required','Employee Response Required',30,'{"awaiting_employee": true}'),
    ('case_status','hearing_scheduled','Hearing Scheduled',40,'{"awaiting_hearing": true}'),
    ('case_status','outcome_pending','Outcome Pending',50,'{"awaiting_hearing": true}'),
    ('case_status','closed','Closed',60,'{"terminal": true}'),
    ('warning_type','verbal','Verbal Warning',10,'{}'),
    ('warning_type','written','Written Warning',20,'{}'),
    ('warning_type','final_written','Final Written Warning',30,'{}'),
    ('warning_type','other','Other',40,'{}'),
    ('outcome','no_action','No Action',10,'{}'),
    ('outcome','verbal_warning','Verbal Warning',20,'{"warning_type": "verbal"}'),
    ('outcome','written_warning','Written Warning',30,'{"warning_type": "written"}'),
    ('outcome','final_written_warning','Final Written Warning',40,'{"warning_type": "final_written"}'),
    ('outcome','further_action','Further Action',50,'{}'),
    ('outcome','suspension','Suspension',60,'{}'),
    ('outcome','termination','Termination',70,'{}'),
    ('outcome','other','Other',80,'{}'),
    ('document_category','employment_contract','Employment Contract',10,'{"tracks_contract": true}'),
    ('document_category','id_passport','ID / Passport',20,'{}'),
    ('document_category','drivers_licence','Driver''s Licence',30,'{}'),
    ('document_category','medical','Medical Document',40,'{}'),
    ('document_category','certificate','Certificate',50,'{}'),
    ('document_category','warning','Warning / HR Document',60,'{}'),
    ('document_category','other','Other',70,'{}')
  ) as v(kind, code, label, sort_order, meta)
  on conflict (org_id, kind, code) do nothing;
end;
$$;

revoke all on function public.provision_organization(uuid) from public, anon, authenticated;
revoke all on function public.assign_default_permissions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saving a job role
-- ---------------------------------------------------------------------------
--
-- One RPC rather than five client writes, because the rules are about the whole
-- change and not about any one row: `admin` must not appear on a template that
-- is not the administrator, a built-in template keeps its code and its
-- systemness, and the whole thing wants one audit entry rather than eight.
--
-- ⚠️ Editing a template does NOT change the people already on it. That is the
-- model working as designed — `profile_permissions` is a copy, so an
-- administrator's individual adjustments survive a template edit — but it is
-- surprising enough that the screen says so and offers `reapply_job_role`.

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
  v_org      uuid := public.current_org_id();
  v_existing record;
  v_id       uuid;
  v_name     text := btrim(coalesce(p_name, ''));
  v_perms    text[] := coalesce(p_permissions, '{}');
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
    select * into v_existing from public.job_roles where id = p_id;
    if v_existing is null or v_existing.org_id is distinct from v_org then
      raise exception 'That job role does not exist.' using errcode = '42501';
    end if;
  end if;

  -- `admin` belongs to the built-in administrator template and nowhere else.
  -- Otherwise an administrator could mint a template that grants their own
  -- level of access and hand it out from the create dialog, which is the rule
  -- `set_profile_permission` and the invite route already enforce.
  if 'admin' = any (v_perms)
     and coalesce(v_existing.code, '') is distinct from 'administrator' then
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

/**
 * Delete a job role.
 *
 * Refused for a built-in one and for any role somebody is on. The foreign key
 * says `on delete set null`, so deleting a role in use would leave those people
 * holding permissions with nothing naming where they came from — a quiet mess
 * rather than a loud refusal. Disabling is the answer, and the error says so.
 */
create or replace function public.delete_job_role(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_row record;
  v_in_use integer;
begin
  if not public.has_permission('admin') then
    raise exception 'Only an administrator can delete a job role.' using errcode = '42501';
  end if;
  select * into v_row from public.job_roles where id = p_id;
  if v_row is null or v_row.org_id is distinct from v_org then
    raise exception 'That job role does not exist.' using errcode = '42501';
  end if;
  if v_row.is_system then
    raise exception 'Built-in job roles cannot be deleted. Disable it instead.'
      using errcode = '42501';
  end if;
  select count(*) into v_in_use from public.profiles where job_role_id = p_id;
  if v_in_use > 0 then
    raise exception '% % on this job role. Move them first, or disable it.',
      v_in_use, case when v_in_use = 1 then 'person is' else 'people are' end
      using errcode = '42501';
  end if;

  delete from public.job_roles where id = p_id;
  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, auth.uid(), 'access.job_role_deleted', 'job_role', p_id,
          jsonb_build_object('name', v_row.name, 'via', current_user));
end;
$$;

/**
 * Push a template back onto everybody who holds it.
 *
 * The counterpart to the copy-not-reference decision: because editing a
 * template deliberately leaves existing people alone, there has to be a way to
 * say "no, I meant everyone". It replaces their grants, so any individual
 * adjustment an administrator made is discarded — which is what makes it worth
 * an explicit button and a confirmation rather than happening on save.
 *
 * Goes through `set_job_role` per person so the last-administrator guard and
 * the audit entry apply to each one.
 */
create or replace function public.reapply_job_role(p_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_n   integer := 0;
  r     record;
begin
  if not public.has_permission('admin') then
    raise exception 'Only an administrator can re-apply a job role.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.job_roles
                  where id = p_id and org_id = v_org) then
    raise exception 'That job role does not exist.' using errcode = '42501';
  end if;

  for r in select id from public.profiles where job_role_id = p_id and org_id = v_org loop
    perform public.set_job_role(r.id, p_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.save_job_role(uuid, text, text, text, boolean, text[]) from public, anon;
revoke all on function public.delete_job_role(uuid) from public, anon;
revoke all on function public.reapply_job_role(uuid) from public, anon;
grant execute on function public.save_job_role(uuid, text, text, text, boolean, text[]) to authenticated;
grant execute on function public.delete_job_role(uuid) to authenticated;
grant execute on function public.reapply_job_role(uuid) to authenticated;

-- The direct write policies come off. Everything about a job role now moves
-- through the three functions above, which is where the rules live.
drop policy if exists job_roles_write on public.job_roles;
drop policy if exists job_role_permissions_write on public.job_role_permissions;
revoke insert, update, delete on public.job_roles from authenticated, anon;
revoke insert, update, delete on public.job_role_permissions from authenticated, anon;

comment on function public.save_job_role(uuid, text, text, text, boolean, text[]) is
  'Creates or updates a job role and replaces its permission set. Refuses `admin` on anything but the built-in administrator, and never moves `code` or `is_system`. Editing a template does not touch the people already on it — see reapply_job_role.';
