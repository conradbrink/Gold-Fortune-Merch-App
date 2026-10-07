-- Guard the seven report RPCs that still lean on RLS alone.
--
-- `20260912053302_guard_rep_performance_rpcs` closed the four functions #57
-- added and left these, deliberately, as their own change with their own
-- blast radius. That change is this one, decided by the owner on 7 October
-- 2026 as part of preparing for more than one company.
--
-- The hole: these are `security invoker` and granted to `authenticated` (and,
-- for three of them, `anon`), and RLS on `visits`, `routes` and
-- `form_submissions` is scoped to the *organisation*, not to the rep. So any rep
-- holding a token — every rep's phone has one — can call them through
-- PostgREST and read every colleague's figures. The web page was never the
-- boundary: `canAccessPath` already refuses `/reports` without `insights`.
--
-- Who loses access, read from production before applying: the three field reps,
-- the warehouse clerk and the CFO login — none of whom hold `insights`, so none
-- of whom can open `/reports` today. Both managers hold it and keep it. Every
-- live caller is `web/lib/reports.ts`, reached from `/reports` and
-- `/api/insights`.
--
-- HOW. Each function gains a first statement,
--
--     select public.require_permission('insights');
--
-- ahead of its existing query. A `language sql` function runs every statement
-- in its body and returns the last, so the check runs on every call whatever
-- the arguments. That matters: the first version of this migration folded the
-- guard into the `cfg` CTE, the way the rep_performance functions do, and the
-- rehearsal on 7 October caught a rep calling `form_report(null, …)` without
-- being refused. With a null template the planner proves the query empty and
-- never evaluates `cfg`, guard included. Nothing leaked, but a guard that
-- depends on the arguments is not a guard. (The four `rep_performance_*`
-- functions use the CTE form; worth checking the same way.)
--
-- Rather than restate seven bodies (about 21 kB of SQL whose only change is
-- one line each), the bodies are taken from the catalogue and rewritten in
-- place, the technique `20260826155052_org_timezone` used, with assertions
-- that the anchor appears exactly once and that the function is not already
-- guarded. A body that has drifted stops the migration rather than being
-- skipped. The rollback applies the inverse replacement.

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

    if def is null then
      raise exception '%: not found', fn;
    end if;
    if def like '%require_permission%' then
      raise exception '%: already guarded — has this migration run before?', fn;
    end if;
    if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
      raise exception '%: the body delimiter is not present exactly once; cannot rewrite safely', fn;
    end if;

    execute replace(def, anchor, guarded);
  end loop;
end;
$$;

-- All seven were also executable by `anon`, and by PUBLIC (`=X/postgres` in
-- the ACL, read on 7 October 2026), so revoking from `anon` alone would have
-- changed nothing. With no session there is no organisation and nothing comes
-- back, but there is no reason for either grant, and the guard raises for anon
-- regardless. `authenticated` and `service_role` hold explicit grants of their
-- own and are untouched.
revoke execute on function public.rep_scorecard(timestamptz, timestamptz) from public, anon;
revoke execute on function public.schedule_adherence(timestamptz, timestamptz) from public, anon;
revoke execute on function public.coverage_gaps(timestamptz, timestamptz) from public, anon;
revoke execute on function public.perfect_store_score(timestamptz, timestamptz) from public, anon;
revoke execute on function public.oos_hotspots(timestamptz, timestamptz) from public, anon;
revoke execute on function public.compliance_trends(timestamptz, timestamptz, text, uuid) from public, anon;
revoke execute on function public.form_report(uuid, timestamptz, timestamptz, uuid[], uuid[]) from public, anon;
