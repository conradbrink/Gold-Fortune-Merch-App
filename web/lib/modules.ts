/**
 * Which module each destination belongs to, and whether a company has it.
 *
 * Modules are switched per company by the platform operator (requirements §5:
 * "Every feature is a module that can be switched on or off per company").
 * The database is the boundary — every gated table carries a restrictive
 * `module_gate` policy and every gated RPC starts with `require_module` (see
 * `supabase/migrations/20261007112638_enforce_modules.sql`). This file is the
 * web's half: `proxy.ts` refuses a page whose module is off, and the sidebar
 * and the dashboard stop offering it.
 *
 * Like `permissions.ts`, it is imported by the proxy (server) and by the
 * chrome (browser), so it stays plain data and plain functions.
 *
 * One map, by path. Nav items, dashboard links and redirects all ask
 * `moduleForPath`, so a page cannot be gated in the proxy and forgotten in the
 * menu, or the other way round. A path that matches nothing is `core`.
 */

import { matchesPrefix } from "@/lib/permissions";

export type ModuleCode =
  | "core"
  | "recurring_jobs"
  | "checklists_forms"
  | "reports"
  | "distribution"
  | "warehouse"
  | "hr";

/** The modules a company has on. `core` is implied and never stored. */
export type ModuleSet = ReadonlySet<string>;

/**
 * From `my_company_config().modules`, a `{ code: boolean }` map. Anything not
 * `true` is off — a missing key is a module this build does not know about
 * yet, and the safe reading of an unknown module is "not yours".
 */
export function toModuleSet(map: Record<string, unknown> | null | undefined): ModuleSet {
  const on = new Set<string>(["core"]);
  for (const [code, enabled] of Object.entries(map ?? {})) {
    if (enabled === true) on.add(code);
  }
  return on;
}

export function moduleEnabled(modules: ModuleSet, code: ModuleCode): boolean {
  return code === "core" || modules.has(code);
}

/**
 * Longest prefix wins, as in `PATH_PERMISSIONS`: `/warehouse/insights` is a
 * warehouse page whatever `/warehouse`'s neighbours are, and `/hr/me` is HR —
 * with the HR module off there is no HR record to show anybody, themselves
 * included.
 */
const MODULE_PATHS: { prefix: string; module: ModuleCode }[] = [
  { prefix: "/orders", module: "distribution" },
  { prefix: "/quotes", module: "distribution" },
  { prefix: "/invoices", module: "distribution" },
  { prefix: "/recurring-orders", module: "distribution" },
  { prefix: "/targets", module: "distribution" },
  { prefix: "/commissions", module: "distribution" },
  { prefix: "/products", module: "distribution" },
  { prefix: "/promotions", module: "distribution" },
  { prefix: "/leads", module: "distribution" },
  { prefix: "/sales", module: "distribution" },

  { prefix: "/warehouse", module: "warehouse" },
  { prefix: "/inventory", module: "warehouse" },

  { prefix: "/hr", module: "hr" },

  { prefix: "/forms", module: "checklists_forms" },

  { prefix: "/reports", module: "reports" },
];

/** The module a path belongs to; `core` when no prefix claims it. */
export function moduleForPath(pathname: string): ModuleCode {
  let best: { prefix: string; module: ModuleCode } | null = null;
  for (const entry of MODULE_PATHS) {
    if (!matchesPrefix(pathname, entry.prefix)) continue;
    if (best === null || entry.prefix.length > best.prefix.length) best = entry;
  }
  return best?.module ?? "core";
}

export function canReachPath(modules: ModuleSet, pathname: string): boolean {
  return moduleEnabled(modules, moduleForPath(pathname));
}
