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
