-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 6 OF 7
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260729152435_create_rate_limiter.sql
--    .. through 20260730111738_fix_leads_follow_up_index_predicate.sql
--
-- Run the chunks in order. If one fails, do NOT re-run it blind —
-- open 99_resume.sql and ask the database what actually landed.
-- ──────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────
-- 55/71  20260729152435_create_rate_limiter.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Server-side rate limiting for the operations that cost money.
--
-- Three routes reach a paid third party on behalf of a signed-in user, with no
-- ceiling of any kind today:
--
--   /api/geocode   — Google Places text search, then Geocoding as a fallback,
--                    once per store, up to 25 stores a request
--   /api/insights  — OpenAI gpt-5.5, a long prompt with the estate in it
--   /api/reps/invite — creates an auth user
--
-- Any authenticated rep can call these in a loop. The bill is the customer's.
--
-- Counting lives in Postgres rather than in the Next.js process because the
-- process is not a reliable place to keep a counter: serverless instances come
-- and go, several can run at once, and an in-memory tally resets on every cold
-- start. `insert … on conflict … do update` is atomic, so two simultaneous
-- requests cannot both read "9 of 10" and both proceed.

create table if not exists public.rate_limits (
  bucket       text        not null,
  -- Usually a user id. Kept as text so an IP or an org can share the table if
  -- an unauthenticated endpoint ever appears.
  subject      text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (bucket, subject, window_start)
);

-- Old windows are dead weight; this makes the sweep cheap.
create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

-- RLS on with **no policies at all**. Deny by default is the whole point: a
-- user must never be able to read their own counter, reset it, or raise a
-- limit. Only the SECURITY DEFINER function below touches this table.
alter table public.rate_limits enable row level security;

revoke all on public.rate_limits from authenticated, anon;

comment on table public.rate_limits is
  'Fixed-window counters for expensive operations. Deliberately has RLS enabled and zero policies — nothing but consume_rate_limit() may read or write it, so a user cannot inspect or reset their own quota.';

/**
 * Consumes [p_cost] units from a caller's window and says whether to proceed.
 *
 * Fixed window rather than sliding: a sliding window needs the timestamps of
 * individual events, which is more data and more contention for no benefit at
 * these limits. The cost is that a caller can spend a full window's budget at
 * the end of one window and again at the start of the next; for "don't run up
 * a Google bill" that is entirely acceptable.
 *
 * Returns `{allowed, remaining, retry_after_seconds}`. The caller turns a false
 * into an HTTP 429 with `Retry-After`.
 */
create or replace function public.consume_rate_limit(
  p_bucket          text,
  p_limit           int,
  p_window_seconds  int,
  p_cost            int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_start   timestamptz;
  v_count   int;
begin
  -- Identity comes from the verified token, never from an argument. If the
  -- caller could name their own subject they could simply use a fresh one for
  -- every request.
  v_subject := coalesce(auth.uid()::text, '');
  if v_subject = '' then
    raise exception 'Rate limiting requires an authenticated caller.'
      using errcode = '42501';
  end if;

  if p_limit <= 0 or p_window_seconds <= 0 or p_cost <= 0 then
    raise exception 'Invalid rate limit parameters.' using errcode = '22023';
  end if;

  -- Floor the clock to the window so every caller in the same window shares a
  -- row and the primary key does the locking for us.
  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, subject, window_start, count)
  values (p_bucket, v_subject, v_start, p_cost)
  on conflict (bucket, subject, window_start)
    do update set count = public.rate_limits.count + p_cost
  returning count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'retry_after_seconds',
      ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int
  );
end;
$$;

comment on function public.consume_rate_limit is
  'Atomically consumes quota for the authenticated caller and reports whether to proceed. The subject is taken from auth.uid(), never from an argument, so a caller cannot spread their usage across identities.';

revoke all on function public.consume_rate_limit(text, int, int, int) from public, anon;
grant execute on function public.consume_rate_limit(text, int, int, int) to authenticated;

/**
 * Drops windows nobody can still be inside.
 *
 * Not scheduled — pg_cron is not enabled on this project. Called opportunistically
 * from the limiter's callers; a day of rows is a handful of kilobytes, so this
 * is housekeeping rather than anything load-bearing.
 */
create or replace function public.prune_rate_limits()
returns int
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.rate_limits
     where window_start < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.prune_rate_limits() from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729152435', 'create_rate_limiter')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 56/71  20260729160120_create_security_audit_log.sql
-- ──────────────────────────────────────────────────────────────────────────

