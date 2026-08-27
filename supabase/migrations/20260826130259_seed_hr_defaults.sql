-- Defaults, and the one-time link between the people who already exist and the
-- HR records that now describe them.
--
-- Two halves, and only the second is interesting.
--
-- The first half is vocabulary: an org with no settings row, no departments and
-- no incident types is an HR module where every dropdown is empty and the first
-- hour is data entry. Everything seeded here is editable in HR → Settings, and
-- `on conflict do nothing` means re-running this cannot undo an edit.
--
-- The second half creates an `hr_employees` row for every existing profile.
-- This is the "do not create duplicate employee records" requirement done in
-- the only direction that is safe: the profile is the anchor, the employee row
-- points at it, and the unique constraint on `profile_id` means running this
-- twice links nothing twice.
--
-- What it deliberately does NOT invent:
--
--   * `start_date` stays null. The earliest workday session is a real date but
--     it is the first day somebody pressed a button, not the day they were
--     hired, and a dashboard tile reading "Recently joined: 3" built out of that
--     would be a fabrication that looks like a fact. HR fills these in.
--   * No salary row. `hr_employee_compensation` stays empty until a human types
--     a number into it.
--   * No date of birth, ID number, address or emergency contact. The database
--     does not know them and a blank field says so.
--
-- What it does assert: reps report to the manager account, because they do, and
-- the reporting line is what the line-manager half of every HR policy reads. An
-- org with a flat null `manager_id` would leave that path untested and every
-- manager-scoped screen empty.

-- ---------------------------------------------------------------------------
-- Settings, one row per organisation
-- ---------------------------------------------------------------------------

insert into public.hr_settings (org_id)
select o.id from public.organizations o
on conflict (org_id) do nothing;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

insert into public.hr_departments (org_id, name, code, sort_order)
select o.id, d.name, d.code, d.sort_order
  from public.organizations o
  cross join (values
    ('Field Sales',           'FIELD', 10),
    ('Warehouse & Logistics', 'WHSE',  20),
    ('Management',            'MGMT',  30),
    ('Administration',        'ADMIN', 40)
  ) as d(name, code, sort_order)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Vocabularies
-- ---------------------------------------------------------------------------
--
-- `meta.rank` on a severity is what the dashboard sorts and colours by, so
-- adding "Very Serious" between two existing levels is a number, not a schema
-- change. `meta.terminal` marks the case statuses that mean the case is over —
-- the open-case counts read that flag rather than hard-coding the string
-- 'closed', so an org that renames it does not silently zero its dashboard.

insert into public.hr_lookups (org_id, kind, code, label, sort_order, meta)
select o.id, v.kind, v.code, v.label, v.sort_order, v.meta::jsonb
  from public.organizations o
  cross join (values
    -- Incident types (section 8)
    ('incident_type', 'attendance',         'Attendance',           10, '{}'),
    ('incident_type', 'late_arrival',       'Late Arrival',         20, '{}'),
    ('incident_type', 'absence',            'Absence',              30, '{}'),
    ('incident_type', 'misconduct',         'Misconduct',           40, '{}'),
    ('incident_type', 'poor_performance',   'Poor Performance',     50, '{}'),
    ('incident_type', 'policy_violation',   'Policy Violation',     60, '{}'),
    ('incident_type', 'customer_complaint', 'Customer Complaint',   70, '{}'),
    ('incident_type', 'asset_issue',        'Property/Asset Issue', 80, '{}'),
    ('incident_type', 'insubordination',    'Insubordination',      90, '{}'),
    ('incident_type', 'other',              'Other',               100, '{}'),

    -- Severity
    ('severity', 'minor',            'Minor',            10, '{"rank": 1}'),
    ('severity', 'moderate',         'Moderate',         20, '{"rank": 2}'),
    ('severity', 'serious',          'Serious',          30, '{"rank": 3}'),
    ('severity', 'gross_misconduct', 'Gross Misconduct', 40, '{"rank": 4}'),

    -- Case workflow
    ('case_status', 'open',                       'Open',                       10, '{}'),
    ('case_status', 'under_investigation',        'Under Investigation',        20, '{}'),
    ('case_status', 'employee_response_required', 'Employee Response Required', 30, '{"awaiting_employee": true}'),
    ('case_status', 'hearing_scheduled',          'Hearing Scheduled',          40, '{"awaiting_hearing": true}'),
    ('case_status', 'outcome_pending',            'Outcome Pending',            50, '{"awaiting_hearing": true}'),
    ('case_status', 'closed',                     'Closed',                     60, '{"terminal": true}'),

    -- Warning types
    ('warning_type', 'verbal',        'Verbal Warning',        10, '{}'),
    ('warning_type', 'written',       'Written Warning',       20, '{}'),
    ('warning_type', 'final_written', 'Final Written Warning', 30, '{}'),
    ('warning_type', 'other',         'Other',                 40, '{}'),

    -- Outcomes. Recorded by a human; nothing in this system recommends one.
    ('outcome', 'no_action',             'No Action',             10, '{}'),
    ('outcome', 'verbal_warning',        'Verbal Warning',        20, '{"warning_type": "verbal"}'),
    ('outcome', 'written_warning',       'Written Warning',       30, '{"warning_type": "written"}'),
    ('outcome', 'final_written_warning', 'Final Written Warning', 40, '{"warning_type": "final_written"}'),
    ('outcome', 'further_action',        'Further Action',        50, '{}'),
    ('outcome', 'suspension',            'Suspension',            60, '{}'),
    ('outcome', 'termination',           'Termination',           70, '{}'),
    ('outcome', 'other',                 'Other',                 80, '{}'),

    -- Document categories (section 6)
    ('document_category', 'employment_contract', 'Employment Contract',  10, '{"tracks_contract": true}'),
    ('document_category', 'id_passport',         'ID / Passport',        20, '{}'),
    ('document_category', 'drivers_licence',     'Driver''s Licence',    30, '{}'),
    ('document_category', 'medical',             'Medical Document',     40, '{}'),
    ('document_category', 'certificate',         'Certificate',          50, '{}'),
    ('document_category', 'warning',             'Warning / HR Document',60, '{}'),
    ('document_category', 'other',               'Other',                70, '{}')
  ) as v(kind, code, label, sort_order, meta)
