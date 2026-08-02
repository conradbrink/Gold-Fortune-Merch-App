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

export type AppRole = "rep" | "manager" | "warehouse";

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

/** Where each role lands when it asks for the site root. */
export const ROLE_HOME: Record<AppRole, string> = {
  rep: "/rep-notice",
  manager: "/",
  warehouse: "/warehouse",
};

/**
 * Prefix match on whole path segments.
 *
 * `startsWith` alone would let `/ordersomething` through on the strength of
 * `/orders`, and would match `/stores-archive` against `/stores`. The next
 * character has to be a separator or the end of the path.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(prefix + "/");
}

/** Whether `role` may load `pathname`. */
export function canAccessPath(role: AppRole, pathname: string): boolean {
  if (role === "manager") return true;
  if (role === "rep") return false;

  if (WAREHOUSE_DENIED.some((p) => matchesPrefix(pathname, p))) return false;
  return WAREHOUSE_ALLOWED.some((p) => matchesPrefix(pathname, p));
}
