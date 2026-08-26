-- The three dashboards, and the daily sweep that turns dates into notices.
--
-- All three are `security invoker`, which is the repo rule and is also what
-- makes them useful: the counts a line manager sees are their own team's,
-- because RLS filters the rows before they are counted, and not because the
-- function was told who was asking. The one definer call inside them is
-- `hr_attendance_report`, which explains itself in its own migration.
--
-- Returning jsonb rather than a wide table: these are a dozen unrelated
-- scalars in seven groups, and a flat table of a dozen columns with one row is
-- the shape that forces the caller to remember an order. `close_abandoned_workday`
-- and the other operational RPCs already return Json, so the web side has a
-- pattern for it.
--
-- Everything below counts. Nothing scores, ranks or predicts.

-- ---------------------------------------------------------------------------
-- HR dashboard (section 9)
-- ---------------------------------------------------------------------------

create or replace function public.hr_dashboard_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_org      uuid := public.current_org_id();
  v_today    date;
  v_settings record;
  v_result   jsonb;
begin
  if v_org is null then return '{}'::jsonb; end if;

  -- The same zone the rest of the system uses to decide what day it is.
  v_today := (now() at time zone 'Africa/Gaborone')::date;

  select coalesce(s.expiry_warning_days, 30) as warn_days,
         coalesce(s.min_acceptable_score, 3.0) as min_score,
         coalesce(s.review_frequency, 'quarterly') as frequency
    into v_settings
    from (select 1) one
    left join public.hr_settings s on s.org_id = v_org;

  with staff as (
    select * from public.hr_employees where org_id = v_org
  ),
  attendance as (
    select * from public.hr_attendance_report(v_today, v_today)
  ),
  period as (
    select v_settings.frequency as period_type,
           extract(year from v_today)::int as period_year,
           public.hr_period_index(v_settings.frequency, v_today) as period_index
  ),
  latest_review as (
    -- One row per employee: their most recent finished review, whenever it was.
    -- "Below expectations" is a statement about where somebody stands now, not
    -- about the average of everything they have ever scored.
    select distinct on (r.employee_id)
           r.employee_id, r.overall_rating, r.period_end
      from public.hr_reviews r
     where r.org_id = v_org and r.status in ('completed','acknowledged')
     order by r.employee_id, r.period_end desc, r.review_date desc
  ),
  case_status as (
    select l.code,
           coalesce((l.meta ->> 'terminal')::boolean, false)          as terminal,
           coalesce((l.meta ->> 'awaiting_employee')::boolean, false) as awaiting_employee,
           coalesce((l.meta ->> 'awaiting_hearing')::boolean, false)  as awaiting_hearing
      from public.hr_lookups l
     where l.org_id = v_org and l.kind = 'case_status'
  )
  select jsonb_build_object(
    'as_of', v_today,
    'workforce', jsonb_build_object(
      'total',      (select count(*) from staff),
      'active',     (select count(*) from staff where employment_status = 'active'),
      'on_leave',   (select count(*) from staff where employment_status = 'on_leave'),
      'suspended',  (select count(*) from staff where employment_status = 'suspended'),
      -- 30 days, and null start dates are simply not counted. A "recently
      -- joined" figure built on a guess would be the most quoted wrong number
      -- on the page.
      'recently_joined', (select count(*) from staff
                           where start_date is not null
                             and start_date >= v_today - 30 and start_date <= v_today),
      'recently_terminated', (select count(*) from staff
                               where end_date is not null
                                 and end_date >= v_today - 30 and end_date <= v_today)
    ),
    'attendance_today', jsonb_build_object(
      'working',    (select count(*) from attendance where status in ('present','late')),
      'late',       (select count(*) from attendance where status = 'late'),
      'absent',     (select count(*) from attendance where status = 'absent'),
      'incomplete', (select count(*) from attendance where status = 'incomplete'),
      'on_leave',   (select count(*) from attendance where status = 'on_leave'),
      'expected',   (select count(*) from attendance where is_working_day)
    ),
    'leave', jsonb_build_object(
      'pending_requests', (select count(*) from public.hr_leave_requests
                            where org_id = v_org and status = 'pending'),
      'on_leave_today',   (select count(*) from public.hr_leave_requests
                            where org_id = v_org and status = 'approved'
                              and v_today between start_date and end_date)
    ),
    'documents', jsonb_build_object(
      'expired',      (select count(*) from public.hr_documents
                        where org_id = v_org and expiry_date is not null
                          and expiry_date < v_today),
      'expiring_7',   (select count(*) from public.hr_documents
                        where org_id = v_org and expiry_date is not null
                          and expiry_date >= v_today and expiry_date <= v_today + 7),
      'expiring_30',  (select count(*) from public.hr_documents
                        where org_id = v_org and expiry_date is not null
                          and expiry_date >= v_today and expiry_date <= v_today + 30),
      -- Everything with no expiry, plus everything whose expiry is past the
      -- 30-day horizon. A document that never expires is valid, not unknown.
      'valid',        (select count(*) from public.hr_documents
                        where org_id = v_org
                          and (expiry_date is null or expiry_date > v_today + 30))
    ),
    'contracts', jsonb_build_object(
      'expiring_soon', (select count(*) from staff
                         where contract_end_date is not null
                           and contract_end_date >= v_today
                           and contract_end_date <= v_today + v_settings.warn_days
                           and employment_status not in ('terminated','resigned','inactive')),
      'expired',       (select count(*) from staff
                         where contract_end_date is not null
                           and contract_end_date < v_today
                           and employment_status not in ('terminated','resigned','inactive'))
    ),
    'performance', jsonb_build_object(
      'reviews_due', (select count(*) from staff s, period p
                       where s.employment_status = 'active'
                         and not exists (
                           select 1 from public.hr_reviews r
                            where r.employee_id = s.id
                              and r.period_type = p.period_type
                              and r.period_year = p.period_year
                              and r.period_index = p.period_index
                              and r.status in ('completed','acknowledged'))),
      'reviews_completed', (select count(*) from public.hr_reviews r, period p
                             where r.org_id = v_org
                               and r.period_type = p.period_type
                               and r.period_year = p.period_year
                               and r.period_index = p.period_index
                               and r.status in ('completed','acknowledged')),
      'average_score', (select round(avg(lr.overall_rating), 2) from latest_review lr),
      'below_expectations', (select count(*) from latest_review lr
                              where lr.overall_rating is not null
                                and lr.overall_rating < v_settings.min_score),
      'threshold', v_settings.min_score,
      'period', (select jsonb_build_object('type', p.period_type, 'year', p.period_year,
                                           'index', p.period_index) from period p)
    ),
    'disciplinary', jsonb_build_object(
      'open_cases', (select count(*) from public.hr_disciplinary_cases c
                      where c.org_id = v_org and c.closed_at is null),
      'under_investigation', (select count(*) from public.hr_disciplinary_cases c
                               where c.org_id = v_org and c.status = 'under_investigation'),
      'hearings_pending', (select count(*) from public.hr_disciplinary_cases c
                            join case_status cs on cs.code = c.status
                            where c.org_id = v_org and cs.awaiting_hearing),
      'awaiting_response', (select count(*) from public.hr_disciplinary_cases c
                             join case_status cs on cs.code = c.status
                             where c.org_id = v_org and cs.awaiting_employee),
      'active_warnings', (select count(*) from public.hr_warnings w
                           where w.org_id = v_org
                             and (w.expires_on is null or w.expires_on >= v_today))
    )
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Performance dashboard (section 10)
-- ---------------------------------------------------------------------------

create or replace function public.hr_performance_dashboard(
  p_department uuid default null,
  p_manager    uuid default null,
  p_territory  uuid default null,
  p_position   text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_org      uuid := public.current_org_id();
  v_today    date;
  v_settings record;
  v_result   jsonb;
begin
  if v_org is null then return '{}'::jsonb; end if;
  v_today := (now() at time zone 'Africa/Gaborone')::date;

  select coalesce(s.min_acceptable_score, 3.0) as min_score,
         coalesce(s.review_frequency, 'quarterly') as frequency
    into v_settings
    from (select 1) one
    left join public.hr_settings s on s.org_id = v_org;

  with staff as (
    select e.* from public.hr_employees e
     where e.org_id = v_org
       and e.employment_status = 'active'
       and (p_department is null or e.department_id = p_department)
       and (p_manager    is null or e.manager_id    = p_manager)
       and (p_territory  is null or e.territory_id  = p_territory)
       and (p_position   is null or e.position      = p_position)
  ),
  period as (
    select v_settings.frequency as period_type,
           extract(year from v_today)::int as period_year,
           public.hr_period_index(v_settings.frequency, v_today) as period_index
  ),
  current_reviews as (
    select r.* from public.hr_reviews r, period p
     where r.org_id = v_org
       and r.period_type = p.period_type
       and r.period_year = p.period_year
       and r.period_index = p.period_index
  ),
  latest_review as (
    select distinct on (r.employee_id)
           r.employee_id, r.overall_rating, r.period_end, r.period_year, r.period_index
      from public.hr_reviews r
      join staff s on s.id = r.employee_id
     where r.status in ('completed','acknowledged')
     order by r.employee_id, r.period_end desc, r.review_date desc
  ),
  due as (
    select s.id, s.full_name, s.employee_number, s.position, s.manager_id
      from staff s
     where not exists (
       select 1 from current_reviews r
        where r.employee_id = s.id and r.status in ('completed','acknowledged'))
  ),
  -- "Managers who have not completed reviews": the outstanding work, grouped by
  -- the person who owes it. A manager with no reports simply does not appear,
  -- rather than appearing with a zero.
  outstanding as (
    select m.id as manager_id, m.full_name as manager_name, count(*)::int as outstanding
      from due d
      join public.hr_employees m on m.id = d.manager_id
     group by m.id, m.full_name
  ),
  trend as (
    select r.period_year, r.period_index, r.period_type,
           round(avg(r.overall_rating), 2) as average,
           count(*)::int as reviews
      from public.hr_reviews r
      join staff s on s.id = r.employee_id
     where r.status in ('completed','acknowledged')
       and r.overall_rating is not null
       and r.period_end >= v_today - 730
     group by r.period_year, r.period_index, r.period_type
     order by r.period_year, r.period_index
  )
  select jsonb_build_object(
    'as_of', v_today,
    'threshold', v_settings.min_score,
    'period', (select jsonb_build_object('type', p.period_type, 'year', p.period_year,
                                         'index', p.period_index) from period p),
    'headcount', (select count(*) from staff),
    'reviews_due', (select count(*) from due),
    'reviews_completed', (select count(*) from current_reviews r join staff s on s.id = r.employee_id
                           where r.status in ('completed','acknowledged')),
    'reviews_in_draft', (select count(*) from current_reviews r join staff s on s.id = r.employee_id
                          where r.status = 'draft'),
    'average_score', (select round(avg(overall_rating), 2) from latest_review),
    'below_expectations', (select coalesce(jsonb_agg(jsonb_build_object(
                              'employee_id', lr.employee_id,
                              'name', e.full_name,
                              'position', e.position,
                              'score', lr.overall_rating) order by lr.overall_rating), '[]'::jsonb)
                            from latest_review lr
                            join public.hr_employees e on e.id = lr.employee_id
                           where lr.overall_rating is not null
                             and lr.overall_rating < v_settings.min_score),
    'due_list', (select coalesce(jsonb_agg(jsonb_build_object(
                     'employee_id', d.id, 'name', d.full_name,
                     'employee_number', d.employee_number, 'position', d.position)
                     order by d.full_name), '[]'::jsonb) from due d),
    'outstanding_by_manager', (select coalesce(jsonb_agg(jsonb_build_object(
                     'manager_id', o.manager_id, 'name', o.manager_name,
                     'outstanding', o.outstanding) order by o.outstanding desc), '[]'::jsonb)
                     from outstanding o),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object(
                     'year', t.period_year, 'index', t.period_index, 'type', t.period_type,
                     'average', t.average, 'reviews', t.reviews)), '[]'::jsonb) from trend t)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Disciplinary dashboard (section 11)
