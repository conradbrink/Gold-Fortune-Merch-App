-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 8 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260731181954_restructure_territories_into_regions.sql
--    .. through 20260731203745_align_function_text_with_repo.sql
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
-- 73/76  20260731181954_restructure_territories_into_regions.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Country → Region → Territory → Store.
--
-- The tiers were country → territory → sub, with stores on the *middle* level
-- and the sub an optional refinement nobody had used (0 stores in it). The
-- estate is actually run as four sales regions, so a region tier goes in and
-- the unused sub tier comes out. Stores stay on the deepest tier, which is
-- where someone looks for them: "which shops are in Palapye" is now a question
-- the tree answers directly, and a territory can hold stores wherever it sits.
--
-- Deliberately one migration, matching `20260730152523_add_country_tier`,
-- which likewise reshaped the tiers and moved the rows in the same breath. The
-- two cannot be separated: between them the tree is in a state both the old
-- rules and the new ones refuse.
--
-- No store is orphaned. Twenty-three towns are absorbed into a neighbour —
-- their stores move first, because `stores.territory_id` is RESTRICT and the
-- delete would otherwise be refused rather than silently cascading.

-- ---------------------------------------------------------------- levels

alter table public.territories drop constraint territories_level_check;

-- 'sub' is still allowed *here* because Gaborone Central is still one. The
-- constraint is tightened at the end, once nothing is a sub any more.
alter table public.territories
  add constraint territories_level_check
  check (level in ('country', 'region', 'territory', 'sub'));

