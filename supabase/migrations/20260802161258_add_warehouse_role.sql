-- A third role: warehouse.
--
-- Until now the business was one half of itself. Reps go to shops and managers
-- read what they found; nothing in the system knew what stock existed or that a
-- shop had asked for any. The warehouse module changes that, and the person who
-- runs it is neither of the two people the schema knows about.
--
-- A warehouse clerk is not a manager. They must not see a rep's GPS trail, the
-- leads pipeline, or the organisation's settings — and under the policies this
-- database already has, they will not: every one of those tables reads
-- `current_role() = 'manager' or rep_id = auth.uid()`, and a warehouse user is
-- neither. Widening the role therefore *closes* those doors rather than opening
-- them, which is why this is the safe direction to extend in.
--
-- This migration does one thing and nothing else. Every policy in the module
-- that follows names 'warehouse', and none of them can be written until a row
-- is allowed to hold the value; landing it alone also means the revert is a
-- single file rather than an unpicking.
--
-- What it deliberately does NOT do:
--
--   * It does not grant a warehouse user anything. There is no policy anywhere
--     that mentions 'warehouse' yet, so a profile with this role can currently
--     read exactly what an authenticated user with no matching policy can read,
--     which is the org-wide tables (stores, products, territories) and nothing
--     that is scoped to a rep or a manager.
--   * It does not change `current_role()` or `current_org_id()`. They return
--     whatever the column holds and always have.
--   * It does not touch the web app's route guard. `web/proxy.ts` bounces
--     `role === 'rep'` and would hand a warehouse user the full manager shell —
--     a navigation full of pages that render empty. That is fixed in the same
--     pull request as this migration, in TypeScript, because it is a routing
--     bug and not a database one.
--
-- Checked before writing: `rep_directory()`, `rep_scorecard()`, `coverage_gaps()`
-- and `call_cycle_review()` all filter `role = 'rep'` explicitly rather than
-- "not a manager", so no rep count, capacity figure or coverage denominator
-- moves as a result of a third value existing.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('rep', 'manager', 'warehouse'));

comment on column public.profiles.role is
  'rep = field merchandiser, uses the Android app only. manager = full web dashboard. warehouse = the fulfilment and inventory screens only; deliberately has no access to visits, GPS, leads or settings.';
