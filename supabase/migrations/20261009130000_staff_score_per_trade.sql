-- Stage 7 Part 4b: each trade's own staff score, and the research's fairness
-- rules.
--
-- * Setting `staff_score_weights`: the score's parts and their published
--   weights ("completion:35,proof:15,…", adding to 100), seeded per trade from
--   the industry research. The parts are a catalogue in the web
--   (lib/staff-score.ts); a part nothing measures yet is shown as "not
--   measured yet" and its weight is spread over the rest. The default is
--   today's distribution weights, so Gold Fortune's published weights are
--   unchanged (owner, 8 Oct: "keep GF unchanged").
-- * approved_leave_days(): the days each person was on approved leave, for
--   the caller's own company. Planned work on those days leaves the score
--   (owner, 8 Oct: "apply leave", every company). Only the day is returned,
--   never the kind of leave or its reason.
-- * staff_score_inputs(): one row per person for the period, every count a
--   score part needs, so the {Staff} tab and the employee report score from
--   the same numbers. Planned and caught-up work follow the employee report's
--   rules exactly (planned up to today; a round gone back to later counts, by
--   route_catchups); GPS counts every check-in with a fix, none without
--   (no fix is unknown, not a fail), as rep_performance_summary does.
--
-- Rollback: supabase/rollback/20261009130000_staff_score_per_trade.down.sql.

------------------------------------------------------------- the setting

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('staff_score_weights', 'Staff score weights',
   'The parts of the staff score and their weights, adding to 100.',
   'text', '"sales:35,visits:25,coverage:15,merchandising:15,compliance:10"', null, null,
   '^([a-z_]+:[0-9]{1,3}(,[a-z_]+:[0-9]{1,3})*)?$', 950);

-- Industry research §1-11, "Staff score". Parts marked there as needing data
-- Tickd does not record yet keep their published weight and sit out until it
-- does; the owner approved stand-ins for handover, treatment records, proof of
-- delivery, before/after photos (photo and checklist) and round quality
-- (a GPS-verified round with a photo).
insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'staff_score_weights', to_jsonb(v.weights)
  from (values
    ('cleaning', 'completion:35,punctuality:15,proof:15,full_time:15,inspection:10,gps_verified:10'),
    ('garden', 'completion:30,before_after:20,hours_vs_budget:20,gps_verified:15,onsite_share:15'),
    ('plumbing', 'completion:25,first_time_fix:25,paperwork:20,onsite_share:15,quote_conversion:15'),
    ('installation', 'completion:25,handover:25,no_returns:20,hours_vs_quoted:15,punctuality:15'),
    ('maintenance', 'completion:30,response_time:20,no_repeats:20,proof:15,gps_verified:15'),
    ('security', 'completion:35,punctuality:25,round_quality:20,no_long_gaps:10,reporting:10'),
    ('pest_control', 'completion:30,no_callbacks:25,treatment_records:25,jobs_per_day:10,gps_verified:10'),
    ('pool', 'completion:30,readings:20,back_in_range:15,before_after:15,full_time:10,gps_verified:10'),
    ('delivery', 'completion:30,delivery_proof:25,driver_failures:20,punctuality:15,gps_verified:10'),
    ('distribution', 'sales:35,visits:25,coverage:15,merchandising:15,compliance:10'),
    ('generic', 'completion:40,proof:20,gps_verified:15,punctuality:15,full_time:10')
  ) as v(template_code, weights)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key = 'staff_score_weights'
on conflict (org_id, key) do nothing;

------------------------------------------------------------- leave days

-- Security definer because leave belongs to HR and its rows are readable by
-- HR people only; a manager reading scores needs to know that a day was
-- leave, nothing more. The caller's own company, and only with `insights`.
create function public.approved_leave_days(p_from date, p_to date)
returns table (profile_id uuid, day date)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
begin
  perform public.require_module('reports');
  perform public.require_permission('insights');
  v_org := public.current_org_id();
  if not public.module_enabled('hr') then
    return;
  end if;
  return query
  select distinct e.profile_id, d::date
    from public.hr_leave_requests lr
    join public.hr_employees e on e.id = lr.employee_id
    cross join lateral generate_series(greatest(lr.start_date, p_from), least(lr.end_date, p_to - 1), interval '1 day') d
   where lr.org_id = v_org and e.org_id = v_org and lr.status = 'approved'
     and e.profile_id is not null
     and lr.start_date < p_to and lr.end_date >= p_from;
end;
$function$;

revoke all on function public.approved_leave_days(date, date) from public, anon;
grant execute on function public.approved_leave_days(date, date) to authenticated;

------------------------------------------------------------- score inputs

create function public.staff_score_inputs(p_from timestamptz, p_to timestamptz, p_territory_id uuid default null)
returns table (staff_id uuid, staff_name text,
               planned integer, served integer, leave_planned integer, leave_served integer,
               sites_planned integer, sites_reached integer,
               finished integer, proven integer, with_form integer, rounds_proven integer,
               with_fix integer, inside integer,
               onsite_seconds integer, workday_seconds integer, workdays integer, staff_days integer)
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
  v_from date;
  v_to date;
  v_today date;
  v_forms boolean;
