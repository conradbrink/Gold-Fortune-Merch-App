-- Rollback of 20261010211000_auto_end_after_a_late_start.
do $$
declare
  def text;
  new_text constant text :=
    '((ws.started_at at time zone c.tz)::date + c.cutoff) at time zone c.tz as cutoff_at';
  old_text constant text :=
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
