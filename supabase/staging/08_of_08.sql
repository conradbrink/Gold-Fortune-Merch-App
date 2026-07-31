-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 8 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260731181954_restructure_territories_into_regions.sql
--    .. through 20260731181954_restructure_territories_into_regions.sql
--
-- Run the chunks in order. If one fails, do NOT re-run it blind —
-- open 99_resume.sql and ask the database what actually landed.
-- ──────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────
-- 73/73  20260731181954_restructure_territories_into_regions.sql
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
    raise exception 'No country row to hang the regions off.';
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
