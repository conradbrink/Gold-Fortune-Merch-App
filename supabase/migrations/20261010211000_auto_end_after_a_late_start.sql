-- A workday started after the company's auto-end time ends at the NEXT
-- cut-off, not at one already past.
--
-- `auto_end_overdue_workdays` put the cut-off on the day the workday started:
-- a plumber who starts a call-out at 20:10 with the default 19:30 auto-end was
-- closed on the next hourly run with ended_at 19:30, before started_at, zero
-- hours and zero km. The cut-off is now the first one after the start.
-- (The phone app's own timer, `autoEndCutoffFor`, gets the same rule.)

do $$
declare
  def text;
  old_text constant text :=
    '((ws.started_at at time zone c.tz)::date + c.cutoff) at time zone c.tz as cutoff_at';
  new_text constant text :=
    '((ws.started_at at time zone c.tz)::date'
    || ' + case when (ws.started_at at time zone c.tz)::time >= c.cutoff then 1 else 0 end'
    || ' + c.cutoff) at time zone c.tz as cutoff_at';
  n int;
begin
  def := pg_get_functiondef('public.auto_end_overdue_workdays(time)'::regprocedure);
  n := (length(def) - length(replace(def, old_text, ''))) / length(old_text);
  if n <> 1 then
    raise exception 'auto_end_overdue_workdays: expected 1 cut-off expression, found %', n;
  end if;
  execute replace(def, old_text, new_text);
end;
$$;