-- ---------------------------------------------------------------------------

create or replace function public.hr_disciplinary_dashboard()
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_org    uuid := public.current_org_id();
  v_today  date;
  v_result jsonb;
begin
  if v_org is null then return '{}'::jsonb; end if;
  v_today := (now() at time zone 'Africa/Gaborone')::date;

  with cases as (
    select c.*, e.department_id, e.territory_id
      from public.hr_disciplinary_cases c
      join public.hr_employees e on e.id = c.employee_id
     where c.org_id = v_org
  ),
  status_meta as (
    select l.code, l.label,
           coalesce((l.meta ->> 'terminal')::boolean, false)          as terminal,
           coalesce((l.meta ->> 'awaiting_employee')::boolean, false) as awaiting_employee,
           coalesce((l.meta ->> 'awaiting_hearing')::boolean, false)  as awaiting_hearing
      from public.hr_lookups l
     where l.org_id = v_org and l.kind = 'case_status'
  ),
  open_cases as (select * from cases where closed_at is null)
  select jsonb_build_object(
    'as_of', v_today,
    'open_cases',  (select count(*) from open_cases),
    'total_cases', (select count(*) from cases),
    'awaiting_response', (select count(*) from open_cases c join status_meta m on m.code = c.status
                           where m.awaiting_employee),
    'awaiting_hearing',  (select count(*) from open_cases c join status_meta m on m.code = c.status
                           where m.awaiting_hearing),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object(
                      'code', t.status, 'label', coalesce(m.label, t.status), 'count', t.n)
                      order by t.n desc), '[]'::jsonb)
                   from (select status, count(*)::int n from open_cases group by status) t
                   left join status_meta m on m.code = t.status),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object(
                      'code', t.incident_type, 'label', coalesce(l.label, t.incident_type),
                      'count', t.n) order by t.n desc), '[]'::jsonb)
                 from (select incident_type, count(*)::int n from open_cases group by incident_type) t
                 left join public.hr_lookups l
                   on l.org_id = v_org and l.kind = 'incident_type' and l.code = t.incident_type),
    'by_severity', (select coalesce(jsonb_agg(jsonb_build_object(
                      'code', t.severity, 'label', coalesce(l.label, t.severity),
                      'rank', coalesce((l.meta ->> 'rank')::int, 0), 'count', t.n)
                      order by coalesce((l.meta ->> 'rank')::int, 0)), '[]'::jsonb)
                 from (select severity, count(*)::int n from open_cases group by severity) t
                 left join public.hr_lookups l
                   on l.org_id = v_org and l.kind = 'severity' and l.code = t.severity),
    'by_department', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', t.department_id, 'label', coalesce(d.name, 'Unassigned'), 'count', t.n)
                      order by t.n desc), '[]'::jsonb)
                 from (select department_id, count(*)::int n from open_cases group by department_id) t
                 left join public.hr_departments d on d.id = t.department_id),
    'by_territory', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', t.territory_id, 'label', coalesce(tr.name, 'Unassigned'), 'count', t.n)
                      order by t.n desc), '[]'::jsonb)
                 from (select territory_id, count(*)::int n from open_cases group by territory_id) t
                 left join public.territories tr on tr.id = t.territory_id),
    'active_warnings', (select count(*) from public.hr_warnings w
                         where w.org_id = v_org
                           and (w.expires_on is null or w.expires_on >= v_today)),
    'expiring_warnings', (select count(*) from public.hr_warnings w
                           where w.org_id = v_org and w.expires_on is not null
                             and w.expires_on >= v_today and w.expires_on <= v_today + 30),
    'unacknowledged_warnings', (select count(*) from public.hr_warnings w
                                 where w.org_id = v_org and w.acknowledged_at is null)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The expiry sweep