-- An audit trail for the changes that decide who can see what.
--
-- Nothing recorded a role change, a deactivation or a store moving between reps.
-- Those are exactly the events you need after the fact — "who gave this person
-- manager?" is unanswerable today, and the escalation hole closed in
-- 20260729171447 means it was a question worth being able to answer.
--
-- Written by triggers rather than by application code, deliberately. Code that
-- remembers to log is code that eventually forgets, and both the web app and
-- the service-role routes write to these tables — a trigger catches every path
-- including direct SQL.

create table if not exists public.security_events (
  id           bigint generated always as identity primary key,
  org_id       uuid,
  -- Null when the change came from the service role or direct SQL, which is
  -- itself worth knowing: it means it did not come from a signed-in person.
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  subject_type text not null,
  subject_id   uuid,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists security_events_org_time_idx
  on public.security_events (org_id, created_at desc);
create index if not exists security_events_subject_idx
  on public.security_events (subject_type, subject_id);

alter table public.security_events enable row level security;

-- Managers read their own organisation's trail. Nobody writes through the API:
-- there is no INSERT, UPDATE or DELETE policy, so the only way a row appears is
-- a trigger, and the only way one changes is direct SQL by an administrator.
-- An audit log a user can edit is not an audit log.
create policy security_events_select on public.security_events
  for select using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

revoke insert, update, delete on public.security_events from authenticated, anon;

comment on table public.security_events is
  'Append-only trail of permission-relevant changes. Written by triggers so no code path can forget; readable by managers in the same org; not writable through the API by anyone.';

/**
 * Records changes to the fields that decide access.
 *
 * Only fires on the three that matter — role, is_active and org_id. Ordinary
 * profile edits (name, phone, job title) are noise here and would bury the
 * events worth finding.
 */
create or replace function public.log_profile_security_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.role is distinct from old.role then
    v_changes := v_changes || jsonb_build_object('role',
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.is_active is distinct from old.is_active then
    v_changes := v_changes || jsonb_build_object('is_active',
      jsonb_build_object('from', old.is_active, 'to', new.is_active));
  end if;
  if new.org_id is distinct from old.org_id then
    v_changes := v_changes || jsonb_build_object('org_id',
      jsonb_build_object('from', old.org_id, 'to', new.org_id));
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (
    coalesce(new.org_id, old.org_id),
    auth.uid(),
    'profile.permissions_changed',
    'profile',
    new.id,
    v_changes || jsonb_build_object(
      'subject_name', new.full_name,
      -- Names the connection role, so a change made with the service key is
      -- distinguishable from one made by a signed-in manager.
      'via', current_user
    )
  );
  return new;
end;
$$;

drop trigger if exists profiles_log_security_change on public.profiles;
create trigger profiles_log_security_change
  after update on public.profiles
  for each row execute function public.log_profile_security_change();

/**
 * Records a store moving into or out of a rep's patch.
 *
 * Coverage decides which files a rep can see through the chain audience, so an
 * assignment is a permission change as much as a scheduling one.
 */
create or replace function public.log_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  v_row := coalesce(new, old);
  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (
    v_row.org_id,
    auth.uid(),
    case when tg_op = 'INSERT' then 'store.assigned' else 'store.unassigned' end,
    'store',
    v_row.store_id,
    jsonb_build_object('rep_id', v_row.rep_id, 'via', current_user)
  );
  return v_row;
end;
$$;

drop trigger if exists store_assignments_log_change on public.store_assignments;
create trigger store_assignments_log_change
  after insert or delete on public.store_assignments
  for each row execute function public.log_assignment_change();

comment on function public.log_profile_security_change is
  'Audit trigger. Fires only for role, is_active and org_id — the fields that decide access. Ordinary profile edits would bury the events worth finding.';
comment on function public.log_assignment_change is
  'Audit trigger for store coverage, which is a permission change as much as a scheduling one: chain-audience files follow the stores a rep covers.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729160120', 'create_security_audit_log')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 57/71  20260729161113_create_service_flags.sql
-- ──────────────────────────────────────────────────────────────────────────

-- An off switch for the expensive features, separate from the app's own health.
--
-- The rate limiter caps what any one user can spend. It does nothing about a
-- bill that is climbing for a reason nobody has diagnosed yet — a loop in a
-- client, a price change at a provider, or a key that has leaked and is being
-- used somewhere the referrer restriction does not cover.
--
-- The response to that should not be "take the product down". A rep in a shop
-- still needs to check in, and none of that costs anything. This lets the
-- paid features be switched off on their own, in seconds, without a deploy.
--
-- One row, global. Deliberately **not** per-organisation: this is an operator
-- control for whoever runs the service and pays the providers, not a customer
-- setting. A customer switching off their own geocoding is a product feature
-- and can be added separately if it is ever wanted.

create table if not exists public.service_flags (
  -- Enforced singleton: one row, always id = 1.
  id                bool primary key default true,
  geocoding_enabled boolean not null default true,
  insights_enabled  boolean not null default true,
  -- Shown to the user instead of a bare failure, so a switched-off feature
  -- reads as a decision rather than a bug.
  notice            text,
  updated_at        timestamptz not null default now(),
  constraint service_flags_singleton check (id)
);

insert into public.service_flags (id) values (true)
on conflict (id) do nothing;

alter table public.service_flags enable row level security;

-- Everyone signed in may read, so the UI can explain itself. Nobody may write
-- through the API — flipping a flag is a service-role act, done from the
-- Supabase SQL editor in a hurry, and a customer must not be able to turn a
-- feature back on that the operator has just switched off.
create policy service_flags_select on public.service_flags
  for select to authenticated using (true);

revoke insert, update, delete on public.service_flags from authenticated, anon;

comment on table public.service_flags is
  'Operator kill switches for features that cost money per use. Readable by any signed-in user so the UI can explain why something is off; writable only with the service role. To switch insights off: update public.service_flags set insights_enabled = false, notice = ''…'';';

/**
 * Reads a flag by name, defaulting to on.
 *
 * Defaulting to *on* is deliberate: if this table is somehow missing or
 * unreadable, the product keeps working. A kill switch that fails closed would
 * turn a small operational problem into an outage, which is the opposite of
 * what it is for.
 */
create or replace function public.service_flag(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case p_name
      when 'geocoding' then (select geocoding_enabled from service_flags where id)
      when 'insights'  then (select insights_enabled  from service_flags where id)
      else true
    end,
    true
  );
$$;

grant execute on function public.service_flag(text) to authenticated;

comment on function public.service_flag is
  'True when a paid feature is enabled. Defaults to true on any doubt — a kill switch that fails closed turns an operational problem into an outage.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729161113', 'create_service_flags')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 58/71  20260730065510_create_territories.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Territories: a per-organisation, two-level geography.
