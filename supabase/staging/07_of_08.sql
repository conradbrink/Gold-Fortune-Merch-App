-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 7 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260730114524_create_dashboard_layouts.sql
--    .. through 20260731175407_create_form_field_delete_impact_rpc.sql
--
-- Run the chunks in order. If one fails, do NOT re-run it blind —
-- open 99_resume.sql and ask the database what actually landed.
-- ──────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────
-- 65/73  20260730114524_create_dashboard_layouts.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Which dashboard cards a person wants, and in what order.
--
-- Deliberately *not* a saved-query or report-builder table. What a
-- QuickBooks-style dashboard needs is a catalogue of cards that already know
-- their own query — `dashboard_summary`, `dashboard_operations`, `rep_day_times`
-- and the scorecard family are that catalogue — plus somewhere to record which
-- ones this person keeps and in what order. Storing a *query* per widget would
-- put SQL the user composed inside the security boundary and make every RPC's
-- guarantees unenforceable; storing an id keeps the queries in migrations where
-- they can be reviewed.
--
-- So the only thing here is an ordered list of widget ids. An id the running
-- code does not recognise is ignored rather than rejected, so a widget retired
-- in a later release does not break the page for whoever still has it saved.
create table public.dashboard_layouts (
  -- One layout per person, not per organisation: two managers looking at the
  -- same estate want different things on top.
  user_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Order is the array order. Absent from the array = not shown.
  widget_ids text[] not null,
  updated_at timestamptz not null default now(),
  -- A layout is a preference, not a payload. Both of these stop this row being
  -- used as free storage.
  constraint dashboard_layouts_size_check
    check (cardinality(widget_ids) <= 64),
  constraint dashboard_layouts_no_nulls_check
    check (array_position(widget_ids, null) is null)
);

comment on table public.dashboard_layouts is
  'Per-user dashboard composition: an ordered list of widget ids from the registry in web/components/dashboard/widget-registry.tsx.';

alter table public.dashboard_layouts enable row level security;

create policy dashboard_layouts_select on public.dashboard_layouts
  for select using (user_id = (select auth.uid()));

create policy dashboard_layouts_insert on public.dashboard_layouts
  for insert with check (
    user_id = (select auth.uid())
    and org_id = (select public.current_org_id())
  );

-- WITH CHECK stated explicitly rather than left to default to USING. That
-- default is what the `profiles_update` escalation came down to: Postgres reuses
-- the USING expression for the new row, and it tests *who owns the row*, never
-- which columns changed. Here USING keeps a caller on their own row and
-- WITH CHECK keeps the row theirs afterwards — no reassigning it to another user
-- or another organisation.
create policy dashboard_layouts_update on public.dashboard_layouts
  for update using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and org_id = (select public.current_org_id())
  );

-- Deleting is how "reset to the default layout" is expressed: no row means the
-- default, so the reset does not have to hardcode a copy of it.
create policy dashboard_layouts_delete on public.dashboard_layouts
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.dashboard_layouts to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730114524', 'create_dashboard_layouts')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 66/73  20260730122631_territories_shape_guards_dependents.sql
-- ──────────────────────────────────────────────────────────────────────────

-- `territories_enforce_shape` validated the row being written and nothing that
-- depends on it, so an UPDATE could create states the very same triggers refuse
-- to create on INSERT. Both confirmed by exploiting them in rolled-back
-- transactions against the live estate:
--
--   1. Giving a main territory a `parent_id` was ACCEPTED with 75 stores and a
--      sub-territory hanging off it. Those 75 stores now name a *sub*-territory
--      in `territory_id`, which `stores_enforce_territory` refuses outright
--      ("% is a sub-territory, not a main territory"), and the existing sub
--      became a third level, which the shape check refuses too.
--
--   2. Changing a main's `org_id` was ACCEPTED, leaving 75 stores and 1
--      sub-territory pointing across the tenancy line — verified afterwards:
--      "75 stores now point at a territory in a different org".
--
-- Neither is reachable from the web app, which only ever updates `name` and
-- `active`. That is not the guarantee: the constraint belongs to the database,
-- and this is the same reasoning that closed the `territory_reps` gap earlier
-- today and the `profiles.org_id` gap in docs/SECURITY-AUDIT.md.
--
-- The rule is narrow on purpose. A territory may still be renamed, deactivated,
-- or restructured freely while nothing depends on it; it may not be restructured
-- *out from under* its dependents.
create or replace function public.territories_enforce_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.territories;
  v_subs int;
  v_stores int;
  v_reps int;
