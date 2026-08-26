/**
 * Who may see which page.
 *
 * This module is imported by `proxy.ts` (which runs on the server, before the
 * page does) and by the sidebar (which runs in the browser). It must therefore
 * stay free of any client-only or server-only import — it is plain data and
 * plain functions, deliberately.
 *
 * The two callers do different jobs and both are needed. The proxy is the
 * enforcement: it decides whether a request is served at all. The sidebar is
 * the courtesy: it stops offering destinations that would bounce. Neither is a
 * security boundary on its own — RLS is — but a clerk who can see "Reports" in
 * the menu and is thrown out when they click it has been told the product is
 * broken, which is its own kind of failure.
 */

export type AppRole = "rep" | "manager" | "warehouse" | "hr_manager";

/**
 * The prefixes a warehouse clerk may reach.
 *
 * An allowlist, not a denylist. The previous guard asked "is this person a
 * rep?" and bounced them; everyone else got the manager shell by default. That
 * default is what made adding a third role a routing bug — a warehouse user is
 * not a rep, so they fell through to everything. Listing what is permitted
 * means the next role added is locked out until somebody decides otherwise,
 * which is the safer direction to be wrong in.
 *
 * Deliberately short. `/stores` and `/products` were both considered and both
 * left out: the clerk does need a store's address and a product's pack size,
 * but those existing pages are management screens whose write policies are
 * manager-only (`products_write`, `stores_insert`), so a clerk would get a full
 * CRUD interface where every button fails on RLS. The lookups they actually
 * need are built into the warehouse screens instead, where the UI can be the
 * clerk's rather than the manager's. `/stores/review` — the triage queue for
 * rep GPS drift — is the sort of thing this role should never have been near.
 */
const WAREHOUSE_ALLOWED = ["/warehouse", "/orders", "/inventory"] as const;

/**
 * Carved back out of the allowlist above.
 *
 * `/warehouse/insights` ranks staff by fulfilment time and accuracy. That is
 * management information about a clerk's colleagues, and it sits under the
 * `/warehouse` prefix only because that is where it belongs in the navigation.
 * Denials are checked first, so the prefix does not let it through.
 */
const WAREHOUSE_DENIED = ["/warehouse/insights"] as const;

/**
 * The HR module, and nothing else.
 *
 * An HR manager reads dates of birth, salaries and disciplinary histories, and
 * has no business in sales, the warehouse, the leads pipeline or the
 * organisation's settings. One prefix is the whole grant, and the database
 * agrees: every HR policy names `hr_manager`, and no other policy in the schema
 * does.
 */
const HR_MANAGER_ALLOWED = ["/hr"] as const;

/**
 * Employee self-service, reachable by every role.
 *
 * Reps work in the Android app and the web dashboard bounces them to
 * `/rep-notice` — which is right for the merchandising screens and wrong for
 * this one. Somebody has to be able to read their own leave balance, submit a
 * request, and acknowledge their own review, and the alternative was building
 * all of that a second time in Flutter for a release cycle we do not need.
 * This page is deliberately the only exception: it shows the signed-in person
 * their own record and refuses to render anybody else's, and RLS refuses it
 * again underneath.
 */
const SELF_SERVICE = "/hr/me";

/** Where each role lands when it asks for the site root. */
export const ROLE_HOME: Record<AppRole, string> = {
  rep: "/rep-notice",
  manager: "/",
  warehouse: "/warehouse",
  hr_manager: "/hr",
};

/**
 * Prefix match on whole path segments.
 *
 * `startsWith` alone would let `/ordersomething` through on the strength of
 * `/orders`, and would match `/stores-archive` against `/stores`. The next
 * character has to be a separator or the end of the path.
 *
 * Exported because `proxy.ts` needs the same rule for its exemption list, and
 * that list is the one place where a wrong match grants access rather than
 * denying it.
 */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(prefix + "/");
}

/**
 * The one place a role string from the database is checked.
 *
 * Derived from `ROLE_HOME` rather than written out again, so adding a role to
 * `AppRole` fails to compile until it has a home — and every caller of this
 * guard starts recognising it at the same moment. Two hand-written copies of
 * the same triple would each silently treat a fourth role as unknown, in two
 * different ways.
 */
export function isAppRole(value: unknown): value is AppRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_HOME, value)
  );
}

/** Whether `role` may load `pathname`. */
export function canAccessPath(role: AppRole, pathname: string): boolean {
  if (role === "manager") return true;

  // Checked before every allowlist below, because it is the one destination
  // that is about the caller rather than about the caller's job.
  if (matchesPrefix(pathname, SELF_SERVICE)) return true;

  // A rep's only other destination is their own notice page. Returning `false`
  // for every path including that one made `ROLE_HOME.rep` a path its own role
  // may not load — an invariant violated from the start, and harmless today
  // only because `proxy.ts` exempts `/rep-notice` before it gets here. The loop
  // guard in the proxy should be the thing that never fires, not the thing
  // holding the arrangement together.
  if (role === "rep") return matchesPrefix(pathname, ROLE_HOME.rep);

  if (role === "hr_manager") {
    return HR_MANAGER_ALLOWED.some((p) => matchesPrefix(pathname, p));
  }

  if (WAREHOUSE_DENIED.some((p) => matchesPrefix(pathname, p))) return false;
  return WAREHOUSE_ALLOWED.some((p) => matchesPrefix(pathname, p));
}

/**
 * Whether this role runs the HR module, as opposed to merely appearing in it.
 *
 * Presentation only — it decides which buttons are offered. `hr_is_hr()` in the
 * database is the same question asked where it counts, and the two are
 * deliberately the same pair of roles. A line manager is not HR: they are
 * granted their own team by `hr_manages_employee`, which is a row-level fact
 * and cannot be answered from a role string.
 */
export function isHrRole(role: AppRole | null): boolean {
  return role === "manager" || role === "hr_manager";
}
