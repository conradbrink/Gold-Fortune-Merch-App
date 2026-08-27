-- A sick note and a warning letter are required, and the database is what says so.
--
-- Both rules already existed and neither was a rule. `hr_leave_types.
-- requires_document` was true for Sick Leave and the request dialog refused to
-- submit without a file; `hr_warnings.document_path` existed and the dialog
-- offered "Attach the letter". Both checks lived entirely in the browser, so
-- both were advice to one screen rather than a property of the record.
--
-- That gap matters here more than it usually would. This module feeds
-- disciplinary cases and a CCMA-style hearing, where "there is no note on file"
-- and "the note was never required" are the same sentence to anyone reading the
-- record afterwards. And the leave screens are about to exist on the phone as
-- well, at which point a rule enforced by one dialog is a rule that quietly
-- stops applying to whoever files from the other one.
--
-- Both tables are empty today, so nothing is grandfathered and nothing needs a
-- backfill. If they had rows, this would need an `is_legacy` escape and a
-- decision about them; it does not, and pretending otherwise would leave a hole
-- that only ever gets used by accident.

-- ---------------------------------------------------------------------------
-- Which warning types need a letter
-- ---------------------------------------------------------------------------
--
-- In `meta`, not a new column, for the reason `meta` exists — `{"terminal":
-- true}` on a case status is the same shape of fact. A verbal warning has no
-- letter to attach and is deliberately exempt; so is "Other", which is a
-- catch-all and would otherwise refuse a record nobody meant to make formal.
-- An HR manager can move the flag on any of them, and a warning type they add
-- themselves carries no requirement until they say so.

update public.hr_lookups
   set meta = meta || '{"requires_document": true}'::jsonb
 where kind = 'warning_type'
   and code in ('written', 'final_written')
   and coalesce(meta->>'requires_document', '') <> 'true';

-- 🔴 And the same for every organisation created from here on.
--
-- The statement above is a one-off over the rows that exist today. Without this
-- second half `provision_organization()` would go on seeding `warning_type`
-- with `meta '{}'`, `hr_warning_requires_document()` would find no row carrying
-- the flag, and a new tenant would silently have no letter requirement at all —
-- in the one module whose entire purpose is the paper trail. It fails quietly
-- in both directions, too: the dialog reads the same JSON, so it would stop
-- asking for the letter as well.
--
-- Note the asymmetry that hid this. Leave survives provisioning because
-- `requires_document` is a real column on `hr_leave_types` and the seeder sets
-- it. Only the warning rule lives in seeded JSON, and only the warning rule was
-- lost.
--
-- Re-declared in full rather than patched, because there is one function name
-- and `create or replace` carries the whole body — the ordinary way a function
-- changes in this schema. Copied verbatim from `pg_get_functiondef` immediately
-- before this migration; the ONLY difference is the `meta` on the two written
-- warning types. Everything else is byte-for-byte what was already running.

create or replace function public.provision_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
$fn$;

-- ---------------------------------------------------------------------------
-- Leave: the type decides
-- ---------------------------------------------------------------------------

create or replace function public.hr_leave_requires_document()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_type record;
begin
  select name, requires_document into v_type
    from public.hr_leave_types
   where id = new.leave_type_id;

  -- An unknown type is the FK's problem, not this trigger's. Raising here would
  -- report a missing document for a request whose real fault is a bad type id.
  if v_type is null or not v_type.requires_document then return new; end if;

  if new.document_path is null or btrim(new.document_path) = '' then
    raise exception '% needs a supporting document — attach it before filing the request.',
      v_type.name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

/**
 * Insert, and the two updates that could evade it.
 *
 * Not every update: a request is approved, rejected, withdrawn and cancelled by
 * updates that touch neither the type nor the document, and a blanket trigger
 * would make a legacy row impossible to decide on. Firing only when the two
 * columns that matter change closes the actual hole — swapping the leave type
 * after filing, or clearing the path afterwards — and leaves the lifecycle
 * alone.
 */
drop trigger if exists hr_leave_requests_require_document on public.hr_leave_requests;
create trigger hr_leave_requests_require_document
  before insert on public.hr_leave_requests
  for each row execute function public.hr_leave_requires_document();

drop trigger if exists hr_leave_requests_require_document_upd on public.hr_leave_requests;
create trigger hr_leave_requests_require_document_upd
  before update of leave_type_id, document_path on public.hr_leave_requests
  for each row
  when (new.leave_type_id is distinct from old.leave_type_id
        or new.document_path is distinct from old.document_path)
  execute function public.hr_leave_requires_document();

revoke all on function public.hr_leave_requires_document() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Warnings: the lookup decides
-- ---------------------------------------------------------------------------

create or replace function public.hr_warning_requires_document()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_label text;
begin
  select l.label into v_label
    from public.hr_lookups l
   where l.org_id = new.org_id
     and l.kind = 'warning_type'
     and l.code = new.warning_type
     and coalesce(l.meta->>'requires_document', '') = 'true';

  if v_label is null then return new; end if;

  if new.document_path is null or btrim(new.document_path) = '' then
    raise exception 'A % must have the signed letter attached.', lower(v_label)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists hr_warnings_require_document on public.hr_warnings;
create trigger hr_warnings_require_document
  before insert on public.hr_warnings
  for each row execute function public.hr_warning_requires_document();

drop trigger if exists hr_warnings_require_document_upd on public.hr_warnings;
create trigger hr_warnings_require_document_upd
  before update of warning_type, document_path on public.hr_warnings
  for each row
  when (new.warning_type is distinct from old.warning_type
        or new.document_path is distinct from old.document_path)
  execute function public.hr_warning_requires_document();

revoke all on function public.hr_warning_requires_document() from public, anon, authenticated;

comment on function public.hr_leave_requires_document() is
  'Refuses a leave request with no document when its leave type requires one. The browser asks; this is what makes it a rule.';
comment on function public.hr_warning_requires_document() is
  'Refuses a warning with no letter when its warning type carries meta.requires_document. Verbal warnings are exempt by not carrying the flag.';