--
-- A main territory is normally a city, town or region; a sub-territory divides
-- one up ("Gaborone" → "Gaborone North"). Nothing here is hardcoded — every
-- name belongs to one organisation and is invisible to the others, because the
-- next customer's estate is a different set of towns entirely.
--
-- This replaces `stores.territory`, a free-text column that was dropped from
-- the UI on 27 July because nobody filled it in. It is filled on 0 of 209 rows,
-- so it is removed here rather than left to be confused with the real thing.

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Null means this is a main territory. A sub-territory points at its main.
  parent_id uuid references public.territories(id) on delete restrict,
  name text not null,
  -- Deactivating keeps the history a store or a route already refers to;
  -- deleting is for genuine mistakes and is guarded separately.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.territories is
  'Two-level sales geography, scoped to one organisation. parent_id null = main territory.';

-- Names are unique within their level, case-insensitively: "Gaborone North"
-- and "gaborone north" in the same parent are the same place typed twice.
create unique index territories_main_name_idx
  on public.territories (org_id, lower(name))
  where parent_id is null;

create unique index territories_sub_name_idx
  on public.territories (parent_id, lower(name))
  where parent_id is not null;

create index territories_org_parent_idx on public.territories (org_id, parent_id);

/**
 * Keeps the tree two deep and inside one organisation.
 *
 * A check constraint cannot see another row, so this has to be a trigger. Both
 * rules matter: a sub-territory of a sub-territory would break every "main →
 * subs" query in the app, and a parent in another organisation would be a hole
 * straight through tenancy.
 */
create or replace function public.territories_enforce_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.territories;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.';
  end if;

  select * into v_parent from public.territories where id = new.parent_id;

  if v_parent is null then
    raise exception 'That parent territory does not exist.';
  end if;
  if v_parent.org_id <> new.org_id then
    raise exception 'A sub-territory must belong to the same organisation as its main territory.';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'Territories are two levels deep: % is already a sub-territory.', v_parent.name;
  end if;

  return new;
end;
$$;

create trigger territories_shape
before insert or update on public.territories
for each row execute function public.territories_enforce_shape();

-- Which reps cover which territory. A rep may cover several, and a territory
-- may be shared — the same arrangement store_assignments already allows.
create table public.territory_reps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (territory_id, rep_id)
);

comment on table public.territory_reps is
  'Which reps cover which territory or sub-territory.';

create index territory_reps_rep_idx on public.territory_reps (rep_id);