begin
  -- Guard the dependents first, and only when the shape actually changes:
  -- becoming a sub, ceasing to be one, or moving organisation. A rename or an
  -- active toggle passes straight through.
  if tg_op = 'UPDATE'
     and (old.parent_id is distinct from new.parent_id or old.org_id <> new.org_id)
  then
    select count(*) into v_subs   from public.territories where parent_id = old.id;
    select count(*) into v_stores from public.stores
      where territory_id = old.id or sub_territory_id = old.id;
    select count(*) into v_reps   from public.territory_reps where territory_id = old.id;

    if v_subs > 0 or v_stores > 0 or v_reps > 0 then
      raise exception
        'Cannot restructure % while % sub-territory/ies, % store(s) and % rep assignment(s) depend on it. Move them first.',
        old.name, v_subs, v_stores, v_reps;
    end if;
  end if;

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730122631', 'territories_shape_guards_dependents')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 67/73  20260730123329_bound_dashboard_layout_size.sql
-- ──────────────────────────────────────────────────────────────────────────

-- `dashboard_layouts` claimed its constraints stopped the row being used as free
-- storage. They did not: `cardinality(widget_ids) <= 64` bounds the number of
-- elements and says nothing about their size, and `text` is unbounded — 64
-- elements of 1 KB measured 65,599 characters and was accepted. The comment was
-- a claim the schema did not back.
--
-- Two bounds added, on the total joined length rather than per element, because
-- CHECK cannot contain a subquery and `unnest` is not available to it.
--
-- `array_ndims = 1` states the other invariant: this is a list, not a matrix.
--
-- It was suggested as a way to make a multidimensional insert fail as a
-- constraint violation rather than the raw `0A000` that
-- `array_position(widget_ids, null)` raises on such input. **It does not do
-- that** — tested: a 2-D insert still reports `0A000`, because Postgres chooses
-- the order it evaluates CHECK constraints in and can reach `array_position`
-- first. The row is refused either way, and PostgREST cannot produce a 2-D array
-- from a JSON array of strings, so the constraint is kept for what it states and
-- not for the error code it was supposed to improve.
--
-- Note `array_ndims('{}') is null`, so `= 1` yields NULL and an empty layout — a
-- legitimate choice, meaning "show me nothing" — still passes. Verified.
alter table public.dashboard_layouts
  add constraint dashboard_layouts_shape_check
    check (array_ndims(widget_ids) = 1);

alter table public.dashboard_layouts
  add constraint dashboard_layouts_length_check
    check (length(array_to_string(widget_ids, ',')) <= 2048);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730123329', 'bound_dashboard_layout_size')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 68/73  20260730130413_serialize_territory_reparenting.sql
-- ──────────────────────────────────────────────────────────────────────────

