-- Rollback of 20261010221000_scorecard_completion_against_plan: the inverse
-- replacements.

do $$
declare
  r record;
  def text := pg_get_functiondef('public.rep_scorecard(timestamptz,timestamptz)'::regprocedure);
  n int;
begin
  for r in
    select * from (values
      ($a$  with cfg as materialized (
    select public.current_org_id() as org
  ),$a$,
       $b$  with cfg as materialized (
    select public.current_org_id() as org
  ),
  bounds as materialized (
    select (p_from at time zone public.org_timezone(cfg.org))::date as d0,
           (p_to   at time zone public.org_timezone(cfg.org))::date as d1,
           (now()  at time zone public.org_timezone(cfg.org))::date as today
      from cfg
  ),
  caught as materialized (
    select rc.route_id from public.route_catchups(p_from, p_to) rc
  ),
  plan as materialized (
    select ro.rep_id,
           count(*) as planned,
           count(*) filter (where d.done) as done
      from public.routes ro
      cross join cfg
      cross join bounds b
      cross join lateral (
        select exists (select 1 from public.visits pv
                        where pv.route_id = ro.id and pv.status = 'checked_out')
               or ro.id in (select route_id from caught) as done
      ) d
     where ro.org_id = cfg.org
       and ro.scheduled_date >= b.d0
       and ro.scheduled_date <  b.d1
       and (ro.scheduled_date < b.today or d.done)
     group by ro.rep_id
  ),$b$),
      ($a$  select b.rep_id, b.full_name, b.visits_total, b.visits_completed,
         b.completion_rate, b.avg_duration_seconds, b.stores_covered,
         b.submissions, b.form_compliance_rate, b.verified_rate,
         round(
           100.0 * (coalesce(b.completion_rate, 0) + coalesce(b.form_compliance_rate, 0)
                    + coalesce(b.verified_rate, 0))
           / nullif((b.completion_rate is not null)::int
                    + (b.form_compliance_rate is not null)::int
                    + (b.verified_rate is not null)::int, 0)
         , 1) as score
  from base b
  order by score desc nulls last, b.visits_completed desc;$a$,
       $b$  select x.rep_id, x.full_name, x.visits_total, x.visits_completed,
         x.completion_rate, x.avg_duration_seconds, x.stores_covered,
         x.submissions, x.form_compliance_rate, x.verified_rate,
         round(
           100.0 * (coalesce(x.completion_rate, 0) + coalesce(x.form_compliance_rate, 0)
                    + coalesce(x.verified_rate, 0))
           / nullif((x.completion_rate is not null)::int
                    + (x.form_compliance_rate is not null)::int
                    + (x.verified_rate is not null)::int, 0)
         , 1) as score
  from (
    select ids.rep_id,
           coalesce(b.full_name, pr.full_name) as full_name,
           coalesce(b.visits_total, 0) as visits_total,
           coalesce(b.visits_completed, 0) as visits_completed,
           case when pl.planned > 0 then round(pl.done::numeric / pl.planned, 4) end as completion_rate,
           b.avg_duration_seconds,
           coalesce(b.stores_covered, 0) as stores_covered,
           coalesce(b.submissions, 0) as submissions,
           b.form_compliance_rate,
           b.verified_rate
      from (select base.rep_id from base union select plan.rep_id from plan) ids
      left join base b on b.rep_id = ids.rep_id
      left join plan pl on pl.rep_id = ids.rep_id
      left join public.profiles pr on pr.id = ids.rep_id
  ) x
  order by score desc nulls last, x.visits_completed desc;$b$)
    ) v(new_text, old_text)
  loop
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then
      raise exception 'rep_scorecard: expected 1 of the anchor, found %', n;
    end if;
    def := replace(def, r.old_text, r.new_text);
  end loop;
  execute def;
end;
$$;
