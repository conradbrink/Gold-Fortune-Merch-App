-- Per-user permissions, with job roles as templates.
--
-- Until now access was one string on `profiles`: rep, manager, warehouse,
-- hr_manager. That is enough for one company with four kinds of person and
-- wrong for a product — the CFO who needs the warehouse and HR but not sales
-- has no role, and inventing `cfo` would only move the problem to the next
-- person who does not fit.
--
-- ------------------------------------------------------------ the shape
--
--   app_permissions        what can be granted. Global: the application
--                          defines its own surface, and a tenant inventing a
--                          permission the code never checks would be a lie.
--   job_roles              per-organisation templates — Administrator, CFO,
--                          Warehouse Clerk. Editable and addable by a tenant.
--   job_role_permissions   what a template ticks.
--   profile_permissions    what a PERSON actually holds. The effective set,
--                          not a lookup through the template.
--
-- That last one is the decision worth defending. Resolving permissions through
-- the template at query time would be less to store and would mean editing the
-- CFO template next year silently re-granting something an admin had
-- deliberately unticked for one person. A template is a starting point that is
-- copied, not a rule that keeps applying.
--
-- ------------------------------------------------ role is not going away
--
-- `profiles.role` stays and every template names one in `base_role`. Three
-- reasons, none of them nostalgia:
--
--   * The Flutter app routes on it (`role != 'rep'` → manager notice). It has
--     no idea permissions exist and will not until it ships a build that does.
--   * Around sixty tables still name role strings in their policies. This
--     migration converts none of them; the HR and warehouse modules follow in
--     the next one, and the rest after that. Until then `base_role` is what
--     actually governs data in the unconverted modules, which is why
--     `app_permissions.data_enforced` exists and why the admin screen says so
--     out loud rather than showing a tick box that only moves a menu item.
--   * It is the honest floor. A template whose permissions exceed what its
--     base_role can read would be permissions theatre, so the seeded templates
--     below are deliberately built the other way round.

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.app_permissions (
  code        text primary key,
  label       text not null,
  description text not null,
  -- Which sidebar group this lights up, for the admin screen's grouping.
  area        text not null,
  -- True when the DATABASE enforces this permission, not just the menu. False
  -- means the module still reads `profiles.role`, so ticking it changes what a
  -- person can reach and not what they can read. The admin screen shows the
  -- difference; hiding it would be the worst kind of security UI.
  data_enforced boolean not null default false,
  sort_order  integer not null default 0
);

insert into public.app_permissions (code, label, description, area, data_enforced, sort_order) values
  ('admin', 'Full administrator',
   'Everything, including creating people and granting permissions.', 'Administration', true, 10),
  ('dashboard', 'Dashboard',
   'The main dashboard: visits, coverage, the live rep map and the working day.', 'Overview', false, 20),
  ('insights', 'Sales and reports',
   'Sales, Reports and Warehouse insights — commercial and staff performance.', 'Insights', false, 30),
  ('sales_coverage', 'Leads, stores and territories',
   'The customer estate and who covers it.', 'Sales & Coverage', false, 40),
  ('field_ops', 'Field operations',
   'Schedule, Visits & Activities, Promotions, and the store GPS review queue.', 'Field Operations', false, 50),
  ('warehouse', 'Warehouse and fulfilment',
   'Warehouse, Orders, Inventory and warehouse setup.', 'Warehouse & Fulfilment', true, 60),
  ('warehouse_approve', 'Approve stock decisions',
   'Approve or reject stock adjustments and stocktakes. Separate from warehouse work on purpose: whoever counts the stock should not be the one who signs off the variance.',
   'Warehouse & Fulfilment', true, 70),
  ('team', 'Representatives',
   'The rep directory and store assignments.', 'Team', false, 80),
  ('resources', 'Products, forms and files',
   'The shared reference material reps work from.', 'Resources', false, 90),
  ('hr', 'Human resources',
   'Employees, attendance, leave, documents, reviews and disciplinary records — including salaries and dates of birth.',
   'Human Resources', true, 100),
  ('hr_settings', 'HR settings',
   'Working hours, leave types, departments, review and disciplinary vocabularies, and creating HR staff.',
   'Human Resources', true, 110),
  ('company_settings', 'Company settings',
   'The organisation profile and VAT rate.', 'Administration', false, 120),
  ('workday', 'Start and stop their own day',
   'Record their own working day from the web, the way the rep app does.', 'Everyone', true, 130)
on conflict (code) do update
  set label = excluded.label,
      description = excluded.description,
      area = excluded.area,
      data_enforced = excluded.data_enforced,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Templates and grants
-- ---------------------------------------------------------------------------

create table if not exists public.job_roles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  description text,
  -- The `profiles.role` a person on this template gets. Constrained to the
  -- four the rest of the system knows about, because it is still what the
  -- mobile app and the unconverted policies read.
  base_role  text not null check (base_role in ('rep','manager','warehouse','hr_manager')),
  -- Seeded by provisioning. A tenant may edit or disable one but deleting a
  -- system template would leave people pointing at nothing.
  is_system  boolean not null default false,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists job_roles_org_name_idx
  on public.job_roles (org_id, lower(name));

