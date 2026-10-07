-- The last three settings that were constants in SQL now come from each
-- company's settings (`modules_and_settings`):
--
-- 1. Auto-end. `auto_end_overdue_workdays` closed every company's forgotten
--    workdays at one cut-off, 19:30, triggered once a day by a Vercel cron at
--    17:30 UTC — right for one company in Botswana and wrong for anyone else
--    (another timezone; a security company working nights). It now reads each
--    company's `auto_end_enabled` and `auto_end_time`, in that company's
--    timezone, and skips companies that switched it off. `p_cutoff` stays as
--    the fallback, so the existing route and its signature are unchanged.
--    It runs **hourly** from pg_cron (owner's decision, 7 Oct 2026); the daily
--    Vercel cron stays as a backup. Both are idempotent: an ended day is not
--    touched again.
--
-- 2. The activity feed's check-in verdict: "invalid GPS" beyond 5000 m and
--    "off site" beyond 500 m were literals. They read `invalid_gps_distance_m`
--    and `off_site_distance_m`.
--
-- 3. A new site's check-in radius was the column default, 100. It now comes
--    from `checkin_radius_m` when the insert does not give one. No client sends
--    one today (web and phone both rely on the default).
--
-- Gold Fortune's settings are 19:30 / on / 5000 / 500 / 100, so nothing it
-- sees changes.
--
-- Rollback: supabase/rollback/<this version>_per_company_auto_end_and_thresholds.down.sql.

--------------------------------------------------------------- 1. auto-end

create or replace function public.auto_end_overdue_workdays(p_cutoff time without time zone default '19:30:00'::time without time zone)
returns table(session_id uuid, rep_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, distance_meters double precision, legs integer)
language sql
security definer
set search_path to 'public'
as $function$
  with cfg as (
    -- Each company's own rule. Read with org_setting, which answers for any
    -- company to this function's callers (service role, pg_cron).
    select o.id as org_id,
           coalesce((public.org_setting(o.id, 'auto_end_enabled') #>> '{}')::boolean, true) as enabled,
           coalesce((public.org_setting(o.id, 'auto_end_time') #>> '{}')::time, p_cutoff) as cutoff,
           public.org_timezone(o.id) as tz
      from public.organizations o
  ),
  overdue as (
    select ws.id, ws.org_id, ws.rep_id, ws.started_at,
           ((ws.started_at at time zone c.tz)::date + c.cutoff) at time zone c.tz as cutoff_at
    from public.workday_sessions ws
    join cfg c on c.org_id = ws.org_id
    where ws.ended_at is null
      and c.enabled
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

-- Hourly, at five past: each company is closed within the hour after its own
-- cut-off, in its own timezone. Runs as the database owner, which org_setting
-- and org_timezone answer for every company.
create extension if not exists pg_cron;

select cron.schedule('auto-end-workdays', '5 * * * *',
                     'select public.auto_end_overdue_workdays()');

------------------------------------------- 2. activity-feed verdict distances

do $$
declare
  def text;
  newdef text;
  c_invalid constant text := 'e.distance_m > 5000';
  c_offsite constant text := 'e.distance_m > 500 ';
  r_invalid constant text :=
    'e.distance_m > (select (public.company_setting(''invalid_gps_distance_m'') #>> ''{}'')::numeric)';
  r_offsite constant text :=
    'e.distance_m > (select (public.company_setting(''off_site_distance_m'') #>> ''{}'')::numeric) ';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'activity_feed';
  if (length(def) - length(replace(def, c_invalid, ''))) / length(c_invalid) <> 1
     or (length(def) - length(replace(def, c_offsite, ''))) / length(c_offsite) <> 1 then
    raise exception 'activity_feed: the verdict literals are not present exactly once each';
  end if;
  newdef := replace(replace(def, c_invalid, r_invalid), c_offsite, r_offsite);
  execute newdef;
end;
$$;

-------------------------------------------------- 3. default check-in radius

create or replace function public.stores_default_radius()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.geofence_radius_m is null then
    new.geofence_radius_m := coalesce(
      (public.org_setting(new.org_id, 'checkin_radius_m') #>> '{}')::int,
      (select (d.default_value #>> '{}')::int from public.setting_definitions d
        where d.key = 'checkin_radius_m'));
  end if;
  return new;
end;
$function$;

revoke all on function public.stores_default_radius() from public, anon, authenticated;

alter table public.stores alter column geofence_radius_m drop default;

create trigger stores_default_radius
  before insert on public.stores
  for each row execute function public.stores_default_radius();
