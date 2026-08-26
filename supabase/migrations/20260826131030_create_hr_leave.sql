-- Leave: types, entitlement, requests, and the rules about who may decide one.
--
-- The shape worth explaining is the balance. There is no `remaining_days`
-- column anywhere, and there deliberately never will be. A stored balance is a
-- number that has to be decremented by every path that approves leave and
-- incremented by every path that cancels it, and the first path somebody
-- forgets is the one that makes the figure wrong for ever with nothing to
-- reconcile it against. `hr_leave_balances` stores only what a human decides —
-- entitlement, carry-over, a manual adjustment — and `hr_leave_balance_summary`
-- derives used, pending and remaining by counting the requests. Approve, then
-- cancel, and the number returns to where it started because it was never
-- anywhere else.
--
-- The second decision is that `days` is stored rather than computed from the
-- dates. Half days exist, public holidays exist, and a request that spans a
-- weekend is not five days. `hr_working_days()` gives the UI the default so
-- that the UI and the database agree on what a working week is, and the person
-- filing the request can override it.

-- ---------------------------------------------------------------------------
-- Leave years
-- ---------------------------------------------------------------------------
--
-- Entitlement runs on a cycle that starts in a configurable month, so "this
-- year's leave" is not the same as "this calendar year" for an org whose cycle
-- starts in April. Both helpers exist so that the view and the UI ask the same
-- question of the same function rather than each doing the arithmetic.

create or replace function public.hr_leave_year_of(p_org uuid, p_date date)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when extract(month from p_date)::int
         >= coalesce((select leave_year_start_month from public.hr_settings where org_id = p_org), 1)
    then extract(year from p_date)::int
    else extract(year from p_date)::int - 1
  end
$$;

