-- Rollback for per_company_auto_end_and_thresholds. Restores the single
-- 19:30 cut-off, the 5000 m / 500 m literals and the column default of 100,
-- exactly as production held them on 8 October 2026; unschedules the hourly
-- job and removes pg_cron (nothing else uses it).

drop trigger if exists stores_default_radius on public.stores;
drop function if exists public.stores_default_radius();
alter table public.stores alter column geofence_radius_m set default 100;

do $$
declare
  def text;
  r_invalid constant text :=
    'e.distance_m > (select (public.company_setting(''invalid_gps_distance_m'') #>> ''{}'')::numeric)';
  r_offsite constant text :=
    'e.distance_m > (select (public.company_setting(''off_site_distance_m'') #>> ''{}'')::numeric) ';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'activity_feed';
  if (length(def) - length(replace(def, r_invalid, ''))) / length(r_invalid) <> 1
     or (length(def) - length(replace(def, r_offsite, ''))) / length(r_offsite) <> 1 then
    raise exception 'activity_feed: the setting lookups are not present exactly once each';
  end if;
  execute replace(replace(def, r_invalid, 'e.distance_m > 5000'), r_offsite, 'e.distance_m > 500 ');
end;
$$;

select cron.unschedule('auto-end-workdays');
drop extension if exists pg_cron;

create or replace function public.auto_end_overdue_workdays(p_cutoff time without time zone default '19:30:00'::time without time zone)
returns table(session_id uuid, rep_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, distance_meters double precision, legs integer)
language sql
security definer
set search_path to 'public'
as $function$
  with overdue as (
    select ws.id, ws.org_id, ws.rep_id, ws.started_at,
           ((ws.started_at at time zone public.org_timezone(ws.org_id))::date
              + p_cutoff)
             at time zone public.org_timezone(ws.org_id) as cutoff_at
    from public.workday_sessions ws
    where ws.ended_at is null
  ),
  due as (
    select * from overdue where cutoff_at <= now()
  ),
  fixes as (
    select lp.workday_session_id as sid,
           lp.recorded_at, lp.lat, lp.lng,
           lag(lp.lat) over w as prev_lat,
           lag(lp.lng) over w as prev_lng
    from public.location_pings lp
    join due d on d.id = lp.workday_session_id
    where lp.recorded_at <= d.cutoff_at
    window w as (partition by lp.workday_session_id order by lp.recorded_at)
  ),
  legs as (
    select sid, prev_lat,
           public.haversine_m(prev_lat, prev_lng, lat, lng) as leg
    from fixes
  ),
  trail as (
    select sid,
           coalesce(sum(case when leg >= 50 then leg else 0 end), 0)::double precision
             as meters,
           count(*) filter (where prev_lat is not null)::int as legs
    from legs
    group by sid
  ),
  last_fix as (
    select distinct on (sid) sid, lat, lng
    from fixes
    order by sid, recorded_at desc
  )
  update public.workday_sessions ws
     set ended_at         = d.cutoff_at,
         auto_ended_at    = now(),
         duration_seconds = greatest(
           extract(epoch from d.cutoff_at - ws.started_at)::int, 0),
         distance_meters  = greatest(ws.distance_meters, coalesce(t.meters, 0)),
         end_lat          = coalesce(ws.end_lat, lf.lat),
         end_lng          = coalesce(ws.end_lng, lf.lng)
    from due d
    left join trail t on t.sid = d.id
    left join last_fix lf on lf.sid = d.id
   where ws.id = d.id
     -- Re-checked here: a rep's own end can land between the select and the
     -- write, and theirs is the one that stands.
     and ws.ended_at is null
  returning ws.id, ws.rep_id, ws.started_at, ws.ended_at, ws.distance_meters,
            coalesce(t.legs, 0);
$function$;
