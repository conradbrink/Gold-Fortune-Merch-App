-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 3 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260727201311_coverage_gaps_uses_any_assignment.sql
--    .. through 20260728190322_create_files_bucket.sql
--
-- Run the chunks in order.
--
-- Wrapped in a transaction, so a statement that fails should take the
-- whole chunk back out with it. That is a *should*: supabase/README.md
-- records a 377 KB script that failed and had partly applied anyway,
-- so the editor cannot be assumed to honour it. The per-migration
-- stamps and 99_resume.sql are still the authority on what landed —
-- check them rather than re-running blind.
-- ──────────────────────────────────────────────────────────────────────────

begin;
-- ──────────────────────────────────────────────────────────────────────────
-- 26/76  20260727201311_coverage_gaps_uses_any_assignment.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Assignment now means responsibility: if a store is assigned to a rep, that rep
-- is accountable for it. There is no separate "primary" concept in the UI any
-- more, so filtering the responsible rep on is_primary would leave every store
-- assigned after this change reading as Unassigned in the coverage report.
--
-- is_primary stays on the table (and keeps its partial unique index) rather than
-- being dropped — no code writes it now, and removing a column is not worth the
-- migration risk while the flag is harmless.
--
-- Return type changes, so drop rather than replace.
drop function if exists public.coverage_gaps(timestamptz, timestamptz);