create or replace function public.hr_current_leave_year(p_org uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.hr_leave_year_of(p_org, current_date)
$$;

/**
 * Working days between two dates, inclusive, by the org's own working week.
 *
 * Public holidays are NOT subtracted. The system has no holiday calendar, and
 * inventing Botswana's would hard-code exactly the kind of local rule section
 * 12 forbids. The figure is a default the requester can correct, not a ruling.
 */
create or replace function public.hr_working_days(p_org uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::numeric
    from generate_series(p_from, p_to, interval '1 day') d
   where extract(isodow from d)::smallint = any(
     coalesce((select workweek from public.hr_settings where org_id = p_org),
              '{1,2,3,4,5}'::smallint[]))
$$;

revoke execute on function public.hr_leave_year_of(uuid, date) from anon;
revoke execute on function public.hr_current_leave_year(uuid) from anon;
revoke execute on function public.hr_working_days(uuid, date, date) from anon;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.hr_leave_types (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name   text not null,
  code   text not null,
  -- Paid vs unpaid is the one attribute payroll will certainly need, so it is
  -- recorded now even though nothing reads it yet.
  is_paid boolean not null default true,
  default_entitlement_days numeric(6,2) not null default 0,
  requires_document boolean not null default false,
  -- False for types that are tracked but not capped — unpaid leave, typically.
  deducts_from_balance boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_leave_types_org_code_idx
  on public.hr_leave_types (org_id, code);

-- Only what a person decides. Everything else is counted, not stored.
create table if not exists public.hr_leave_balances (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  employee_id   uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete cascade,
  leave_year    integer not null,
  -- Null means "use the leave type's default", which is why the column is
  -- nullable on a table where every other number defaults to zero: an HR
  -- manager who raises the annual entitlement for everyone should not have to
  -- edit a row per employee.
  entitlement_days  numeric(6,2),
  carried_over_days numeric(6,2) not null default 0,
  adjustment_days   numeric(6,2) not null default 0,
  note       text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_leave_balances_unique_idx
  on public.hr_leave_balances (employee_id, leave_type_id, leave_year);

create table if not exists public.hr_leave_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  employee_id   uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete restrict,
  start_date date not null,
  end_date   date not null,
  days       numeric(6,2) not null check (days > 0),
  reason     text,
  document_path text,
  status     text not null default 'pending'
               check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_leave_requests_dates check (end_date >= start_date)
);

create index if not exists hr_leave_requests_employee_idx
  on public.hr_leave_requests (employee_id, start_date desc);
create index if not exists hr_leave_requests_org_status_idx
  on public.hr_leave_requests (org_id, status, start_date);
-- The leave calendar's query: approved leave overlapping a window.
create index if not exists hr_leave_requests_approved_span_idx
  on public.hr_leave_requests (org_id, start_date, end_date)
  where status = 'approved';

drop trigger if exists hr_leave_types_set_updated_at on public.hr_leave_types;
create trigger hr_leave_types_set_updated_at before update on public.hr_leave_types
  for each row execute function public.set_updated_at();
drop trigger if exists hr_leave_balances_set_updated_at on public.hr_leave_balances;
create trigger hr_leave_balances_set_updated_at before update on public.hr_leave_balances
  for each row execute function public.set_updated_at();
drop trigger if exists hr_leave_requests_set_updated_at on public.hr_leave_requests;
create trigger hr_leave_requests_set_updated_at before update on public.hr_leave_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The derived balance
-- ---------------------------------------------------------------------------
--
-- `security_invoker = true` is not optional. A view defaults to definer rights
-- and would hand every employee's leave balance to anyone who selected from it,
-- across organisations. Every row below is filtered by the RLS on the tables it
-- reads, so this view shows exactly what the caller could have counted for
-- themselves.

create or replace view public.hr_leave_balance_summary
with (security_invoker = true) as
select
  e.org_id,
  e.id   as employee_id,
  t.id   as leave_type_id,
  t.name as leave_type_name,
  t.code as leave_type_code,
  t.is_paid,
  t.deducts_from_balance,
  public.hr_current_leave_year(e.org_id) as leave_year,
  round(coalesce(b.entitlement_days, t.default_entitlement_days)
        + coalesce(b.carried_over_days, 0)
        + coalesce(b.adjustment_days, 0), 2) as entitlement_days,
  round(coalesce(used.days, 0), 2)    as used_days,
  round(coalesce(pending.days, 0), 2) as pending_days,
  round(coalesce(b.entitlement_days, t.default_entitlement_days)
        + coalesce(b.carried_over_days, 0)
        + coalesce(b.adjustment_days, 0)
        - coalesce(used.days, 0)
        - coalesce(pending.days, 0), 2) as remaining_days
from public.hr_employees e
join public.hr_leave_types t
  on t.org_id = e.org_id and t.active
left join public.hr_leave_balances b
  on b.employee_id = e.id
 and b.leave_type_id = t.id
 and b.leave_year = public.hr_current_leave_year(e.org_id)
left join lateral (
  select sum(r.days) as days
    from public.hr_leave_requests r
   where r.employee_id = e.id and r.leave_type_id = t.id
     and r.status = 'approved'
     and public.hr_leave_year_of(e.org_id, r.start_date)
         = public.hr_current_leave_year(e.org_id)
) used on true
left join lateral (
  select sum(r.days) as days
    from public.hr_leave_requests r
   where r.employee_id = e.id and r.leave_type_id = t.id
     and r.status = 'pending'
     and public.hr_leave_year_of(e.org_id, r.start_date)
         = public.hr_current_leave_year(e.org_id)
) pending on true;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hr_leave_types enable row level security;
alter table public.hr_leave_balances enable row level security;
alter table public.hr_leave_requests enable row level security;

drop policy if exists hr_leave_types_select on public.hr_leave_types;
create policy hr_leave_types_select on public.hr_leave_types
  for select using (org_id = (select public.current_org_id()));

drop policy if exists hr_leave_types_write on public.hr_leave_types;
create policy hr_leave_types_write on public.hr_leave_types
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

drop policy if exists hr_leave_balances_select on public.hr_leave_balances;
create policy hr_leave_balances_select on public.hr_leave_balances
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_leave_balances.employee_id)
  );

-- Adjusting a balance is an HR act. A line manager approves days off; they do
-- not decide how many days exist.
drop policy if exists hr_leave_balances_write on public.hr_leave_balances;
create policy hr_leave_balances_write on public.hr_leave_balances
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

drop policy if exists hr_leave_requests_select on public.hr_leave_requests;
create policy hr_leave_requests_select on public.hr_leave_requests
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_leave_requests.employee_id)
  );

-- Anyone who can see the employee can file for them: the employee themselves,
-- their manager, or HR. What they may then *do* with the row is the trigger's
-- business, not the policy's — a policy can say who may write, but it cannot
-- see the old row and the new row together, which is what a status transition
-- is.
drop policy if exists hr_leave_requests_insert on public.hr_leave_requests;
create policy hr_leave_requests_insert on public.hr_leave_requests
  for insert with check (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_leave_requests.employee_id)
  );