/**
 * Four tiers, each under the right kind of parent, inside one organisation.
 *
 * Only the expected-parent table changes: a territory now sits under a region
 * rather than under the country. Every guarantee the three-tier version made —
 * the dependents guard, the organisation checks, the advisory locks that stop
 * two transactions validating against each other's stale rows — is unchanged.
 *
 * 'sub' keeps its rule for the length of this migration only. Nothing can be
 * one afterwards: the constraint below removes it.
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

  v_expected_parent := case new.level
    when 'country'   then null
    when 'region'    then 'country'
    when 'territory' then 'region'
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

-- ------------------------------------------------------------- the tree

do $$
declare
  v_org      uuid;
  v_country  uuid;
  v_north    uuid;
  v_central  uuid;
  v_gabs     uuid;
  v_west     uuid;

  -- Absorbed town -> the territory that takes its stores. The survivor is
  -- whichever row already holds the most stores, so the fewest rows move.
  v_merges text[][] := array[
    ['Orapa',          'Letlhakane'],
    ['Gweta',          'Nata'],
    ['Gumare',         'Shakawe'],
    ['Sepopa',         'Shakawe'],
    ['Kazungula',      'Kasane'],
    ['Pandamatenga',   'Kasane'],
    ['Tati Siding',    'Francistown'],
    ['Shoshong',       'Mahalapye'],
    ['Masunga',        'Tonota'],
    ['Tutume',         'Tonota'],
    ['Bobonong',       'Selebi Phikwe'],
    ['Metsimotlhabe',  'Molepolole'],
    ['Kopong',         'Molepolole'],
    ['Mmopane',        'Molepolole'],
    ['Thebephatswa',   'Molepolole'],
    ['Pilane',         'Mochudi'],
    ['Morwa',          'Mochudi'],
    ['Oodi',           'Mochudi'],
    ['Ramotswa',       'Ramotswa–Lobatse'],
    ['Molapowabojang', 'Ramotswa–Lobatse'],
    ['Thamaga',        'Thamaga–Moshupa'],
    ['Gabane',         'Gaborone West'],
    ['Pitsane',        'Kanye']
  ];
  v_pair   text[];
  v_from   uuid;
  v_to     uuid;
  v_moved  int;
begin
  select id, org_id into v_country, v_org
  from public.territories where level = 'country' limit 1;

  if v_country is null then
    -- An empty database has nothing to restructure. Real on staging, which
    -- replays schema only; impossible in the production this ran against.
    raise notice 'No country row - empty database, skipping the data moves.';
    return;
  end if;

  -- 1. The four sales regions.
  insert into public.territories (org_id, name, level, parent_id)
  values (v_org, 'North Botswana',        'region', v_country) returning id into v_north;
  insert into public.territories (org_id, name, level, parent_id)
  values (v_org, 'Central Botswana',      'region', v_country) returning id into v_central;
  insert into public.territories (org_id, name, level, parent_id)
  values (v_org, 'Greater Gaborone',      'region', v_country) returning id into v_gabs;
  insert into public.territories (org_id, name, level, parent_id)
  values (v_org, 'West & South Botswana', 'region', v_country) returning id into v_west;

  -- 2. Survivors into their region, under their CURRENT names.
  --
  --    This has to happen before the renames, and a dry run is how I know: the
  --    trigger validates the whole new row on any update, so renaming a
  --    territory that still sits under the country is refused with "Botswana is
  --    a country, not a region". Reparenting is the one update that is legal
  --    from the old shape, because the row it produces is already the new one.
  update public.territories set parent_id = v_north
   where level = 'territory'
     and name in ('Maun', 'Letlhakane', 'Nata', 'Shakawe', 'Kasane');

  update public.territories set parent_id = v_central
   where level = 'territory'
     and name in ('Francistown', 'Palapye', 'Serowe', 'Mahalapye', 'Tonota',
                  'Selebi Phikwe');

  update public.territories set parent_id = v_gabs
   where level = 'territory'
     and name in ('Gaborone', 'Tlokweng', 'Mogoditshane', 'Molepolole',
                  'Mochudi', 'Lobatse', 'Moshupa');

  update public.territories set parent_id = v_west
   where level = 'territory'
     and name in ('Kanye', 'Jwaneng', 'Ghanzi', 'Kang', 'Tsabong', 'Letlhakeng');

  -- 3. Now the renames. A rename moves no stores: the row keeps its id, so
  --    everything pointing at it still does.
  update public.territories set name = 'Gaborone East'    where name = 'Tlokweng'     and level = 'territory';
  update public.territories set name = 'Gaborone West'    where name = 'Mogoditshane' and level = 'territory';
  update public.territories set name = 'Ramotswa–Lobatse' where name = 'Lobatse'      and level = 'territory';
  update public.territories set name = 'Thamaga–Moshupa'  where name = 'Moshupa'      and level = 'territory';

  -- 4. Gaborone Central was created as a sub and is what this whole request
  --    started from. Promoted rather than recreated, so it keeps its id.
  update public.territories
     set level = 'territory', parent_id = v_gabs
   where name = 'Gaborone Central' and level = 'sub';

  -- 5. The two remaining quarters, empty for now. Splitting Gaborone's 75
  --    shops across them needs someone who knows the city; the data says only
  --    "Gaborone" and a partly-guessed coordinate.
  insert into public.territories (org_id, name, level, parent_id)
  values (v_org, 'Gaborone North', 'territory', v_gabs),
         (v_org, 'Gaborone South', 'territory', v_gabs);

  -- 6. Absorb the small towns: stores first, then the empty row.
  foreach v_pair slice 1 in array v_merges loop
    select id into v_from from public.territories
     where name = v_pair[1] and level = 'territory';
    select id into v_to   from public.territories
     where name = v_pair[2] and level = 'territory';

    if v_from is null then
      raise exception 'Nothing named % to absorb.', v_pair[1];
    end if;
    if v_to is null then
      raise exception 'No territory named % to absorb % into.', v_pair[2], v_pair[1];
    end if;

    update public.stores set territory_id = v_to where territory_id = v_from;
    get diagnostics v_moved = row_count;

    delete from public.territories where id = v_from;
    raise notice 'Absorbed % into % (% stores)', v_pair[1], v_pair[2], v_moved;
  end loop;
end $$;

-- ------------------------------------------------------- no more subs

alter table public.territories drop constraint territories_level_check;

alter table public.territories
  add constraint territories_level_check
  check (level in ('country', 'region', 'territory'));

/**
 * A store sits in a territory — now the deepest tier — and nothing else.
 *
 * `sub_territory_id` is kept as a column rather than dropped: every row is
 * null, dropping it would be an irreversible change to a table holding the
 * only copy of the estate, and a NOT NULL-style guard here says the same thing
 * without destroying anything. It is refused explicitly so a stale client
 * writing one gets a sentence rather than a foreign-key error.
 */
