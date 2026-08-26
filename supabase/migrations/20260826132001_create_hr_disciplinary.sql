-- Disciplinary case management.
--
-- The brief says this twice and it is worth repeating in the schema: the system
-- is for record management and workflow, NOT legal decision-making. Nothing
-- here derives, suggests or escalates an outcome. `outcome` is a nullable text
-- column holding a code a person chose from a list a person configured, and no
-- trigger, constraint or default will ever put a value in it. A severity of
-- 'gross_misconduct' does not imply termination, three warnings do not imply a
-- fourth step, and the absence of that logic is the feature.
--
-- Every vocabulary — incident type, severity, status, warning type, outcome —
-- is a `hr_lookups` code rather than a check constraint, because employment
-- policy changes and a check constraint changes only by migration.
--
-- Access is narrower than the rest of HR and deliberately so. Section 8: "Only
-- authorised HR users and the employee's authorised management chain should
-- access this information." That is `hr_can_view_employee`, which also lets the
-- employee read their own case — not a widening but the point: somebody
-- answering an allegation has to be able to read it.

-- The case reference joins the existing numbering scheme rather than inventing
-- a second one. `document_counters` is already the gapless, per-org, rolls-back
-- -cleanly issuer, and a case that vanishes on a rolled-back transaction should
-- take its number with it.
alter table public.document_counters drop constraint if exists document_counters_type_check;
alter table public.document_counters add constraint document_counters_type_check
  check (doc_type in (
    'goods_receipt', 'order', 'dispatch', 'transfer', 'adjustment', 'stocktake',
    'disciplinary_case'
  ));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.hr_disciplinary_cases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  case_number text not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  opened_on   date not null default current_date,
  reported_by uuid references public.profiles(id) on delete set null,
  -- The manager handling the case, who is not necessarily the person who
  -- reported it and not necessarily the employee's line manager either.
  manager_id  uuid references public.profiles(id) on delete set null,
  incident_date date,
  incident_type text not null,
  description   text not null,
  severity      text not null,
  status        text not null default 'open',

  -- Recorded, never derived. See the header.
  outcome              text,
  outcome_note         text,
  outcome_recorded_by  uuid references public.profiles(id) on delete set null,
  outcome_recorded_at  timestamptz,

  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_cases_org_number_idx
  on public.hr_disciplinary_cases (org_id, case_number);
create index if not exists hr_cases_employee_idx
  on public.hr_disciplinary_cases (employee_id, opened_on desc);
create index if not exists hr_cases_org_status_idx
  on public.hr_disciplinary_cases (org_id, status, opened_on desc);

create table if not exists public.hr_case_evidence (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.hr_disciplinary_cases(id) on delete cascade,
  kind    text not null default 'document' check (kind in (
            'document','photo','screenshot','attendance','gps','store_visit','other')),
  name    text not null,
  -- One of these two, depending on `kind`. An uploaded file has a path; a
  -- pointer at something the merchandising system already holds — a workday
  -- session, a visit — has a reference instead, so the evidence is the live
  -- record rather than a screenshot of it that can go stale.
  storage_path   text,
  reference_type text,
  reference_id   uuid,
  note        text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists hr_case_evidence_case_idx
  on public.hr_case_evidence (case_id, created_at);

create table if not exists public.hr_case_responses (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.hr_disciplinary_cases(id) on delete cascade,
  response      text not null,
  response_date date not null default current_date,
  document_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hr_case_responses_case_idx
  on public.hr_case_responses (case_id, created_at);

create table if not exists public.hr_warnings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  -- Nullable: a verbal warning given on the spot is a warning without a case,
  -- and requiring one would push people into opening cases they do not mean.
  case_id     uuid references public.hr_disciplinary_cases(id) on delete set null,
  warning_type text not null,
  issued_on   date not null default current_date,
  reason      text not null,
  issued_by   uuid references public.profiles(id) on delete set null,
  -- "Validity/expiry date where applicable" — null means it does not lapse.
  expires_on  date,
  document_path text,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_warnings_employee_idx
  on public.hr_warnings (employee_id, issued_on desc);
create index if not exists hr_warnings_org_expiry_idx
  on public.hr_warnings (org_id, expires_on);

drop trigger if exists hr_cases_set_updated_at on public.hr_disciplinary_cases;
create trigger hr_cases_set_updated_at before update on public.hr_disciplinary_cases
  for each row execute function public.set_updated_at();
drop trigger if exists hr_warnings_set_updated_at on public.hr_warnings;
create trigger hr_warnings_set_updated_at before update on public.hr_warnings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hr_disciplinary_cases enable row level security;
alter table public.hr_case_evidence enable row level security;
alter table public.hr_case_responses enable row level security;
alter table public.hr_warnings enable row level security;

drop policy if exists hr_cases_select on public.hr_disciplinary_cases;
create policy hr_cases_select on public.hr_disciplinary_cases
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_disciplinary_cases.employee_id)
  );