-- ⚠️ SUPERSEDED by `20260730190000_lock_both_orgs_on_territory_move.sql`.
--
-- The lock below keys on `new.org_id` only, which does not serialise a *cross-org*
-- move against a concurrent reparenting in the old organisation — they take
-- different keys and never contend. Read 190000 for the current function; this
-- file is left exactly as it was applied, because a migration that is edited
-- after the fact stops describing what actually ran.
--
-- `territories_enforce_shape` reads the prospective parent to check it is not
-- itself a sub-territory, and that read only sees committed rows. Two
-- transactions reparenting in opposite directions therefore both pass:
--
--   Tx1: A.parent_id = B   -- reads B, still a root. OK.
--   Tx2: B.parent_id = A   -- reads A, still a root. OK.
--
-- Each updates a different row, so nothing conflicts, and both commit — leaving
-- A and B as each other's parent. A cycle, in a structure the rest of the app
-- assumes is two levels deep, and one no single-row check can see because the
-- other half of it was invisible at the time.
--
-- Both territories have to be free of sub-territories, stores and rep coverage to
-- get this far (the dependents guard added in `20260730170000`), and nothing in
-- the web app reparents at all — it only ever updates `name` and `active`. Closed
-- anyway, for the same reason as the two before it: the invariant is the
-- database's to keep.
--
-- An advisory lock rather than `select ... for update` on the parent: row locks
-- taken in opposite orders would resolve this as a deadlock, aborting one
-- transaction with a message about the other. Serialising on the organisation
-- makes the second attempt wait and then see the truth. Taken only when
-- `parent_id` actually changes, so renames and active toggles — the two things
-- the UI does — are not serialised at all.
--
-- ⚠️ **Not verified against a live race.** Reproducing it needs two concurrent
-- sessions interleaved mid-transaction, and the tooling here runs one statement
-- per connection, so the cycle could not be demonstrated and neither can its
-- absence. The reasoning above is the whole of the evidence; a two-session test
-- is still owed.
create or replace function public.territories_enforce_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.territories;
  v_subs int;
  v_stores int;
  v_reps int;
begin
  if tg_op = 'UPDATE'
     and (old.parent_id is distinct from new.parent_id or old.org_id <> new.org_id)
  then
    -- Serialise hierarchy changes within the organisation, so the parent read
    -- below cannot be answered from a state another transaction is mid-way
    -- through changing.
    perform pg_advisory_xact_lock(
      hashtext('territories_shape'), hashtext(new.org_id::text)
    );

    select count(*) into v_subs   from public.territories where parent_id = old.id;
    select count(*) into v_stores from public.stores
      where territory_id = old.id or sub_territory_id = old.id;
    select count(*) into v_reps   from public.territory_reps where territory_id = old.id;

    if v_subs > 0 or v_stores > 0 or v_reps > 0 then
      raise exception
        'Cannot restructure % while % sub-territory/ies, % store(s) and % rep assignment(s) depend on it. Move them first.',
        old.name, v_subs, v_stores, v_reps;
    end if;
  end if;

  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.';
  end if;

  -- On INSERT no lock was taken above, so take one here: a new sub-territory
  -- reads its parent for the same "is it already a sub?" check.
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtext('territories_shape'), hashtext(new.org_id::text)
    );
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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730130413', 'serialize_territory_reparenting')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 69/73  20260730133209_lock_both_orgs_on_territory_move.sql
-- ──────────────────────────────────────────────────────────────────────────

-- The advisory lock added in `20260730180000` used `new.org_id` only, which
-- serialises nothing when the two transactions disagree about which organisation
-- they are touching:
--
--   Tx1: A.parent_id = B      -- A and B both in org X. Locks X.
--   Tx2: B.org_id    = Y      -- new.org_id is Y. Locks Y, not X.
--
-- Different keys, so neither waits. Tx1 validates B as a same-org root (true at
-- the time), Tx2 finds B has no dependents (also true at the time), and both
-- commit — leaving A in org X as a sub-territory of B in org Y. A parent/child
-- pair straddling the tenancy line, which is the exact state
-- `territories_enforce_shape` exists to make impossible.
--
-- Both ends of the move are locked now, lowest organisation id first so two
-- transactions touching the same pair queue rather than deadlock, and only once
-- when the two ids are the same.
--
-- ⚠️ Still not demonstrated. `supabase/tests/territory_reparent_race.sh` stages
-- the same-org race for anyone with two `psql` connections; this cross-org
-- variant needs the same treatment and has not had it either. Check 25 of the
-- regression suite catches the *result* of a cycle whatever produced it, and the
-- cross-org pair would additionally be visible as a store or sub-territory whose
-- org_id disagrees with its parent's.
create or replace function public.territories_enforce_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.territories;
  v_subs int;
  v_stores int;
  v_reps int;