-- A store sits in a main territory and, optionally, one of its sub-territories.
--
-- ON DELETE RESTRICT rather than SET NULL: silently unassigning every store in
-- a territory is exactly the outcome the brief asks to be warned about, so the
-- database refuses and the UI has to say what will happen first.
alter table public.stores
  add column territory_id uuid references public.territories(id) on delete restrict,
  add column sub_territory_id uuid references public.territories(id) on delete restrict;

create index stores_territory_idx on public.stores (territory_id);
create index stores_sub_territory_idx on public.stores (sub_territory_id);

/**
 * A store's two territory columns have to agree with each other.
 *
 * Storing both is deliberate — every filter and report reads "main" far more
 * often than it walks up a parent chain — but two columns can disagree, so the
 * relationship between them is enforced here rather than trusted.
 */
create or replace function public.stores_enforce_territory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_main public.territories;
  v_sub public.territories;
begin
  if new.territory_id is null and new.sub_territory_id is null then
    return new;
  end if;

  if new.territory_id is null and new.sub_territory_id is not null then
    raise exception 'A store in a sub-territory must also carry its main territory.';
  end if;

  select * into v_main from public.territories where id = new.territory_id;
  if v_main is null then
    raise exception 'That territory does not exist.';
  end if;
  if v_main.org_id <> new.org_id then
    raise exception 'A store can only belong to its own organisation''s territories.';
  end if;
  if v_main.parent_id is not null then
    raise exception '% is a sub-territory, not a main territory.', v_main.name;
  end if;

  if new.sub_territory_id is not null then
    select * into v_sub from public.territories where id = new.sub_territory_id;
    if v_sub is null then
      raise exception 'That sub-territory does not exist.';
    end if;
    if v_sub.parent_id is distinct from new.territory_id then
      raise exception '% is not inside %.', v_sub.name, v_main.name;
    end if;
  end if;

  return new;
end;
$$;

create trigger stores_territory_shape
before insert or update of territory_id, sub_territory_id, org_id on public.stores
for each row execute function public.stores_enforce_territory();

-- ------------------------------------------------------------------ RLS

alter table public.territories enable row level security;
alter table public.territory_reps enable row level security;

-- Everyone in the organisation reads the territory list: a rep's schedule and
-- store list are described in terms of it. Only a manager changes it.
create policy territories_select on public.territories
  for select using (org_id = (select public.current_org_id()));

create policy territories_insert on public.territories
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy territories_update on public.territories
  for update using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy territories_delete on public.territories
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

-- A rep sees their own coverage; a manager sees the whole team's. Mirrors
-- store_assignments, which answers the same question about stores.
create policy territory_reps_select on public.territory_reps
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'manager'
      or rep_id = (select auth.uid())
    )
  );

create policy territory_reps_insert on public.territory_reps
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy territory_reps_delete on public.territory_reps
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

-- ------------------------------------------------------- seed from the estate

-- Every organisation's own towns become its main territories, and its stores
-- are placed in them. Derived from data rather than from a list of names, so
-- this is correct for the next customer's estate too. Organisations with no
-- stores get nothing.
insert into public.territories (org_id, name)
select distinct s.org_id, btrim(s.city)
from public.stores s
where s.city is not null and btrim(s.city) <> ''
on conflict do nothing;

update public.stores s
set territory_id = t.id
from public.territories t
where t.org_id = s.org_id
  and t.parent_id is null
  and lower(t.name) = lower(btrim(s.city))
  and s.city is not null
  and s.territory_id is null;

-- The free-text column this replaces. Confirmed empty before dropping.
alter table public.stores drop column territory;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730065510', 'create_territories')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 59/71  20260730072204_create_leads.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Sales visits to prospects, and the pipeline they feed.
--
-- A scheduled visit and an unscheduled store check-in are both about a store
-- that already exists: they carry a store_id, a geofence and a form. This is
-- the other kind of call — walking into a shop that stocks nothing of ours to
-- ask for a listing. There is no store row to point at, because the whole
-- point is that it is not a customer yet.
--
-- One row is both the visit and the lead it produces. The rep fills the top
-- half on the way in (who, why) and the bottom half on the way out (what
-- happened, what next); the manager then moves it through the pipeline. A
-- separate leads table would have to be kept in step with the visit that
-- created it, for a pipeline that is currently one card per call.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,

  -- Recorded on the way in.
  company_name text not null,
  purpose text not null,
  contact_name text,
  contact_phone text,

  -- Recorded on the way out.
  outcome text,
  notes text,
  follow_up_required boolean not null default false,
  follow_up_on date,

  -- Where the pipeline has got to. Free movement between stages: a lead can go
  -- back to Contacted after a failed follow-up, so this is not a one-way ladder.
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'follow_up', 'converted', 'lost')),

  -- 'in_progress' until the rep closes it off, so an abandoned call is visible
  -- as an abandoned call rather than as a lead with no outcome.
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,

  -- The offline idempotency key every rep-writable table here uses: the sync
  -- upserts on it, so replaying a call whose acknowledgement was lost cannot
  -- create the lead twice.
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