drop policy if exists hr_leave_requests_update on public.hr_leave_requests;
create policy hr_leave_requests_update on public.hr_leave_requests
  for update using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_leave_requests.employee_id)
  ) with check (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_leave_requests.employee_id)
  );

-- Deleting is HR's alone. A cancelled request is a record; a deleted one is a
-- gap in somebody's leave history that nothing explains.
drop policy if exists hr_leave_requests_delete on public.hr_leave_requests;
create policy hr_leave_requests_delete on public.hr_leave_requests
  for delete using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- ---------------------------------------------------------------------------
-- The rules a policy cannot express
-- ---------------------------------------------------------------------------

/**
 * Who may decide a request, and what a decision does to the row.
 *
 * The policy above lets a rep update their own request — they have to, to
 * withdraw it. Without this trigger that same rep could set `status` to
 * 'approved' and grant themselves three weeks. `decided_by` and `decided_at`
 * are stamped here rather than sent by the client for the same reason.
 */
create or replace function public.hr_leave_request_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_hr      boolean := public.hr_is_hr();
  v_is_manager boolean := public.hr_manages_employee(new.employee_id);
  v_is_self    boolean := new.employee_id = public.hr_my_employee_id();
  v_clash      integer;
begin
  if tg_op = 'INSERT' then
    -- HR may record leave that was agreed off-system and is already taken.
    -- Everyone else files a request, whatever they put in the field.
    if not v_is_hr then
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    if new.status is distinct from old.status then
      if old.status in ('rejected', 'cancelled') then
        raise exception 'a % leave request cannot change status', old.status;
      end if;

      if new.status in ('approved', 'rejected') then
        -- A manager cannot be their own manager (hr_employees forbids it), so
        -- the only route to approving your own leave is holding the HR role.
        -- Allowed on purpose: in an org with one HR user, refusing it would
        -- mean that person can never take a day off.
        if not (v_is_hr or v_is_manager) then
          raise exception 'only HR or the employee''s manager may decide a leave request';
        end if;
        new.decided_by := auth.uid();
        new.decided_at := now();
      elsif new.status = 'cancelled' then
        if not (v_is_hr or v_is_manager or v_is_self) then
          raise exception 'you may not cancel this leave request';
        end if;
      end if;
    end if;

    -- The dates and the type are the request. Changing them after a decision
    -- would leave an approval attached to something nobody approved.
    if old.status <> 'pending' and not v_is_hr and (
         new.start_date is distinct from old.start_date
      or new.end_date   is distinct from old.end_date
      or new.days       is distinct from old.days
      or new.leave_type_id is distinct from old.leave_type_id) then
      raise exception 'a decided leave request cannot be re-dated';
    end if;
  end if;

  -- Two approved absences over the same days is a double count in every figure
  -- that reads this table. Checked on the way in rather than reported later.
  if new.status = 'approved' then
    select count(*) into v_clash
      from public.hr_leave_requests r
     where r.employee_id = new.employee_id
       and r.id <> new.id
       and r.status = 'approved'
       and daterange(r.start_date, r.end_date, '[]')
           && daterange(new.start_date, new.end_date, '[]');
    if v_clash > 0 then
      raise exception 'this employee already has approved leave over those dates';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists hr_leave_requests_guard on public.hr_leave_requests;
create trigger hr_leave_requests_guard
  before insert or update on public.hr_leave_requests
  for each row execute function public.hr_leave_request_guard();

-- ---------------------------------------------------------------------------
-- Audit and notification
-- ---------------------------------------------------------------------------

create or replace function public.log_hr_leave_request_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee record;
  v_type text;
