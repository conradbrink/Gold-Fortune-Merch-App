-- Rollback of 20261010216000_generate_routes_company_today.
do $$
declare
  def text := pg_get_functiondef('public.generate_routes(int,boolean)'::regprocedure);
  new_text constant text := '(now() at time zone public.org_timezone(v_org))::date';
  n int;
begin
  n := (length(def) - length(replace(def, new_text, ''))) / length(new_text);
  if n <> 3 then
    raise exception 'generate_routes: expected 3 company dates, found %', n;
  end if;
  execute replace(def, new_text, 'current_date');
end;
$$;
