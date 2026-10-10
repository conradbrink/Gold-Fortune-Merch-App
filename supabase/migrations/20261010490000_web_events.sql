-- Website visits, counted by Tickd itself.
--
-- Why: the owner (10 Oct 2026) wants the Control Centre's website numbers to
-- be instant. Google Analytics' reports can take hours (its live view covers
-- only 30 minutes), so the sales site now also sends each page view and
-- funnel event here, through the app's /api/events. Google Analytics stays on.
--
--   web_events            one row per page view or funnel event. Anonymous:
--                         a random id per browser (localStorage, not a cookie)
--                         and per visit (sessionStorage), the page, the event's
--                         section, how the visit arrived (UTM tags, the other
--                         site's host, the kind of ad click, never its id),
--                         the kind of device and the country. No IP address,
--                         no user agent, nothing that names anyone. Written and
--                         read by the service role only.
--   platform_web_stats()  the Control Centre's numbers for a period, in one
--                         call: visitors, new visitors, sessions, page views,
--                         visitors per day, pages, people per event, and
--                         visitors per source. Optional device and country
--                         filters. Service role only.
--
-- Rollback: supabase/rollback/20261010490000_web_events.down.sql.

create table public.web_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  name          text not null check (name ~ '^[a-z][a-z0-9_]{1,39}$'),
  visitor_id    uuid not null,
  session_id    uuid not null,
  path          text not null check (char_length(path) between 1 and 200 and left(path, 1) = '/'),
  section       text check (section is null or section ~ '^[a-z0-9_-]{1,40}$'),
  referrer_host text check (referrer_host is null or referrer_host ~ '^[a-z0-9.-]{1,253}$'),
  utm_source    text check (utm_source is null or char_length(utm_source) <= 100),
  utm_medium    text check (utm_medium is null or char_length(utm_medium) <= 100),
  utm_campaign  text check (utm_campaign is null or char_length(utm_campaign) <= 100),
  click_id      text check (click_id is null or click_id in ('gclid', 'fbclid', 'msclkid', 'ttclid')),
  device        text check (device is null or device in ('mobile', 'tablet', 'desktop')),
  country       text check (country is null or country ~ '^[A-Z]{2}$')
);

create index web_events_at_idx on public.web_events (at);
create index web_events_name_at_idx on public.web_events (name, at);
create index web_events_visitor_idx on public.web_events (visitor_id, at);

alter table public.web_events enable row level security;
-- No policies: the service role (the app's /api/events and the Control Centre) only.
revoke all on public.web_events from anon, authenticated;

comment on table public.web_events is
  'Website page views and funnel events counted by Tickd itself (anonymous: random browser and visit ids, no IP, no user agent). Service role only.';

create or replace function public.platform_web_stats(
  p_from    timestamptz,
  p_to      timestamptz,
  p_tz      text default 'Africa/Johannesburg',
  p_device  text default null,
  p_country text default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with e as (
    select * from public.web_events w
    where w.at >= p_from and w.at < p_to
      and (p_device is null or w.device = p_device)
      and (p_country is null or w.country = p_country)
  ),
  pv as (select * from e where e.name = 'page_view'),
  firsts as (
    select w.visitor_id, min(w.at) as first_at
    from public.web_events w
    where w.name = 'page_view' and w.visitor_id in (select distinct pv.visitor_id from pv)
    group by w.visitor_id
  ),
  started as (
    select e.path, count(distinct e.visitor_id) as n from e where e.name = 'signup_started' group by e.path
  )
  select jsonb_build_object(
    'visitors',     (select count(distinct visitor_id) from pv),
    'new_visitors', (select count(*) from firsts where first_at >= p_from),
    'sessions',     (select count(distinct session_id) from pv),
    'page_views',   (select count(*) from pv),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'visitors', v, 'views', c) order by d), '[]'::jsonb)
      from (select (pv.at at time zone p_tz)::date as d, count(distinct pv.visitor_id) as v, count(*) as c
            from pv group by 1) x
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', x.path, 'visitors', x.v, 'views', x.c, 'started', coalesce(s.n, 0))
                                order by x.v desc, x.path), '[]'::jsonb)
      from (select pv.path, count(distinct pv.visitor_id) as v, count(*) as c
            from pv group by pv.path order by 2 desc limit 100) x
      left join started s on s.path = x.path
    ),
    'events', (
      select coalesce(jsonb_object_agg(x.name, x.n), '{}'::jsonb)
      from (select e.name, count(distinct e.visitor_id) as n from e group by e.name) x
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'utm_source', x.utm_source, 'utm_medium', x.utm_medium, 'utm_campaign', x.utm_campaign,
               'referrer', x.referrer_host, 'click_id', x.click_id,
               'visitors', x.v, 'started', x.st, 'applied', x.ap)), '[]'::jsonb)
      from (select e.utm_source, e.utm_medium, e.utm_campaign, e.referrer_host, e.click_id,
                   count(distinct e.visitor_id) filter (where e.name = 'page_view')        as v,
                   count(distinct e.visitor_id) filter (where e.name = 'signup_started')   as st,
                   count(distinct e.visitor_id) filter (where e.name = 'signup_completed') as ap
            from e group by 1, 2, 3, 4, 5) x
    ),
    'devices', (
      select coalesce(jsonb_agg(distinct w.device), '[]'::jsonb)
      from public.web_events w where w.at >= p_from and w.at < p_to and w.device is not null
    ),
    'countries', (
      select coalesce(jsonb_agg(distinct w.country), '[]'::jsonb)
      from public.web_events w where w.at >= p_from and w.at < p_to and w.country is not null
    )
  );
$function$;

revoke all on function public.platform_web_stats(timestamptz, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_web_stats(timestamptz, timestamptz, text, text, text) to service_role;