drop policy if exists hr_cases_insert on public.hr_disciplinary_cases;
create policy hr_cases_insert on public.hr_disciplinary_cases
  for insert with check (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_disciplinary_cases.employee_id)
    )
  );

-- The employee can read their case and add a response; they cannot edit the
-- case itself. That is why the response is its own table rather than a column.
drop policy if exists hr_cases_update on public.hr_disciplinary_cases;
create policy hr_cases_update on public.hr_disciplinary_cases
  for update using (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_disciplinary_cases.employee_id)
    )
  ) with check (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_disciplinary_cases.employee_id)
    )
  );

drop policy if exists hr_cases_delete on public.hr_disciplinary_cases;
create policy hr_cases_delete on public.hr_disciplinary_cases
  for delete using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- Evidence and responses inherit visibility from the case. `exists` against
-- hr_disciplinary_cases runs under the caller's own RLS, so there is one
-- definition of who may see a case and these two do not restate it.
drop policy if exists hr_case_evidence_select on public.hr_case_evidence;
create policy hr_case_evidence_select on public.hr_case_evidence
  for select using (
    exists (select 1 from public.hr_disciplinary_cases c where c.id = hr_case_evidence.case_id)
  );

drop policy if exists hr_case_evidence_write on public.hr_case_evidence;
create policy hr_case_evidence_write on public.hr_case_evidence
  for all using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.hr_disciplinary_cases c
       where c.id = hr_case_evidence.case_id
         and ((select public.hr_is_hr()) or public.hr_manages_employee(c.employee_id))
    )
  ) with check (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.hr_disciplinary_cases c
       where c.id = hr_case_evidence.case_id
         and ((select public.hr_is_hr()) or public.hr_manages_employee(c.employee_id))
    )
  );

drop policy if exists hr_case_responses_select on public.hr_case_responses;
create policy hr_case_responses_select on public.hr_case_responses
  for select using (
    exists (select 1 from public.hr_disciplinary_cases c where c.id = hr_case_responses.case_id)
  );

-- The one place the employee writes. HR and the manager may also record a
-- response given verbally or on paper, which is why they are here too.
drop policy if exists hr_case_responses_insert on public.hr_case_responses;
create policy hr_case_responses_insert on public.hr_case_responses
  for insert with check (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.hr_disciplinary_cases c
       where c.id = hr_case_responses.case_id
         and (
           (select public.hr_is_hr())
           or public.hr_manages_employee(c.employee_id)
           or c.employee_id = (select public.hr_my_employee_id())
         )
    )
  );

-- A response, once given, is part of the record. Only HR can correct one, and
-- the correction is in the trail.
drop policy if exists hr_case_responses_write on public.hr_case_responses;
create policy hr_case_responses_write on public.hr_case_responses
  for update using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

drop policy if exists hr_warnings_select on public.hr_warnings;
create policy hr_warnings_select on public.hr_warnings
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_warnings.employee_id)
  );

drop policy if exists hr_warnings_insert on public.hr_warnings;
create policy hr_warnings_insert on public.hr_warnings
  for insert with check (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_warnings.employee_id)
    )
  );

-- Wide enough for the employee to acknowledge; `hr_warning_guard` is what stops
-- them rewriting the reason on their way past.
drop policy if exists hr_warnings_update on public.hr_warnings;
create policy hr_warnings_update on public.hr_warnings
  for update using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_warnings.employee_id)
  ) with check (org_id = (select public.current_org_id()));

drop policy if exists hr_warnings_delete on public.hr_warnings;
create policy hr_warnings_delete on public.hr_warnings
  for delete using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------

/**
 * Case numbering, and the stamps that go with a status or an outcome.
 *
 * Note what is *not* here: no rule that a severity implies an outcome, no
 * default outcome for a closed case, and no check that an outcome is
 * "appropriate" to the severity. `outcome` stays null until somebody chooses
 * one, including for a case closed with no action — the difference between
 * "closed, no action" and "closed, nobody recorded what happened" is a
 * difference worth keeping.
 */
