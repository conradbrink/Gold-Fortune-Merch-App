-- Call cycle: how often a store is visited, and on which day of the rep's week.
--
-- Frequency sits on the STORE because it is intrinsic to the store — a
-- high-volume branch needs weekly attention regardless of who covers it, and
-- reassigning it to another rep should not lose that. The day sits on the
-- ASSIGNMENT because it only means something in the context of one rep's week.
alter table public.stores
  add column if not exists visit_frequency text not null default 'weekly';

alter table public.stores drop constraint if exists stores_visit_frequency_check;
alter table public.stores add constraint stores_visit_frequency_check
  check (visit_frequency in ('weekly', 'biweekly', 'monthly'));

alter table public.store_assignments
  add column if not exists day_of_week   smallint,
  add column if not exists week_of_cycle smallint;

alter table public.store_assignments drop constraint if exists store_assignments_day_of_week_check;
alter table public.store_assignments add constraint store_assignments_day_of_week_check
  -- ISO weekday: 1 = Monday … 7 = Sunday, matching extract(isodow).
  check (day_of_week is null or day_of_week between 1 and 7);

alter table public.store_assignments drop constraint if exists store_assignments_week_of_cycle_check;
alter table public.store_assignments add constraint store_assignments_week_of_cycle_check
  -- 1-2 for bi-weekly (week A / week B), 1-4 for monthly (nth weekday of month).
  check (week_of_cycle is null or week_of_cycle between 1 and 4);

comment on column public.store_assignments.day_of_week is
  'ISO weekday 1=Mon..7=Sun. Null means unplanned — the store will never be scheduled.';
comment on column public.store_assignments.week_of_cycle is
  'Bi-weekly: 1=week A, 2=week B (ISO week parity). Monthly: nth occurrence of that weekday in the month. Ignored when the store is weekly.';

-- The safety net for the generator.
--
-- routes had NO unique constraint of any kind, so re-running a generator would
-- silently create duplicate stops. That is not cosmetic: the Flutter app renders
-- one card per route row (identity is route.id), so the rep would see the same
-- store twice, and both schedule_adherence.planned and the app's monthly
-- completion count route rows, so the numbers would inflate.
--
-- Verified zero existing duplicates before adding this.
create unique index if not exists routes_rep_store_date_key
  on public.routes (rep_id, store_id, scheduled_date);
