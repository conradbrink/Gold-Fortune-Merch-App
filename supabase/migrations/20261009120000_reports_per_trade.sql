-- Stage 7 Part 4a: each trade's own reports.
--
-- * Setting `report_tabs`: the Reports page's tabs, in order, as a comma list
--   seeded per trade. Its default is today's eight tabs in today's order, so
--   Gold Fortune (distribution) sees no change. A tab still needs its module.
-- * Settings `report_short_day_hours` and `report_long_day_hours`: the Hours
--   tab marks a finished workday shorter or longer than these (0 = no mark).
--   Seeded where the industry research names a limit: a cleaner's day under
--   6 hours, a guard's shift over 12.
-- * service_log(): proof of service, one row per finished job in the period,
--   per place: who, in, out, minutes, on site or not, forms, photos, planned
--   or not, and the gap since the place's previous check-in that day (the
--   longest gap between rounds, research §6).
-- * staff_hours(): one row per person per day: first in, last out, workday,
--   time on site, jobs, km. The rest (travel, jobs per hour, short and long
--   days) is arithmetic the page does on these.
--
-- Formulas as the dashboard's (research, "Standard formulas"): on site is a
-- check-in within the place's radius; a check-in without a fix is unknown
-- (null), never "away".
--
-- Both functions are the `reports` module's and need `insights`, like every
-- report; security invoker, so the caller's own rows only.
--
-- Rollback: supabase/rollback/20261009120000_reports_per_trade.down.sql.

------------------------------------------------------------- the settings

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('report_tabs', 'Report tabs',
   'The tabs on the Reports page, in order.',
   'text', '"score,oos,coverage,adherence,reps,trends,form,photos"', null, null, '^([a-z0-9_]+(,[a-z0-9_]+)*)?$', 920),
  ('report_short_day_hours', 'Short day (hours)',
   'The Hours report marks a finished workday shorter than this. 0 turns the mark off.',
   'integer', '0', 0, 24, null, 930),
  ('report_long_day_hours', 'Long day (hours)',
   'The Hours report marks a finished workday longer than this. 0 turns the mark off.',
   'integer', '0', 0, 24, null, 940);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'report_tabs', to_jsonb(v.tabs)
  from (values
    ('cleaning', 'service_log,adherence,hours,reps,form,photos,coverage'),
    ('garden', 'service_log,hours,adherence,reps,photos,form,coverage'),
    ('plumbing', 'service_log,hours,reps,form,photos,adherence'),
    ('installation', 'service_log,hours,reps,form,photos,adherence'),
    ('maintenance', 'service_log,adherence,hours,reps,form,photos,coverage'),
    ('security', 'service_log,adherence,hours,reps,form,photos'),
    ('pest_control', 'service_log,hours,adherence,reps,form,photos'),
    ('pool', 'service_log,hours,adherence,reps,form,photos'),
    ('delivery', 'service_log,hours,adherence,reps,form,photos'),
    ('distribution', 'score,oos,coverage,adherence,reps,trends,form,photos'),
    ('generic', 'adherence,service_log,hours,reps,form,photos,coverage')
  ) as v(template_code, tabs)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, v.setting_key, to_jsonb(v.hours)
  from (values
    ('cleaning', 'report_short_day_hours', 6),
    ('security', 'report_long_day_hours', 12)
  ) as v(template_code, setting_key, hours)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

-- Existing companies: their first trade's values, as create_company writes
-- every setting (Gold Fortune: distribution's, which are today's tabs).
insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key in ('report_tabs', 'report_short_day_hours', 'report_long_day_hours')
on conflict (org_id, key) do nothing;

------------------------------------------------------- proof of service

