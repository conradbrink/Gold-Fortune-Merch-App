// The menu: simple navigation, deep pages (docs/navigation.md).
//
// These pin the promise the redesign made: the sidebar got shorter, and no page
// became unreachable. Every page in the app is either in the menu (an item or
// a tab) or linked from a named page, each route belongs to one item, and each
// person still reaches exactly what their permissions allow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeItem,
  allItemDefs,
  mobilePrimary,
  reachablePages,
  tabsFor,
  visibleNavGroups,
  type NavGroup,
} from "@/components/layout/nav-items";
import { toModuleSet } from "@/lib/modules";
import { toPermissionSet } from "@/lib/permissions";
import { parseTerms } from "@/lib/terms";
import { parseCompanyConfig } from "@/lib/company-config";
import { storeHealthHref, storeRangeHref, storeReorderHref } from "@/lib/dashboard-links";

const web = fileURLToPath(new URL("..", import.meta.url));
const admin = toPermissionSet(["admin"]);

/** A company with every module and every money switch on. */
const distributor = toModuleSet({
  recurring_jobs: true,
  checklists_forms: true,
  reports: true,
  distribution: true,
  warehouse: true,
  hr: true,
  invoicing: true,
  vehicle_logbook: true,
  owner_notifications: true,
});
const service = toModuleSet({
  recurring_jobs: true,
  checklists_forms: true,
  reports: true,
  hr: true,
  invoicing: true,
  vehicle_logbook: true,
  owner_notifications: true,
});
const allSwitches = parseCompanyConfig({
  org_id: "o",
  settings: { money_workflow: "contract_extras", money_contracts: true },
  modules: {},
})!.settings;

const hrefs = (groups: NavGroup[]) => reachablePages(groups).map((p) => p.href);

