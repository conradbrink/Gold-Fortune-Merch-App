-- The HR module's spine: who works here, under whom, on what terms.
--
-- The one decision everything else rests on is that an employee is NOT a new
-- user. `profiles` already holds every person who can sign in, and `hr_employees`
-- points at it rather than copying it: one nullable, unique `profile_id`. Two
-- consequences, both deliberate:
--
--   * A rep who exists today gets an HR record attached to the account they
--     already sign in with. Their name, phone and email are not duplicated into
--     a second place that can disagree with the first — `full_name` on the
--     profile stays the display name the rest of the app uses, and the HR record
--     carries the split first/last that HR paperwork needs.
--   * An employee with no login is representable. A cleaner or a driver who
--     never touches the app is a real employee and would otherwise need a fake
--     auth user to exist. `profile_id` is null for them, and every policy below
--     copes with that rather than assuming a signed-in counterpart.
--
-- Salary lives in its own table, not in a column here. That is the whole reason
-- `hr_employee_compensation` exists: RLS is a row-level mechanism, so the only
-- way to let a line manager read an employee's record while refusing them the
-- salary on it is to put the salary in a different row, in a different table,
-- with a different policy. A `salary` column on `hr_employees` would be visible
-- to anyone who could select the row at all.
--
-- `hr_lookups` is one table for six configurable vocabularies rather than six
-- tables of (id, name, active, sort_order). Section 12 of the brief wants
-- incident types, severities, case statuses, warning types and outcomes all
-- editable by HR; leave types and review categories are NOT here because they
-- carry real data of their own (entitlement days, weighting) and would turn a
-- lookup row into a bag of nullable columns.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table if not exists public.hr_settings (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  -- Attendance is derived from these three, per section 4. Nothing stores a
  -- "late" flag; changing the threshold re-reads history correctly rather than
  -- leaving yesterday's verdicts frozen at yesterday's rule.
  work_start_time        time not null default '08:00',
  work_end_time          time not null default '17:00',
  late_threshold_minutes integer not null default 15 check (late_threshold_minutes between 0 and 240),
  -- Below this, a day that was started and ended is flagged "very short".
  short_day_hours        numeric(4,2) not null default 4 check (short_day_hours >= 0),
  -- ISO day numbers, 1 = Monday. A day outside this set is not counted absent.
  workweek               smallint[] not null default '{1,2,3,4,5}',
  review_frequency       text not null default 'quarterly'
                           check (review_frequency in ('monthly','quarterly','six_monthly','annual')),
  rating_scale_max       smallint not null default 5 check (rating_scale_max between 3 and 10),
  min_acceptable_score   numeric(4,2) not null default 3.0,
  -- Leave entitlement runs on this cycle. January in Botswana practice, but the
  -- brief is explicit that no local rule may be hard-coded.
  leave_year_start_month smallint not null default 1 check (leave_year_start_month between 1 and 12),
  -- Documents and contracts inside this window count as "expiring soon".
  expiry_warning_days    integer not null default 30 check (expiry_warning_days > 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

create table if not exists public.hr_departments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  code       text,
  -- Added by ALTER further down: hr_employees does not exist yet, and a
  -- department's head is an employee of it.
  head_employee_id uuid,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_departments_org_name_idx
  on public.hr_departments (org_id, lower(name));

-- ---------------------------------------------------------------------------
-- Configurable vocabularies
-- ---------------------------------------------------------------------------

create table if not exists public.hr_lookups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  kind       text not null check (kind in (
               'incident_type', 'severity', 'case_status',
               'warning_type', 'outcome', 'document_category')),
  -- Stable across renames. Rows elsewhere store the code, so an HR manager
  -- correcting "Late arrival" to "Late Arrival" does not orphan 40 cases.
  code       text not null,
  label      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  -- Kind-specific extras kept out of the column list: `{"terminal": true}` on
  -- a case status, `{"rank": 4}` on a severity.
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_lookups_org_kind_code_idx
  on public.hr_lookups (org_id, kind, code);
create index if not exists hr_lookups_org_kind_idx
  on public.hr_lookups (org_id, kind, sort_order);

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------

create table if not exists public.hr_employees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- The link to the existing account. Unique, so no profile can acquire two
  -- employee records; nullable, so an employee can exist without a login.
  -- `on delete set null` rather than cascade: deleting an auth user must not
  -- silently delete their disciplinary history.
  profile_id    uuid unique references public.profiles(id) on delete set null,
  employee_number text not null,

  first_name    text not null,
  last_name     text not null,
  -- Search and display. Generated, so it cannot disagree with its parts.
  full_name     text generated always as (
                  btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
                ) stored,
  photo_path    text,
  phone         text,
  email         text,
  date_of_birth date,
  national_id   text,
  address       text,
  emergency_contact_name  text,
  emergency_contact_phone text,

  position      text,
  department_id uuid references public.hr_departments(id) on delete set null,
  manager_id    uuid references public.hr_employees(id) on delete set null,
  territory_id  uuid references public.territories(id) on delete set null,

  employment_status text not null default 'active' check (employment_status in (
                      'active','on_leave','suspended','terminated','resigned','inactive')),
  employment_type   text not null default 'permanent' check (employment_type in (
                      'permanent','fixed_term','temporary','casual','other')),

  start_date          date,
  probation_end_date  date,
  contract_start_date date,
  contract_end_date   date,
  end_date            date,

  -- Null falls back to the org's standard hours. Set only for the people whose
  -- day genuinely differs, so changing the standard moves everyone it should.
  work_start_time time,
  work_end_time   time,
  weekly_hours    numeric(5,2),

  notes      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Stops the shortest cycle. Longer ones are caught by the depth cap in
  -- hr_manages_employee, which is the honest place for it: enforcing acyclicity
  -- properly needs a trigger that walks the chain on every write.
  constraint hr_employees_manager_not_self check (manager_id is null or manager_id <> id)
);

create unique index if not exists hr_employees_org_number_idx
  on public.hr_employees (org_id, lower(employee_number));
create index if not exists hr_employees_org_status_idx
  on public.hr_employees (org_id, employment_status);
create index if not exists hr_employees_manager_idx
  on public.hr_employees (manager_id);
create index if not exists hr_employees_department_idx
  on public.hr_employees (department_id);
create index if not exists hr_employees_territory_idx
  on public.hr_employees (territory_id);
create index if not exists hr_employees_contract_end_idx
  on public.hr_employees (org_id, contract_end_date)
  where contract_end_date is not null;

-- The circular half of the department/employee pair.
alter table public.hr_departments
  drop constraint if exists hr_departments_head_employee_id_fkey;
alter table public.hr_departments
  add constraint hr_departments_head_employee_id_fkey
  foreign key (head_employee_id) references public.hr_employees(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Compensation — the payroll seam
-- ---------------------------------------------------------------------------
--
-- No payroll UI is built and no calculation happens anywhere. What this table
-- does is make sure that when payroll arrives it does not need the employee
-- record reshaped: the fields a payslip needs have a home, a policy and an
-- audit trail from today. `allowances`, `deductions` and `benefits` are jsonb
-- arrays of `{label, amount, ...}` deliberately — their shape is a payroll
-- decision nobody has taken yet, and columns guessed now would be wrong ones to
-- migrate off later.

create table if not exists public.hr_employee_compensation (
  employee_id  uuid primary key references public.hr_employees(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  currency     text not null default 'BWP',
  basic_salary numeric(14,2),
  pay_frequency text not null default 'monthly'
                 check (pay_frequency in ('monthly','fortnightly','weekly','daily','hourly')),
  commission_structure text,
  allowances   jsonb not null default '[]'::jsonb,
  deductions   jsonb not null default '[]'::jsonb,
  benefits     jsonb not null default '[]'::jsonb,
  overtime_rate numeric(10,2),
  bonus_note   text,
  bank_name    text,
  bank_branch_code text,
  bank_account_name text,
  bank_account_number text,
  tax_number   text,
  tax_status   text,
  payroll_status text not null default 'not_configured'
                 check (payroll_status in ('not_configured','active','suspended','excluded')),
  effective_from date,
  notes        text,
  updated_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Company assets
-- ---------------------------------------------------------------------------

create table if not exists public.hr_employee_assets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind        text not null default 'other' check (kind in ('vehicle','phone','other')),
  -- Points at the fleet the warehouse module already manages, when the asset is
  -- one of its vehicles. Null for a vehicle that is not in `vehicles` yet, in
  -- which case `label` carries the registration.
  vehicle_id  uuid references public.vehicles(id) on delete set null,
  label       text not null,
  identifier  text,
  issued_on   date,
  returned_on date,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hr_employee_assets_employee_idx
  on public.hr_employee_assets (employee_id, returned_on);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists hr_settings_set_updated_at on public.hr_settings;
create trigger hr_settings_set_updated_at before update on public.hr_settings
  for each row execute function public.set_updated_at();
drop trigger if exists hr_departments_set_updated_at on public.hr_departments;
create trigger hr_departments_set_updated_at before update on public.hr_departments
  for each row execute function public.set_updated_at();
drop trigger if exists hr_lookups_set_updated_at on public.hr_lookups;
create trigger hr_lookups_set_updated_at before update on public.hr_lookups
  for each row execute function public.set_updated_at();
drop trigger if exists hr_employees_set_updated_at on public.hr_employees;
create trigger hr_employees_set_updated_at before update on public.hr_employees
  for each row execute function public.set_updated_at();
drop trigger if exists hr_employee_compensation_set_updated_at on public.hr_employee_compensation;
create trigger hr_employee_compensation_set_updated_at before update on public.hr_employee_compensation
  for each row execute function public.set_updated_at();
drop trigger if exists hr_employee_assets_set_updated_at on public.hr_employee_assets;
create trigger hr_employee_assets_set_updated_at before update on public.hr_employee_assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
--
-- Every one of these is `security definer`, and that is not a convenience.
-- `hr_manages_employee` walks `hr_employees` while being called from a policy
-- ON `hr_employees`; under invoker rights that is infinite recursion and
-- Postgres refuses it at query time. Definer rights read the table with RLS
-- bypassed, which is exactly what a policy helper must do.
--
-- They are also the single definition of each question. "Is this person HR?"
-- is asked by about thirty policies below; written out thirty times it would
-- eventually be written differently in one of them.

create or replace function public.hr_is_hr()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- `manager` is the Admin tier. The organisation has no separate admin role
  -- and inventing one would demote every existing manager account.
  select public."current_role"() in ('manager', 'hr_manager')
$$;

create or replace function public.hr_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public."current_role"() = 'manager'
$$;

/**
 * The caller's own HR record, or null.
 *
 * Null for a signed-in user with no employee record — a warehouse clerk nobody
 * has entered into HR yet. Every caller must treat null as "matches nothing"
 * rather than "matches everything"; the `= null` comparisons below do that for
 * free, which is why they are written as equality rather than `is not distinct
 * from`.
 */
create or replace function public.hr_my_employee_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.id
    from public.hr_employees e
   where e.profile_id = auth.uid()
     and e.org_id = public.current_org_id()
$$;

/**
 * Whether the caller is somewhere above this employee in the reporting line.
 *
 * Walks *up* from the employee through `manager_id`, so a regional manager sees
 * their managers' people too — the brief's "authorised management chain". Depth
 * is capped at six rather than trusted to terminate: `manager_id` is a
 * self-reference and the only structural guard against a cycle is the
 * `<> id` check, which stops A→A and not A→B→A.
 */
create or replace function public.hr_manages_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
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
$$;

/** HR, the person themselves, or anyone in their management chain. */
create or replace function public.hr_can_view_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.hr_is_hr()
      or p_employee_id = public.hr_my_employee_id()
      or public.hr_manages_employee(p_employee_id)
$$;

revoke execute on function public.hr_is_hr() from anon;
revoke execute on function public.hr_is_admin() from anon;
revoke execute on function public.hr_my_employee_id() from anon;
revoke execute on function public.hr_manages_employee(uuid) from anon;
revoke execute on function public.hr_can_view_employee(uuid) from anon;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hr_settings enable row level security;
alter table public.hr_departments enable row level security;
alter table public.hr_lookups enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_employee_compensation enable row level security;
alter table public.hr_employee_assets enable row level security;

-- Readable by the whole org: an employee needs to know what time the working
-- day starts before "late" means anything to them, and the vocabularies are
-- labels for records they can already see.
drop policy if exists hr_settings_select on public.hr_settings;
create policy hr_settings_select on public.hr_settings
  for select using (org_id = (select public.current_org_id()));

drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write on public.hr_settings
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

drop policy if exists hr_departments_select on public.hr_departments;
create policy hr_departments_select on public.hr_departments
  for select using (org_id = (select public.current_org_id()));

drop policy if exists hr_departments_write on public.hr_departments;
create policy hr_departments_write on public.hr_departments
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

drop policy if exists hr_lookups_select on public.hr_lookups;
create policy hr_lookups_select on public.hr_lookups
  for select using (org_id = (select public.current_org_id()));

drop policy if exists hr_lookups_write on public.hr_lookups;
create policy hr_lookups_write on public.hr_lookups
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- The rule the whole module turns on. HR sees everyone; a line manager sees
-- their chain; everybody sees themselves; nobody else sees anything.
drop policy if exists hr_employees_select on public.hr_employees;
create policy hr_employees_select on public.hr_employees
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_employees.id)
  );

drop policy if exists hr_employees_write on public.hr_employees;
create policy hr_employees_write on public.hr_employees
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- Salary. Deliberately narrower than the employee record it hangs off: a line
-- manager who can read the person cannot read this row at all. The employee
-- themselves can, because it is their own pay and because employee self-service
-- payslips are the first thing payroll will want.
drop policy if exists hr_compensation_select on public.hr_employee_compensation;
create policy hr_compensation_select on public.hr_employee_compensation
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or employee_id = (select public.hr_my_employee_id())
    )
  );