create or replace function public.hr_case_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_terminal boolean;
begin
  if tg_op = 'INSERT' then
    new.case_number := coalesce(
      nullif(new.case_number, ''),
      public.next_document_number(new.org_id, 'disciplinary_case', 'DC'));
    new.created_by  := coalesce(new.created_by, auth.uid());
    new.reported_by := coalesce(new.reported_by, auth.uid());
  end if;

  if new.outcome is not null and (tg_op = 'INSERT' or new.outcome is distinct from old.outcome) then
    new.outcome_recorded_by := auth.uid();
    new.outcome_recorded_at := now();
  end if;

  -- "Closed" is whichever status the org has marked terminal, not the literal
  -- string. An org that renames it keeps working.
  select coalesce((l.meta ->> 'terminal')::boolean, false) into v_terminal
    from public.hr_lookups l
   where l.org_id = new.org_id and l.kind = 'case_status' and l.code = new.status;

  if coalesce(v_terminal, false) then
    if new.closed_at is null then
      new.closed_at := now();
      new.closed_by := auth.uid();
    end if;
  else
    new.closed_at := null;
    new.closed_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists hr_cases_guard on public.hr_disciplinary_cases;
create trigger hr_cases_guard before insert or update on public.hr_disciplinary_cases
  for each row execute function public.hr_case_guard();

/** The employee may acknowledge a warning and change nothing else. */
create or replace function public.hr_warning_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_can_write boolean;
  v_is_self   boolean;
begin
  if tg_op = 'INSERT' then
    new.issued_by := coalesce(new.issued_by, auth.uid());
    -- Nobody acknowledges a warning at the moment it is issued.
    new.acknowledged_by := null;
    new.acknowledged_at := null;
    return new;
  end if;

  v_can_write := public.hr_is_hr() or public.hr_manages_employee(old.employee_id);
  v_is_self   := old.employee_id = public.hr_my_employee_id();

  if not v_can_write then
    if not v_is_self then
      raise exception 'you may not change this warning';
    end if;
    if (to_jsonb(new) - 'acknowledged_by' - 'acknowledged_at' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'acknowledged_by' - 'acknowledged_at' - 'updated_at') then
      raise exception 'you may only acknowledge this warning';
    end if;
    if old.acknowledged_at is not null then
      raise exception 'this warning has already been acknowledged';
    end if;
    new.acknowledged_by := auth.uid();
    new.acknowledged_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists hr_warnings_guard on public.hr_warnings;
create trigger hr_warnings_guard before insert or update on public.hr_warnings
  for each row execute function public.hr_warning_guard();

-- ---------------------------------------------------------------------------
-- Audit and notification
-- ---------------------------------------------------------------------------

create or replace function public.log_hr_case_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee record;
  v_changes  jsonb := '{}'::jsonb;
  v_col      text;
  v_old      jsonb;
  v_new      jsonb := to_jsonb(new);
  v_awaiting boolean;
