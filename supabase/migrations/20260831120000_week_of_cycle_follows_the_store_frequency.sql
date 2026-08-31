-- `week_of_cycle` has to follow the store's frequency, and until now nothing
-- made it.
--
-- The column is constrained `between 1 and 4` because *monthly* needs four —
-- it is the nth occurrence of that weekday in the month. Bi-weekly has only
-- two (1 = week A, 2 = week B, by ISO week parity) and weekly has none. So the
-- legal range of a column on `store_assignments` depends on a column on
-- `stores`, which is exactly the rule a check constraint cannot state, and no
-- other thing stated it either: a monthly store on the 3rd Tuesday, moved down
-- to bi-weekly, kept its 3.
--
-- A 3 on a bi-weekly store is not a harmless leftover. It is read two
-- different ways by two things that are supposed to agree:
--
--   * `describeCycle` in the web app renders `week === 1 ? 'A' : 'B'`, so it
--     says **week B**;
--   * `generate_routes` — and `occursOn`, which previews it — take the parity,
--     `(extract(week from d.day)::int % 2) = (c.week_of_cycle % 2)`, and
--     `3 % 2 = 1` puts the store on the ODD weeks, which is week **A**.
--
-- The label and the schedule are a full week apart. Worse, the Week control
-- offers only 1 and 2, so it renders with nothing selected, and a manager
-- correcting the blank by choosing Week B shifts every visit for that store.
--
-- The immediate cause was a client bug (`week !== s.week_of_cycle` was false in
-- precisely the case that needed the write) and it is fixed in the same change
-- as this file. This migration exists because that was one of THREE places
-- that set a store's frequency — the call-cycle planner, the bulk frequency
-- action in the coverage planner, and the per-row control on the stores list —
-- and only one of them ever touched the week at all. The durable statement of
-- the rule belongs next to the data.
--
-- Production was checked before writing this: 175 assignments, 72 bi-weekly on
-- weeks 1 and 2, 101 weekly with a null week, 2 bi-weekly unplanned with a
-- null week, and NO monthly stores at all. Zero rows are in the broken state,
-- so the backfill below is a no-op today and is here so that stays true.

-- ---------------------------------------------------------------------------
-- The rule, in one place
-- ---------------------------------------------------------------------------
--
-- A clamp, not a default: a null stays null. Null already means week A to
-- everything that reads it (`coalesce(sa.week_of_cycle, 1)` in the generator
-- and the review RPCs, `?? 1` in the web app), so promoting it to a literal 1
-- would write a value nobody chose onto assignments that are usually unplanned.
--
-- Mirrors `reconcileWeekOfCycle` in `web/lib/schedule.ts` case for case. If one
-- of the two ever moves, the other has to move with it — the same standing
-- arrangement `occursOn` already has with `generate_routes`.
create or replace function public.reconcile_week_of_cycle(
  p_frequency text,
  p_week      smallint
)
returns smallint
language sql
immutable
as $$
  select case p_frequency
           -- Weekly ignores the week entirely; a value left behind here is one
           -- that reappears the moment the store is put back on a cycle.
           when 'weekly'   then null::smallint
           when 'biweekly' then case when p_week > 2 then 1::smallint else p_week end
           -- Monthly: 1-4 are all meaningful, so there is nothing to reconcile.
           else p_week
         end;
$$;

comment on function public.reconcile_week_of_cycle(text, smallint) is
  'week_of_cycle clamped to what the store frequency actually has: null for weekly, 1-2 for biweekly, 1-4 for monthly. Nulls are left alone.';

-- ---------------------------------------------------------------------------
-- Guard 1: no row can be written out of range for its own store
-- ---------------------------------------------------------------------------
--
-- Clamps rather than raising. The value being corrected is one no caller ever
-- deliberately chose — it is a stale number surviving a frequency change — so
-- refusing the write would turn a silent inconsistency into a visible error on
-- an unrelated action (setting a *day*, usually) with nothing the manager could
-- do about it. Every reader of the column already has a defined meaning for the
-- clamped value, and the alternative is the split-brain described above.
create or replace function public.store_assignment_week_guard()
returns trigger
language plpgsql
as $$
declare
  v_frequency text;
begin
  if new.week_of_cycle is null then
    return new;
  end if;

  select s.visit_frequency into v_frequency
    from public.stores s
   where s.id = new.store_id;

  -- No store row visible: leave the value alone rather than invent a rule. The
  -- FK will have its say.
  if v_frequency is null then
    return new;
  end if;

  new.week_of_cycle :=
    public.reconcile_week_of_cycle(v_frequency, new.week_of_cycle);
  return new;
end;
$$;

drop trigger if exists store_assignments_week_guard on public.store_assignments;
create trigger store_assignments_week_guard
  before insert or update of store_id, week_of_cycle
  on public.store_assignments
  for each row
  execute function public.store_assignment_week_guard();

-- ---------------------------------------------------------------------------
-- Guard 2: changing the frequency brings the weeks with it
-- ---------------------------------------------------------------------------
--
-- Guard 1 cannot do this on its own — the row that becomes invalid is on the
-- other table and nothing writes to it. This is the half that was missing.
--
-- Store-wide, because a store covered by two reps has one assignment per rep,
-- and reconciling only the row whoever made the change was looking at leaves
-- the other rep's week holding a number their frequency no longer has.
--
-- Deliberately NOT security definer. `stores_update` and
-- `store_assignments_update` carry the identical test — org match plus
-- `current_role() = 'manager'` — so anybody who can reach this trigger can
-- already make the write it performs, and running as the invoker keeps RLS
-- meaning what it says. If the two policies ever diverge, this needs revisiting
-- rather than quietly reconciling nothing.
create or replace function public.stores_reconcile_week_of_cycle()
returns trigger
language plpgsql
as $$
begin
  update public.store_assignments sa
     set week_of_cycle =
           public.reconcile_week_of_cycle(new.visit_frequency, sa.week_of_cycle)
   where sa.store_id = new.id
     and sa.week_of_cycle is distinct from
           public.reconcile_week_of_cycle(new.visit_frequency, sa.week_of_cycle);
  return null;
end;
$$;

drop trigger if exists stores_reconcile_week_of_cycle on public.stores;
create trigger stores_reconcile_week_of_cycle
  after update of visit_frequency
  on public.stores
  for each row
  when (old.visit_frequency is distinct from new.visit_frequency)
  execute function public.stores_reconcile_week_of_cycle();

-- ---------------------------------------------------------------------------
-- Backfill — zero rows today, by measurement
-- ---------------------------------------------------------------------------
update public.store_assignments sa
   set week_of_cycle =
         public.reconcile_week_of_cycle(s.visit_frequency, sa.week_of_cycle)
  from public.stores s
 where s.id = sa.store_id
   and sa.week_of_cycle is distinct from
         public.reconcile_week_of_cycle(s.visit_frequency, sa.week_of_cycle);

comment on column public.store_assignments.week_of_cycle is
  'Bi-weekly: 1=week A, 2=week B (ISO week parity). Monthly: nth occurrence of that weekday in the month. Null for weekly, and null reads as week A. Kept in range for the store''s visit_frequency by store_assignments_week_guard and stores_reconcile_week_of_cycle.';
