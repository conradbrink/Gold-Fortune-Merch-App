-- Rollback for 20261029161700_driver_role.
--
-- Refuses while any login is a driver, or any custom job role is a driver's:
-- the constraints below would reject those rows, and quietly turning a driver
-- into somebody else is not a rollback's decision. Move them to another job
-- role first (Settings → Users).
--
-- Every function body below is production's from before the migration; the
-- rehearsal compares md5(pg_get_functiondef) before the up and after this.

do $$
begin
  if exists (select 1 from public.profiles where role = 'driver') then
    raise exception 'Some logins are drivers. Move them to another job role before rolling back.';
  end if;
  if exists (select 1 from public.job_roles where base_role = 'driver' and code is distinct from 'driver') then
    raise exception 'A custom job role is a driver''s. Change or delete it before rolling back.';
  end if;
end $$;

-- The built-in Driver template. profiles.job_role_id is ON DELETE SET NULL,
-- and no profile is a driver (checked above).
delete from public.job_role_permissions
 where job_role_id in (select id from public.job_roles where code = 'driver' and is_system);
delete from public.job_roles where code = 'driver' and is_system;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('rep', 'manager', 'warehouse', 'hr_manager'));

alter table public.job_roles drop constraint if exists job_roles_base_role_check;
alter table public.job_roles add constraint job_roles_base_role_check
  check (base_role in ('rep', 'manager', 'warehouse', 'hr_manager'));

comment on column public.profiles.role is
  'rep = field merchandiser, uses the Android app only. manager = full web dashboard, and the Admin tier for HR. warehouse = the fulfilment and inventory screens only. hr_manager = the HR module only; deliberately has no access to sales, warehouse, settings or the security trail outside HR.';

create or replace function public.provision_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_scorecard uuid;
begin
  if p_org is null then return; end if;

  insert into public.job_roles (org_id, name, code, description, base_role, is_system, sort_order)
  values
    (p_org, 'Administrator', 'administrator',
     'Everything, including creating people and granting permissions.', 'manager', true, 10),
    (p_org, 'Operations Manager', 'operations_manager',
     'Runs the field: schedules, check-ins, sites, staff and the warehouse.', 'manager', true, 20),
    (p_org, 'CFO', 'cfo',
     'Finance oversight: the warehouse and fulfilment side, and HR.', 'warehouse', true, 30),
    (p_org, 'HR Manager', 'hr_manager',
     'The HR module only. Reads salaries, dates of birth and disciplinary files.', 'hr_manager', true, 40),
    (p_org, 'Warehouse Clerk', 'warehouse_clerk',
     'Receiving, picking, dispatch and stock counts.', 'warehouse', true, 50),
    (p_org, 'Field Staff', 'sales_rep',
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
      ('operations_manager', 'invoicing'),
      ('operations_manager', 'warehouse_approve'),
      ('operations_manager', 'workday'),
      ('cfo',                'warehouse'),
      ('cfo',                'invoicing'),
      ('cfo',                'warehouse_approve'),
      ('cfo',                'hr'),
      ('cfo',                'workday'),
      ('hr_manager',         'hr'),
      ('hr_manager',         'hr_settings'),
      ('hr_manager',         'workday'),
      ('warehouse_clerk',    'warehouse'),
      ('warehouse_clerk',    'invoicing'),
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
    ('Field Team', 'FIELD', 10), ('Warehouse & Logistics', 'WHSE', 20),
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

  -- Categories hang off a scorecard since 28 August. One general scorecard;
  -- the industry templates will bring their own.
  insert into public.hr_review_templates (org_id, name, description, sort_order)
  values (p_org, 'General', 'The standard scorecard. Edit or add scorecards per department.', 10)
  on conflict (org_id, lower(name)) do nothing;

  select id into v_scorecard
    from public.hr_review_templates
   where org_id = p_org and lower(name) = 'general';

  insert into public.hr_review_categories (org_id, template_id, name, description, sort_order)
  select p_org, v_scorecard, v.name, v.description, v.sort_order from (values
    ('Quality of Work', 'The standard of the work delivered, first time.', 10),
    ('Attendance & Reliability', 'Starting and ending the working day, punctuality, availability.', 20),
    ('Reporting Accuracy', 'Forms, photos and records completed correctly and on time.', 30),
    ('Client Relationships', 'How clients and their staff experience working with this person.', 40),
    ('Teamwork', 'Working with colleagues and the office.', 50),
    ('Professional Conduct', 'Presentation, company property, and adherence to policy.', 60)
  ) as v(name, description, sort_order)
  on conflict (template_id, lower(name)) do nothing;

  insert into public.hr_lookups (org_id, kind, code, label, sort_order, meta)
  select p_org, v.kind, v.code, v.label, v.sort_order, v.meta::jsonb from (values
    ('incident_type','attendance','Attendance',10,'{}'),
    ('incident_type','late_arrival','Late Arrival',20,'{}'),
    ('incident_type','absence','Absence',30,'{}'),
    ('incident_type','misconduct','Misconduct',40,'{}'),
    ('incident_type','poor_performance','Poor Performance',50,'{}'),
    ('incident_type','policy_violation','Policy Violation',60,'{}'),
    ('incident_type','customer_complaint','Client Complaint',70,'{}'),
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
    ('warning_type','written','Written Warning',20,'{"requires_document": true}'),
    ('warning_type','final_written','Final Written Warning',30,'{"requires_document": true}'),
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
$function$;

create or replace function public.assign_default_permissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.save_job_role(p_id uuid, p_name text, p_description text, p_base_role text, p_active boolean, p_permissions text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  perform public.require_writable();
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
$function$;

create or replace function public.assign_dispatch_rep(p_dispatch uuid, p_rep uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_number text;
  v_role   text;
  v_active boolean;
  v_rep_name text;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  if not public.has_permission('warehouse') then
    raise exception 'Only the warehouse can assign a delivery.' using errcode = '42501';
  end if;

  select dispatch_number into v_number
    from public.dispatches
   where id = p_dispatch and org_id = v_org;
  if not found then
    raise exception 'That dispatch does not exist.' using errcode = '42501';
  end if;

  if p_rep is not null then
    select role, is_active, full_name into v_role, v_active, v_rep_name
      from public.profiles where id = p_rep and org_id = v_org;
    if not found then
      raise exception 'That person is not in your organisation.' using errcode = '42501';
    end if;
    if not v_active then
      raise exception 'That account is deactivated.' using errcode = '42501';
    end if;
    if v_role <> 'rep' then
      raise exception '% cannot be given a delivery: only field staff use the app.',
        coalesce(v_rep_name, 'That account') using errcode = '42501';
    end if;
  end if;

  update public.dispatches
     set assigned_rep_id = p_rep
   where id = p_dispatch;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, auth.uid(), 'dispatch.rep_assigned', 'dispatch', p_dispatch,
          jsonb_build_object('dispatch_number', v_number,
                             'rep_id', p_rep,
                             'rep', coalesce(v_rep_name, 'unassigned')));
end;
$function$;

comment on function public.assign_dispatch_rep(uuid, uuid) is
  'Gives a dispatch to a field rep, or takes it back with null. Refuses anyone who is not an active rep in the caller''s organisation, because only a rep can open the app the job appears in.';