create function public.coverage_gaps(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id         uuid,
  store_name       text,
  store_group      text,
  city             text,
  state            text,
  last_visit_at    timestamptz,
  days_since       numeric,
  visits_in_period bigint,
  assigned_reps    text,
  assigned_count   bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  sc as (
    select s.id, s.name, s.city, s.state, g.name as grp
    from stores s
    left join store_groups g on g.id = s.store_group_id
    cross join cfg
    where s.org_id = cfg.org and s.active
  ),
  -- Deliberately over all history, not the filtered range: "last visited"
  -- means last visited, not last visited inside the window you happen to
  -- be looking at.
  lv as (
    select v.store_id, max(v.checkin_at) as last_visit_at
    from visits v cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null
    group by 1
  ),
  inper as (
    select v.store_id, count(*) as n
    from visits v cross join cfg
    where v.org_id = cfg.org
      and v.checkin_at >= p_from and v.checkin_at < p_to
      and v.status = 'checked_out'
    group by 1
  ),
  owners as (
    select a.store_id,
           string_agg(p.full_name, ', ' order by p.full_name) as names,
           count(*) as n
    from store_assignments a
    left join profiles p on p.id = a.rep_id
    cross join cfg
    where a.org_id = cfg.org
    group by a.store_id
  )
  select sc.id, sc.name, sc.grp, sc.city, sc.state,
         lv.last_visit_at,
         case when lv.last_visit_at is not null
              then round((extract(epoch from (p_to - lv.last_visit_at)) / 86400.0)::numeric, 1)
         end,
         coalesce(inper.n, 0),
         owners.names,
         coalesce(owners.n, 0)
  from sc
  left join lv     on lv.store_id     = sc.id
  left join inper  on inper.store_id  = sc.id
  left join owners on owners.store_id = sc.id
  order by lv.last_visit_at asc nulls first, sc.name;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727201311', 'coverage_gaps_uses_any_assignment')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 27/76  20260727201409_add_rep_detail_columns.sql
-- ──────────────────────────────────────────────────────────────────────────

-- profiles carried only name/email/role, which is not enough to manage a field
-- team: a manager needs to phone a rep, and needs a way to retire someone who
-- has left.
--
-- Deactivating rather than deleting matters here — a rep's visits, photos and
-- form submissions reference their profile, so deleting would orphan history.
alter table public.profiles
  add column if not exists phone      text,
  add column if not exists job_title  text,
  add column if not exists is_active  boolean not null default true;

comment on column public.profiles.is_active is
  'Soft delete. Deactivated reps keep their visit history but should not be assigned new work.';

-- Extend the directory with the new fields plus when they joined.
drop function if exists public.rep_directory();

create function public.rep_directory()
returns table (
  rep_id          uuid,
  rep_name        text,
  email           text,
  phone           text,
  job_title       text,
  is_active       boolean,
  joined_at       timestamptz,
  assigned_stores bigint,
  store_names     text,
  last_active_at  timestamptz,
  visits_30d      bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, now() - interval '30 days' as since
  ),
  a as (
    select sa.rep_id,
           count(*) as assigned_stores,
           string_agg(s.name, ', ' order by s.name) as store_names
    from store_assignments sa
    join stores s on s.id = sa.store_id
    cross join cfg
    where sa.org_id = cfg.org
    group by sa.rep_id
  ),
  v as (
    select vi.rep_id,
           max(vi.checkin_at) as last_active_at,
           count(*) filter (where vi.checkin_at >= cfg.since
                              and vi.status = 'checked_out') as visits_30d
    from visits vi
    cross join cfg
    where vi.org_id = cfg.org and vi.checkin_at is not null
    group by vi.rep_id
  )
  select p.id, p.full_name, p.email, p.phone, p.job_title, p.is_active,
         p.created_at,
         coalesce(a.assigned_stores, 0),
         a.store_names,
         v.last_active_at,
         coalesce(v.visits_30d, 0)
  from profiles p
  cross join cfg
  left join a on a.rep_id = p.id
  left join v on v.rep_id = p.id
  where p.org_id = cfg.org
    and p.role = 'rep'
  -- Active reps first; a retired rep should not sit at the top of the list.
  order by p.is_active desc, p.full_name;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727201409', 'add_rep_detail_columns')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 28/76  20260727202504_create_rep_delete_impact_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What a hard delete would destroy.
--
-- Every rep-owned table cascades from profiles (visits, photos,
-- form_submissions, workday_sessions, routes, location_pings,
-- store_assignments), and profiles itself cascades from auth.users. So deleting
-- a rep erases their entire history and retroactively changes every report that
-- covered it. The UI must be able to state the cost before asking to confirm.
create or replace function public.rep_delete_impact(p_rep_id uuid)
returns table (
  rep_name    text,
  visits      bigint,
  submissions bigint,
  photos      bigint,
  workdays    bigint,
  routes      bigint,
  assignments bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select
    (select p.full_name from profiles p cross join cfg
      where p.id = p_rep_id and p.org_id = cfg.org),
    (select count(*) from visits v cross join cfg
      where v.rep_id = p_rep_id and v.org_id = cfg.org),
    (select count(*) from form_submissions f cross join cfg
      where f.rep_id = p_rep_id and f.org_id = cfg.org),
    (select count(*) from photos ph cross join cfg
      where ph.rep_id = p_rep_id and ph.org_id = cfg.org),
    (select count(*) from workday_sessions w cross join cfg
      where w.rep_id = p_rep_id and w.org_id = cfg.org),
    (select count(*) from routes r cross join cfg
      where r.rep_id = p_rep_id and r.org_id = cfg.org),
    (select count(*) from store_assignments sa cross join cfg
      where sa.rep_id = p_rep_id and sa.org_id = cfg.org);
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727202504', 'create_rep_delete_impact_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 29/76  20260727203059_enforce_is_active_in_rls_helpers.sql
-- ──────────────────────────────────────────────────────────────────────────

-- is_active was cosmetic: Supabase auth does not know about the column, and
-- these helpers ignored it, so a "deactivated" rep could still sign in to the
-- mobile app and RLS still handed them their org's data.
--
-- Enforcing it here rather than in the apps is deliberate — every policy in the
-- schema already funnels through these two functions, so one change covers the
-- web dashboard, the Flutter app and any future client at once. A deactivated
-- user now gets null from both, and `org_id = null` is never true, so every
-- policy denies.
--
-- Both stay SECURITY DEFINER (they must read profiles regardless of the
-- caller's own policies) with search_path pinned.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select org_id from public.profiles
   where id = auth.uid() and is_active
$$;

create or replace function public."current_role"()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select role from public.profiles
   where id = auth.uid() and is_active
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727203059', 'enforce_is_active_in_rls_helpers')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 30/76  20260727211052_add_call_cycle.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Call cycle: how often a store is visited, and on which day of the rep's week.
--
-- Frequency sits on the STORE because it is intrinsic to the store — a
-- high-volume branch needs weekly attention regardless of who covers it, and
-- reassigning it to another rep should not lose that. The day sits on the
-- ASSIGNMENT because it only means something in the context of one rep's week.
alter table public.stores
  add column if not exists visit_frequency text not null default 'weekly';

alter table public.stores drop constraint if exists stores_visit_frequency_check;
alter table public.stores add constraint stores_visit_frequency_check
  check (visit_frequency in ('weekly', 'biweekly', 'monthly'));

alter table public.store_assignments
  add column if not exists day_of_week   smallint,
  add column if not exists week_of_cycle smallint;

alter table public.store_assignments drop constraint if exists store_assignments_day_of_week_check;
alter table public.store_assignments add constraint store_assignments_day_of_week_check
  -- ISO weekday: 1 = Monday … 7 = Sunday, matching extract(isodow).
  check (day_of_week is null or day_of_week between 1 and 7);

alter table public.store_assignments drop constraint if exists store_assignments_week_of_cycle_check;
alter table public.store_assignments add constraint store_assignments_week_of_cycle_check
  -- 1-2 for bi-weekly (week A / week B), 1-4 for monthly (nth weekday of month).
  check (week_of_cycle is null or week_of_cycle between 1 and 4);

comment on column public.store_assignments.day_of_week is
  'ISO weekday 1=Mon..7=Sun. Null means unplanned — the store will never be scheduled.';
comment on column public.store_assignments.week_of_cycle is
  'Bi-weekly: 1=week A, 2=week B (ISO week parity). Monthly: nth occurrence of that weekday in the month. Ignored when the store is weekly.';

-- The safety net for the generator.
--
-- routes had NO unique constraint of any kind, so re-running a generator would
-- silently create duplicate stops. That is not cosmetic: the Flutter app renders
-- one card per route row (identity is route.id), so the rep would see the same
-- store twice, and both schedule_adherence.planned and the app's monthly
-- completion count route rows, so the numbers would inflate.
--
-- Verified zero existing duplicates before adding this.
create unique index if not exists routes_rep_store_date_key
  on public.routes (rep_id, store_id, scheduled_date);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727211052', 'add_call_cycle')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 31/76  20260727211122_create_generate_routes_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Materialises dated `routes` rows from the call cycle.
--
-- Safe to run repeatedly: `on conflict do nothing` against
-- routes_rep_store_date_key makes it idempotent, and it never looks at a date
-- before tomorrow, so nothing already visited or in progress can be disturbed.
--
-- Creates routes ONLY, never `visits`. The schedule dialog eagerly inserts a
-- companion visit row and that is exactly what produced the fan-out bug fixed in
-- 20260727194019 — a visit belongs to a check-in, not to a plan.
create or replace function public.generate_routes(
  p_weeks   int  default 8,
  p_dry_run boolean default false
)
returns table (
  created      bigint,
  first_date   date,
  last_date    date,
  reps_covered bigint
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_org   uuid;
  v_role  text;
  v_from  date;
  v_to    date;
begin
  v_org := public.current_org_id();
  -- Quoted: current_role shadows a reserved Postgres keyword, and unquoted it
  -- silently returns the database role name instead of the profile role.
  v_role := public."current_role"();

  if v_org is null then
    raise exception 'No organisation for the current user';
  end if;
  -- The routes insert policy is manager-only. An RPC has to enforce that
  -- itself rather than assume the caller already passed a check.
  if v_role is distinct from 'manager' then
    raise exception 'Only managers can generate schedules';
  end if;

  if p_weeks < 1 or p_weeks > 52 then
    raise exception 'p_weeks must be between 1 and 52';
  end if;

  -- Start tomorrow: today may already be part-worked, and back-filling the past
  -- would invent plans that were never made.
  v_from := current_date + 1;
  v_to   := current_date + (p_weeks * 7);

  return query
  with cfg as materialized (
    select v_org as org
  ),
  cycle as (
    select sa.rep_id, sa.store_id, sa.day_of_week,
           coalesce(sa.week_of_cycle, 1) as week_of_cycle,
           s.visit_frequency,
           s.city, s.name
    from store_assignments sa
    join stores s on s.id = sa.store_id
    cross join cfg
    where sa.org_id = cfg.org
      and s.active
      and sa.day_of_week is not null
  ),
  days as (
    select d::date as day
    from generate_series(v_from, v_to, interval '1 day') d
  ),
  matched as (
    select c.rep_id, c.store_id, d.day, c.city, c.name
    from cycle c
    join days d
      on extract(isodow from d.day)::int = c.day_of_week
     and case c.visit_frequency
           when 'weekly' then true
           -- Week A / week B by ISO week parity: cycle 1 = odd weeks.
           when 'biweekly' then
             (extract(week from d.day)::int % 2) = (c.week_of_cycle % 2)
           -- nth occurrence of that weekday within the month: days 1-7 are the
           -- 1st, 8-14 the 2nd, and so on.
           when 'monthly' then
             ((extract(day from d.day)::int - 1) / 7) + 1 = c.week_of_cycle
           else false
         end
  ),
  ordered as (
    select m.*,
           -- Sequenced by city then name so a day's stops group geographically.
           -- Mobile does not read sequence_order yet, but populating it now means
           -- the eventual Dart change needs no data migration.
           row_number() over (
             partition by m.rep_id, m.day
             order by coalesce(m.city, ''), m.name
           )::int as seq
    from matched m
  ),
  ins as (
    insert into routes (org_id, rep_id, store_id, scheduled_date, sequence_order, created_by)
    select v_org, o.rep_id, o.store_id, o.day, o.seq, auth.uid()
    from ordered o
    where not p_dry_run
    on conflict (rep_id, store_id, scheduled_date) do nothing
    returning scheduled_date, rep_id
  ),
  result as (
    select * from ins
    union all
    -- Dry run: report what WOULD be created, minus anything already scheduled.
    select o.day, o.rep_id
    from ordered o
    where p_dry_run
      and not exists (
        select 1 from routes r
        where r.rep_id = o.rep_id and r.store_id = o.store_id
          and r.scheduled_date = o.day
      )
  )
  select count(*)::bigint,
         min(result.scheduled_date),
         max(result.scheduled_date),
         count(distinct result.rep_id)::bigint
  from result;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727211122', 'create_generate_routes_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 32/76  20260727214650_create_call_cycle_review_rpcs.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What the AI plan critic reads.
--
-- The manager sets the call cycle by hand; these functions describe the result
-- so a model can say what is wrong with it. Every number is computed here — the
-- model is given prose to write, never arithmetic to do.

-- The haversine formula already existed inline inside activity_feed
-- (20260727121757). Lifting it into one immutable function means there is a
-- single copy to be wrong.
--
-- `strict` is the important word: a null coordinate yields null rather than a
-- confidently wrong distance. activity_feed is deliberately left alone — it is
-- verified, and rewriting it is not part of this change.
create or replace function public.haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = public
as $$
  select round((6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 1);
$$;

comment on function public.haversine_m is
  'Straight-line metres between two points. Strict: a null coordinate returns null, never 0.';

-- One row per (rep, weekday) that actually carries stores.
--
-- The cycle / days / matched CTEs are deliberately identical to
-- generate_routes (20260727211122). The critic must review exactly the plan the
-- generator will write — if these two ever drift, the AI is commenting on a
-- schedule that does not exist.
create or replace function public.call_cycle_review(p_weeks int default 8)
returns table (
  rep_id              uuid,
  rep_name            text,
  day_of_week         smallint,
  peak_stores         int,
  avg_stores          numeric,
  occurrences         int,
  cities              text[],
  stores_without_city int,
  span_km             numeric,
  frequency_mix       jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           current_date + 1 as d_from,
           current_date + (greatest(least(coalesce(p_weeks, 8), 52), 1) * 7) as d_to
  ),
  cycle as (
    select sa.rep_id, sa.store_id, sa.day_of_week,
           coalesce(sa.week_of_cycle, 1) as week_of_cycle,
           s.visit_frequency, s.city, s.name, s.lat, s.lng
    from store_assignments sa
    join stores s on s.id = sa.store_id
    cross join cfg
    where sa.org_id = cfg.org
      and s.active
      and sa.day_of_week is not null
  ),
  days as (
    select d::date as the_day
    from cfg, generate_series(cfg.d_from, cfg.d_to, interval '1 day') d
  ),
  matched as (
    select c.rep_id, c.store_id, c.day_of_week, c.visit_frequency,
           c.city, c.name, c.lat, c.lng, d.the_day
    from cycle c
    join days d
      on extract(isodow from d.the_day)::int = c.day_of_week
     and case c.visit_frequency
           when 'weekly' then true
           when 'biweekly' then
             (extract(week from d.the_day)::int % 2) = (c.week_of_cycle % 2)
           when 'monthly' then
             ((extract(day from d.the_day)::int - 1) / 7) + 1 = c.week_of_cycle
           else false
         end
  ),
  occ as (
    select m.rep_id, m.day_of_week, m.the_day, count(*)::int as stores
    from matched m
    group by m.rep_id, m.day_of_week, m.the_day
  ),
  -- The busiest single occurrence, not the total. A rep with four monthly
  -- stores on a Tuesday is not carrying four stores every Tuesday, and a
  -- figure that said so would advise against a perfectly sensible plan.
  peak as (
    select distinct on (o.rep_id, o.day_of_week)
           o.rep_id, o.day_of_week, o.the_day as peak_day, o.stores as peak_stores
    from occ o
    order by o.rep_id, o.day_of_week, o.stores desc, o.the_day
  ),
  spread as (
    select o.rep_id, o.day_of_week,
           round(avg(o.stores)::numeric, 1) as avg_stores,
           count(*)::int as occurrences
    from occ o
    group by o.rep_id, o.day_of_week
  ),
  peak_detail as (
    select m.rep_id, m.day_of_week, m.store_id, m.city, m.lat, m.lng
    from matched m
    join peak p
      on p.rep_id = m.rep_id
     and p.day_of_week = m.day_of_week
     and p.peak_day = m.the_day
  ),
  places as (
    select d.rep_id, d.day_of_week,
           array_agg(distinct d.city) filter (where d.city is not null) as cities,
           count(*) filter (where d.city is null)::int as stores_without_city,
           count(*) filter (where d.lat is null or d.lng is null)::int as without_coords
    from peak_detail d
    group by d.rep_id, d.day_of_week
  ),
  -- Widest straight-line gap between any two stops on the peak day.
  spans as (
    select a.rep_id, a.day_of_week,
           round(max(public.haversine_m(a.lat, a.lng, b.lat, b.lng)) / 1000.0, 1) as span_km
    from peak_detail a
    join peak_detail b
      on b.rep_id = a.rep_id
     and b.day_of_week = a.day_of_week
     and b.store_id > a.store_id
    group by a.rep_id, a.day_of_week
  ),
  freq as (
    select c.rep_id, c.day_of_week,
           jsonb_object_agg(c.visit_frequency, c.n) as frequency_mix
    from (
      select cy.rep_id, cy.day_of_week, cy.visit_frequency, count(*) as n
      from cycle cy
      group by cy.rep_id, cy.day_of_week, cy.visit_frequency
    ) c
    group by c.rep_id, c.day_of_week
  )
  select p.rep_id,
         pr.full_name,
         p.day_of_week,
         p.peak_stores,
         sp.avg_stores,
         sp.occurrences,
         coalesce(pl.cities, '{}'::text[]),
         pl.stores_without_city,
         -- Null, never 0, when any stop that day has no coordinates: a zero
         -- would read as "these stores are all in the same place", which is the
         -- most misleading thing this function could say. A genuine single-stop
         -- day is 0 — there is no travel between stops.
         case
           when pl.without_coords > 0 then null
           when p.peak_stores = 1 then 0
           else s.span_km
         end,
         f.frequency_mix
  from peak p
  join profiles pr on pr.id = p.rep_id
  join spread sp on sp.rep_id = p.rep_id and sp.day_of_week = p.day_of_week
  left join places pl on pl.rep_id = p.rep_id and pl.day_of_week = p.day_of_week
  left join spans s on s.rep_id = p.rep_id and s.day_of_week = p.day_of_week
  left join freq f on f.rep_id = p.rep_id and f.day_of_week = p.day_of_week
  order by pr.full_name, p.day_of_week;
$$;

comment on function public.call_cycle_review is
  'Per (rep, weekday) call-cycle load over a rolling horizon. Figures are the busiest single occurrence, matching generate_routes.';

-- Everything the plan is missing, in one row.
--
-- call_cycle_review only returns days that carry stores, so on its own it would
-- silently omit exactly the problems worth reporting: a rep with stores but no
-- days, and stores nobody covers at all.
create or replace function public.call_cycle_gaps()
returns table (
  stores_active            int,
  stores_unassigned        int,
  unassigned_store_names   text[],
  stores_without_city      int,
  stores_without_coords    int,
  unplanned_assignments    int,
  unplanned_by_rep         jsonb,
  reps_active              int,
  reps_without_stores      int,
  reps_without_stores_names text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  s as (
    select st.* from stores st cross join cfg
    where st.org_id = cfg.org and st.active
  ),
  r as (
    select p.id, p.full_name from profiles p cross join cfg
    where p.org_id = cfg.org and p.role = 'rep' and p.is_active
  ),
  unassigned as (
    select s.id, s.name from s
    where not exists (select 1 from store_assignments sa where sa.store_id = s.id)
  ),
  unplanned as (
    select sa.rep_id, count(*)::int as n
    from store_assignments sa
    join s on s.id = sa.store_id
    where sa.day_of_week is null
    group by sa.rep_id
  ),
  bare_reps as (
    select r.id, r.full_name from r
    where not exists (select 1 from store_assignments sa where sa.rep_id = r.id)
  )
  select (select count(*)::int from s),
         (select count(*)::int from unassigned),
         -- Capped: the point is that they exist, and a 200-name array would
         -- dominate the prompt for no extra insight.
         (select coalesce(array_agg(u.name order by u.name), '{}'::text[])
          from (select name from unassigned order by name limit 25) u),
         (select count(*)::int from s where s.city is null),
         (select count(*)::int from s where s.lat is null or s.lng is null),
         (select coalesce(sum(n), 0)::int from unplanned),
         (select coalesce(jsonb_object_agg(coalesce(pr.full_name, 'Unknown'), u.n), '{}'::jsonb)
          from unplanned u join profiles pr on pr.id = u.rep_id),
         (select count(*)::int from r),
         (select count(*)::int from bare_reps),
         (select coalesce(array_agg(b.full_name order by b.full_name), '{}'::text[]) from bare_reps b);
$$;

comment on function public.call_cycle_gaps is
  'Org-level call-cycle gaps: stores nobody covers, assignments with no day, and missing location data.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727214650', 'create_call_cycle_review_rpcs')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 33/76  20260728144922_create_store_last_visit_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Last visit per store, for the Stores list.
--
-- One aggregate rather than pulling `visits` to the browser: that table grows
-- faster than any other here (~583 check-in/out events already) and the store
-- list would otherwise download all of it just to find a maximum per row.
--
-- `current_org_id()` is materialised into a CTE so the planner sees a literal
-- and uses visits_org_checkin_at_idx.
create or replace function public.store_last_visit()
returns table (
  store_id      uuid,
  last_visit_at timestamptz,
  visits_total  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select v.store_id, max(v.checkin_at), count(*)::bigint
  from visits v
  cross join cfg
  where v.org_id = cfg.org
    and v.checkin_at is not null
  group by v.store_id;
$$;

comment on function public.store_last_visit is
  'Last check-in and total visits per store. Stores never visited simply have no row.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728144922', 'create_store_last_visit_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 34/76  20260728145421_create_store_delete_impact_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What deleting a store would destroy.
--
-- `visits`, `routes` and `store_assignments` all cascade from stores, and
-- form_submissions and photos cascade from visits in turn. So deleting a store
-- silently erases every audit ever done there and retroactively changes every
-- report covering those dates — the same trap rep_delete_impact exists for
-- (20260727202504), and the UI has to be able to state the cost first.
--
-- Deactivating is the right call in almost every real case: it keeps the
-- history and simply stops the store appearing on new routes.
create or replace function public.store_delete_impact(p_store_id uuid)
returns table (
  store_name  text,
  visits      bigint,
  submissions bigint,
  photos      bigint,
  routes      bigint,
  assignments bigint,
  reps        bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select
    (select s.name from stores s cross join cfg
      where s.id = p_store_id and s.org_id = cfg.org),
    (select count(*) from visits v cross join cfg
      where v.store_id = p_store_id and v.org_id = cfg.org),
    (select count(*) from form_submissions f cross join cfg
      join visits v on v.id = f.visit_id
      where v.store_id = p_store_id and f.org_id = cfg.org),
    (select count(*) from photos ph cross join cfg
      join visits v on v.id = ph.visit_id
      where v.store_id = p_store_id and ph.org_id = cfg.org),
    (select count(*) from routes r cross join cfg
      where r.store_id = p_store_id and r.org_id = cfg.org),
    (select count(*) from store_assignments sa cross join cfg
      where sa.store_id = p_store_id and sa.org_id = cfg.org),
    -- How many reps lose a store from their patch.
    (select count(distinct sa.rep_id) from store_assignments sa cross join cfg
      where sa.store_id = p_store_id and sa.org_id = cfg.org);
$$;

comment on function public.store_delete_impact is
  'Rows a hard store delete would cascade away. Shown before confirming; deactivating keeps history instead.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728145421', 'create_store_delete_impact_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 35/76  20260728170616_add_org_capacity_settings.sql
-- ──────────────────────────────────────────────────────────────────────────

-- How much work one rep-day holds, per organisation.
--
-- These were constants in the web app (FULL_DAY_STORES = 6). That is fine for
-- one customer and wrong for the next: a merchandiser covering small kiosks
-- fits far more stops in a day than one covering hypermarkets, and an estate
-- that works Saturdays has a different week. The call cycle, the load strip,
-- the capacity meter and the AI critic all key off these, so they belong with
-- the organisation rather than in the bundle.
alter table public.organizations
  add column if not exists stores_per_day int not null default 8,
  add column if not exists working_days smallint[] not null default '{1,2,3,4,5}',
  add column if not exists default_visit_frequency text not null default 'monthly';

alter table public.organizations drop constraint if exists organizations_stores_per_day_check;
alter table public.organizations add constraint organizations_stores_per_day_check
  check (stores_per_day between 1 and 50);

alter table public.organizations drop constraint if exists organizations_working_days_check;
alter table public.organizations add constraint organizations_working_days_check
  -- ISO weekdays, 1 = Monday .. 7 = Sunday, matching extract(isodow) and the
  -- day_of_week on store_assignments. At least one day, or nothing can ever be
  -- scheduled.
  check (
    array_length(working_days, 1) between 1 and 7
    and working_days <@ array[1,2,3,4,5,6,7]::smallint[]
  );

alter table public.organizations drop constraint if exists organizations_default_frequency_check;
alter table public.organizations add constraint organizations_default_frequency_check
  check (default_visit_frequency in ('weekly', 'biweekly', 'monthly'));

comment on column public.organizations.stores_per_day is
  'Stops one rep can realistically make in a day. Drives capacity, the load strip and the auto-spread.';
comment on column public.organizations.working_days is
  'ISO weekdays the team works. 1=Mon..7=Sun.';
comment on column public.organizations.default_visit_frequency is
  'Applied to newly imported stores, so a bulk import does not silently default everything to weekly.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728170616', 'add_org_capacity_settings')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 36/76  20260728184637_generate_routes_retracts_stale.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Where a route came from, so re-generating can clean up after itself.
--
-- Until now generate_routes only ever added (`on conflict do nothing`). Change
-- a store's day and the old dated routes stayed behind: after one re-plan, 139
-- of 204 future routes no longer matched the cycle, and reps would still have
-- seen every one of them. That is worse under hand-built schedules than
-- automatic ones, because the manager changes days one at a time.
--
-- Cleanup has to distinguish the generator's own output from a stop somebody
-- added deliberately, or "Add stop" on the day board would be undone by the
-- next generate. Existing rows are marked 'cycle' because they came from the
-- generator; only the day-board dialog writes 'manual'.
alter table public.routes
  add column if not exists source text not null default 'cycle';

alter table public.routes drop constraint if exists routes_source_check;
alter table public.routes add constraint routes_source_check
  check (source in ('cycle', 'manual'));

comment on column public.routes.source is
  'cycle = written by generate_routes and safe for it to retract; manual = added by hand, never touched.';

-- Return type changes, so this cannot be a CREATE OR REPLACE.
drop function if exists public.generate_routes(int, boolean);

create or replace function public.generate_routes(
  p_weeks   int  default 8,
  p_dry_run boolean default false
)
returns table (
  created      bigint,
  removed      bigint,
  first_date   date,
  last_date    date,
  reps_covered bigint
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_org   uuid;
  v_role  text;
  v_from  date;
  v_to    date;
begin
  v_org := public.current_org_id();
  -- Quoted: current_role shadows a reserved Postgres keyword, and unquoted it
  -- silently returns the database role name instead of the profile role.
  v_role := public."current_role"();

  if v_org is null then
    raise exception 'No organisation for the current user';
  end if;
  if v_role is distinct from 'manager' then
    raise exception 'Only managers can generate schedules';
  end if;
  if p_weeks < 1 or p_weeks > 52 then
    raise exception 'p_weeks must be between 1 and 52';
  end if;

  -- Start tomorrow: today may already be part-worked, and back-filling the past
  -- would invent plans that were never made.
  v_from := current_date + 1;
  v_to   := current_date + (p_weeks * 7);

  return query
  with cfg as materialized (
    select v_org as org
  ),
  cycle as (
    select sa.rep_id, sa.store_id, sa.day_of_week,
           coalesce(sa.week_of_cycle, 1) as week_of_cycle,
           s.visit_frequency,
           s.city, s.name
    from store_assignments sa
    join stores s on s.id = sa.store_id
    cross join cfg
    where sa.org_id = cfg.org
      and s.active
      and sa.day_of_week is not null
  ),
  days as (
    select d::date as day
    from generate_series(v_from, v_to, interval '1 day') d
  ),
  matched as (
    select c.rep_id, c.store_id, d.day, c.city, c.name
    from cycle c
    join days d
      on extract(isodow from d.day)::int = c.day_of_week
     and case c.visit_frequency
           when 'weekly' then true
           when 'biweekly' then
             (extract(week from d.day)::int % 2) = (c.week_of_cycle % 2)
           when 'monthly' then
             ((extract(day from d.day)::int - 1) / 7) + 1 = c.week_of_cycle
           else false
         end
  ),
  ordered as (
    select m.*,
           row_number() over (
             partition by m.rep_id, m.day
             order by coalesce(m.city, ''), m.name
           )::int as seq
    from matched m
  ),
  -- Future cycle-built routes the call cycle no longer calls for. Deliberately
  -- not limited to the horizon: a route stops being valid the moment the cycle
  -- changes, whenever it falls. Never touches the past, anything a rep has
  -- already checked into, or a hand-added stop.
  stale as (
    select r.id
    from routes r
    cross join cfg
    where r.org_id = cfg.org
      and r.scheduled_date > current_date
      and r.source = 'cycle'
      and not exists (select 1 from visits v where v.route_id = r.id)
      and not exists (
        select 1 from cycle c
        where c.rep_id = r.rep_id
          and c.store_id = r.store_id
          and c.day_of_week = extract(isodow from r.scheduled_date)::int
          and case c.visit_frequency
                when 'weekly' then true
                when 'biweekly' then
                  (extract(week from r.scheduled_date)::int % 2) = (c.week_of_cycle % 2)
                when 'monthly' then
                  ((extract(day from r.scheduled_date)::int - 1) / 7) + 1 = c.week_of_cycle
                else false
              end
      )
  ),
  del as (
    delete from routes
    where id in (select id from stale) and not p_dry_run
    returning 1 as gone
  ),
  ins as (
    insert into routes (org_id, rep_id, store_id, scheduled_date, sequence_order, created_by, source)
    select v_org, o.rep_id, o.store_id, o.day, o.seq, auth.uid(), 'cycle'
    from ordered o
    where not p_dry_run
    on conflict (rep_id, store_id, scheduled_date) do nothing
    returning scheduled_date, rep_id
  ),
  result as (
    select * from ins
    union all
    select o.day, o.rep_id
    from ordered o
    where p_dry_run
      and not exists (
        select 1 from routes r
        where r.rep_id = o.rep_id and r.store_id = o.store_id
          and r.scheduled_date = o.day
      )
  )
  select count(*)::bigint,
         -- On a dry run nothing is deleted, so report what would go.
         case when p_dry_run
              then (select count(*)::bigint from stale)
              else (select count(*)::bigint from del)
         end,
         min(result.scheduled_date),
         max(result.scheduled_date),
         count(distinct result.rep_id)::bigint
  from result;
end;
$$;

comment on function public.generate_routes is
  'Materialises routes from the call cycle and retracts future cycle-built routes it no longer calls for. Never touches the past, checked-in visits, or manual stops.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728184637', 'generate_routes_retracts_stale')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 37/76  20260728190255_create_files.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Shared documents: planograms, price lists, notices.
--
-- These currently reach reps over WhatsApp, where nobody can tell which copy is
-- current. The point of this table is not storage — it is deciding who may see
-- what, in one place that both the app and Supabase Storage obey.
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  description  text,
  -- Matches storage.objects.name exactly. The storage policy joins on it, so a
  -- mismatch means an unreadable file rather than a leaked one.
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint,
  audience     text not null default 'everyone',
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.files drop constraint if exists files_audience_check;
alter table public.files add constraint files_audience_check
  check (audience in ('everyone', 'reps', 'groups'));

-- Named reps, when audience = 'reps'.
create table if not exists public.file_reps (
  file_id uuid not null references public.files(id) on delete cascade,
  rep_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (file_id, rep_id)
);

-- Retail chains, when audience = 'groups'. Reps inherit access from the stores
-- they cover, so moving a store between reps moves the file access with it and
-- nobody has to remember to re-share a planogram.
create table if not exists public.file_groups (
  file_id        uuid not null references public.files(id) on delete cascade,
  store_group_id uuid not null references public.store_groups(id) on delete cascade,
  primary key (file_id, store_group_id)
);

create index if not exists files_org_created_idx on public.files (org_id, created_at desc);
create index if not exists file_reps_rep_idx on public.file_reps (rep_id);
create index if not exists file_groups_group_idx on public.file_groups (store_group_id);

alter table public.files enable row level security;
alter table public.file_reps enable row level security;
alter table public.file_groups enable row level security;

-- The single entitlement rule. Storage inherits it rather than restating it,
-- so there is no second copy to drift out of step.
--
-- Constrains the row under test instead of sub-selecting `files`, so there is
-- no policy recursion. auth.uid() is wrapped in a scalar subquery so the
-- planner evaluates it once per statement rather than per row.
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) = 'manager'
      or audience = 'everyone'
      or (audience = 'reps' and exists (
            select 1 from public.file_reps fr
            where fr.file_id = files.id and fr.rep_id = (select auth.uid())))
      or (audience = 'groups' and exists (
            select 1 from public.file_groups fg
            join public.stores s on s.store_group_id = fg.store_group_id
            join public.store_assignments sa on sa.store_id = s.id
            where fg.file_id = files.id and sa.rep_id = (select auth.uid())))
    )
  );

drop policy if exists files_insert on public.files;
create policy files_insert on public.files
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_update on public.files;
create policy files_update on public.files
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

-- The join tables are readable to anyone who can read the parent file, and
-- writable only by managers. Reading them leaks nothing on its own: knowing a
-- file id is shared with a rep is meaningless without access to the file.
drop policy if exists file_reps_select on public.file_reps;
create policy file_reps_select on public.file_reps
  for select using (
    exists (select 1 from public.files f where f.id = file_reps.file_id)
  );

drop policy if exists file_reps_write on public.file_reps;
create policy file_reps_write on public.file_reps
  for all using (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_reps.file_id and f.org_id = (select public.current_org_id())
    )
  ) with check (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_reps.file_id and f.org_id = (select public.current_org_id())
    )
  );

drop policy if exists file_groups_select on public.file_groups;
create policy file_groups_select on public.file_groups
  for select using (
    exists (select 1 from public.files f where f.id = file_groups.file_id)
  );

drop policy if exists file_groups_write on public.file_groups;
create policy file_groups_write on public.file_groups
  for all using (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_groups.file_id and f.org_id = (select public.current_org_id())
    )
  ) with check (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_groups.file_id and f.org_id = (select public.current_org_id())
    )
  );

