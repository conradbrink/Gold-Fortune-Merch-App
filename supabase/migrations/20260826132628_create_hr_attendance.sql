-- Attendance, derived. There is no second clock-in system and no attendance
-- table — section 4 forbids one and it would be the wrong shape anyway.
--
-- Everything below is computed from records that already exist:
-- `workday_sessions` for start, end, GPS and duration; `visits` and `leads` as
-- evidence that somebody was working; `hr_leave_requests` for the days they
-- were not; and `hr_settings` for what "late" means. Nothing is stored, so
-- changing the late threshold re-reads history correctly instead of leaving
-- last month's verdicts frozen at last month's rule.
--
-- 🔴 The judgement call that matters most: a day with visits but no workday
-- session is NOT absent.
--
-- The handoff for 25 August recorded the finding behind this — Jerry has a
-- workday session on 8 of 19 working days, Tshepo on 7 of 15, and both were
-- demonstrably working the rest of the time. A system that called those eleven
-- days "absent" would be making an accusation out of a UI habit, and it is the
-- sort of accusation that ends up in a disciplinary case. So the evidence is
-- read in two layers: the session says when the day started and ended, and the
-- visits say whether there was a day at all. No session plus no activity is
-- absent. No session plus twelve store visits is `incomplete`, flagged
-- `no_start` — which is the true finding, and the one worth acting on.
--
-- ------------------------------------------------------ why security definer
--
-- The repo rule is `security invoker` on every RPC, and it exists to stop
-- cross-organisation leaks. This one is definer, deliberately, and the reason
-- is the new role. An `hr_manager` needs attendance; every policy on
-- `workday_sessions`, `visits` and `leads` reads `current_role() = 'manager' or
-- rep_id = auth.uid()`, so under invoker rights an HR manager's attendance
-- screen would be silently, permanently empty.
--
-- The alternative was to widen those three policies to name `hr_manager`, which
-- would hand HR the whole visits and leads tables — every store called on,
-- every prospect, every sales note — to answer a question about what time
-- somebody started. That is a much larger grant than the one being made here.
--
-- What replaces the invoker check, and what a reviewer should verify:
--   * `org_id = public.current_org_id()` on every table read. No row from
--     another tenant can enter the result.
--   * `public.hr_can_view_employee(e.id)` on the employee list, which is the
--     same rule `hr_employees` RLS applies — HR, the person, or their
--     management chain.
--   * The output carries times, coordinates and a status. It does not carry a
--     store name, a customer, an order or a value.