create function public.service_log(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns table (visit_id uuid, store_id uuid, store_name text, store_address text, day date,
               staff_name text, checkin_at timestamptz, checkout_at timestamptz, minutes integer,
               on_site boolean, forms integer, photos integer, planned boolean, gap_minutes integer)
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
begin
  perform public.require_module('reports');
  perform public.require_permission('insights');
  v_org := public.current_org_id();
  v_tz := public.org_timezone(v_org);
  return query
  with done as (
    select v.id, v.store_id, v.rep_id, v.route_id, v.checkin_at, v.checkout_at,
           v.checkin_distance_from_store_m as dist,
           (v.checkin_at at time zone v_tz)::date as day
      from public.visits v
     where v.org_id = v_org and v.status = 'checked_out'
       and v.checkin_at >= p_from and v.checkin_at < p_to
       and (p_store_id is null or v.store_id = p_store_id)
  )
  select d.id,
         d.store_id,
         st.name,
         nullif(concat_ws(', ', nullif(btrim(st.address), ''), nullif(btrim(st.city), '')), ''),
         d.day,
         p.full_name,
         d.checkin_at,
         d.checkout_at,
         round(extract(epoch from d.checkout_at - d.checkin_at) / 60)::integer,
         case when d.dist is null then null else d.dist <= st.geofence_radius_m end,
         (select count(*) from public.form_submissions f where f.visit_id = d.id)::integer,
         (select count(*) from public.photos ph where ph.visit_id = d.id)::integer,
         d.route_id is not null,
         round(extract(epoch from d.checkin_at
                 - lag(d.checkin_at) over (partition by d.store_id, d.day order by d.checkin_at)) / 60)::integer
    from done d
    join public.stores st on st.id = d.store_id
    left join public.profiles p on p.id = d.rep_id
   order by st.name, d.store_id, d.checkin_at;
end;
$function$;

revoke all on function public.service_log(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.service_log(timestamptz, timestamptz, uuid) to authenticated;

------------------------------------------------------------------ hours

-- A day is the company's day the workday started on; a workday still open
-- has no last out and counts no hours yet.
create function public.staff_hours(p_from timestamptz, p_to timestamptz)
returns table (staff_id uuid, staff_name text, day date, first_in timestamptz, last_out timestamptz,
               open_now boolean, workday_seconds integer, onsite_seconds integer, jobs integer, km numeric)
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
begin
  perform public.require_module('reports');
  perform public.require_permission('insights');
  v_org := public.current_org_id();
  v_tz := public.org_timezone(v_org);
  return query
  with wd as (
    select w.rep_id, (w.started_at at time zone v_tz)::date as day,
           min(w.started_at) as first_in,
           max(w.ended_at) as last_out,
           bool_or(w.ended_at is null) as open_now,
           coalesce(sum(w.duration_seconds) filter (where w.ended_at is not null), 0) as seconds,
           sum(w.road_distance_meters) as meters
      from public.workday_sessions w
     where w.org_id = v_org and w.started_at >= p_from and w.started_at < p_to
     group by 1, 2
  ),
  vis as (
    select v.rep_id, (v.checkin_at at time zone v_tz)::date as day,
           count(*) as jobs,
           coalesce(sum(v.duration_seconds) filter (where v.duration_seconds > 0), 0) as seconds
      from public.visits v
     where v.org_id = v_org and v.status = 'checked_out'
       and v.checkin_at >= p_from and v.checkin_at < p_to
     group by 1, 2
  )
  select coalesce(wd.rep_id, vis.rep_id),
         p.full_name,
         coalesce(wd.day, vis.day),
         wd.first_in,
         wd.last_out,
         coalesce(wd.open_now, false),
         coalesce(wd.seconds, 0)::integer,
         coalesce(vis.seconds, 0)::integer,
         coalesce(vis.jobs, 0)::integer,
         round(wd.meters / 1000.0, 1)
    from wd
    full join vis on vis.rep_id = wd.rep_id and vis.day = wd.day
    left join public.profiles p on p.id = coalesce(wd.rep_id, vis.rep_id)
   order by 3 desc, 2;
end;
$function$;

revoke all on function public.staff_hours(timestamptz, timestamptz) from public, anon;
grant execute on function public.staff_hours(timestamptz, timestamptz) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'service_log', 'reports'),
  ('function', 'staff_hours', 'reports');
