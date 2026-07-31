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