-- ---------------------------------------------------------------------------

/**
 * Turns dates that have quietly become true into notifications.
 *
 * This is not a scheduler and must not be mistaken for one. `pg_cron` is not
 * enabled on this project, so it is called when the HR dashboard loads: if
 * nobody opens the dashboard, nobody is notified — and the same numbers are on
 * that dashboard anyway, so the notice is a convenience rather than the only
 * route to the fact. When a scheduler does exist, point it at this function and
 * delete the call from the page; nothing else changes.
 *
 * Safe to call repeatedly. The partial unique index on `hr_notifications`
 * covers (recipient, kind, subject, day) for `expiry.%` kinds, and `hr_notify`
 * inserts `on conflict do nothing`, so ten dashboard loads produce one notice.
 */
create or replace function public.hr_sweep_expiry_notifications()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org    uuid := public.current_org_id();
  v_today  date;
  v_warn   integer;
  v_before bigint;
  v_after  bigint;
  r        record;
begin
  -- Only HR is notified by this sweep, so only HR has any reason to run it.
  if v_org is null or not public.hr_is_hr() then return 0; end if;
  v_today := (now() at time zone 'Africa/Gaborone')::date;
  select coalesce(s.expiry_warning_days, 30) into v_warn
    from (select 1) one left join public.hr_settings s on s.org_id = v_org;

  select count(*) into v_before from public.hr_notifications where org_id = v_org;

  for r in
    select d.id, d.name, d.expiry_date, e.full_name
      from public.hr_documents d
      join public.hr_employees e on e.id = d.employee_id
     where d.org_id = v_org and d.expiry_date is not null
       and d.expiry_date <= v_today + v_warn
  loop
    perform public.hr_notify_hr(
      v_org, 'expiry.document',
      case when r.expiry_date < v_today
           then r.name || ' has expired' else r.name || ' expires soon' end,
      r.full_name || ' — ' || to_char(r.expiry_date, 'DD Mon YYYY'),
      '/hr/documents', 'hr_document', r.id);
  end loop;

  for r in
    select e.id, e.full_name, e.contract_end_date
      from public.hr_employees e
     where e.org_id = v_org and e.contract_end_date is not null
       and e.contract_end_date <= v_today + v_warn
       and e.employment_status not in ('terminated','resigned','inactive')
  loop
    perform public.hr_notify_hr(
      v_org, 'expiry.contract',
      case when r.contract_end_date < v_today
           then r.full_name || '''s contract has expired'
           else r.full_name || '''s contract expires soon' end,
      to_char(r.contract_end_date, 'DD Mon YYYY'),
      '/hr/employees/' || r.id, 'hr_employee', r.id);
  end loop;

  -- Overdue, not merely due: the period has to have ended before anybody is
  -- chased for it. Chasing a manager on the first day of a quarter for a review
  -- of that quarter is how a notification system trains people to ignore it.
  for r in
    with period as (
      select coalesce(s.review_frequency, 'quarterly') as ptype,
             extract(year from v_today)::int as pyear,
             public.hr_period_index(coalesce(s.review_frequency, 'quarterly'), v_today) as pindex
        from (select 1) one left join public.hr_settings s on s.org_id = v_org
    ),
    previous as (
      select p.ptype,
             case when p.pindex > 1 then p.pyear else p.pyear - 1 end as pyear,
             case when p.pindex > 1 then p.pindex - 1 else
               case p.ptype when 'monthly' then 12 when 'quarterly' then 4
                            when 'six_monthly' then 2 else 1 end end as pindex
        from period p
    )
    select e.id, e.full_name, pv.ptype, pv.pyear, pv.pindex
      from public.hr_employees e, previous pv
     where e.org_id = v_org and e.employment_status = 'active'
       and not exists (
         select 1 from public.hr_reviews rv
          where rv.employee_id = e.id
            and rv.period_type = pv.ptype and rv.period_year = pv.pyear
            and rv.period_index = pv.pindex
            and rv.status in ('completed','acknowledged'))
  loop
    perform public.hr_notify_hr(
      v_org, 'expiry.review_overdue',
      'Review overdue for ' || r.full_name,
      'The ' || r.pyear || ' period ' || r.pindex || ' review has not been completed.',
      '/hr/performance', 'hr_employee', r.id);
  end loop;

  for r in
    select c.id, c.case_number, c.status, e.full_name
      from public.hr_disciplinary_cases c
      join public.hr_employees e on e.id = c.employee_id
      join public.hr_lookups l on l.org_id = v_org and l.kind = 'case_status' and l.code = c.status
     where c.org_id = v_org and c.closed_at is null
       and (coalesce((l.meta ->> 'awaiting_employee')::boolean, false)
            or coalesce((l.meta ->> 'awaiting_hearing')::boolean, false))
       and c.updated_at < now() - interval '7 days'
  loop
    perform public.hr_notify_hr(
      v_org, 'expiry.case_awaiting',
      'Case ' || r.case_number || ' is waiting',
      r.full_name || ' — no movement for over a week.',
      '/hr/disciplinary/' || r.id, 'hr_case', r.id);
  end loop;

  select count(*) into v_after from public.hr_notifications where org_id = v_org;
  return (v_after - v_before)::integer;
end;
$$;

revoke all on function public.hr_dashboard_summary() from public, anon;
revoke all on function public.hr_performance_dashboard(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.hr_disciplinary_dashboard() from public, anon;
revoke all on function public.hr_sweep_expiry_notifications() from public, anon;
grant execute on function public.hr_dashboard_summary() to authenticated;
grant execute on function public.hr_performance_dashboard(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.hr_disciplinary_dashboard() to authenticated;
grant execute on function public.hr_sweep_expiry_notifications() to authenticated;

comment on function public.hr_sweep_expiry_notifications() is
  'Idempotent per day. Called from the HR dashboard because pg_cron is not enabled; point a real scheduler at it and remove the page call when one exists.';