comment on table public.leads is
  'Unscheduled sales visits to prospects, and the pipeline stage each one is at.';

create index leads_org_stage_idx on public.leads (org_id, stage);
create index leads_rep_idx on public.leads (rep_id, started_at desc);
-- The "what is due" query the follow-up view will ask.
create index leads_follow_up_idx on public.leads (org_id, follow_up_on)
  where follow_up_required and status = 'completed';

/**
 * A follow-up date only means something when a follow-up was asked for.
 *
 * Enforced rather than trusted: the date is what a manager schedules from, and
 * a stale one left behind after the rep unticked the box would put a call in
 * the diary that nobody agreed to.
 */
alter table public.leads
  add constraint leads_follow_up_date_needs_flag
  check (follow_up_on is null or follow_up_required);

/**
 * Where the rep was standing when the call started is evidence, and the person
 * it describes must not be able to revise it afterwards.
 *
 * The same rule visits already carry, for the same reason: null → value is the
 * call being completed, value → anything else is a rewrite. `service_role` and
 * direct SQL are exempt, so a genuine correction stays possible out of band.
 */
create or replace function public.leads_freeze_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('role', true) = 'service_role' or auth.uid() is null then
    return new;
  end if;

  if old.started_at is distinct from new.started_at then
    raise exception 'The start time of a sales visit cannot be changed.';
  end if;
  if old.start_lat is not null and new.start_lat is distinct from old.start_lat then
    raise exception 'The recorded position of a sales visit cannot be changed.';
  end if;
  if old.start_lng is not null and new.start_lng is distinct from old.start_lng then
    raise exception 'The recorded position of a sales visit cannot be changed.';
  end if;
  if old.rep_id is distinct from new.rep_id or old.org_id is distinct from new.org_id then
    raise exception 'A sales visit cannot be reassigned.';
  end if;

  return new;
end;
$$;

create trigger leads_freeze_recorded_start
before update on public.leads
for each row execute function public.leads_freeze_start();

-- ------------------------------------------------------------------ RLS

alter table public.leads enable row level security;

-- A rep sees their own calls; a manager sees the organisation's pipeline.
create policy leads_select on public.leads
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'manager'
      or rep_id = (select auth.uid())
    )
  );

-- Pinned to the caller, exactly as visits_insert is: a rep cannot log a call
-- as somebody else.
create policy leads_insert on public.leads
  for insert with check (
    org_id = (select public.current_org_id())
    and rep_id = (select auth.uid())
  );

-- The rep completes their own call; the manager works the pipeline.
create policy leads_update on public.leads
  for update using (
    org_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'manager'
      or rep_id = (select auth.uid())
    )
  );

-- No delete policy, deliberately. A prospect that was called on is a record of
-- work done, and "Lost" is a stage rather than a reason to erase the visit.

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730072204', 'create_leads')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 60/71  20260730090357_activity_feed_sales_visits.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Sales visits in the activity feed.
--
-- A call on a prospect is field activity like any other — the manager watching
-- this page wants to see that the rep was out working, not only the stops that
-- happened to be on a store list. The feed was built to take new event kinds
-- here rather than by merging streams in the client, so this is a third branch
-- of the same union.
--
-- Two shapes had to give:
--
--   * The store join becomes a LEFT JOIN. A prospect is by definition not a
--     store, so an inner join silently dropped every one of these rows.
--   * A new verdict, 'prospect'. Reusing 'unknown' would have been a lie —
--     that means "a position was expected and we could not get one", whereas
--     here there is a position and nothing to measure it against, because the
--     shop is not on the estate and has no geofence.
--
-- The summary strip deliberately excludes them: it answers "were they where
-- they said they were", and a prospect visit cannot answer that. Leaving them
-- in would have made the tiles stop adding up to the total.

