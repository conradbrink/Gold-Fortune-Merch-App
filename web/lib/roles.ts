/**
 * The base role, which is no longer how access is decided.
 *
 * Access moved to `lib/permissions.ts`. What is left here is the small amount
 * of role that still means something, and it is worth being precise about
 * what:
 *
 *   * **The Flutter app routes on it.** `mobile/lib/app.dart` sends anybody
 *     whose role is not `rep` to the manager notice. It knows nothing about
 *     permissions and will not until it ships a build that does.
 *   * **The modules not yet converted still read it.** Sales, stores, visits,
 *     leads, forms and files all test `current_role()` in their policies. HR
 *     and the warehouse now ask `has_permission()` instead; the rest follow.
 *   * **A job role carries one**, in `job_roles.base_role`, and applying a
 *     template sets it. That is the seam: while both systems are live, the
 *     template picks a role that can read at least what its permissions offer,
 *     so a tick box never promises access the data layer refuses.
 *
 * Nothing in this file decides what anybody may see any more. If you are
 * reaching for `AppRole` to gate a feature, you want `can()` instead.
 */

export type AppRole = "rep" | "manager" | "warehouse" | "hr_manager";

/** Every value `profiles.role` may hold, and what each one means today. */
export const ROLE_LABELS: Record<AppRole, string> = {
  rep: "Field rep",
  manager: "Manager",
  warehouse: "Warehouse",
  hr_manager: "HR",
};

/**
 * The one place a role string from the database is checked.
 *
 * Derived from `ROLE_LABELS` rather than written out again, so adding a role
 * fails to compile until it has a label and every caller starts recognising it
 * at the same moment.
 */
export function isAppRole(value: unknown): value is AppRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_LABELS, value)
  );
}