on conflict (org_id, kind, code) do nothing;

-- ---------------------------------------------------------------------------
-- Link existing people to HR records
-- ---------------------------------------------------------------------------
--
-- `full_name` is one free-text field and HR needs two. Split on the first
-- space: everything before it is the first name, everything after is the
-- surname. That is right for "Jerry Habana" and wrong for "Van Der Merwe" in a
-- way HR can fix in one edit — better than refusing to seed, and better than a
-- guess that pretends to handle particles it cannot.

with numbered as (
  select p.id, p.org_id, p.full_name, p.email, p.phone, p.role, p.job_title,
         row_number() over (partition by p.org_id order by p.created_at, p.id) as n
    from public.profiles p
   where not exists (select 1 from public.hr_employees e where e.profile_id = p.id)
)
insert into public.hr_employees (
  org_id, profile_id, employee_number, first_name, last_name, email, phone,
  position, department_id, employment_status, employment_type
)
select
  n.org_id,
  n.id,
  'EMP-' || lpad(n.n::text, 3, '0'),
  coalesce(nullif(split_part(btrim(coalesce(n.full_name, '')), ' ', 1), ''), 'Unnamed'),
  coalesce(
    nullif(btrim(substr(btrim(coalesce(n.full_name, '')),
                        length(split_part(btrim(coalesce(n.full_name, '')), ' ', 1)) + 1)), ''),
    '—'),
  n.email,
  n.phone,
  coalesce(n.job_title, case n.role
    when 'rep'        then 'Merchandiser'
    when 'warehouse'  then 'Warehouse Clerk'
    when 'manager'    then 'Manager'
    when 'hr_manager' then 'HR Manager'
    else null end),
  (select d.id from public.hr_departments d
    where d.org_id = n.org_id
      and d.name = case n.role
        when 'rep'       then 'Field Sales'
        when 'warehouse' then 'Warehouse & Logistics'
        else 'Management' end),
  case when (select is_active from public.profiles where id = n.id) then 'active' else 'inactive' end,
  'permanent'
from numbered n;

-- Everyone reports to the manager account, which is who they in fact report to.
-- Skipped entirely if an org has no manager or more than one, because picking
-- between two would be inventing an org chart rather than recording one.
update public.hr_employees e
   set manager_id = m.id
  from (
    select mp.org_id, me.id
      from public.profiles mp
      join public.hr_employees me on me.profile_id = mp.id
     where mp.role = 'manager'
  ) m
 where e.org_id = m.org_id
   and e.id <> m.id
   and e.manager_id is null
   and (select count(*) from public.profiles p2
         where p2.org_id = e.org_id and p2.role = 'manager') = 1;
