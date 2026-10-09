-- Stage 8.4: alerts when something's off. The sales site promises the owner
-- hears about it when a job goes wrong; this keeps that promise without a
-- phone release, from what the phones already record.
--
-- * Five rules, as data. Which are on is the company setting `alerts_on`, a
--   comma list of rule codes seeded per trade:
--     off_site_checkin  a check-in farther from the site than its radius
--                       (stores.geofence_radius_m, as the dashboards' "GPS
--                       on site" counts it)
--     short_job         a finished job shorter than `short_visit_minutes`
--                       (only while that setting is above 0)
--     missed_planned    a planned job (a route) for the day not done by the
--                       company's end of day, `alerts_digest_time` on its own
--                       clock; done means a finished job on that route, or a
--                       finished job at that site that day
--     patrol_gap        the longest gap between consecutive check-ins at one
--                       site on one company day, when it is longer than
--                       `alerts_patrol_gap_minutes`; one alert per site-day
--     no_gps            a check-in without a GPS position
--   Every trade but distribution starts with the first three on; security
--   also with patrol_gap; no_gps starts off everywhere. Distribution has none,
--   so Gold Fortune sees no change.
-- * alerts: one row per thing that went wrong, made by detect_alerts() every
--   five minutes (pg_cron "alerts-detect") for every company with the module
--   on that can still write. Idempotent by `dedupe_key` (rule:visit,
--   rule:route, patrol_gap:site:day); it looks back over the company's
--   yesterday and today only, so it stays cheap.
-- * Email, `alerts_email`: "instant" queues one email per new alert to each
--   recipient; "digest" (the default) one email per recipient once a company
--   day, after `alerts_digest_time`, listing what came in since the last one
--   (alert_digests keeps the day so it goes once); "off" sends nothing.
--   Recipients are the company's active people holding `insights` (or
--   `admin`) with a real email: not a phone login (@staff.tickd.co.za). These
--   are the company's own people, so the emails carry no unsubscribe link.
-- * Who sees them: people in the company holding `insights` (the Reports and
--   Tracking permission: the people who read how the field went), in the app
--   through my_alerts(), each with their own read marks (alert_reads,
--   mark_alerts_read()). Nobody signed in writes alerts.
-- * The module: `owner_notifications` ("Daily summary and exception alerts")
--   was catalogued unbuilt. It is marked built here, switched on for every
--   existing company except Gold Fortune, and for new companies of every
--   trade except distribution (template_modules).
--
-- The phone app reads none of this, and nothing it reads or writes changes.
--
-- Needs the billing gate on production (company_account.status), as
-- 20261009160000_job_reports does.
--
-- Rollback: supabase/rollback/20261009170000_alerts.down.sql.

------------------------------------------------------------------ the module

update public.modules set is_built = true where code = 'owner_notifications';

-- Security had it already (20261007182242); every other trade but
-- distribution gets it now.
insert into public.template_modules (template_code, module_code)
select it.code, 'owner_notifications'
  from public.industry_templates it
 where it.code <> 'distribution'
on conflict do nothing;

-- A company the operator already switched it off for keeps it off.
insert into public.company_modules (org_id, module_code, enabled)
select o.id, 'owner_notifications', true
  from public.organizations o
 where o.id <> '71170c8a-d53c-4a07-bdd4-97704a3cf4bc'   -- Gold Fortune: no change
on conflict (org_id, module_code) do nothing;