create or replace function public.hr_attendance_report(
  p_from       date,
  p_to         date,
  p_employee   uuid default null,
  p_department uuid default null,
  p_territory  uuid default null,
  p_status     text default null
)
returns table (
  employee_id     uuid,
  employee_name   text,
  employee_number text,
  department_id   uuid,
  department_name text,
  territory_id    uuid,
  territory_name  text,
  work_date       date,
  is_working_day  boolean,
  started_at      timestamptz,
  ended_at        timestamptz,
  start_lat       double precision,
  start_lng       double precision,
  end_lat         double precision,
  end_lng         double precision,
  worked_seconds  numeric,
  activity_events integer,
  status          text,
  exceptions      text[],
  leave_type      text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null then return; end if;
  if p_from is null or p_to is null or p_to < p_from then return; end if;
  -- A guard, not a preference. Without it a mistyped year scans every session
  -- the company has ever recorded and cross-joins it with a date series.
  if p_to - p_from > 366 then
    raise exception 'an attendance range may not exceed 366 days';
  end if;

  return query
  with cfg as materialized (
    select v_org as org,
           -- Botswana is UTC+2 and does not observe DST. Written out rather
           -- than read from settings because `rep_day_times_per_day` and
           -- `dashboard_operations` already hard-code the same zone, and a
           -- second source of truth for "what day is it" is how two screens
           -- start disagreeing about the same morning.
           'Africa/Gaborone'::text as tz,
           coalesce(s.work_start_time, '08:00'::time)  as work_start,
           coalesce(s.work_end_time, '17:00'::time)    as work_end,
           coalesce(s.late_threshold_minutes, 15)      as late_minutes,
           coalesce(s.short_day_hours, 4)              as short_hours,
           coalesce(s.workweek, '{1,2,3,4,5}'::smallint[]) as workweek
      from (select 1) one
      left join public.hr_settings s on s.org_id = v_org
  ),
  days as (
    select d::date as work_date from generate_series(p_from, p_to, interval '1 day') d
  ),
  staff as (
    select e.id, e.full_name, e.employee_number, e.profile_id,
           e.department_id, d.name as department_name,
           e.territory_id, t.name as territory_name,
           coalesce(e.work_start_time, cfg.work_start) as work_start,
           -- An employee with no start date is treated as employed from the
           -- first day they recorded a workday. Not a guess about their
           -- contract — it is the earliest day about which this system has
           -- anything to say, and rows before it would be manufactured
           -- absences. Null for somebody with neither, who then correctly
           -- produces no attendance at all.
           coalesce(e.start_date,
                    (select min((w.started_at at time zone cfg.tz)::date)
                       from public.workday_sessions w
                      where w.rep_id = e.profile_id and w.org_id = cfg.org)) as employed_from,
           coalesce(e.end_date, 'infinity'::date) as employed_to
      from public.hr_employees e
      cross join cfg
      left join public.hr_departments d on d.id = e.department_id
      left join public.territories t on t.id = e.territory_id
     where e.org_id = cfg.org
       and public.hr_can_view_employee(e.id)
       and (p_employee   is null or e.id = p_employee)
       and (p_department is null or e.department_id = p_department)
       and (p_territory  is null or e.territory_id = p_territory)
  ),
  -- One row per rep per local day. A rep can start and stop more than once;
  -- the day runs from the first start to the last end, and the worked total is
  -- the sum of the sessions rather than the span between them, so a two-hour
  -- lunch with the workday stopped is not counted as worked.
  sessions as (
    select w.rep_id,
           (w.started_at at time zone cfg.tz)::date as local_day,
           min(w.started_at) as first_start,
           max(w.ended_at)   as last_end,
           count(*) filter (where w.ended_at is null) as open_sessions,
           sum(coalesce(w.duration_seconds,
                        extract(epoch from (w.ended_at - w.started_at))))::numeric as worked_seconds,
           (array_agg(w.start_lat order by w.started_at))[1]::double precision as start_lat,
           (array_agg(w.start_lng order by w.started_at))[1]::double precision as start_lng,
           (array_agg(w.end_lat   order by w.started_at desc))[1]::double precision as end_lat,
           (array_agg(w.end_lng   order by w.started_at desc))[1]::double precision as end_lng
      from public.workday_sessions w
      cross join cfg
     where w.org_id = cfg.org
       and w.started_at >= (p_from::timestamp at time zone cfg.tz)
       and w.started_at <  ((p_to + 1)::timestamp at time zone cfg.tz)
     group by w.rep_id, (w.started_at at time zone cfg.tz)::date
  ),
  -- Evidence of a working day that leaves no session behind. Deliberately only
  -- counted, never described: the number of events is enough to say "this
  -- person was working", and the module has no business knowing which shops.
  activity as (
    select ev.rep_id, ev.local_day, count(*)::integer as events
      from (
        select v.rep_id, (v.checkin_at at time zone cfg.tz)::date as local_day
          from public.visits v cross join cfg
         where v.org_id = cfg.org and v.checkin_at is not null
           and v.checkin_at >= (p_from::timestamp at time zone cfg.tz)
           and v.checkin_at <  ((p_to + 1)::timestamp at time zone cfg.tz)
        union all
        select l.rep_id, (l.started_at at time zone cfg.tz)::date
          from public.leads l cross join cfg
         where l.org_id = cfg.org
           and l.started_at >= (p_from::timestamp at time zone cfg.tz)
           and l.started_at <  ((p_to + 1)::timestamp at time zone cfg.tz)
      ) ev
     group by ev.rep_id, ev.local_day
  ),
  leave as (
    select r.employee_id, r.start_date, r.end_date, lt.name as type_name
      from public.hr_leave_requests r
      join public.hr_leave_types lt on lt.id = r.leave_type_id
     where r.org_id = v_org
       and r.status = 'approved'
       and r.start_date <= p_to and r.end_date >= p_from
  ),
  day_rows as (
    select
      st.id, st.full_name, st.employee_number,
      st.department_id, st.department_name, st.territory_id, st.territory_name,
      dy.work_date,
      (extract(isodow from dy.work_date)::smallint = any(cfg.workweek)) as is_working_day,
      se.first_start, se.last_end, se.open_sessions, se.worked_seconds,
      se.start_lat, se.start_lng, se.end_lat, se.end_lng,
      coalesce(ac.events, 0) as events,
      lv.type_name as leave_type,
      -- Local clock time of the first start, which is what "late" is measured
      -- against. Null when there is no session.
      (se.first_start at time zone cfg.tz)::time as local_start,
      st.work_start,
      cfg.late_minutes, cfg.short_hours
    from staff st
    cross join cfg
    join days dy
      on dy.work_date >= st.employed_from and dy.work_date <= st.employed_to
    left join sessions se on se.rep_id = st.profile_id and se.local_day = dy.work_date
    left join activity ac on ac.rep_id = st.profile_id and ac.local_day = dy.work_date
    left join lateral (
      select l.type_name from leave l
       where l.employee_id = st.id
         and dy.work_date between l.start_date and l.end_date
       limit 1
    ) lv on true
    where st.employed_from is not null
  ),
  judged as (
    select r.*,
      case
        when r.leave_type is not null then 'on_leave'
        -- No session and nothing else happened. On a non-working day this is
        -- simply a day off, which the caller filters out by `is_working_day`
        -- rather than the status pretending Sunday was an absence.
        when r.first_start is null and r.events = 0 then
          case when r.is_working_day then 'absent' else 'off' end
        -- Worked, but never pressed Start. The finding, not an absence.
        when r.first_start is null then 'incomplete'
        when r.last_end is null or r.open_sessions > 0 then 'incomplete'
        when r.local_start > (r.work_start + make_interval(mins => r.late_minutes)) then 'late'
        else 'present'
      end as status
    from day_rows r
  )
  select
    j.id, j.full_name, j.employee_number,
    j.department_id, j.department_name, j.territory_id, j.territory_name,
    j.work_date, j.is_working_day,
    j.first_start, j.last_end,
    j.start_lat, j.start_lng, j.end_lat, j.end_lng,
    j.worked_seconds, j.events, j.status,
    -- Exceptions are independent of the status and of each other. A late start
    -- that also ran short is two facts, and collapsing them into one label
    -- would lose whichever the manager was looking for.
    array_remove(array[
      case when j.first_start is null and j.events > 0 then 'no_start' end,
      case when j.first_start is not null
            and (j.last_end is null or j.open_sessions > 0) then 'no_end' end,
      case when j.status = 'late' then 'late_start' end,
      case when j.worked_seconds is not null
            and j.open_sessions = 0
            and j.worked_seconds < j.short_hours * 3600 then 'short_day' end
    ], null) as exceptions,
    j.leave_type
  from judged j
  where p_status is null or j.status = p_status
  order by j.work_date desc, j.full_name;
end;
$$;

revoke all on function public.hr_attendance_report(date, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.hr_attendance_report(date, date, uuid, uuid, uuid, text) to authenticated;

comment on function public.hr_attendance_report(date, date, uuid, uuid, uuid, text) is
  'Attendance derived from workday_sessions, visits, leads, approved leave and hr_settings. Nothing is stored. A day with activity but no session is `incomplete`/`no_start`, never `absent`. security definer on purpose — see the header comment in the migration.';