begin
  if tg_op = 'UPDATE'
     and (old.parent_id is distinct from new.parent_id or old.org_id <> new.org_id)
  then
    -- Source and destination, in a fixed order.
    perform pg_advisory_xact_lock(
      hashtext('territories_shape'),
      hashtext(least(old.org_id, new.org_id)::text)
    );
    if old.org_id <> new.org_id then
      perform pg_advisory_xact_lock(
        hashtext('territories_shape'),
        hashtext(greatest(old.org_id, new.org_id)::text)
      );
    end if;

    select count(*) into v_subs   from public.territories where parent_id = old.id;
    select count(*) into v_stores from public.stores
      where territory_id = old.id or sub_territory_id = old.id;
    select count(*) into v_reps   from public.territory_reps where territory_id = old.id;

    if v_subs > 0 or v_stores > 0 or v_reps > 0 then
      raise exception
        'Cannot restructure % while % sub-territory/ies, % store(s) and % rep assignment(s) depend on it. Move them first.',
        old.name, v_subs, v_stores, v_reps;
    end if;
  end if;

  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.';
  end if;

  -- On INSERT there is no old row, so there is only one organisation to lock.
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtext('territories_shape'), hashtext(new.org_id::text)
    );
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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730133209', 'lock_both_orgs_on_territory_move')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 70/73  20260730152523_add_country_tier.sql
-- ──────────────────────────────────────────────────────────────────────────

-- A third tier: country → territory → sub-territory.
--
-- The structure was two levels, and `parent_id is null` *meant* "main territory"
-- in the triggers, two unique indexes, the dashboard counts and the planner.
-- Adding a level by reparenting alone would silently change what that phrase
-- means in every one of those places, so the level is now stated rather than
-- inferred from depth. `level` is the column every query keys off from here.
--
-- Depth-by-walking-parents was the alternative and was rejected: it makes each
-- check a recursive query, and a wrong answer is a silent mis-classification
-- rather than a constraint violation.
alter table public.territories
  add column level text not null default 'territory';

alter table public.territories
  add constraint territories_level_check
  check (level in ('country', 'territory', 'sub'));

-- Existing rows: a top-level row was a main territory, a child was a sub. This
-- is the only moment the old meaning of `parent_id is null` is still true, so the
-- backfill has to happen before anything is reparented.
update public.territories set level = 'sub' where parent_id is not null;
update public.territories set level = 'territory' where parent_id is null;

-- The old index made *main territory* names unique per org while `parent_id is
-- null`; that predicate now selects countries. Restated against `level` so each
-- index says what it means.
drop index if exists public.territories_main_name_idx;

create unique index territories_country_name_idx
  on public.territories (org_id, lower(name))
  where level = 'country';

-- `territories_sub_name_idx` on (parent_id, lower(name)) still holds: it keeps
-- names unique among siblings, which is right for both territories under a
-- country and subs under a territory.

create index territories_level_idx on public.territories (org_id, level);

/**
 * Three levels, each under the right kind of parent, inside one organisation.
 *
 * Everything the two-level version enforced is still enforced — the dependents
 * guard, the organisation checks, the advisory locks that stop two transactions
 * validating against each other's stale rows. What changed is the shape rule:
 * "a parent must not itself have a parent" becomes "a parent must be exactly one
 * level up".
 */
create or replace function public.territories_enforce_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.territories;
  v_subs int;
  v_stores int;
  v_reps int;
  v_expected_parent text;
