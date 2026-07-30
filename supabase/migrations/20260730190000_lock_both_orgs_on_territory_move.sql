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