drop policy if exists hr_compensation_write on public.hr_employee_compensation;
create policy hr_compensation_write on public.hr_employee_compensation
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

drop policy if exists hr_assets_select on public.hr_employee_assets;
create policy hr_assets_select on public.hr_employee_assets
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_employee_assets.employee_id)
  );

drop policy if exists hr_assets_write on public.hr_employee_assets;
create policy hr_assets_write on public.hr_employee_assets
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
--
-- Written by triggers for the same reason the existing security trail is:
-- application code that remembers to log is code that eventually forgets, and
-- HR records are edited from the web app today and will be edited by a payroll
-- import tomorrow.
--
-- `security_events` is reused rather than duplicated. It already has org,
-- actor, action, subject and a jsonb detail, it is append-only by construction
-- (no INSERT policy exists, and insert is revoked from `authenticated`), and a
-- second audit table would mean two places to look when answering one question.

create or replace function public.log_hr_employee_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_col text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.employee_created', 'hr_employee', new.id,
            jsonb_build_object('name', new.full_name, 'employee_number', new.employee_number,
                               'via', current_user));
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (old.org_id, auth.uid(), 'hr.employee_deleted', 'hr_employee', old.id,
            jsonb_build_object('name', old.full_name, 'via', current_user));
    return old;
  end if;

  -- Watched columns only. Logging every field would bury an employment-status
  -- change under a phone number correction, and the brief asks for the former.
  foreach v_col in array array[
    'employment_status','employment_type','position','department_id','manager_id',
    'territory_id','start_date','probation_end_date','contract_start_date',
    'contract_end_date','end_date','profile_id','employee_number','first_name','last_name'
  ] loop
    if v_old -> v_col is distinct from v_new -> v_col then
      v_changes := v_changes || jsonb_build_object(v_col,
        jsonb_build_object('from', v_old -> v_col, 'to', v_new -> v_col));
    end if;
  end loop;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (
    new.org_id, auth.uid(),
    -- Employment status gets its own action name so "who suspended this person
    -- and when" is one indexed lookup rather than a scan through jsonb.
    case when v_changes ? 'employment_status'
         then 'hr.employment_status_changed'
         else 'hr.employee_changed' end,
    'hr_employee', new.id,
    v_changes || jsonb_build_object('name', new.full_name, 'via', current_user)
  );
  return new;