begin
  -- Narrower than the two-level version, and deliberately so. That one blocked
  -- *any* reparenting of a row with dependents, which was right when the only
  -- reparenting possible was a main becoming a sub. With a country above, moving
  -- a territory from one country to another is an ordinary reorganisation: its
  -- stores still point at the territory and its subs still point at it, so
  -- nothing is orphaned. (This is not hypothetical — the guard refused the
  -- migration's own backfill until it was narrowed.)
  --
  -- What still has to be blocked:
  --   * a level change — a territory with stores becoming a sub is the state
  --     `stores_enforce_territory` refuses to create;
  --   * an organisation change — dependents would be left across the line;
  --   * reparenting a *sub*, because stores carry (territory, sub) as a pair and
  --     moving the sub breaks the pair.
  if tg_op = 'UPDATE'
     and (old.level <> new.level
          or old.org_id <> new.org_id
          or (old.level = 'sub'
              and old.parent_id is distinct from new.parent_id))
  then
    perform pg_advisory_xact_lock(
      hashtext('territories_shape'),
      hashtext(least(old.org_id, new.org_id)::text)
    );
    if old.org_id <> new.org_id then
      perform pg_advisory_xact_lock(
        hashtext('territories_shape'),
        hashtext(greatest(old.org_id, new.org_id)::text)
      );
    end if;

    select count(*) into v_subs   from public.territories where parent_id = old.id;
    select count(*) into v_stores from public.stores
      where territory_id = old.id or sub_territory_id = old.id;
    select count(*) into v_reps   from public.territory_reps where territory_id = old.id;

    if v_subs > 0 or v_stores > 0 or v_reps > 0 then
      raise exception
        'Cannot restructure % while % child territory/ies, % store(s) and % rep assignment(s) depend on it. Move them first.',
        old.name, v_subs, v_stores, v_reps;
    end if;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.';
  end if;

  -- What each level must sit under.
  v_expected_parent := case new.level
    when 'country'   then null
    when 'territory' then 'country'
    when 'sub'       then 'territory'
  end;

  if v_expected_parent is null then
    if new.parent_id is not null then
      raise exception 'A country is the top level and cannot sit inside anything.';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception 'A % must sit inside a %.', new.level, v_expected_parent;
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtext('territories_shape'), hashtext(new.org_id::text)
    );
  end if;

  select * into v_parent from public.territories where id = new.parent_id;

  if v_parent is null then
    raise exception 'That parent does not exist.';
  end if;
  if v_parent.org_id <> new.org_id then
    raise exception 'A % must belong to the same organisation as its %.',
      new.level, v_expected_parent;
  end if;
  if v_parent.level <> v_expected_parent then
    raise exception '% is a %, not a %.', v_parent.name, v_parent.level, v_expected_parent;
  end if;

  return new;
end;
$$;

