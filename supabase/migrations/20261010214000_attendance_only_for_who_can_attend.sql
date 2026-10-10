-- Attendance stops marking people absent who cannot attend.
--
-- `hr_attendance_report` (and so the HR dashboard's Absent and Expected
-- tiles) listed every employee record for every working day:
--
-- * An employee with no app login (`profile_id` null) can never start a
--   workday, so every working day after their start date came out Absent.
--   They are left out: there is nothing for this report to say about them.
-- * Someone terminated, resigned, inactive or suspended with no end date
--   (the employee form does not ask for one) was Absent every working day
--   for ever. Without an end date, their employment for this report now ends
--   on the last day they recorded a workday, the same rule the report already
--   uses for a missing start date. An end date, when set, still wins.
--
-- Gold Fortune's five employees are all active and linked, so its figures do
-- not change. Patched in place; the rollback reverses both replacements.

do $$
declare
  r record;
  def text;
  n int;
begin
  def := pg_get_functiondef('public.hr_attendance_report(date,date,uuid,uuid,uuid,text)'::regprocedure);
  for r in
    select * from (values
      ($a$           coalesce(e.end_date, 'infinity'::date) as employed_to$a$,
       $b$           coalesce(e.end_date,
                    case when e.employment_status in ('active', 'on_leave') then 'infinity'::date
                         else coalesce((select max((w.started_at at time zone cfg.tz)::date)
                                          from public.workday_sessions w
                                         where w.rep_id = e.profile_id and w.org_id = cfg.org),
                                       '-infinity'::date) end) as employed_to$b$),
      ($a$     where e.org_id = cfg.org
       and public.hr_can_view_employee(e.id)$a$,
       $b$     where e.org_id = cfg.org
       and e.profile_id is not null
       and public.hr_can_view_employee(e.id)$b$)
    ) v(old_text, new_text)
  loop
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then
      raise exception 'hr_attendance_report: expected 1 of the anchor, found %', n;
    end if;
    def := replace(def, r.old_text, r.new_text);
  end loop;
  execute def;
end;
$$;
