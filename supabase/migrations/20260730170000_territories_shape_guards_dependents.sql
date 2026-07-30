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