begin
  perform public.require_module('reports');
  perform public.require_permission('insights');
  v_org := public.current_org_id();
  v_tz := public.org_timezone(v_org);
  v_from := (p_from at time zone v_tz)::date;
  v_to := (p_to at time zone v_tz)::date;
  v_today := (now() at time zone v_tz)::date;
  v_forms := public.module_enabled('checklists_forms');
  return query
  with st as materialized (
    select s.id, s.geofence_radius_m
      from public.stores s
     where s.org_id = v_org
       and (p_territory_id is null
            or s.territory_id in (select t.territory_id from public.territory_subtree(p_territory_id) t))
  ),
  leave_days as materialized (
    select l.profile_id, l.day from public.approved_leave_days(v_from, v_to) l
  ),
  caught as materialized (
    select rc.route_id from public.route_catchups(p_from, p_to) rc
  ),
  planned as materialized (
    select ro.rep_id, ro.store_id,
           (exists (select 1 from public.visits v where v.route_id = ro.id and v.status = 'checked_out')
            or ro.id in (select route_id from caught)) as served,
           exists (select 1 from leave_days l where l.profile_id = ro.rep_id and l.day = ro.scheduled_date) as on_leave
      from public.routes ro
      join st on st.id = ro.store_id
     where ro.org_id = v_org and ro.rep_id is not null
       and ro.scheduled_date >= v_from and ro.scheduled_date < v_to
       and ro.scheduled_date <= v_today
  ),
  vis as materialized (
    select v.id, v.rep_id, v.store_id, v.status, v.duration_seconds,
           v.checkin_distance_from_store_m as dist, st.geofence_radius_m as radius,
           (v.checkin_at at time zone v_tz)::date as day,
           exists (select 1 from public.photos ph where ph.visit_id = v.id) as has_photo,
           exists (select 1 from public.form_submissions fs where fs.visit_id = v.id) as has_form
      from public.visits v
      join st on st.id = v.store_id
     where v.org_id = v_org and v.checkin_at >= p_from and v.checkin_at < p_to
  ),
  wd as (
    select w.rep_id,
           count(*) filter (where w.ended_at is not null) as ended,
           coalesce(sum(w.duration_seconds) filter (where w.ended_at is not null), 0) as seconds
      from public.workday_sessions w
     where w.org_id = v_org and w.started_at >= p_from and w.started_at < p_to
     group by 1
  ),
  p as (
    select rep_id,
           count(*) as planned,
           count(*) filter (where served) as served,
           count(*) filter (where on_leave) as leave_planned,
           count(*) filter (where on_leave and served) as leave_served
      from planned group by 1
  ),
  -- Coverage: the places planned on working days, and which of them were
  -- reached at least once in the period.
  sp as (
    select pl.rep_id,
           count(distinct pl.store_id) as sites_planned,
           count(distinct pl.store_id) filter (where exists (
             select 1 from vis v where v.rep_id = pl.rep_id and v.store_id = pl.store_id and v.status = 'checked_out'))
             as sites_reached
      from planned pl where not pl.on_leave group by 1
  ),
  f as (
    select rep_id,
           count(*) filter (where status = 'checked_out') as finished,
           count(*) filter (where status = 'checked_out' and has_photo and (has_form or not v_forms)) as proven,
           count(*) filter (where status = 'checked_out' and has_form) as with_form,
           count(*) filter (where status = 'checked_out' and has_photo and dist is not null and dist <= radius) as rounds_proven,
           count(*) filter (where dist is not null) as with_fix,
           count(*) filter (where dist is not null and dist <= radius) as inside,
           coalesce(sum(duration_seconds) filter (where status = 'checked_out' and duration_seconds > 0), 0) as onsite,
           count(distinct day) filter (where status = 'checked_out') as staff_days
      from vis group by 1
  ),
  people as (
    select rep_id from p union select rep_id from f union select rep_id from wd
  )
  select pe.rep_id,
         pr.full_name,
         coalesce(p.planned, 0)::integer,
         coalesce(p.served, 0)::integer,
         coalesce(p.leave_planned, 0)::integer,
         coalesce(p.leave_served, 0)::integer,
         coalesce(sp.sites_planned, 0)::integer,
         coalesce(sp.sites_reached, 0)::integer,
         coalesce(f.finished, 0)::integer,
         coalesce(f.proven, 0)::integer,
         coalesce(f.with_form, 0)::integer,
         coalesce(f.rounds_proven, 0)::integer,
         coalesce(f.with_fix, 0)::integer,
         coalesce(f.inside, 0)::integer,
         coalesce(f.onsite, 0)::integer,
         coalesce(wd.seconds, 0)::integer,
         coalesce(wd.ended, 0)::integer,
         coalesce(f.staff_days, 0)::integer
    from people pe
    join public.profiles pr on pr.id = pe.rep_id
    left join p on p.rep_id = pe.rep_id
    left join sp on sp.rep_id = pe.rep_id
    left join f on f.rep_id = pe.rep_id
    left join wd on wd.rep_id = pe.rep_id
   order by pr.full_name, pe.rep_id;
end;
$function$;

revoke all on function public.staff_score_inputs(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.staff_score_inputs(timestamptz, timestamptz, uuid) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'approved_leave_days', 'reports'),
  ('function', 'staff_score_inputs', 'reports');
