-- Rollback of 20261010215000_dashboard_invoiced_range_end.

do $$
declare
  def text := pg_get_functiondef('public.dashboard_business(timestamptz,timestamptz)'::regprocedure);
  new_text constant text := 'issue_date < (p_to at time zone v_tz)::date + 1';
  old_text constant text := 'issue_date::timestamp < (p_to at time zone v_tz)';
  n int;
begin
  n := (length(def) - length(replace(def, old_text, ''))) / length(old_text);
  if n <> 1 then
    raise exception 'dashboard_business: expected 1 of the anchor, found %', n;
  end if;
  execute replace(def, old_text, new_text);
end;
$$;
