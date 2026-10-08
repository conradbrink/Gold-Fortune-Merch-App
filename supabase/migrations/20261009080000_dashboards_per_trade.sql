-- Stage 7 Part 3: each trade's own dashboard.
--
-- * Settings `dashboard_cards` (the numbers "Your numbers" shows, in order)
--   and `dashboard_layout` (the cards a new user starts with), comma lists,
--   seeded per trade. Their defaults are today's distribution dashboard, so
--   Gold Fortune, and any company without a trade value, keep what they have.
-- * dashboard_kpis(): the numbers for the caller's own company, by its days,
--   for the chosen window and the one before it, each with how many events it
--   rests on (the dashboard says "not enough data" under five). Money only for
--   `invoicing` holders. dashboard_kpi_window() is its per-window half.
-- * Quotes remember when they were sent and decided (`sent_at`,
--   `decided_at`), stamped by the database, so win rates and waiting times
--   are exact.
-- * dashboard_summary(): its daily series by the company's day, not UTC.
-- * Design pass (hormozi skills, 8 Oct): "proof on file" counts (photos,
--   checklists) and a new company's first-week milestones.
--
-- Formulas (industry research, "Standard formulas"):
--   done %       planned visits up to today served on the day or by a later
--                catch-up ÷ planned (today's not yet done are not counted);
--   proof        completed visits with a photo and, where forms are on, a form;
--   GPS-verified check-ins within the site's radius ÷ check-ins with a fix
--                (no fix is unknown, not a fail);
--   on-site share time on site ÷ finished workday hours.

------------------------------------------------------------- the settings

insert into public.setting_definitions (key, label, description, value_type, default_value, pattern, sort_order) values
  ('dashboard_cards', 'Dashboard numbers',
   'The numbers at the top of the dashboard, in order.',
   'text', '"jobs_done_pct,missed,gps_verified_pct,owed"', '^([a-z0-9_]+(,[a-z0-9_]+)*)?$', 900),
  ('dashboard_layout', 'Dashboard cards',
   'The cards a new user''s dashboard starts with, in order.',
   'text', '"headline,sales,pipeline,field_team,store_health,live_reps"', '^([a-z0-9_]+(,[a-z0-9_]+)*)?$', 910);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'dashboard_cards', to_jsonb(v.cards)
  from (values
    ('cleaning', 'jobs_done_pct,missed,proof_pct,gps_verified_pct,time_on_site,owed,unbilled_jobs'),
    ('garden', 'jobs_done_pct,missed,onsite_share,km_per_job,owed,unbilled_jobs'),
    ('plumbing', 'jobs_today,response_hours,quote_win_rate,avg_invoice,invoiced,unbilled_jobs,owed'),
    ('installation', 'jobs_done,quotes_waiting_value,quote_win_value,accepted_not_invoiced,invoiced,owed'),
    ('maintenance', 'jobs_done_pct,missed,planned_share,onsite_share,unbilled_jobs,owed'),
    ('security', 'jobs_done_pct,longest_gap,rounds_proven_pct,hours_worked,owed'),
    ('pest_control', 'jobs_done_pct,upcoming_7d,jobs_per_staff_day,proof_pct,owed'),
    ('pool', 'jobs_done_pct,time_on_site,jobs_per_staff_day,proof_pct,owed'),
    ('delivery', 'jobs_done_pct,jobs_per_hour,km_per_job,proof_pct,owed'),
    ('distribution', 'jobs_done_pct,missed,gps_verified_pct,owed'),
    ('generic', 'jobs_done_pct,missed,hours_worked,onsite_share,km,proof_pct,gps_verified_pct,owed')
  ) as v(template_code, cards)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'dashboard_layout', to_jsonb(v.layout)
  from (values
    ('cleaning', 'kpis,today,money,field_team,live_reps,working_day'),
    ('garden', 'kpis,today,money,field_team,live_reps,working_day'),
    ('plumbing', 'kpis,today,quotes,money,live_reps,working_day'),
    ('installation', 'kpis,today,quotes,money,live_reps,working_day'),
    ('maintenance', 'kpis,today,money,field_team,live_reps,working_day'),
    ('security', 'kpis,today,field_team,live_reps,working_day,money'),
    ('pest_control', 'kpis,today,money,field_team,live_reps,working_day'),
    ('pool', 'kpis,today,money,field_team,live_reps,working_day'),
    ('delivery', 'kpis,today,live_reps,working_day,money'),
    ('distribution', 'headline,sales,pipeline,field_team,store_health,live_reps'),
    ('generic', 'kpis,today,money,field_team,live_reps,working_day')
  ) as v(template_code, layout)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

-- Existing companies (Gold Fortune): their first trade's values, written down
-- as create_company writes every setting.
insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key in ('dashboard_cards', 'dashboard_layout')
on conflict (org_id, key) do nothing;

------------------------------------------------------------- quote dates

alter table public.quotes
  add column sent_at timestamptz,
  add column decided_at timestamptz;

-- The database's to keep: set when the status moves, never from the request.
create function public.quotes_stamp_status()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE' then
    new.sent_at := old.sent_at;
    new.decided_at := old.decided_at;
  else
    new.sent_at := null;
    new.decided_at := null;
  end if;
  if new.status in ('sent', 'accepted', 'declined', 'converted') and new.sent_at is null then
    new.sent_at := now();
  end if;
  if new.status in ('accepted', 'declined', 'converted') and new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end;
$function$;
revoke all on function public.quotes_stamp_status() from public, anon, authenticated;

create trigger quotes_stamp_status before insert or update on public.quotes
  for each row execute function public.quotes_stamp_status();

------------------------------------------------------------- the numbers

-- One window of the dashboard's numbers, [p_d0, p_d1) in the company's days.
-- The caller's own rights apply (security invoker).
create function public.dashboard_kpi_window(p_d0 date, p_d1 date, p_today date, p_caught uuid[],
                                            p_money boolean, p_forms boolean)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  with cfg as materialized (
    select public.current_org_id() as org, public.org_timezone(public.current_org_id()) as tz
  ),
  planned as materialized (
    select ro.id, ro.scheduled_date,
           (exists (select 1 from public.visits v where v.route_id = ro.id and v.status = 'checked_out')
            or ro.id = any(coalesce(p_caught, '{}'::uuid[]))) as done
      from public.routes ro, cfg
     where ro.org_id = cfg.org and ro.scheduled_date >= p_d0 and ro.scheduled_date < p_d1
       and ro.scheduled_date <= p_today
  ),
  plan as (
    select count(*) filter (where scheduled_date < p_today or done) as n,
           count(*) filter (where done) as done,
           count(*) filter (where scheduled_date < p_today and not done) as missed
      from planned
  ),
  vis as materialized (
    select v.id, v.rep_id, v.store_id, v.route_id, v.checkin_at, v.duration_seconds,
           v.checkin_distance_from_store_m as dist, st.geofence_radius_m as radius,
           (v.checkin_at at time zone cfg.tz)::date as day,
           exists (select 1 from public.photos ph where ph.visit_id = v.id) as has_photo,
           exists (select 1 from public.form_submissions fs where fs.visit_id = v.id) as has_form
      from public.visits v
      join public.stores st on st.id = v.store_id
      cross join cfg
     where v.org_id = cfg.org and v.status = 'checked_out'
       and (v.checkin_at at time zone cfg.tz)::date >= p_d0
       and (v.checkin_at at time zone cfg.tz)::date < p_d1
  ),
  fin as (
    select count(*) as n,
           count(*) filter (where has_photo and (has_form or not p_forms)) as proven,
           count(*) filter (where dist is not null) as fixes,
           count(*) filter (where dist is not null and dist <= radius) as inside,
           count(*) filter (where dist is not null and dist <= radius and has_photo) as rounds_proven,
           count(*) filter (where route_id is not null) as planned_visits,
           count(*) filter (where duration_seconds > 0) as timed,
           coalesce(sum(duration_seconds) filter (where duration_seconds > 0), 0) as onsite_seconds,
           count(distinct (rep_id, day)) as staff_days
      from vis
  ),
  -- Proof on file: what the team recorded, counted.
  tally as (
    select (select count(*) from public.photos ph join vis on vis.id = ph.visit_id) as photos,
           (select count(*) from public.form_submissions fs join vis on vis.id = fs.visit_id) as forms
  ),
  wd as (
    select count(*) filter (where w.ended_at is not null) as ended,
           coalesce(sum(w.duration_seconds) filter (where w.ended_at is not null), 0) as seconds,
           count(*) filter (where w.duration_seconds > 12 * 3600) as long_shifts,
           count(*) filter (where w.road_distance_meters is not null) as measured,
           coalesce(sum(w.road_distance_meters), 0) / 1000.0 as km
      from public.workday_sessions w, cfg
     where w.org_id = cfg.org
       and (w.started_at at time zone cfg.tz)::date >= p_d0
       and (w.started_at at time zone cfg.tz)::date < p_d1
  ),
  gaps as (
    select max(gap) as minutes, count(*) as site_days
      from (select store_id, day, max(extract(epoch from (checkin_at - prev_at)) / 60.0) as gap
              from (select store_id, day, checkin_at,
                           lag(checkin_at) over (partition by store_id, day order by checkin_at) as prev_at
                      from vis) x
             where prev_at is not null
             group by store_id, day) g
  ),
  -- Logged to on site: only jobs logged within the week before (call-outs);
  -- a round planned weeks ahead says nothing about response.
  resp as (
    select avg(extract(epoch from (v.checkin_at - ro.created_at)) / 3600.0) as hours, count(*) as n
      from vis v join public.routes ro on ro.id = v.route_id
     where v.checkin_at >= ro.created_at and v.checkin_at - ro.created_at <= interval '7 days'
  ),
  inv as (
    select count(*) as n, coalesce(sum(i.total), 0) as total
      from public.tax_invoices i, cfg
     where p_money and i.org_id = cfg.org and i.status = 'issued'
       and i.issue_date >= p_d0 and i.issue_date < p_d1
  ),
  pay as (
    select count(*) as n, coalesce(sum(pm.amount), 0) as total
      from public.invoice_payments pm, cfg
     where p_money and pm.org_id = cfg.org and pm.paid_on >= p_d0 and pm.paid_on < p_d1
  ),
  qd as (
    select count(*) filter (where q.status in ('accepted', 'converted')) as won,
           count(*) as decided,
           coalesce(sum(qv.value) filter (where q.status in ('accepted', 'converted')), 0) as won_value,
           coalesce(sum(qv.value), 0) as decided_value
      from public.quotes q
      cross join cfg
      left join lateral (select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as value
                           from public.quote_lines l where l.quote_id = q.id) qv on true
     where p_money and q.org_id = cfg.org and q.status in ('accepted', 'converted', 'declined')
       and q.decided_at is not null
       and (q.decided_at at time zone cfg.tz)::date >= p_d0 and (q.decided_at at time zone cfg.tz)::date < p_d1
  )
  select jsonb_build_object(
    'jobs_done_pct', jsonb_build_object('value', case when p.n > 0 then round(p.done::numeric / p.n, 4) end, 'events', p.n),
    'missed', jsonb_build_object('value', p.missed, 'events', p.n),
    'jobs_done', jsonb_build_object('value', f.n, 'events', f.n),
    'photos_taken', jsonb_build_object('value', t.photos, 'events', t.photos),
    'forms_done', jsonb_build_object('value', t.forms, 'events', t.forms),
    'proof_pct', jsonb_build_object('value', case when f.n > 0 then round(f.proven::numeric / f.n, 4) end, 'events', f.n),
    'gps_verified_pct', jsonb_build_object('value', case when f.fixes > 0 then round(f.inside::numeric / f.fixes, 4) end, 'events', f.fixes),
    'rounds_proven_pct', jsonb_build_object('value', case when f.n > 0 then round(f.rounds_proven::numeric / f.n, 4) end, 'events', f.n),
    'planned_share', jsonb_build_object('value', case when f.n > 0 then round(f.planned_visits::numeric / f.n, 4) end, 'events', f.n),
    'time_on_site', jsonb_build_object('value', case when f.timed > 0 then round(f.onsite_seconds::numeric / f.timed / 60, 1) end, 'events', f.timed),
    'onsite_share', jsonb_build_object('value', case when w.seconds > 0 then round(least(f.onsite_seconds::numeric / w.seconds, 1), 4) end, 'events', w.ended),
    'hours_worked', jsonb_build_object('value', round(w.seconds::numeric / 3600, 1), 'events', w.ended, 'extra', w.long_shifts),
    'jobs_per_hour', jsonb_build_object('value', case when w.seconds > 0 then round(f.n::numeric / (w.seconds::numeric / 3600), 2) end, 'events', w.ended),
    'jobs_per_staff_day', jsonb_build_object('value', case when f.staff_days > 0 then round(f.n::numeric / f.staff_days, 1) end, 'events', f.staff_days),
    'km', jsonb_build_object('value', case when w.measured > 0 then round(w.km, 1) end, 'events', w.measured),
    'km_per_job', jsonb_build_object('value', case when w.measured > 0 and f.n > 0 then round(w.km / f.n, 1) end, 'events', least(w.measured, f.n)),
    'longest_gap', jsonb_build_object('value', round(g.minutes::numeric, 0), 'events', g.site_days),
    'response_hours', jsonb_build_object('value', round(r.hours::numeric, 1), 'events', r.n),
    'invoiced', jsonb_build_object('value', i.total, 'events', i.n),
    'avg_invoice', jsonb_build_object('value', case when i.n > 0 then round(i.total / i.n, 2) end, 'events', i.n),
    'received', jsonb_build_object('value', y.total, 'events', y.n),
    'quote_win_rate', jsonb_build_object('value', case when qd.decided > 0 then round(qd.won::numeric / qd.decided, 4) end, 'events', qd.decided),
    'quote_win_value', jsonb_build_object('value', case when qd.decided_value > 0 then round(qd.won_value / qd.decided_value, 4) end, 'events', qd.decided)
  )
  from plan p, fin f, tally t, wd w, gaps g, resp r, inv i, pay y, qd;
$function$;

revoke all on function public.dashboard_kpi_window(date, date, date, uuid[], boolean, boolean) from public, anon;
grant execute on function public.dashboard_kpi_window(date, date, date, uuid[], boolean, boolean) to authenticated;

-- The dashboard's numbers: `p_codes` of them (all when null), each
-- {value, previous, events, extra}. Window numbers carry the previous
-- window's value; numbers about now (today, owed, waiting) do not.
create function public.dashboard_kpis(p_from timestamptz, p_to timestamptz, p_codes text[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_tz text;
  v_from date;
  v_to date;
  v_pfrom date;
  v_today date;
  v_money boolean;
  v_forms boolean;
  v_caught uuid[] := '{}';
  v_cur jsonb;
  v_prev jsonb;
  v_now jsonb;
  v_out jsonb := '{}';
  c text;
begin
  if v_org is null then
    raise exception 'Not signed in to a company.' using errcode = '42501';
  end if;
  v_tz := public.org_timezone(v_org);
  v_from := (p_from at time zone v_tz)::date;
  v_to := greatest((p_to at time zone v_tz)::date, v_from + 1);
  v_pfrom := v_from - (v_to - v_from);
  v_today := (now() at time zone v_tz)::date;
  v_money := public.module_enabled('invoicing') and public.has_permission('invoicing');
  v_forms := public.module_enabled('checklists_forms');
  -- A round gone back to later counts as done, as the reports count it.
  if public.module_enabled('reports') then
    select coalesce(array_agg(rc.route_id), '{}') into v_caught
      from public.route_catchups(v_pfrom::timestamp at time zone v_tz, v_to::timestamp at time zone v_tz) rc;
  end if;
  v_cur := public.dashboard_kpi_window(v_from, v_to, v_today, v_caught, v_money, v_forms);
  v_prev := public.dashboard_kpi_window(v_pfrom, v_from, v_today, v_caught, v_money, v_forms);

  v_now := jsonb_build_object(
    'jobs_today', (select jsonb_build_object('value', count(*) filter (where v.status = 'checked_out'),
                                             'events', count(*),
                                             'extra', count(*) filter (where v.status = 'checked_in'))
                     from public.visits v
                    where v.org_id = v_org and (v.checkin_at at time zone v_tz)::date = v_today),
    -- A new company's first week: ever, not windowed. Each 0 or 1.
    'first_week', jsonb_build_object(
      'sites', (select count(*) from (select 1 from public.stores s where s.org_id = v_org limit 1) x),
      'workdays', (select count(*) from (select 1 from public.workday_sessions w where w.org_id = v_org limit 1) x),
      'proven', (select count(*) from (select 1 from public.visits v
                                         where v.org_id = v_org and v.status = 'checked_out'
                                           and exists (select 1 from public.photos ph where ph.visit_id = v.id)
                                         limit 1) x),
      'invoices', case when v_money
                       then (select count(*) from (select 1 from public.tax_invoices i
                                                    where i.org_id = v_org and i.status = 'issued' limit 1) x) end),
    'upcoming_7d', (select jsonb_build_object('value', count(*), 'events', count(*))
                      from public.routes ro
                     where ro.org_id = v_org and ro.scheduled_date >= v_today and ro.scheduled_date < v_today + 7
                       and not exists (select 1 from public.visits v where v.route_id = ro.id and v.status = 'checked_out')));
  if v_money then
    v_now := v_now || jsonb_build_object(
      'owed', (select jsonb_build_object('value', coalesce(sum(b.outstanding), 0),
                                         'events', count(*) filter (where b.outstanding > 0),
                                         'extra', coalesce(sum(b.outstanding) filter (where i.due_date < v_today), 0))
                 from public.tax_invoices i join public.tax_invoice_balances b on b.invoice_id = i.id
                where i.org_id = v_org and i.status = 'issued'),
      'overdue', (select jsonb_build_object('value', coalesce(sum(b.outstanding) filter (where i.due_date < v_today), 0),
                                            'events', count(*) filter (where b.outstanding > 0 and i.due_date < v_today))
                    from public.tax_invoices i join public.tax_invoice_balances b on b.invoice_id = i.id
                   where i.org_id = v_org and i.status = 'issued'),
      'unbilled_jobs', (select jsonb_build_object('value', count(*), 'events', count(*))
                          from public.unbilled_visits(null, v_from, v_to - 1)),
      'quotes_waiting_value', (select jsonb_build_object('value', coalesce(sum(qv.value), 0), 'events', count(*),
                                                         'extra', max(v_today - (coalesce(q.sent_at, q.created_at) at time zone v_tz)::date))
                                 from public.quotes q
                                 left join lateral (select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as value
                                                      from public.quote_lines l where l.quote_id = q.id) qv on true
                                where q.org_id = v_org and q.status = 'sent'),
      'accepted_not_invoiced', (select jsonb_build_object('value', coalesce(sum(qv.value), 0), 'events', count(*), 'extra', count(*))
                                  from public.quotes q
                                  left join lateral (select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as value
                                                       from public.quote_lines l where l.quote_id = q.id) qv on true
                                 where q.org_id = v_org and q.status = 'accepted'
                                   and not exists (select 1 from public.tax_invoices i
                                                    where i.quote_id = q.id and i.status = 'issued')));
  end if;

  foreach c in array coalesce(p_codes, array(select jsonb_object_keys(v_cur || v_now))) loop
    if v_now ? c then
      v_out := v_out || jsonb_build_object(c, v_now -> c);
    elsif v_cur ? c then
      if not v_money and c in ('invoiced', 'avg_invoice', 'received', 'quote_win_rate', 'quote_win_value') then
        continue;
      end if;
      v_out := v_out || jsonb_build_object(c, (v_cur -> c) || jsonb_build_object('previous', v_prev -> c -> 'value'));
    end if;
  end loop;
  return v_out;
end;
$function$;

revoke all on function public.dashboard_kpis(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.dashboard_kpis(timestamptz, timestamptz, text[]) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'dashboard_kpis', 'core'),
  ('function', 'dashboard_kpi_window', 'core');

------------------------------------------------- the trend in company days

do $migration$
declare
  v_def text := pg_get_functiondef('public.dashboard_summary(timestamptz, timestamptz)'::regprocedure);
  c_old1 constant text := $a$           p_from - (p_to - p_from) as prev_from
  ),$a$;
  c_new1 constant text := $b$           p_from - (p_to - p_from) as prev_from,
           public.org_timezone(public.current_org_id()) as tz
  ),$b$;
  c_old2 constant text := $a$    cross join lateral generate_series(cfg.cur_from::date,
                                       (cfg.cur_to - interval '1 second')::date,$a$;
  c_new2 constant text := $b$    cross join lateral generate_series((cfg.cur_from at time zone cfg.tz)::date,
                                       ((cfg.cur_to - interval '1 second') at time zone cfg.tz)::date,$b$;
  c_old3 constant text := $a$                      and (p.occurred_at at time zone 'UTC')::date = d.day::date$a$;
  c_new3 constant text := $b$                      and (p.occurred_at at time zone cfg.tz)::date = d.day::date$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old1, ''))) / length(c_old1) <> 1
     or (length(v_def) - length(replace(v_def, c_old2, ''))) / length(c_old2) <> 1
     or (length(v_def) - length(replace(v_def, c_old3, ''))) / length(c_old3) <> 1 then
    raise exception 'dashboard_summary is not the text this migration expects';
  end if;
  execute replace(replace(replace(v_def, c_old1, c_new1), c_old2, c_new2), c_old3, c_new3);
end;
$migration$;