create or replace function public.activity_feed(
  p_from         timestamptz,
  p_to           timestamptz,
  p_rep_ids      uuid[]  default null,
  p_store_ids    uuid[]  default null,
  p_only_flagged boolean default false,
  p_limit        int     default 50,
  p_offset       int     default 0
)
returns table (
  event_id          text,
  kind              text,
  occurred_at       timestamptz,
  visit_id          uuid,
  rep_id            uuid,
  rep_name          text,
  store_id          uuid,
  store_name        text,
  distance_m        numeric,
  accuracy_m        numeric,
  geofence_radius_m int,
  verdict           text,
  submission_id     uuid,
  total_count       bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  events as (
    select v.id::text || ':in' as event_id,
           'check_in'::text    as kind,
           v.checkin_at        as occurred_at,
           v.id as visit_id, v.rep_id, v.store_id,
           null::text as company_name,
           v.checkin_distance_from_store_m::numeric as distance_m,
           v.checkin_gps_accuracy_m::numeric        as accuracy_m
    from visits v cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null

    union all

    -- No checkout_distance_from_store_m column exists, so derive it the same
    -- way the check-in distance was derived.
    select v.id::text || ':out',
           'check_out',
           v.checkout_at,
           v.id, v.rep_id, v.store_id,
           null::text,
           case when v.checkout_lat is not null and s.lat is not null then
             round((6371000 * 2 * asin(sqrt(
               power(sin(radians(s.lat - v.checkout_lat) / 2), 2)
               + cos(radians(v.checkout_lat)) * cos(radians(s.lat))
               * power(sin(radians(s.lng - v.checkout_lng) / 2), 2)
             )))::numeric, 1)
           end,
           null::numeric
    from visits v
    join stores s on s.id = v.store_id
    cross join cfg
    where v.org_id = cfg.org and v.checkout_at is not null

    union all

    -- One row per sales call, at the moment it started. Not two: a check-in
    -- and a check-out bracket time spent in a shop that is being audited,
    -- whereas what matters about a prospect is that it happened and what came
    -- of it — which the Leads board carries in full.
    select l.id::text || ':sales',
           'sales_visit',
           l.started_at,
           null::uuid, l.rep_id, null::uuid,
           l.company_name,
           null::numeric,
           null::numeric
    from leads l cross join cfg
    where l.org_id = cfg.org
  ),
  enriched as (
    select e.event_id, e.kind, e.occurred_at, e.visit_id, e.rep_id, e.store_id,
           e.distance_m, e.accuracy_m,
           -- A prospect has no store row; its name is the company the rep called on.
           coalesce(s.name, e.company_name) as store_name,
           s.geofence_radius_m,
           p.full_name as rep_name,
           case
             when e.kind = 'sales_visit'          then 'prospect'
             when e.distance_m is null            then 'unknown'
             -- Beyond 5km is a corrupt reading, not behaviour. Never present
             -- it as fact; it destroys trust in every other number here.
             when e.distance_m > 5000             then 'invalid_gps'
             when e.distance_m > 500              then 'off_site'
             when e.distance_m > s.geofence_radius_m then 'nearby'
             else 'at_store'
           end as verdict,
           (select fs.id from form_submissions fs
             where fs.visit_id = e.visit_id
             order by fs.submitted_at limit 1) as submission_id
    from events e
    -- LEFT, so a prospect survives having no store.
    left join stores s on s.id = e.store_id
    left join profiles p on p.id = e.rep_id
  ),
  filtered as (
    select * from enriched
    where occurred_at >= p_from
      and occurred_at <  p_to
      and (p_rep_ids   is null or rep_id   = any(p_rep_ids))
      -- Filtering by store excludes prospects, correctly: they are not in any
      -- store's history.
      and (p_store_ids is null or store_id = any(p_store_ids))
      and (not p_only_flagged or verdict in ('off_site', 'invalid_gps'))
  )
  select event_id, kind, occurred_at, visit_id, rep_id, rep_name,
         store_id, store_name, distance_m, accuracy_m, geofence_radius_m,
         verdict, submission_id,
         count(*) over () as total_count
  from filtered
  -- event_id tiebreaks so paging can't duplicate or skip rows sharing a timestamp.
  order by occurred_at desc, event_id
  limit p_limit offset p_offset;
$$;

-- Counts for the summary strip, across the whole range rather than one page.
--
-- Prospects are excluded here on purpose. This strip is the geofence verdict —
-- "were they where they said they were" — and a call on a shop with no
-- geofence has no answer to give. Counting them would inflate the total past
-- what the tiles below it add up to.
create or replace function public.activity_feed_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_rep_ids   uuid[] default null,
  p_store_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(verdict, n) || jsonb_build_object('total', sum(n)),
    '{"total": 0}'::jsonb
  )
  from (
    select verdict, count(*) as n
    from public.activity_feed(p_from, p_to, p_rep_ids, p_store_ids,
                              false, 1000000, 0)
    where verdict <> 'prospect'
    group by verdict
  ) x;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730090357', 'activity_feed_sales_visits')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 61/71  20260730101806_create_rep_day_times_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- When the team actually starts and finishes.