create table if not exists public.job_role_permissions (
  job_role_id     uuid not null references public.job_roles(id) on delete cascade,
  permission_code text not null references public.app_permissions(code) on delete cascade,
  primary key (job_role_id, permission_code)
);

create table if not exists public.profile_permissions (
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.app_permissions(code) on delete cascade,
  granted_by      uuid references public.profiles(id) on delete set null,
  granted_at      timestamptz not null default now(),
  primary key (profile_id, permission_code)
);

create index if not exists profile_permissions_code_idx
  on public.profile_permissions (permission_code);

alter table public.profiles
  add column if not exists job_role_id uuid references public.job_roles(id) on delete set null;

drop trigger if exists job_roles_set_updated_at on public.job_roles;
create trigger job_roles_set_updated_at before update on public.job_roles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The one question every policy asks
-- ---------------------------------------------------------------------------

/**
 * Whether the caller holds a permission.
 *
 * `admin` satisfies everything, so policies never have to write
 * `has_permission('x') or has_permission('admin')` — and cannot forget to.
 *
 * `is_active` is checked here for the same reason `current_org_id()` checks it:
 * deactivating somebody must take their access with it, and a permission row
 * outliving the deactivation would be a way back in.
 *
 * security definer because `profile_permissions` has RLS of its own, and a
 * policy that had to read it under the caller's rights would recurse.
 */
create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.profile_permissions pp
      join public.profiles p on p.id = pp.profile_id
     where pp.profile_id = auth.uid()
       and p.is_active
       and pp.permission_code in (p_code, 'admin')
  )
$$;

/** The caller's own permission codes, for the navigation to read once. */
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(pp.permission_code order by pp.permission_code), '{}')
    from public.profile_permissions pp
    join public.profiles p on p.id = pp.profile_id
   where pp.profile_id = auth.uid() and p.is_active
$$;

revoke all on function public.has_permission(text) from public, anon;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.my_permissions() to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning a new organisation
-- ---------------------------------------------------------------------------
--
-- 🔴 This is the multi-tenant hole the HR module opened this morning and this
-- closes. Those migrations seeded settings, lookups, leave types and review
-- categories with `insert … select from organizations` — which covers the orgs
-- that existed when the migration ran and NO organisation created afterwards.
-- The second tenant would have signed up to an HR module where every dropdown
-- was empty and attendance had no working hours to measure against.
--
-- One function, called by a trigger on `organizations`, and called again by
-- this migration for the org that already exists. Idempotent throughout, so
-- running it twice cannot undo an edit a tenant has made.

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

  -- ---------------------------------------------------------------- job roles
  insert into public.job_roles (org_id, name, description, base_role, is_system, sort_order)
  values
    (p_org, 'Administrator',
     'Everything, including creating people and granting permissions.', 'manager', true, 10),
    (p_org, 'Operations Manager',
     'Runs the field: schedule, visits, stores, reps and the warehouse.', 'manager', true, 20),
    (p_org, 'CFO',
     'Finance oversight: the warehouse and fulfilment side, and HR.', 'warehouse', true, 30),
    (p_org, 'HR Manager',
     'The HR module only. Reads salaries, dates of birth and disciplinary files.', 'hr_manager', true, 40),
    (p_org, 'Warehouse Clerk',
     'Receiving, picking, dispatch and stock counts.', 'warehouse', true, 50),
    (p_org, 'Sales Rep',
     'Works in the mobile app. Their own working day and their own HR record.', 'rep', true, 60)
  on conflict do nothing;

  -- Which template ticks what. The CFO deliberately does NOT get `insights` or
  -- `dashboard`: those modules still read `profiles.role`, and a CFO on the
  -- `warehouse` base role would get the pages with empty tables. They go in
  -- when those policies are converted, not before.
  for r in
    select * from (values
      ('Administrator',      'admin'),
      ('Operations Manager', 'dashboard'),
      ('Operations Manager', 'insights'),
      ('Operations Manager', 'sales_coverage'),
      ('Operations Manager', 'field_ops'),
      ('Operations Manager', 'team'),
      ('Operations Manager', 'resources'),
      ('Operations Manager', 'warehouse'),
      ('Operations Manager', 'warehouse_approve'),
      ('Operations Manager', 'workday'),
      ('CFO',                'warehouse'),
      ('CFO',                'warehouse_approve'),
      ('CFO',                'hr'),
      ('CFO',                'workday'),
      ('HR Manager',         'hr'),
      ('HR Manager',         'hr_settings'),
      ('HR Manager',         'workday'),
      ('Warehouse Clerk',    'warehouse'),
      ('Warehouse Clerk',    'workday'),
      ('Sales Rep',          'workday')
    ) as v(role_name, permission_code)
  loop
    insert into public.job_role_permissions (job_role_id, permission_code)
    select jr.id, r.permission_code
      from public.job_roles jr
     where jr.org_id = p_org and jr.name = r.role_name and jr.is_system
    on conflict do nothing;
  end loop;

  -- ------------------------------------------------------------- HR defaults
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