begin
  select e.full_name, e.profile_id into v_employee
    from public.hr_employees e where e.id = new.employee_id;
  select name into v_type from public.hr_leave_types where id = new.leave_type_id;

  if tg_op = 'INSERT' then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.leave_requested', 'hr_leave_request', new.id,
            jsonb_build_object('employee', v_employee.full_name, 'type', v_type,
                               'from', new.start_date, 'to', new.end_date,
                               'days', new.days, 'status', new.status, 'via', current_user));

    if new.status = 'pending' then
      perform public.hr_notify(
        new.org_id, public.hr_manager_profile_of(new.employee_id),
        'leave.requested', v_employee.full_name || ' requested leave',
        v_type || ', ' || new.days || ' day(s) from ' || to_char(new.start_date, 'DD Mon YYYY'),
        '/hr/leave?request=' || new.id, 'hr_leave_request', new.id);
      perform public.hr_notify_hr(
        new.org_id, 'leave.requested', v_employee.full_name || ' requested leave',
        v_type || ', ' || new.days || ' day(s) from ' || to_char(new.start_date, 'DD Mon YYYY'),
        '/hr/leave?request=' || new.id, 'hr_leave_request', new.id, auth.uid());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.leave_' || new.status, 'hr_leave_request', new.id,
            jsonb_build_object('employee', v_employee.full_name, 'type', v_type,
                               'from', new.start_date, 'to', new.end_date, 'days', new.days,
                               'status', jsonb_build_object('from', old.status, 'to', new.status),
                               'note', new.decision_note, 'via', current_user));

    if new.status in ('approved', 'rejected') then
      perform public.hr_notify(
        new.org_id, v_employee.profile_id, 'leave.' || new.status,
        'Leave ' || new.status,
        v_type || ', ' || new.days || ' day(s) from ' || to_char(new.start_date, 'DD Mon YYYY')
          || coalesce(' — ' || new.decision_note, ''),
        '/hr/me?tab=leave', 'hr_leave_request', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hr_leave_requests_log on public.hr_leave_requests;
create trigger hr_leave_requests_log
  after insert or update on public.hr_leave_requests
  for each row execute function public.log_hr_leave_request_change();

create or replace function public.log_hr_leave_balance_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row record;
begin
  v_row := coalesce(new, old);
  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_row.org_id, auth.uid(), 'hr.leave_balance_changed', 'hr_employee', v_row.employee_id,
          jsonb_build_object(
            'leave_type_id', v_row.leave_type_id, 'leave_year', v_row.leave_year,
            'from', case when tg_op = 'INSERT' then null else
              jsonb_build_object('entitlement', old.entitlement_days,
                                 'carried_over', old.carried_over_days,
                                 'adjustment', old.adjustment_days) end,
            'to', case when tg_op = 'DELETE' then null else
              jsonb_build_object('entitlement', new.entitlement_days,
                                 'carried_over', new.carried_over_days,
                                 'adjustment', new.adjustment_days) end,
            'via', current_user));
  return v_row;
end;
$$;

drop trigger if exists hr_leave_balances_log on public.hr_leave_balances;
create trigger hr_leave_balances_log
  after insert or update or delete on public.hr_leave_balances
  for each row execute function public.log_hr_leave_balance_change();

-- ---------------------------------------------------------------------------
-- Default leave types
-- ---------------------------------------------------------------------------
--
-- Entitlement days are all zero on purpose. Botswana's Employment Act sets
-- minimums, and section 12 says not to hard-code them: a number seeded here
-- would look authoritative, would be wrong for fixed-term and casual staff, and
-- would silently become wrong again the next time the law moves. HR sets them.

insert into public.hr_leave_types (org_id, name, code, is_paid, requires_document, deducts_from_balance, sort_order)
select o.id, v.name, v.code, v.is_paid, v.requires_document, v.deducts, v.sort_order
  from public.organizations o
  cross join (values
    ('Annual Leave',                 'annual',   true,  false, true,  10),
    ('Sick Leave',                   'sick',     true,  true,  true,  20),
    ('Family Responsibility Leave',  'family',   true,  false, true,  30),
    ('Unpaid Leave',                 'unpaid',   false, false, false, 40),
    ('Other',                        'other',    true,  false, true,  50)
  ) as v(name, code, is_paid, requires_document, deducts, sort_order)
on conflict (org_id, code) do nothing;

comment on view public.hr_leave_balance_summary is
  'Entitlement, used, pending and remaining per employee and leave type for the current leave year. Derived, never stored: cancelling approved leave returns the balance because it was only ever a count.';
comment on function public.hr_leave_request_guard is
  'Enforces who may approve, reject or cancel, stamps the decision, and refuses overlapping approved leave. The RLS policy has to let an employee update their own row to withdraw it, which is exactly why this trigger exists.';
