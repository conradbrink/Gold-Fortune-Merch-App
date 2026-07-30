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
