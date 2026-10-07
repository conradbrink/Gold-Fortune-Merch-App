-- Rollback for 20261007000001_tenant_isolation_fixes.
--
-- Restores every definition that migration replaced, exactly as production
-- held it on 7 October 2026 (read back with pg_get_functiondef / pg_policies
-- before the change), then drops the helper it added. Running this re-opens
-- the leaks and breaks company creation again — it exists so that a bad
-- forward migration can be undone in one step, not as a normal path.
--
-- Order matters: the four company-id helpers stop calling
-- `caller_may_read_org` before it is dropped.

create or replace function public.org_timezone(p_org uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC')
$function$;

create or replace function public.hr_working_days(p_org uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::numeric
    from generate_series(p_from, p_to, interval '1 day') d
   where extract(isodow from d)::smallint = any(
     coalesce((select workweek from public.hr_settings where org_id = p_org),
              '{1,2,3,4,5}'::smallint[]))
$function$;

create or replace function public.hr_leave_year_of(p_org uuid, p_date date)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when extract(month from p_date)::int
         >= coalesce((select leave_year_start_month from public.hr_settings where org_id = p_org), 1)
    then extract(year from p_date)::int
    else extract(year from p_date)::int - 1
  end
$function$;

create or replace function public.hr_current_leave_year(p_org uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.hr_leave_year_of(p_org, current_date)
$function$;

drop function if exists public.caller_may_read_org(uuid);

create or replace function public.hr_can_view_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.hr_is_hr()
      or p_employee_id = public.hr_my_employee_id()
      or public.hr_manages_employee(p_employee_id)
$function$;

create or replace function public.hr_manages_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive chain as (
    select e.id, e.manager_id, 1 as depth
      from public.hr_employees e
     where e.id = p_employee_id
    union all
    select m.id, m.manager_id, c.depth + 1
      from public.hr_employees m
      join chain c on m.id = c.manager_id
     where c.depth < 6
  )
  select exists (
    select 1 from chain
     where chain.manager_id = public.hr_my_employee_id()
  )
$function$;

drop policy if exists file_groups_select on public.file_groups;
create policy file_groups_select on public.file_groups
  for select
  using ((select public.current_org_id()) is not null);

drop policy if exists file_reps_select on public.file_reps;
create policy file_reps_select on public.file_reps
  for select
  using (
    ((select public."current_role"()) = 'manager')
    or (rep_id = (select auth.uid()))
  );

-- provision_organization as it was (and as it failed: 42P10 on every new
-- organisation since 28 August 2026). Rolling back restores that failure.
create or replace function public.provision_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
