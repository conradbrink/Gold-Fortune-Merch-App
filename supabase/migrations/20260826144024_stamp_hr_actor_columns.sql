-- Stamp "who did this" in the database instead of trusting the client to say.
--
-- Found the same way as the leave-transition hole: by inserting a case response
-- through SQL rather than through the web form, and getting a response whose
-- author was null. The form passes `created_by` and works; anything that does
-- not pass it produces a record of an employee's answer to a disciplinary
-- allegation with nobody's name on it. A field that is only correct when the
-- caller remembers is a field that is eventually wrong.
--
-- Every actor column in the module now behaves the way `hr_leave_requests`,
-- `hr_disciplinary_cases` and `hr_warnings` already did — set from
-- `auth.uid()`, by a trigger, on the way in.
--
-- The rule is "overwrite when there is a signed-in caller, otherwise leave it
-- alone", and both halves matter:
--
--   * Overwriting rather than filling a null is what stops a client naming
--     somebody else as the author. `coalesce(new.col, auth.uid())` would have
--     been the smaller change and would have kept that hole open.
--   * Leaving it alone when `auth.uid()` is null keeps the service role, a
--     migration and a repair script able to attribute a row deliberately —
--     which is how the seed migration recorded who created the first employees.

create or replace function public.hr_stamp_actor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_column text := tg_argv[0];
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;
  -- The column is named by the trigger definition, so it has to be written
  -- dynamically. A jsonb round-trip is the only way to assign to NEW by name
  -- in plpgsql, and it is cheap on a single row.
  return jsonb_populate_record(new, jsonb_build_object(v_column, v_uid));
end;
$$;

comment on function public.hr_stamp_actor is
  'Sets the actor column named in the trigger arguments from auth.uid(). Overwrites whatever the client sent, so an author cannot be forged; skipped entirely when there is no signed-in caller, so the service role can still attribute rows deliberately.';

drop trigger if exists hr_documents_stamp_actor on public.hr_documents;
create trigger hr_documents_stamp_actor before insert on public.hr_documents
  for each row execute function public.hr_stamp_actor('uploaded_by');

drop trigger if exists hr_case_evidence_stamp_actor on public.hr_case_evidence;
create trigger hr_case_evidence_stamp_actor before insert on public.hr_case_evidence
  for each row execute function public.hr_stamp_actor('uploaded_by');

drop trigger if exists hr_case_responses_stamp_actor on public.hr_case_responses;
create trigger hr_case_responses_stamp_actor before insert on public.hr_case_responses
  for each row execute function public.hr_stamp_actor('created_by');

drop trigger if exists hr_employee_assets_stamp_actor on public.hr_employee_assets;
create trigger hr_employee_assets_stamp_actor before insert on public.hr_employee_assets
  for each row execute function public.hr_stamp_actor('created_by');

drop trigger if exists hr_employees_stamp_actor on public.hr_employees;
create trigger hr_employees_stamp_actor before insert on public.hr_employees
  for each row execute function public.hr_stamp_actor('created_by');

-- These two are stamped on UPDATE as well as INSERT: the interesting question
-- about a balance adjustment or a salary change is who made the *latest* one.
drop trigger if exists hr_leave_balances_stamp_actor on public.hr_leave_balances;
create trigger hr_leave_balances_stamp_actor before insert or update on public.hr_leave_balances
  for each row execute function public.hr_stamp_actor('updated_by');

drop trigger if exists hr_compensation_stamp_actor on public.hr_employee_compensation;
create trigger hr_compensation_stamp_actor before insert or update on public.hr_employee_compensation
  for each row execute function public.hr_stamp_actor('updated_by');
