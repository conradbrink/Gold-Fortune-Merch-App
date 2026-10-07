-- Rollback for 20261007101102_guard_report_rpcs: the inverse replacement, and
-- the PUBLIC and anon grants restored. All seven carried both before (ACL
-- `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres}`, read on 7 October 2026).

do $$
declare
  fn   text;
  def  text;
  anchor constant text := 'AS $function$';
  guarded constant text := E'AS $function$\n  select public.require_permission(''insights'');\n';
begin
  foreach fn in array array['rep_scorecard','schedule_adherence','coverage_gaps',
                            'perfect_store_score','oos_hotspots','compliance_trends',
                            'form_report']
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if (length(def) - length(replace(def, guarded, ''))) / length(guarded) <> 1 then
      raise exception '%: the guard statement is not present exactly once; cannot roll back safely', fn;
    end if;

    execute replace(def, guarded, anchor);
  end loop;
end;
$$;

grant execute on function public.rep_scorecard(timestamptz, timestamptz) to public, anon;
grant execute on function public.schedule_adherence(timestamptz, timestamptz) to public, anon;
grant execute on function public.coverage_gaps(timestamptz, timestamptz) to public, anon;
grant execute on function public.perfect_store_score(timestamptz, timestamptz) to public, anon;
grant execute on function public.oos_hotspots(timestamptz, timestamptz) to public, anon;
grant execute on function public.compliance_trends(timestamptz, timestamptz, text, uuid) to public, anon;
grant execute on function public.form_report(uuid, timestamptz, timestamptz, uuid[], uuid[]) to public, anon;