--
-- "First activity of the day" is not one table's business. A rep may open the
-- workday before driving anywhere, check in somewhere without ever pressing
-- start, or spend a morning on prospects and never touch a scheduled store.
-- Taking only visits would report the last of those as no day at all, so this
-- unions everything that is evidence of the rep being at work:
--
--   * workday_sessions   — the day opened and closed explicitly
--   * visits             — check-in and check-out
--   * leads              — a sales call started and completed
--
-- Times are local. Botswana is UTC+2, so an evening close-of-day stored in UTC
-- belongs to the previous date, and averaging the raw timestamps would report a
-- start time two hours before anybody arrived. Every grouping and every
-- average below happens after the conversion.
create or replace function public.rep_day_times(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id            uuid,
  rep_name          text,
  days_worked       bigint,
  avg_start_seconds numeric,
  avg_end_seconds   numeric,
  avg_length_seconds numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           -- One place to change if the customer ever operates outside CAT.
           'Africa/Gaborone'::text as tz
  ),
  events as (
    select w.rep_id, w.started_at as at from workday_sessions w cross join cfg
     where w.org_id = cfg.org and w.started_at is not null
    union all
    select w.rep_id, w.ended_at from workday_sessions w cross join cfg
     where w.org_id = cfg.org and w.ended_at is not null
    union all
    select v.rep_id, v.checkin_at from visits v cross join cfg
     where v.org_id = cfg.org and v.checkin_at is not null
    union all
    select v.rep_id, v.checkout_at from visits v cross join cfg
     where v.org_id = cfg.org and v.checkout_at is not null
    union all
    select l.rep_id, l.started_at from leads l cross join cfg
     where l.org_id = cfg.org
    union all
    select l.rep_id, l.completed_at from leads l cross join cfg
     where l.org_id = cfg.org and l.completed_at is not null
  ),
  -- One row per rep per working day: when they first did anything, and last.
  per_day as (
    select e.rep_id,
           (e.at at time zone cfg.tz)::date as local_day,
           min(e.at at time zone cfg.tz) as first_at,
           max(e.at at time zone cfg.tz) as last_at
    from events e cross join cfg
    where e.at >= p_from and e.at < p_to
    group by e.rep_id, (e.at at time zone cfg.tz)::date
  )
  select d.rep_id,
         p.full_name as rep_name,
         count(*) as days_worked,
         -- Seconds since local midnight, averaged across the rep's days. Kept
         -- as seconds rather than a time so the caller can render it and the
         -- overall average can be taken without re-parsing.
         round(avg(extract(epoch from d.first_at::time))::numeric, 0) as avg_start_seconds,
         round(avg(extract(epoch from d.last_at::time))::numeric, 0) as avg_end_seconds,
         round(avg(extract(epoch from (d.last_at - d.first_at)))::numeric, 0) as avg_length_seconds
  from per_day d
  left join profiles p on p.id = d.rep_id
  group by d.rep_id, p.full_name
  order by p.full_name nulls last;
$$;

comment on function public.rep_day_times is
  'Average local start and end of day per rep, from workday sessions, visits and sales calls.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730101806', 'create_rep_day_times_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 62/71  20260730103711_create_dashboard_operations_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Pipeline, territory and location-confidence counters for the dashboard.
--
-- The original KPIs were written before leads, territories and rep-confirmed
-- store positions existed, so the page reported a system smaller than the one
-- that is running. These are the counters those three subsystems produce.
--
-- Follow-ups are deliberately NOT range-scoped. A follow-up that fell due last
-- month is still owed today, and hiding it because the date picker moved would
-- defeat the point of the field.
create or replace function public.dashboard_operations(
  p_from timestamptz,
  p_to   timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           (now() at time zone 'Africa/Gaborone')::date as today
  )
  select jsonb_build_object(
    'sales_visits', (
      select count(*) from leads l cross join cfg
       where l.org_id = cfg.org and l.started_at >= p_from and l.started_at < p_to
    ),
    'leads_open', (
      select count(*) from leads l cross join cfg
       where l.org_id = cfg.org and l.stage not in ('converted', 'lost')
    ),
    'leads_converted', (
      select count(*) from leads l cross join cfg
       where l.org_id = cfg.org and l.stage = 'converted'
    ),
    'follow_ups_due', (
      select count(*) from leads l cross join cfg
       where l.org_id = cfg.org and l.follow_up_required
         and l.follow_up_on is not null and l.follow_up_on <= cfg.today
         and l.stage not in ('converted', 'lost')
    ),
    'follow_ups_overdue', (
      select count(*) from leads l cross join cfg
       where l.org_id = cfg.org and l.follow_up_required
         and l.follow_up_on is not null and l.follow_up_on < cfg.today
         and l.stage not in ('converted', 'lost')
    ),
    -- Every geofence verdict on the Activities page rests on this.
    'stores_confirmed', (
      select count(*) from stores s cross join cfg
       where s.org_id = cfg.org and s.active and s.location_confirmed_at is not null
    ),
    'stores_guessed', (
      select count(*) from stores s cross join cfg
       where s.org_id = cfg.org and s.active and s.location_confirmed_at is null
    ),
    'stores_unplaced', (
      select count(*) from stores s cross join cfg
       where s.org_id = cfg.org and s.active and s.territory_id is null
    ),
    'territories_main', (
      select count(*) from territories t cross join cfg
       where t.org_id = cfg.org and t.parent_id is null and t.active
    ),
    'territories_sub', (
      select count(*) from territories t cross join cfg
       where t.org_id = cfg.org and t.parent_id is not null and t.active
    )
  );