/**
 * A store sits in a *territory* — the middle level — and optionally in one of
 * that territory's subs.
 *
 * Unchanged in spirit; the "is this a main?" test was `parent_id is null`, which
 * now describes a country. A store is never placed on a country directly: the
 * country is what its territory belongs to, so there is exactly one place a
 * store's geography is written, and it still cannot be in two territories.
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
    raise exception 'A store in a sub-territory must also carry its territory.';
  end if;

  select * into v_main from public.territories where id = new.territory_id;
  if v_main is null then
    raise exception 'That territory does not exist.';
  end if;
  if v_main.org_id <> new.org_id then
    raise exception 'A store can only belong to its own organisation''s territories.';
  end if;
  if v_main.level <> 'territory' then
    raise exception
      '% is a %. A store goes in a territory, not a %.', v_main.name, v_main.level, v_main.level;
  end if;

  if new.sub_territory_id is not null then
    select * into v_sub from public.territories where id = new.sub_territory_id;
    if v_sub is null then
      raise exception 'That sub-territory does not exist.';
    end if;
    if v_sub.level <> 'sub' then
      raise exception '% is a %, not a sub-territory.', v_sub.name, v_sub.level;
    end if;
    if v_sub.parent_id is distinct from new.territory_id then
      raise exception '% is not inside %.', v_sub.name, v_main.name;
    end if;
  end if;

  return new;
end;
$$;

-- One country per organisation, and every existing territory moves under it.
--
-- Runs *after* the new trigger is installed, not before: the reparent has to be
-- validated by the three-level rules, and under the old two-level ones it was
-- refused outright.
--
-- Named Botswana because that is where this estate is. It is data, not a
-- constant — another organisation renames it or adds its own, exactly as the
-- towns were seeded per-org rather than hardcoded.
do $$
declare
  v_org record;
  v_country uuid;
begin
  for v_org in select distinct org_id from public.territories loop
    insert into public.territories (org_id, name, level, parent_id)
    values (v_org.org_id, 'Botswana', 'country', null)
    returning id into v_country;

    update public.territories
       set parent_id = v_country
     where org_id = v_org.org_id
       and level = 'territory'
       and parent_id is null;
  end loop;
end $$;

-- The dashboard counted "main" as `parent_id is null`, which is now the country.
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
       where t.org_id = cfg.org and t.level = 'territory' and t.active
    ),
    'territories_sub', (
      select count(*) from territories t cross join cfg
       where t.org_id = cfg.org and t.level = 'sub' and t.active
    )
  );
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730152523', 'add_country_tier')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 71/73  20260730155919_create_app_releases.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Android release manifest.
--
-- One row per published APK. Three separate consumers read it, which is why it
-- lives in the database rather than in a JSON file next to the build:
--
--   1. the public download page, for version, date, size and release notes
--   2. the APK download route, which resolves storage_path to a private object
--   3. the running app, which compares its own version_code against the current
--      row to decide whether to offer — or require — an update
--
-- Deliberately NOT org-scoped. There is one Android app, and a rep must be able
-- to check for an update before anyone knows which organisation they belong to.

create table if not exists public.app_releases (
  id                        uuid primary key default gen_random_uuid(),
  platform                  text        not null default 'android',

  -- What the user sees ("1.0.0") and what Android actually compares.
  -- version_code is the real identity of a release: Android refuses to install
  -- an APK whose code is lower than the installed one, so it must only ever
  -- increase. Unique, because two releases sharing a code is the one mistake
  -- that cannot be corrected by publishing again.
  version_name              text        not null,
  version_code              integer     not null,

  release_date              date        not null default current_date,

  -- Shown verbatim on the download page as "what changed". An array rather than
  -- prose so the page can render list items without parsing markdown.
  notes                     text[]      not null default '{}',

  -- Object key inside the private `app-releases` bucket. Never a public URL:
  -- the bytes are served through a route that streams them, so the bucket
  -- itself stays unlistable.
  storage_path              text        not null,
  file_size_bytes           bigint      not null,

  -- The forced-update floor. A client whose version_code is below this must
  -- update before it can keep working; at or above it, the update is optional
  -- and can be postponed. Defaults to 1 so that no existing install is locked
  -- out by simply publishing a release.
  min_supported_version_code integer    not null default 1,

  -- Exactly one row per platform is the live release. Enforced by the partial
  -- unique index below rather than by convention, because "which one is
  -- current?" answered two different ways is how a rep gets offered a
  -- downgrade.
  is_current                boolean     not null default false,

  created_at                timestamptz not null default now(),

  constraint app_releases_platform_check
    check (platform in ('android')),
  constraint app_releases_version_code_positive
    check (version_code > 0),
  constraint app_releases_min_supported_sane
    check (min_supported_version_code > 0
           and min_supported_version_code <= version_code),
  constraint app_releases_size_positive
    check (file_size_bytes > 0),
  constraint app_releases_version_name_shape
    check (version_name ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint app_releases_notes_bounded
    check (array_length(notes, 1) is null or array_length(notes, 1) <= 20)
);

create unique index if not exists app_releases_version_code_idx
  on public.app_releases (platform, version_code);

create unique index if not exists app_releases_one_current_idx
  on public.app_releases (platform) where is_current;

alter table public.app_releases enable row level security;

-- Readable by everyone, including anon.
--
-- The download page is public by design: a rep setting up a new phone has no
-- session yet, and cannot get one until the app they are trying to install is
-- installed. Nothing here is sensitive — it is a version number, a date, a byte
-- count and a changelog. The APK bytes are a separate matter and stay behind
-- the streaming route.
create policy app_releases_select_public on public.app_releases
  for select using (true);

-- No insert/update/delete policy exists on purpose. Publishing a release is a
-- deliberate operator action performed with the service role, documented in
-- docs/RELEASE-ANDROID.md. Leaving it out means no signed-in user — manager or
-- rep — can rewrite what the fleet is told to install.

comment on table public.app_releases is
  'Published Android releases. Drives the public download page and the in-app update check. Writes are service-role only; see docs/RELEASE-ANDROID.md.';

-- Private bucket for the APKs themselves.
--
-- 200 MB ceiling: a Flutter release APK is tens of megabytes, so this is
-- headroom rather than a target, and it stops an accidental upload of something
-- entirely different.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-releases', 'app-releases', false, 209715200,
  array['application/vnd.android.package-archive', 'application/octet-stream']
)
on conflict (id) do nothing;

-- No storage policy for anon or authenticated: nobody reads this bucket
-- directly. The download route reads it with the service role and streams the
-- bytes, so the bucket cannot be listed and old or draft APKs cannot be
-- fetched by guessing a path.

insert into supabase_migrations.schema_migrations (version, name)
values ('20260730155919', 'create_app_releases')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 72/73  20260731175407_create_form_field_delete_impact_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What deleting a form question would destroy.
--
-- `form_responses.form_field_id` cascades, so removing a question erases every
-- answer ever given to it — every store, every visit, every month, including
-- audits whose compliance figures then change retroactively. The builder
-- currently deletes on a single click of a bin icon, with nothing said.
--
-- Same trap, and same remedy, as `store_delete_impact` (20260728145421),
-- `rep_delete_impact` (20260727202504) and `product_delete_impact`
-- (20260729142051). The dialog has to be able to state the cost before anyone
-- confirms it.
--
-- Deactivating the whole form keeps its history; there is no per-question
-- equivalent, which is exactly why the count matters here.
create or replace function public.form_field_delete_impact(p_field_id uuid)
returns table (
  field_label       text,
  metric_key        text,
  answers           bigint,
  submissions       bigint,
  stores_answered   bigint,
  photos            bigint,
  first_answered_at timestamptz,
  last_answered_at  timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  -- Every answer to this question that the caller's organisation owns. The
  -- org filter is on form_submissions because form_responses carries no
  -- org_id of its own.
  mine as (
    select fr.form_submission_id,
           fr.photo_id,
           fs.visit_id,
           fs.submitted_at
    from form_responses fr
    join form_submissions fs on fs.id = fr.form_submission_id
    cross join cfg
    where fr.form_field_id = p_field_id
      and fs.org_id = cfg.org
  ),
  field as (
    select ff.label, ff.metric_key
    from form_fields ff
    join form_templates ft on ft.id = ff.form_template_id
    cross join cfg
    where ff.id = p_field_id
      and ft.org_id = cfg.org
  )
  select
    (select f.label from field f),
    (select f.metric_key from field f),
    (select count(*) from mine),
    (select count(distinct m.form_submission_id) from mine m),
    -- Outlets rather than visits: "answers from 34 shops" is the number a
    -- manager can weigh, where a raw row count is not.
    (select count(distinct v.store_id)
       from mine m join visits v on v.id = m.visit_id),
    -- Photo answers are worth naming separately: the image itself is not
    -- deleted by the cascade, but nothing will point at it again.
    (select count(*) from mine m where m.photo_id is not null),
    (select min(m.submitted_at) from mine m),
    (select max(m.submitted_at) from mine m);
$$;

comment on function public.form_field_delete_impact is
  'Answers a hard delete of a form question would cascade away, with how many outlets and what date range they span. Shown before confirming — there is no per-question deactivate, so the only alternatives are keep or lose the history.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260731175407', 'create_form_field_delete_impact_rpc')
on conflict (version) do nothing;
