-- Schedule generation counts from the company's today, not the server's.
--
-- `generate_routes` used `current_date`, which is the database's date (UTC).
-- In Gaborone between 00:00 and 02:00 that is still yesterday: the run
-- planned "tomorrow" as today and treated today's unvisited cycle stops as
-- future ones it could retract. West of UTC an evening run skipped tomorrow
-- entirely. All three uses now read the company's own date.

do $$
declare
  def text := pg_get_functiondef('public.generate_routes(int,boolean)'::regprocedure);
  n int;
begin
  n := (length(def) - length(replace(def, 'current_date', ''))) / length('current_date');
  if n <> 3 then
    raise exception 'generate_routes: expected 3 uses of current_date, found %', n;
  end if;
  execute replace(def, 'current_date', '(now() at time zone public.org_timezone(v_org))::date');
end;
$$;