create or replace function public.provision_organization_on_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.provision_organization(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_provision on public.organizations;
create trigger organizations_provision after insert on public.organizations
  for each row execute function public.provision_organization_on_insert();

revoke all on function public.provision_organization(uuid) from public, anon, authenticated;
revoke all on function public.provision_organization_on_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: today must behave exactly as it did yesterday
-- ---------------------------------------------------------------------------

select public.provision_organization(o.id) from public.organizations o;

-- Point each existing person at the template matching the role they already
-- hold, and give them that template's permissions. Chosen so nobody gains or
-- loses anything on the day this lands:
--   manager    → Administrator (admin ⇒ everything, which is what they had)
--   warehouse  → Warehouse Clerk
--   hr_manager → HR Manager
--   rep        → Sales Rep
update public.profiles p
   set job_role_id = jr.id
  from public.job_roles jr
 where jr.org_id = p.org_id
   and jr.is_system
   and p.job_role_id is null
   and jr.name = case p.role
     when 'manager'    then 'Administrator'
     when 'warehouse'  then 'Warehouse Clerk'
     when 'hr_manager' then 'HR Manager'
     else 'Sales Rep'
   end;

insert into public.profile_permissions (profile_id, permission_code)
select p.id, jrp.permission_code
  from public.profiles p
  join public.job_role_permissions jrp on jrp.job_role_id = p.job_role_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.app_permissions enable row level security;
alter table public.job_roles enable row level security;
alter table public.job_role_permissions enable row level security;
alter table public.profile_permissions enable row level security;

-- The catalogue is the application's own description of itself. Readable by
-- anyone signed in — it is a list of feature names — and writable by nobody:
-- a tenant inventing a permission the code never checks would be a lie told to
-- whoever ticked it.
drop policy if exists app_permissions_select on public.app_permissions;
create policy app_permissions_select on public.app_permissions
  for select to authenticated using (true);
revoke insert, update, delete on public.app_permissions from authenticated, anon;

drop policy if exists job_roles_select on public.job_roles;
create policy job_roles_select on public.job_roles
  for select using (org_id = (select public.current_org_id()));

drop policy if exists job_roles_write on public.job_roles;
create policy job_roles_write on public.job_roles
  for all using (
    org_id = (select public.current_org_id()) and (select public.has_permission('admin'))
  ) with check (
    org_id = (select public.current_org_id()) and (select public.has_permission('admin'))
  );

drop policy if exists job_role_permissions_select on public.job_role_permissions;
create policy job_role_permissions_select on public.job_role_permissions
  for select using (
    exists (select 1 from public.job_roles jr where jr.id = job_role_permissions.job_role_id)
  );

drop policy if exists job_role_permissions_write on public.job_role_permissions;
create policy job_role_permissions_write on public.job_role_permissions
  for all using (
    (select public.has_permission('admin'))
    and exists (
      select 1 from public.job_roles jr
       where jr.id = job_role_permissions.job_role_id
         and jr.org_id = (select public.current_org_id()))
  ) with check (
    (select public.has_permission('admin'))
    and exists (
      select 1 from public.job_roles jr
       where jr.id = job_role_permissions.job_role_id
         and jr.org_id = (select public.current_org_id()))
  );

-- Everyone may read their own grants — the navigation needs them, and knowing
-- what you can do is not a disclosure. Reading somebody else's is an admin act.
drop policy if exists profile_permissions_select on public.profile_permissions;
create policy profile_permissions_select on public.profile_permissions
  for select using (
    profile_id = (select auth.uid())
    or (
      (select public.has_permission('admin'))
      and exists (
        select 1 from public.profiles p
         where p.id = profile_permissions.profile_id
           and p.org_id = (select public.current_org_id()))
    )
  );

-- No write policy at all, and the privilege is revoked underneath. Grants move
-- only through `set_job_role` and `set_profile_permission`, which check the
-- caller, refuse the last-administrator case, and write the audit trail. A
-- table where a user could INSERT their own row is not a permission system.
revoke insert, update, delete on public.profile_permissions from authenticated, anon;

comment on table public.app_permissions is
  'What can be granted. Application-defined and read-only to tenants: a permission nobody checks would be a lie told to whoever ticked it. `data_enforced` marks the ones the database honours, as opposed to the ones that currently only shape the menu.';
comment on table public.profile_permissions is
  'The effective grants for one person, copied from a job role and then edited. Written only by set_job_role() and set_profile_permission().';
comment on function public.provision_organization(uuid) is
  'Seeds a new tenant: job-role templates and every HR default. Called by a trigger on organizations, and idempotent so it can be re-run.';