end;
$$;

drop trigger if exists hr_employees_log_change on public.hr_employees;
create trigger hr_employees_log_change
  after insert or update or delete on public.hr_employees
  for each row execute function public.log_hr_employee_change();

/**
 * Salary changes, recorded with the numbers.
 *
 * Kept apart from the employee trigger because the detail is sensitive in a way
 * the rest is not: `security_events` is readable by managers, and an HR manager
 * reading the trail should see that pay changed and by how much, while a
 * warehouse clerk should not be able to read the trail at all. The select
 * policy on `security_events` already limits it to managers; the split is so a
 * future narrowing has something to narrow.
 */
create or replace function public.log_hr_compensation_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_col text;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
begin
  foreach v_col in array array[
    'basic_salary','currency','pay_frequency','commission_structure','allowances',
    'deductions','benefits','overtime_rate','payroll_status','effective_from',
    'bank_account_number','tax_number','tax_status'
  ] loop
    if v_old -> v_col is distinct from v_new -> v_col then
      v_changes := v_changes || jsonb_build_object(v_col,
        jsonb_build_object('from', v_old -> v_col, 'to', v_new -> v_col));
    end if;
  end loop;

  if v_changes = '{}'::jsonb then return new; end if;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (new.org_id, auth.uid(), 'hr.compensation_changed', 'hr_employee', new.employee_id,
          v_changes || jsonb_build_object('via', current_user));
  return new;