comment on table public.files is
  'Shared documents. `audience` decides visibility; storage.objects policies join on storage_path so the rule is enforced once.';
comment on column public.files.audience is
  'everyone = all org members; reps = the named reps in file_reps; groups = reps covering any store in the chains in file_groups.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728190255', 'create_files')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 38/76  20260728190322_create_files_bucket.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Private bucket for shared documents. Paths are org_id/file_id/filename.
--
-- 25 MB ceiling: reps open these on mobile data, and a planogram that costs
-- someone a chunk of their bundle is a planogram they will not open.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'files', 'files', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading an object is allowed exactly when the caller can read its `files`
-- row. That `exists` runs under the caller's own RLS, so an unentitled rep
-- finds nothing and cannot sign the object — the entitlement rule lives in
-- public.files alone and this inherits it.
--
-- Without this, hiding a file in the UI would be theatre: any authenticated
-- rep could mint a signed URL for a path they guessed.
drop policy if exists files_read on storage.objects;
create policy files_read on storage.objects
  for select using (
    bucket_id = 'files'
    -- Defence in depth: even a bug in the join cannot cross an org boundary.
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and exists (
      select 1 from public.files f where f.storage_path = storage.objects.name
    )
  );

drop policy if exists files_insert on storage.objects;
create policy files_insert on storage.objects
  for insert with check (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_update on storage.objects;
create policy files_update on storage.objects
  for update using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_delete on storage.objects;
create policy files_delete on storage.objects
  for delete using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728190322', 'create_files_bucket')
on conflict (version) do nothing;

commit;
