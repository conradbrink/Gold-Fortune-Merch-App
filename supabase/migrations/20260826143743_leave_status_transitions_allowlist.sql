-- Close a hole in the leave guard: an employee could un-approve their own leave.
--
-- Found by smoke-testing the module against live data as a rep, not by reading
-- the code — which is the only reason it was found at all.
--
-- The original guard asked "who may move a request *into* approved, rejected or
-- cancelled?" and answered each correctly. What it never asked was what happens
-- to every other transition, and `approved → pending` is one of those: it is
-- not a decision, so the decision check did not run; the source status was not
-- rejected or cancelled, so the terminal check did not run either. It fell
-- straight through and the update was allowed. A rep could therefore take an
-- approval their manager had given, put the request back into the pending
-- queue, and leave `decided_by` still naming the manager who no longer had
-- decided anything. The balance moved from used to pending with it.
--
-- The fix is to invert the shape: enumerate the transitions that ARE allowed
-- and refuse everything else. A guard written as a list of forbidden moves is
-- wrong the first time somebody invents a new one; a guard written as a list of
-- permitted moves is merely incomplete, and says so.
--
--     pending   → approved | rejected     HR or the employee's manager
--     pending   → cancelled               HR, the manager, or the employee
--     approved  → cancelled               HR, the manager, or the employee
--     anything else                       refused, for everybody
--
-- `approved → pending` is refused for HR too, deliberately. An approval given
-- in error is corrected by cancelling the request and filing a new one, which
-- leaves both facts in the record; quietly reopening it leaves a request whose
-- history says it was once approved by somebody who would not say so now.

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
      -- An allowlist, not a denylist. See the header.
      if old.status = 'pending' and new.status in ('approved', 'rejected') then
        -- A manager cannot be their own manager (hr_employees forbids it), so
        -- the only route to approving your own leave is holding the HR role.
        -- Allowed on purpose: in an org with one HR user, refusing it would
        -- mean that person can never take a day off.
        if not (v_is_hr or v_is_manager) then
          raise exception 'only HR or the employee''s manager may decide a leave request';
        end if;
        new.decided_by := auth.uid();
        new.decided_at := now();

      elsif old.status in ('pending', 'approved') and new.status = 'cancelled' then
        if not (v_is_hr or v_is_manager or v_is_self) then
          raise exception 'you may not cancel this leave request';
        end if;

      else
        raise exception 'a leave request cannot go from % to %', old.status, new.status;
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

comment on function public.hr_leave_request_guard is
  'Enforces the permitted leave-status transitions as an allowlist, stamps the decision, and refuses overlapping approved leave. Written as an allowlist because the denylist version silently permitted approved → pending, which let an employee erase their own approval.';