begin
  select e.full_name, e.profile_id into v_employee
    from public.hr_employees e where e.id = new.employee_id;

  if tg_op = 'INSERT' then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.case_opened', 'hr_case', new.id,
            jsonb_build_object('case', new.case_number, 'employee', v_employee.full_name,
                               'type', new.incident_type, 'severity', new.severity,
                               'via', current_user));
    perform public.hr_notify_hr(
      new.org_id, 'case.opened', 'Disciplinary case ' || new.case_number || ' opened',
      v_employee.full_name || ' — ' || new.incident_type,
      '/hr/disciplinary/' || new.id, 'hr_case', new.id, auth.uid());
    return new;
  end if;

  v_old := to_jsonb(old);
  foreach v_col in array array[
    'status','severity','incident_type','incident_date','outcome','outcome_note',
    'manager_id','description'
  ] loop
    if v_old -> v_col is distinct from v_new -> v_col then
      v_changes := v_changes || jsonb_build_object(v_col,
        jsonb_build_object('from', v_old -> v_col, 'to', v_new -> v_col));
    end if;
  end loop;

  if v_changes = '{}'::jsonb then return new; end if;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (new.org_id, auth.uid(),
          case when new.closed_at is not null and old.closed_at is null
               then 'hr.case_closed' else 'hr.case_changed' end,
          'hr_case', new.id,
          v_changes || jsonb_build_object('case', new.case_number,
                                          'employee', v_employee.full_name,
                                          'via', current_user));

  if new.status is distinct from old.status then
    select coalesce((l.meta ->> 'awaiting_employee')::boolean, false) into v_awaiting
      from public.hr_lookups l
     where l.org_id = new.org_id and l.kind = 'case_status' and l.code = new.status;

    if coalesce(v_awaiting, false) then
      perform public.hr_notify(
        new.org_id, v_employee.profile_id, 'case.response_required',
        'Your response is required on case ' || new.case_number,
        'Open the case to read it and record your response.',
        '/hr/me?tab=disciplinary', 'hr_case', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists hr_cases_log on public.hr_disciplinary_cases;
create trigger hr_cases_log after insert or update on public.hr_disciplinary_cases
  for each row execute function public.log_hr_case_change();

create or replace function public.log_hr_case_response()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_case record;
  v_employee record;
begin
  select c.case_number, c.employee_id, c.manager_id, c.org_id into v_case
    from public.hr_disciplinary_cases c where c.id = new.case_id;
  select e.full_name into v_employee
    from public.hr_employees e where e.id = v_case.employee_id;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (new.org_id, auth.uid(), 'hr.case_response_recorded', 'hr_case', new.case_id,
          jsonb_build_object('case', v_case.case_number, 'employee', v_employee.full_name,
                             'response_date', new.response_date, 'via', current_user));

  perform public.hr_notify(
    new.org_id, coalesce(v_case.manager_id, public.hr_manager_profile_of(v_case.employee_id)),
    'case.response_received',
    v_employee.full_name || ' responded to case ' || v_case.case_number,
    null, '/hr/disciplinary/' || new.case_id, 'hr_case', new.case_id);
  perform public.hr_notify_hr(
    new.org_id, 'case.response_received',
    v_employee.full_name || ' responded to case ' || v_case.case_number,
    null, '/hr/disciplinary/' || new.case_id, 'hr_case', new.case_id, auth.uid());
  return new;
end;
$$;

drop trigger if exists hr_case_responses_log on public.hr_case_responses;
create trigger hr_case_responses_log after insert on public.hr_case_responses
  for each row execute function public.log_hr_case_response();

create or replace function public.log_hr_warning_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee record;
  v_label text;
begin
  select e.full_name, e.profile_id into v_employee
    from public.hr_employees e where e.id = new.employee_id;
  select coalesce(l.label, new.warning_type) into v_label
    from public.hr_lookups l
   where l.org_id = new.org_id and l.kind = 'warning_type' and l.code = new.warning_type;

  if tg_op = 'INSERT' then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.warning_issued', 'hr_employee', new.employee_id,
            jsonb_build_object('warning_id', new.id, 'type', new.warning_type,
                               'issued_on', new.issued_on, 'expires_on', new.expires_on,
                               'employee', v_employee.full_name, 'via', current_user));
    perform public.hr_notify(
      new.org_id, v_employee.profile_id, 'warning.issued',
      coalesce(v_label, 'Warning') || ' issued',
      new.reason, '/hr/me?tab=disciplinary', 'hr_warning', new.id);
    return new;
  end if;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (new.org_id, auth.uid(),
          case when new.acknowledged_at is not null and old.acknowledged_at is null
               then 'hr.warning_acknowledged' else 'hr.warning_changed' end,
          'hr_employee', new.employee_id,
          jsonb_build_object('warning_id', new.id,
                             'type', jsonb_build_object('from', old.warning_type, 'to', new.warning_type),
                             'expires_on', jsonb_build_object('from', old.expires_on, 'to', new.expires_on),
                             'employee', v_employee.full_name, 'via', current_user));
  return new;
end;
$$;

drop trigger if exists hr_warnings_log on public.hr_warnings;
create trigger hr_warnings_log after insert or update on public.hr_warnings
  for each row execute function public.log_hr_warning_change();

comment on table public.hr_disciplinary_cases is
  'Workflow and record only. Nothing in this schema derives, suggests or escalates an outcome — `outcome` is null until a person records one, and a severity implies nothing.';
comment on column public.hr_disciplinary_cases.outcome is
  'An hr_lookups code of kind `outcome`, chosen by a person. Never written by a default, trigger or rule.';
comment on table public.hr_warnings is
  'Warnings, with or without a case behind them. expires_on null means the warning does not lapse; the dashboard counts an active warning as one with no expiry or an expiry in the future.';