------------------------------------------------------------------ the settings

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('alerts_on', 'Alerts',
   'Which alerts are on, a comma list of: off_site_checkin, short_job, missed_planned, patrol_gap, no_gps.',
   'text', '"off_site_checkin,short_job,missed_planned"', null, null,
   '^((off_site_checkin|short_job|missed_planned|patrol_gap|no_gps)(,(off_site_checkin|short_job|missed_planned|patrol_gap|no_gps))*)?$',
   1000),
  ('alerts_email', 'Alert emails',
   'How alerts are emailed to the people who read reports: instant, digest (one email a day) or off.',
   'text', '"digest"', null, null, '^(instant|digest|off)$', 1001),
  ('alerts_digest_time', 'End of the day for alerts',
   'When planned work not done counts as missed, and when the daily alert email goes, on the company''s clock.',
   'time', '"17:30"', null, null, null, 1002),
  ('alerts_patrol_gap_minutes', 'Longest gap between rounds (minutes)',
   'A site that goes longer than this between check-ins on one day raises an alert.',
   'integer', '90', 15, 1440, null, 1003);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'alerts_on', to_jsonb(v.rules)
  from (values
    ('cleaning', 'off_site_checkin,short_job,missed_planned'),
    ('garden', 'off_site_checkin,short_job,missed_planned'),
    ('plumbing', 'off_site_checkin,short_job,missed_planned'),
    ('installation', 'off_site_checkin,short_job,missed_planned'),
    ('maintenance', 'off_site_checkin,short_job,missed_planned'),
    ('security', 'off_site_checkin,short_job,missed_planned,patrol_gap'),
    ('pest_control', 'off_site_checkin,short_job,missed_planned'),
    ('pool', 'off_site_checkin,short_job,missed_planned'),
    ('delivery', 'off_site_checkin,short_job,missed_planned'),
    ('generic', 'off_site_checkin,short_job,missed_planned'),
    ('distribution', '')
  ) as v(template_code, rules)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.template_settings (template_code, setting_key, value)
select 'security', 'alerts_patrol_gap_minutes', '90'::jsonb
 where exists (select 1 from public.industry_templates it where it.code = 'security');

insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key in ('alerts_on', 'alerts_email', 'alerts_digest_time', 'alerts_patrol_gap_minutes')
on conflict (org_id, key) do nothing;

-- Gold Fortune is on the distribution template, so it has no alerts on
-- already; said again here so nothing depends on how it was recorded.
update public.company_settings set value = '""'
 where org_id = '71170c8a-d53c-4a07-bdd4-97704a3cf4bc' and key = 'alerts_on';

------------------------------------------------------------------ the tables

create table public.alerts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  rule             text not null check (rule in ('off_site_checkin', 'short_job', 'missed_planned', 'patrol_gap', 'no_gps')),
  occurred_at      timestamptz not null,
  -- The company day it belongs to, on the company's clock when it was found.
  day              date not null,
  visit_id         uuid references public.visits(id) on delete cascade,
  route_id         uuid references public.routes(id) on delete cascade,
  store_id         uuid references public.stores(id) on delete cascade,
  -- The staff member concerned.
  profile_id       uuid references public.profiles(id) on delete set null,
  detail           jsonb not null default '{}'::jsonb,
  dedupe_key       text not null check (length(dedupe_key) between 3 and 200),
  -- When the email side was done with it: emailed, put in a digest, or not
  -- to be emailed (alerts_email off).
  email_handled_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (org_id, dedupe_key)
);

create index alerts_org_occurred_idx on public.alerts (org_id, occurred_at desc);
create index alerts_unhandled_idx on public.alerts (org_id, created_at) where email_handled_at is null;
create index alerts_visit_idx on public.alerts (visit_id) where visit_id is not null;
create index alerts_route_idx on public.alerts (route_id) where route_id is not null;
create index alerts_store_idx on public.alerts (store_id) where store_id is not null;
create index alerts_profile_idx on public.alerts (profile_id) where profile_id is not null;

-- Who has read which alert. org_id so a company's rows are its own by
-- column, as every company table's are.
create table public.alert_reads (
  alert_id   uuid not null references public.alerts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (alert_id, profile_id)
);

create index alert_reads_profile_idx on public.alert_reads (profile_id);
create index alert_reads_org_idx on public.alert_reads (org_id);

-- The daily email, once per company day.
create table public.alert_digests (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  day         date not null,
  alert_count integer not null default 0,
  queued_at   timestamptz not null default now(),
  primary key (org_id, day)
);

