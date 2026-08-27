/**
 * What a person may reach, and the one place that decides it.
 *
 * This replaces the role allowlists that used to live in `lib/roles.ts`. The
 * difference is not cosmetic: a role is one string and a person is not. The CFO
 * who needs the warehouse and HR but not sales had no role, and inventing one
 * would have moved the problem to whoever did not fit next.
 *
 * Like `roles.ts` before it, this module is imported by `proxy.ts` (server,
 * before the page renders) and by the sidebar (browser). It must stay free of
 * any client-only or server-only import — plain data and plain functions.
 *
 * And like that module, neither caller is the security boundary. The proxy
 * decides whether a request is served; the sidebar stops offering destinations
 * that would bounce. RLS decides what can actually be read, and since the
 * permission migrations it asks `has_permission()` — the same names as below —
 * for HR and the warehouse. The rest of the app still asks the role, which is
 * why `app_permissions.data_enforced` exists and why the admin screen says
 * which is which.
 */

export type PermissionCode =
  | "admin"
  | "dashboard"
  | "insights"
  | "sales_coverage"
  | "field_ops"
  | "warehouse"
  | "warehouse_approve"
  | "team"
  | "resources"
  | "hr"
  | "hr_settings"
  | "company_settings"
  | "workday";

/** What the caller holds. A plain set, so the proxy and the browser agree. */
export type PermissionSet = ReadonlySet<string>;

export function toPermissionSet(codes: readonly string[] | null | undefined): PermissionSet {
  return new Set(codes ?? []);
}

/**
 * Whether the caller holds a permission.
 *
 * `admin` satisfies everything, exactly as `has_permission()` does in the
 * database. The two must agree or the menu and the data will disagree, and the
 * user will be told they can do something they cannot.
 */
export function can(permissions: PermissionSet, code: PermissionCode): boolean {
  return permissions.has("admin") || permissions.has(code);
}

/**
 * Destinations that need no permission at all.
 *
 * `/hr/me` is a person's own record — their leave, their attendance, their
 * review. Requiring a grant to see yourself would mean an administrator could
 * accidentally make somebody invisible to themselves. `/rep-notice` is the
 * explanation shown to whoever has nothing else, and a home that its own owner
 * may not load is a redirect loop.
 */
const ALWAYS_ALLOWED = ["/hr/me", "/rep-notice"] as const;

/**
 * Which permission each destination needs.
 *
 * Longest prefix wins, which is the whole reason this is a list and not a map:
 * `/warehouse/insights` ranks staff by fulfilment time and is management
 * information, so it must not inherit `/warehouse`; `/stores/review` is the GPS
 * triage queue and belongs to field operations rather than to the store list.
 */
const PATH_PERMISSIONS: { prefix: string; permission: PermissionCode }[] = [
  { prefix: "/warehouse/insights", permission: "insights" },
  { prefix: "/stores/review", permission: "field_ops" },
  { prefix: "/hr/settings", permission: "hr_settings" },
  { prefix: "/settings/users", permission: "admin" },
  { prefix: "/settings/company", permission: "company_settings" },

  { prefix: "/warehouse", permission: "warehouse" },
  { prefix: "/orders", permission: "warehouse" },
  { prefix: "/inventory", permission: "warehouse" },
  { prefix: "/sales", permission: "insights" },
  { prefix: "/reports", permission: "insights" },
  { prefix: "/leads", permission: "sales_coverage" },
  { prefix: "/stores", permission: "sales_coverage" },
  { prefix: "/territories", permission: "sales_coverage" },
  { prefix: "/schedule", permission: "field_ops" },
  { prefix: "/activities", permission: "field_ops" },
  { prefix: "/visits", permission: "field_ops" },
  { prefix: "/promotions", permission: "field_ops" },
  { prefix: "/representatives", permission: "team" },
  { prefix: "/products", permission: "resources" },
  { prefix: "/forms", permission: "resources" },
  { prefix: "/files", permission: "resources" },
  { prefix: "/hr", permission: "hr" },
];

/**
 * Prefix match on whole path segments.
 *
 * `startsWith` alone would let `/ordersomething` through on the strength of
 * `/orders`, and would match `/stores-archive` against `/stores`. The next
 * character has to be a separator or the end of the path. Carried over
 * unchanged from `roles.ts`, where it was the one rule whose failure mode
 * granted access rather than denying it.
 */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(prefix + "/");
}

/** The permission a path needs, or null when it needs none. */
export function permissionForPath(pathname: string): PermissionCode | null {
  if (pathname === "/") return "dashboard";
  if (ALWAYS_ALLOWED.some((p) => matchesPrefix(pathname, p))) return null;

  let best: { prefix: string; permission: PermissionCode } | null = null;
  for (const entry of PATH_PERMISSIONS) {
    if (!matchesPrefix(pathname, entry.prefix)) continue;
    if (best === null || entry.prefix.length > best.prefix.length) best = entry;
  }
  // An unmapped path is refused rather than allowed. A page added tomorrow is
  // locked until somebody decides who it belongs to, which is the safer
  // direction to be wrong in — the same default `roles.ts` chose.
  return best?.permission ?? "admin";
}

export function canAccessPath(permissions: PermissionSet, pathname: string): boolean {
  const needed = permissionForPath(pathname);
  return needed === null || can(permissions, needed);
}

/**
 * Where somebody lands when they ask for the site root.
 *
 * The first destination they can actually open, in the order a person would
 * think of them. Falls through to `/rep-notice` for anybody whose only
 * permission is their own working day — which is every field rep, and which is
 * why that page still explains that the real work happens in the phone app.
 */
export function homeFor(permissions: PermissionSet): string {
  const order: [PermissionCode, string][] = [
    ["dashboard", "/"],
    ["warehouse", "/warehouse"],
    ["hr", "/hr"],
    ["insights", "/sales"],
    ["field_ops", "/schedule"],
    ["sales_coverage", "/stores"],
    ["team", "/representatives"],
    ["resources", "/products"],
    // Last, and only because `permissionForPath` lets these two open a page on
    // their own. Somebody holding nothing but `hr_settings` was sent to
    // /rep-notice from the site root while /hr/settings would have loaded for
    // them — a landing page that contradicts the proxy standing next to it.
    ["hr_settings", "/hr/settings"],
    ["company_settings", "/settings/company"],
  ];
  for (const [permission, href] of order) {
    if (can(permissions, permission)) return href;
  }
  return "/rep-notice";
}