$$;

comment on function public.dashboard_operations is
  'Pipeline, territory and location-confidence counters for the dashboard.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730103711', 'create_dashboard_operations_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 63/71  20260730111627_enforce_territory_reps_org.sql
-- ──────────────────────────────────────────────────────────────────────────

-- `territory_reps` was the one table in the territory structure with no proof
-- that the rows it points at live in the same organisation.
--
-- `territories` gets `territories_enforce_shape` and `stores` gets
-- `stores_enforce_territory`; this table got neither, and its insert policy only
-- checks the `org_id` *supplied in the row*:
--
--   org_id = current_org_id() and current_role() = 'manager'
--
-- So a manager could insert coverage whose `org_id` is their own — passing RLS —
-- while `territory_id` or `rep_id` pointed into another tenant. Confirmed by
-- exploiting it inside a rolled-back transaction: a row with org A's `org_id`
-- and org B's territory was accepted. Any query joining
-- `territory_reps → territories` then crosses the tenancy line.
--
-- Reaching it needs a foreign uuid, which RLS does not hand out — the same
-- "harder to reach, but it is the boundary of the entire multi-tenant model"
-- as the `profiles.org_id` hole in docs/SECURITY-AUDIT.md, which was closed on
-- the same reasoning. A check constraint cannot see another row, so this is a
-- trigger.
create or replace function public.territory_reps_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_territory_org uuid;
  v_rep_org uuid;
begin
  -- Definer so the check reads the real row rather than the caller's RLS view
  -- of it: a foreign territory is invisible to a select, and "not visible" must
  -- not be allowed to look the same as "belongs to us".
  select org_id into v_territory_org
    from public.territories where id = new.territory_id;
  if v_territory_org is null then
    raise exception 'That territory does not exist.';
  end if;
  if v_territory_org <> new.org_id then
    raise exception 'A territory can only be covered by reps in its own organisation.';
  end if;

  select org_id into v_rep_org
    from public.profiles where id = new.rep_id;
  if v_rep_org is null then
    raise exception 'That rep does not exist.';
  end if;
  if v_rep_org <> new.org_id then
    raise exception 'A rep can only cover territories in their own organisation.';
  end if;

  return new;
end;
$$;

create trigger territory_reps_org_shape
before insert or update of org_id, territory_id, rep_id on public.territory_reps
for each row execute function public.territory_reps_enforce_org();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730111627', 'enforce_territory_reps_org')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 64/71  20260730111738_fix_leads_follow_up_index_predicate.sql
-- ──────────────────────────────────────────────────────────────────────────

-- `leads_follow_up_idx` was built for a query that was never written.
--
-- Its predicate is `follow_up_required and status = 'completed'`, but the
-- follow-up counts that actually shipped — `dashboard_operations`,
-- `follow_ups_due` and `follow_ups_overdue` — filter on `follow_up_required`,
-- `follow_up_on` and `stage not in ('converted','lost')`, and never look at
-- `status` at all. A partial index whose predicate the query does not imply
-- cannot be used, so both counts were sequential scans against an index that
-- looked like it covered them.
--
-- Aligned with the shipped query. `follow_up_on is not null` is added to the
-- predicate as well: the query requires it, and it keeps rows that carry a tick
-- but no date out of the index.
drop index if exists public.leads_follow_up_idx;

create index leads_follow_up_idx on public.leads (org_id, follow_up_on)
  where follow_up_required
    and follow_up_on is not null
    and stage not in ('converted', 'lost');

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730111738', 'fix_leads_follow_up_index_predicate')
on conflict (version) do nothing;