end;
$$;

drop trigger if exists hr_compensation_log_change on public.hr_employee_compensation;
create trigger hr_compensation_log_change
  after insert or update on public.hr_employee_compensation
  for each row execute function public.log_hr_compensation_change();

-- HR managers read the HR half of the trail, and only that half. The existing
-- policy hands the whole trail to `manager`; this is a second permissive policy
-- rather than an edit to that one, so the manager's access is untouched and the
-- HR grant can be revoked on its own.
drop policy if exists security_events_hr_select on public.security_events;
create policy security_events_hr_select on public.security_events
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'hr_manager'
    and action like 'hr.%'
  );

comment on table public.hr_employees is
  'The central HR record. Points at profiles rather than duplicating it; profile_id is null for an employee with no login. Salary is deliberately absent — see hr_employee_compensation.';
comment on table public.hr_employee_compensation is
  'Pay and bank details, split from hr_employees so RLS can refuse them to a line manager who may read the employee. Also the seam payroll will attach to; nothing calculates anything today.';
comment on table public.hr_lookups is
  'HR-editable vocabularies (incident types, severities, case statuses, warning types, outcomes, document categories). Rows elsewhere store `code`, so relabelling is safe.';
comment on function public.hr_manages_employee(uuid) is
  'Whether the caller is anywhere above this employee in the reporting line. security definer because it reads hr_employees from inside a policy on hr_employees.';