create or replace function public.stores_enforce_territory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_main public.territories;
begin
  if new.sub_territory_id is not null then
    raise exception
      'Sub-territories no longer exist. Put the store in a territory instead.';
  end if;

  if new.territory_id is null then
    return new;
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
      '% is a %. A store goes in a territory, not a %.',
      v_main.name, v_main.level, v_main.level;
  end if;

  return new;
end;
$$;

-- The dashboard counted territories and subs. Subs are gone; regions are the
-- number that now means something beside them.
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
       where t.org_id = cfg.org and t.level = 'region' and t.active
    )
  );
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260731181954', 'restructure_territories_into_regions')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 74/76  20260731203657_fix_activity_feed_verdict_order.sql
-- ──────────────────────────────────────────────────────────────────────────

-- A check-in inside the geofence must never read as off-site.
--
-- The verdict tested `distance_m > 500` before `distance_m > geofence_radius_m`.
-- For any store whose radius reaches 500 m — a mall, a depot — a check-in
-- *inside* the geofence returned 'off_site', and p_only_flagged plus
-- activity_feed_summary then presented compliant visits as exceptions. The
-- radius is per-store and configurable, so this was one settings change away
-- from firing; today every store sits at the default 100 m and no stored
-- verdict is affected (verdicts are computed at read time, so history heals
-- itself the moment this applies).
--
-- activity_feed_summary needs no change: it aggregates this function.
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
             -- The store's own radius decides first. It is configurable per
             -- store, and with the old order a radius past 500 m turned its
             -- own compliant check-ins into off_site: the flat literal was
             -- tested before the per-store bound, so the wider the geofence,
             -- the more of it counted as an exception. Latent until now —
             -- every store is at the default 100 m — and found in review.
             when e.distance_m <= s.geofence_radius_m then 'at_store'
             when e.distance_m > 500              then 'off_site'
             else 'nearby'
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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260731203657', 'fix_activity_feed_verdict_order')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 75/76  20260731203708_lock_app_releases_writes.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Belt and braces on the table that decides what the fleet installs.
--
-- `app_releases` has RLS enabled with a SELECT-only policy, so writes from
-- clients are already refused. `security_events` and `service_flags` carry an
-- explicit revoke on top of the same arrangement; this table controls which
-- APK every rep's phone offers to install, and deserves the same second
-- layer. Publishing stays service-role only.
revoke insert, update, delete on public.app_releases from authenticated, anon;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260731203708', 'lock_app_releases_writes')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 76/76  20260731203745_align_function_text_with_repo.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Make the stored text of three functions equal the repo's, byte for byte.
--
-- The restructure migration was applied with a retyped copy of its own file:
-- same statements, different wrapping and comments. Behaviour never differed,
-- but the migration history is the disaster-recovery mechanism, and a rebuild
-- from the files would produce functions whose text disagrees with what
-- production ran — which is exactly the drift the staging digest check tripped
-- on. These are the repo files' definitions, extracted verbatim rather than
-- retyped, which is how the drift happened the first time.
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

  v_expected_parent := case new.level
    when 'country'   then null
    when 'region'    then 'country'
    when 'territory' then 'region'
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

create or replace function public.stores_enforce_territory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_main public.territories;
begin
  if new.sub_territory_id is not null then
    raise exception
      'Sub-territories no longer exist. Put the store in a territory instead.';
  end if;

  if new.territory_id is null then
    return new;
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
      '% is a %. A store goes in a territory, not a %.',
      v_main.name, v_main.level, v_main.level;
  end if;

  return new;
end;
$$;

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
       where t.org_id = cfg.org and t.level = 'region' and t.active
    )
  );
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260731203745', 'align_function_text_with_repo')
on conflict (version) do nothing;

commit;