/** Every page route under app/(dashboard), as a URL path. */
function pageRoutes(): string[] {
  const root = join(web, "app", "(dashboard)");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const route = "/" + relative(root, dir).split(sep).filter(Boolean).join("/");
        out.push(route === "/" ? "/" : route.replace(/\/$/, ""));
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Pages reached from a button or link on another page rather than from the
 * menu, with the file that links to them. The test reads that file, so a
 * removed button fails here instead of stranding the page.
 */
const LINKED_FROM: Record<string, string> = {
  "/commissions/rules": "app/(dashboard)/commissions/page.tsx",
  "/logbook/vehicles": "app/(dashboard)/logbook/page.tsx",
  "/invoices/unbilled": "app/(dashboard)/invoices/page.tsx",
  "/inventory/adjustments": "app/(dashboard)/inventory/page.tsx",
  "/inventory/transfers": "app/(dashboard)/inventory/page.tsx",
  "/inventory/stocktakes": "app/(dashboard)/inventory/page.tsx",
  "/inventory/receive": "app/(dashboard)/inventory/page.tsx",
  "/hr/me": "components/layout/top-bar.tsx",
  "/plans": "components/dashboard/account-cards.tsx",
  // One person's full report: their name on Reports → Team or the summary.
  "/reports/rep-performance": "app/(dashboard)/reports/page.tsx",
  // The dashboard's Store health card as a list; its numbers open it too.
  "/stores/health": "app/(dashboard)/stores/page.tsx",
  // Stores due for an order; the dashboard card opens it too.
  "/stores/reorder": "app/(dashboard)/stores/page.tsx",
  // Range: which products each store should carry; the dashboard card opens it too.
  "/stores/range": "app/(dashboard)/stores/page.tsx",
  // Damaged stock the reps reported; the dashboard card links it too.
  "/stores/damages": "app/(dashboard)/stores/page.tsx",
  // The Orders pipeline and Field team cards as pages; their cards open them too.
  "/orders/pipeline": "app/(dashboard)/orders/page.tsx",
  // Finished orders, off the orders board.
  "/orders/archive": "app/(dashboard)/orders/page.tsx",
  "/tracking/team": "app/(dashboard)/tracking/page.tsx",
};

/**
 * Pages whose buttons build their link with a function from lib/dashboard-links.ts
 * (so the link can carry a filter, such as the store group). The linking file
 * must call it, and it must build that page's address.
 */
const BUILT_BY: Record<string, () => string> = {
  "/stores/health": storeHealthHref,
  "/stores/reorder": storeReorderHref,
  "/stores/range": storeRangeHref,
};

/**
 * Old addresses kept for the links already out there, which only forward to
 * where the page went: Company settings is Settings (22 Oct 2026), and Plan
 * and billing is Settings > Plan.
 */
const FORWARDS: Record<string, string> = {
  "/settings/company": "/settings/business",
  "/billing": "/settings/plan",
};

test("every page in the app is in the menu or linked from a named page", () => {
  const offered = new Set([
    ...hrefs(visibleNavGroups(admin, distributor, undefined, allSwitches)),
    ...hrefs(visibleNavGroups(admin, service, undefined, allSwitches)),
  ]);
  const missing: string[] = [];
  for (const route of pageRoutes()) {
    // A record (/invoices/[id]), a form for a new one (/quotes/new) or the
    // "not part of your plan" notice is reached from its list, not a menu.
    if (route.includes("[") || route.endsWith("/new") || route === "/not-enabled") continue;
    if (offered.has(route)) continue;
    if (FORWARDS[route]) {
      const page = readFileSync(join(web, "app", "(dashboard)", ...route.split("/").filter(Boolean), "page.tsx"), "utf8");
      if (page.includes("redirect(") && offered.has(FORWARDS[route])) continue;
    }
    const from = LINKED_FROM[route];
    const source = from ? readFileSync(join(web, from), "utf8") : "";
    if (from && (source.includes(`"${route}`) || source.includes(`\`${route}`))) continue;
    const build = BUILT_BY[route];
    if (from && build && source.includes(`${build.name}(`) && build().split("?")[0] === route) continue;
    missing.push(route);
  }
  assert.deepEqual(missing, [], `pages nobody can reach: ${missing.join(", ")}`);
});

test("everything the old menu offered is still offered, to an administrator", () => {
  const old = [
    "/", "/sales", "/reports", "/warehouse/insights", "/targets",
    "/commissions", "/leads", "/stores", "/territories", "/schedule", "/tracking", "/logbook",
    "/activities", "/promotions", "/quotes", "/invoices", "/contracts", "/owed", "/statements",
    "/price-list", "/warehouse", "/orders", "/recurring-orders", "/inventory", "/products",
    "/warehouse/settings", "/representatives", "/hr", "/hr/employees", "/hr/attendance",
    "/hr/leave", "/hr/documents", "/hr/performance", "/hr/disciplinary", "/hr/settings",
    "/settings/users", "/settings/business", "/forms", "/files",
  ];
  const offered = new Set(hrefs(visibleNavGroups(admin, distributor, undefined, allSwitches)));
  assert.deepEqual(old.filter((h) => !offered.has(h)), []);
});

test("the service layout keeps every service page; the sales pages stay with distribution", () => {
  const offered = new Set(hrefs(visibleNavGroups(admin, service, undefined, allSwitches)));
  for (const h of [
    "/stores", "/stores/review", "/territories", "/schedule", "/visits", "/activities", "/visits/off-site",
    "/tracking", "/logbook", "/representatives", "/quotes", "/invoices", "/contracts", "/statements",
    "/price-list", "/owed", "/reports", "/hr", "/hr/settings",
    "/settings/users", "/settings/business", "/settings/team", "/settings/notifications", "/settings/plan",
    "/forms", "/files",
  ]) {
    assert.ok(offered.has(h), `${h} missing from the service menu`);
  }
  for (const h of ["/orders", "/leads", "/products", "/sales", "/warehouse", "/commissions"]) {
    assert.ok(!offered.has(h), `${h} offered to a company without its module`);
  }
});

test("each page belongs to one item, so one item is highlighted wherever you are", () => {
  for (const modules of [distributor, service]) {
    const groups = visibleNavGroups(admin, modules, undefined, allSwitches);
    const seen = new Map<string, string>();
    for (const item of groups.flatMap((g) => g.items)) {
      for (const path of item.matches) {
        assert.ok(!seen.has(path), `${path} is in both ${seen.get(path)} and ${item.id}`);
        seen.set(path, item.id);
      }
    }
  }
  // And an item is in a layout once.
  assert.equal(new Set(allItemDefs.map((i) => i.href)).size, allItemDefs.length);
});

test("the item that lights up for a page", () => {
  const groups = visibleNavGroups(admin, distributor, undefined, allSwitches);
  const at = (path: string) => activeItem(groups, path)?.id ?? null;
  assert.equal(at("/"), "/");
  assert.equal(at("/warehouse"), "/warehouse");
  assert.equal(at("/warehouse/insights"), "/reports");
  assert.equal(at("/warehouse/settings"), "/settings/business");
  assert.equal(at("/hr/settings"), "/settings/business");
  assert.equal(at("/settings/team"), "/settings/business");
  assert.equal(at("/settings/plan"), "/settings/business");
  assert.equal(at("/settings/company"), "/settings/business");
  assert.equal(at("/billing/invoices/abc"), "/settings/business");
  assert.equal(at("/hr"), "/hr/employees");
  assert.equal(at("/hr/employees/42"), "/hr/employees");
  assert.equal(at("/plans"), "/settings/business");
  assert.equal(at("/invoices/abc"), "/invoices");
  assert.equal(at("/statements"), "/invoices");
  assert.equal(at("/visits/off-site"), "/visits");
  assert.equal(at("/activities"), "/visits");
  assert.equal(at("/logbook/vehicles"), "/tracking");
  // A person's own HR record is in the profile menu, not the sidebar.
  assert.equal(at("/hr/me"), null);
});

test("the tab row is drawn on the pages it lists, not on a record", () => {
  const groups = visibleNavGroups(admin, distributor, undefined, allSwitches);
  assert.deepEqual(
    tabsFor(groups, "/invoices")?.tabs.map((t) => t.label),
    ["Invoices", "Contracts", "Statements", "Price list"]
  );
  assert.equal(tabsFor(groups, "/statements")?.current, "/statements");
  assert.equal(tabsFor(groups, "/invoices/abc"), null);
  assert.equal(tabsFor(groups, "/schedule"), null);
  assert.deepEqual(
    tabsFor(groups, "/reports")?.tabs.map((t) => t.href),
    ["/reports", "/sales", "/targets", "/warehouse/insights"]
  );
  assert.deepEqual(
    tabsFor(groups, "/hr/settings")?.tabs.map((t) => t.label),
    ["Business", "Team & Work", "Notifications", "Plan", "HR", "Warehouse"]
  );
  assert.equal(tabsFor(groups, "/settings/notifications")?.current, "/settings/notifications");
  // A plan's invoice is a record: no tab row.
  assert.equal(tabsFor(groups, "/billing/invoices/abc"), null);
});

test("each trade reads its own words", () => {
  const words = (raw: Record<string, { one: string; many: string }>) => {
    const groups = visibleNavGroups(admin, service, parseTerms(raw), allSwitches);
    return new Map(groups.flatMap((g) => g.items).map((i) => [i.id, i.label] as const));
  };
  const cleaning = words({
    site: { one: "Site", many: "Sites" },
    job: { one: "Visit", many: "Visits" },
    staff: { one: "Cleaner", many: "Cleaners" },
  });
  assert.equal(cleaning.get("/stores"), "Sites");
  assert.equal(cleaning.get("/visits"), "Visits");
  assert.equal(cleaning.get("/representatives"), "Cleaners");
  assert.equal(cleaning.get("/territories"), "Territories");
  const delivery = words({
    site: { one: "Stop", many: "Stops" },
    job: { one: "Delivery", many: "Deliveries" },
    staff: { one: "Driver", many: "Drivers" },
  });
  assert.equal(delivery.get("/stores"), "Stops");
  assert.equal(delivery.get("/visits"), "Deliveries");
  assert.equal(delivery.get("/representatives"), "Drivers");
  // No "Activities" and no "Sales" for a service business.
  const labels = [...cleaning.values()].join("|");
  assert.ok(!/Activities|Sales/.test(labels), labels);
});

test("each person sees only what their permissions open", () => {
  // An HR manager: People, and Settings opening on HR settings.
  const hrManager = visibleNavGroups(toPermissionSet(["hr", "hr_settings", "workday"]), distributor);
  assert.deepEqual(hrManager.map((g) => g.label), ["People", "Admin"]);
  const settings = hrManager.flatMap((g) => g.items).find((i) => i.id === "/settings/business");
  assert.equal(settings?.href, "/hr/settings");
  assert.deepEqual(settings?.tabs.map((t) => t.href), ["/hr/settings"]);

  // Gold Fortune's warehouse clerk: the orders and stock, and the warehouse
  // setup they could open before, now under Settings.
  const clerk = visibleNavGroups(toPermissionSet(["warehouse", "workday", "invoicing"]), distributor);
  const clerkPages = hrefs(clerk);
  for (const h of ["/orders", "/inventory", "/warehouse", "/recurring-orders", "/warehouse/settings", "/invoices"]) {
    assert.ok(clerkPages.includes(h), `${h} lost by the clerk`);
  }
  assert.ok(!clerkPages.includes("/reports") && !clerkPages.includes("/settings/users"));

  // Field operations only: the schedule and the work, no reports or tracking.
  const fieldOnly = hrefs(visibleNavGroups(toPermissionSet(["field_ops"]), service));
  assert.ok(fieldOnly.includes("/schedule") && fieldOnly.includes("/visits"));
  assert.ok(!fieldOnly.includes("/tracking") && !fieldOnly.includes("/reports"));
});

test("the phone's bottom bar leads with the day's work", () => {
  const groups = visibleNavGroups(admin, service, undefined, allSwitches);
  assert.deepEqual(mobilePrimary(groups).map((i) => i.id), ["/", "/visits", "/schedule", "/stores"]);
  // Someone without the field pages gets the first places in their own menu.
  const hr = visibleNavGroups(toPermissionSet(["hr", "hr_settings"]), service);
  assert.deepEqual(mobilePrimary(hr).map((i) => i.id), [
    "/hr/employees",
    "/hr/attendance",
    "/hr/leave",
    "/hr/performance",
  ]);
});
