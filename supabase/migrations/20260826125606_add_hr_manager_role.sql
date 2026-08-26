-- A fourth role: hr_manager.
--
-- The HR module needs a person who may read a colleague's date of birth,
-- disciplinary history and leave balance, and who may not change the
-- organisation's settings, invite users or reach the warehouse and sales
-- screens. Neither `manager` (which means full access) nor `warehouse` is that
-- person, and `rep` certainly is not.
--
-- Landed alone, like `add_warehouse_role` before it, and for the same reason:
-- every HR policy that follows names 'hr_manager' and none can be written
-- until a row is allowed to hold the value.
--
-- What this does NOT do:
--
--   * It grants nothing. No policy in the database mentions 'hr_manager' yet,
--     so such a profile reads exactly what an authenticated user with no
--     matching policy reads — the org-wide reference tables and nothing that
--     is scoped to a rep or a manager. Every existing policy asks for
--     `= 'manager'` or `rep_id = auth.uid()`, and an HR manager is neither.
--   * It does not touch `current_role()` or `current_org_id()`, which return
--     whatever the column holds.
--   * It does not change the web route guard or the mobile app. `web/proxy.ts`
--     is fixed in TypeScript in the same pull request. The Flutter app routes
--     on `role != 'rep'`, so an HR manager already lands on the manager notice
--     rather than the rep UI — no change needed there, and checked rather than
--     assumed (`mobile/lib/app.dart:193`).
--
-- Checked before writing: `rep_directory()`, `rep_scorecard()`,
-- `coverage_gaps()` and `call_cycle_review()` all filter `role = 'rep'`
-- explicitly, so no rep count or coverage denominator moves because a fourth
-- value exists.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('rep', 'manager', 'warehouse', 'hr_manager'));

comment on column public.profiles.role is
  'rep = field merchandiser, uses the Android app only. manager = full web dashboard, and the Admin tier for HR. warehouse = the fulfilment and inventory screens only. hr_manager = the HR module only; deliberately has no access to sales, warehouse, settings or the security trail outside HR.';