alter table public.alerts enable row level security;
alter table public.alert_reads enable row level security;
alter table public.alert_digests enable row level security;

-- The people who read how the field went (Reports, Tracking) read the alerts.
create policy alerts_select on public.alerts for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.has_permission('insights')));
-- Your own read marks only.
create policy alert_reads_select on public.alert_reads for select to authenticated
  using (org_id = (select public.current_org_id()) and profile_id = (select auth.uid()));
-- alert_digests: no policy; the database's own record.

create policy module_gate on public.alerts as restrictive for all
  using ((select public.module_enabled('owner_notifications')))
  with check ((select public.module_enabled('owner_notifications')));
create policy module_gate on public.alert_reads as restrictive for all
  using ((select public.module_enabled('owner_notifications')))
  with check ((select public.module_enabled('owner_notifications')));
create policy module_gate on public.alert_digests as restrictive for all
  using ((select public.module_enabled('owner_notifications')))
  with check ((select public.module_enabled('owner_notifications')));

-- Written only by the database (detect_alerts, mark_alerts_read).
revoke all on public.alerts, public.alert_reads, public.alert_digests from anon, authenticated;
grant select on public.alerts, public.alert_reads to authenticated;

------------------------------------------------------------------ detection

-- One company's new alerts, for the rules it has on. Internal. The number made.
create function public.detect_company_alerts(p_org uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_on text[];
  v_tz text := public.org_timezone(p_org);
  v_today date;
  v_from timestamptz;
  v_cut time;
  v_short integer;
  v_gap integer;
  k integer;
  n integer := 0;
begin
  v_on := string_to_array(nullif(btrim(coalesce(public.org_setting(p_org, 'alerts_on') #>> '{}', '')), ''), ',');
  if coalesce(cardinality(v_on), 0) = 0 then
    return 0;
  end if;
  v_today := (now() at time zone v_tz)::date;
  -- Yesterday and today on the company's clock.
  v_from := ((v_today - 1)::timestamp at time zone v_tz);
  v_cut := coalesce((public.org_setting(p_org, 'alerts_digest_time') #>> '{}')::time, time '17:30');
  v_short := coalesce((public.org_setting(p_org, 'short_visit_minutes') #>> '{}')::integer, 0);
  v_gap := coalesce((public.org_setting(p_org, 'alerts_patrol_gap_minutes') #>> '{}')::integer, 90);

  if 'off_site_checkin' = any(v_on) then
    insert into public.alerts (org_id, rule, occurred_at, day, visit_id, store_id, profile_id, detail, dedupe_key)
    select v.org_id, 'off_site_checkin', v.checkin_at, (v.checkin_at at time zone v_tz)::date, v.id, v.store_id, v.rep_id,
           jsonb_build_object('distance_m', round(v.checkin_distance_from_store_m::numeric),
                              'radius_m', s.geofence_radius_m),
           'off_site_checkin:' || v.id
      from public.visits v
      join public.stores s on s.id = v.store_id
     where v.org_id = p_org and v.checkin_at >= v_from
       and v.status in ('checked_in', 'checked_out')
       and v.checkin_distance_from_store_m is not null
       and v.checkin_distance_from_store_m > s.geofence_radius_m
    on conflict (org_id, dedupe_key) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;

  if 'short_job' = any(v_on) and v_short > 0 then
    insert into public.alerts (org_id, rule, occurred_at, day, visit_id, store_id, profile_id, detail, dedupe_key)
    select v.org_id, 'short_job', v.checkout_at, (v.checkin_at at time zone v_tz)::date, v.id, v.store_id, v.rep_id,
           jsonb_build_object('seconds', d.secs, 'limit_minutes', v_short),
           'short_job:' || v.id
      from public.visits v
      cross join lateral (
        select coalesce(v.duration_seconds, extract(epoch from (v.checkout_at - v.checkin_at)))::integer as secs
      ) d
     where v.org_id = p_org and v.checkin_at >= v_from
       and v.status = 'checked_out' and v.checkout_at is not null
       and d.secs is not null and d.secs >= 0 and d.secs < v_short * 60
    on conflict (org_id, dedupe_key) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;

  if 'no_gps' = any(v_on) then
    insert into public.alerts (org_id, rule, occurred_at, day, visit_id, store_id, profile_id, detail, dedupe_key)
    select v.org_id, 'no_gps', v.checkin_at, (v.checkin_at at time zone v_tz)::date, v.id, v.store_id, v.rep_id,
           '{}'::jsonb, 'no_gps:' || v.id
      from public.visits v
     where v.org_id = p_org and v.checkin_at >= v_from
       and v.status in ('checked_in', 'checked_out')
       and (v.checkin_lat is null or v.checkin_lng is null)
    on conflict (org_id, dedupe_key) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;

  if 'missed_planned' = any(v_on) then
    insert into public.alerts (org_id, rule, occurred_at, day, route_id, store_id, profile_id, detail, dedupe_key)
    select r.org_id, 'missed_planned', ((r.scheduled_date + v_cut)::timestamp at time zone v_tz), r.scheduled_date,
           r.id, r.store_id, r.rep_id,
           jsonb_build_object('scheduled_date', r.scheduled_date, 'cutoff', to_char(v_cut, 'HH24:MI')),
           'missed_planned:' || r.id
      from public.routes r
     where r.org_id = p_org
       and r.scheduled_date between v_today - 1 and v_today
       and (r.scheduled_date < v_today or (now() at time zone v_tz)::time >= v_cut)
       and not exists (select 1 from public.visits v
                        where v.route_id = r.id and v.status = 'checked_out')
       and not exists (select 1 from public.visits v
                        where v.org_id = p_org and v.store_id = r.store_id and v.status = 'checked_out'
                          and v.checkin_at >= ((r.scheduled_date)::timestamp at time zone v_tz)
                          and v.checkin_at < ((r.scheduled_date + 1)::timestamp at time zone v_tz))
    on conflict (org_id, dedupe_key) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;

  if 'patrol_gap' = any(v_on) then
    insert into public.alerts (org_id, rule, occurred_at, day, visit_id, store_id, profile_id, detail, dedupe_key)
    select distinct on (g.store_id, g.day)
           p_org, 'patrol_gap', g.checkin_at, g.day, g.id, g.store_id, g.rep_id,
           jsonb_build_object('gap_minutes', g.minutes, 'from', g.prev_at, 'to', g.checkin_at, 'limit_minutes', v_gap),
           'patrol_gap:' || g.store_id || ':' || g.day
      from (select x.*, floor(extract(epoch from (x.checkin_at - x.prev_at)) / 60)::integer as minutes
              from (select v.id, v.store_id, v.rep_id, v.checkin_at,
                           (v.checkin_at at time zone v_tz)::date as day,
                           lag(v.checkin_at) over (partition by v.store_id, (v.checkin_at at time zone v_tz)::date
                                                   order by v.checkin_at) as prev_at
                      from public.visits v
                     where v.org_id = p_org and v.checkin_at >= v_from
                       and v.status in ('checked_in', 'checked_out')) x
             where x.prev_at is not null) g
     where g.minutes > v_gap
     order by g.store_id, g.day, g.minutes desc, g.checkin_at
    on conflict (org_id, dedupe_key) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;

  return n;
end;
$function$;

revoke all on function public.detect_company_alerts(uuid) from public, anon, authenticated;

------------------------------------------------------------------ emails

-- Who gets a company's alert emails: active people holding `insights` or
-- `admin`, with an email that is not a phone login. Internal.
create function public.alert_recipients(p_org uuid)
returns table (email text, full_name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select distinct on (lower(e.email)) lower(e.email), p.full_name
    from public.profiles p
    left join auth.users u on u.id = p.id
    cross join lateral (select coalesce(nullif(btrim(p.email), ''), u.email) as email) e
   where p.org_id = p_org and p.is_active
     and e.email is not null
     and e.email !~* '@staff\.tickd\.co\.za$'
     and exists (select 1 from public.profile_permissions pp
                  where pp.profile_id = p.id and pp.permission_code in ('insights', 'admin'))
   order by lower(e.email), p.full_name;
$function$;

revoke all on function public.alert_recipients(uuid) from public, anon, authenticated;

-- Everything an alert email shows, so the sender needs nothing else: the
-- company's words, its clock, and up to 50 alerts (with the total). Internal.
create function public.alert_email_payload(p_org uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'timezone', public.org_timezone(p_org),
    'day', (now() at time zone public.org_timezone(p_org))::date,
    'total', (select count(*) from public.alerts a where a.org_id = p_org and a.id = any(p_ids)),
    'terms', (select jsonb_object_agg(d.key, jsonb_build_object(
                       'one', coalesce(ct.singular, d.singular),
                       'many', coalesce(ct.plural, d.plural),
                       'article', case when ct.key is null then d.article else ct.article end))
                from public.term_definitions d
                left join public.company_terminology ct on ct.org_id = p_org and ct.key = d.key),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'rule', a.rule, 'occurred_at', a.occurred_at, 'day', a.day,
               'visit_id', a.visit_id, 'route_id', a.route_id, 'store_id', a.store_id,
               'profile_id', a.profile_id, 'site_name', s.name, 'staff_name', p.full_name,
               'detail', a.detail)
             order by a.occurred_at, a.id)
        from (select * from public.alerts a0
               where a0.org_id = p_org and a0.id = any(p_ids)
               order by a0.occurred_at, a0.id
               limit 50) a
        left join public.stores s on s.id = a.store_id
        left join public.profiles p on p.id = a.profile_id), '[]'::jsonb)
  );
$function$;

revoke all on function public.alert_email_payload(uuid, uuid[]) from public, anon, authenticated;

-- One company's alert emails, as its setting says. Internal. The number of
-- emails queued.
--   instant  each alert of the last two days not yet emailed, one email per
--            alert per recipient.
--   digest   once the company's clock passes alerts_digest_time, once a day:
--            one email per recipient with everything not yet emailed (the
--            last two days). A day with nothing sends nothing.
--   off      nothing; the alerts are marked done so switching on later does
--            not send a backlog.
create function public.queue_alert_emails(p_org uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_mode text := coalesce(public.org_setting(p_org, 'alerts_email') #>> '{}', 'digest');
  v_tz text := public.org_timezone(p_org);
  v_today date := (now() at time zone v_tz)::date;
  v_time time;
  v_ids uuid[];
  v_payload jsonb;
  a record;
  r record;
  n integer := 0;
begin
  if v_mode = 'off' then
    update public.alerts set email_handled_at = now()
     where org_id = p_org and email_handled_at is null;
    return 0;
  end if;

  if v_mode = 'instant' then
    for a in select al.id from public.alerts al
              where al.org_id = p_org and al.email_handled_at is null
                and al.created_at > now() - interval '2 days'
              order by al.occurred_at, al.id
              limit 200
    loop
      v_payload := public.alert_email_payload(p_org, array[a.id]);
      for r in select * from public.alert_recipients(p_org) loop
        perform public.queue_email(p_org, r.email, r.full_name, 'alert', v_payload, 'alert', a.id);
        n := n + 1;
      end loop;
      update public.alerts set email_handled_at = now() where id = a.id;
    end loop;
    return n;
  end if;

  if v_mode = 'digest' then
    v_time := coalesce((public.org_setting(p_org, 'alerts_digest_time') #>> '{}')::time, time '17:30');
    if (now() at time zone v_tz)::time < v_time
       or exists (select 1 from public.alert_digests d where d.org_id = p_org and d.day = v_today) then
      return 0;
    end if;
    select coalesce(array_agg(al.id order by al.occurred_at, al.id), '{}') into v_ids
      from public.alerts al
     where al.org_id = p_org and al.email_handled_at is null
       and al.created_at > now() - interval '2 days';
    insert into public.alert_digests (org_id, day, alert_count) values (p_org, v_today, cardinality(v_ids));
    if cardinality(v_ids) = 0 then
      return 0;
    end if;
    v_payload := public.alert_email_payload(p_org, v_ids);
    for r in select * from public.alert_recipients(p_org) loop
      perform public.queue_email(p_org, r.email, r.full_name, 'alerts_digest', v_payload, 'alert', null);
      n := n + 1;
    end loop;
    update public.alerts set email_handled_at = now() where id = any(v_ids);
    return n;
  end if;

  return 0;
end;
$function$;

revoke all on function public.queue_alert_emails(uuid) from public, anon, authenticated;

-- Every five minutes: every company with the module on that can still write,
-- its new alerts and then its emails. One company's failure is logged and
-- the others carry on. The number of alerts made.
create function public.detect_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o record;
  n integer := 0;
begin
  for o in select org.id from public.organizations org
            where exists (select 1 from public.company_modules cm
                           where cm.org_id = org.id and cm.module_code = 'owner_notifications' and cm.enabled)
              and not exists (select 1 from public.company_account a
                               where a.org_id = org.id and a.status in ('read_only', 'cancelled'))
            order by org.id
  loop
    begin
      n := n + public.detect_company_alerts(o.id);
      perform public.queue_alert_emails(o.id);
    exception when others then
      raise warning 'detect_alerts: company % skipped (% %)', o.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end;
$function$;

revoke all on function public.detect_alerts() from public, anon, authenticated;

select cron.schedule('alerts-detect', '*/5 * * * *', 'select public.detect_alerts()');

------------------------------------------------------------------ in the app

-- The caller's company's latest alerts, newest first, each with whether the
-- caller has read it.
create function public.my_alerts(p_limit integer default 50)
returns table (id uuid, rule text, occurred_at timestamptz, day date, visit_id uuid, route_id uuid,
               store_id uuid, profile_id uuid, site_name text, staff_name text, detail jsonb, unread boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  perform public.require_module('owner_notifications');
  perform public.require_permission('insights');
  return query
  select a.id, a.rule, a.occurred_at, a.day, a.visit_id, a.route_id, a.store_id, a.profile_id,
         s.name, p.full_name, a.detail,
         not exists (select 1 from public.alert_reads ar where ar.alert_id = a.id and ar.profile_id = auth.uid())
    from public.alerts a
    left join public.stores s on s.id = a.store_id
    left join public.profiles p on p.id = a.profile_id
   where a.org_id = public.current_org_id()
   order by a.occurred_at desc, a.id
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

revoke all on function public.my_alerts(integer) from public, anon;
grant execute on function public.my_alerts(integer) to authenticated;

-- Mark the given alerts read for the caller, or all of them when no list is
-- given. The number newly marked.
create function public.mark_alerts_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer;
begin
  perform public.require_module('owner_notifications');
  perform public.require_permission('insights');
  insert into public.alert_reads (alert_id, profile_id, org_id)
  select a.id, auth.uid(), a.org_id
    from public.alerts a
   where a.org_id = public.current_org_id()
     and (p_ids is null or a.id = any(p_ids))
  on conflict (alert_id, profile_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.mark_alerts_read(uuid[]) from public, anon;
grant execute on function public.mark_alerts_read(uuid[]) to authenticated;

------------------------------------------------------------------ registration

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'alerts', 'owner_notifications'),
  ('table', 'alert_reads', 'owner_notifications'),
  ('table', 'alert_digests', 'owner_notifications'),
  ('function', 'my_alerts', 'owner_notifications'),
  ('function', 'mark_alerts_read', 'owner_notifications');
