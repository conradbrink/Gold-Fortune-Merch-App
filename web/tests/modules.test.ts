// Module gating in the web: which page belongs to which module, where a person
// lands, and what the sidebar offers. The database is the real boundary
// (supabase/tests/module_enforcement.sql); these pin the web's half so a page
// cannot be gated in the proxy and forgotten in the menu, or the reverse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canReachPath, moduleForPath, toModuleSet } from "@/lib/modules";
import { canAccessPath, homeFor, toPermissionSet } from "@/lib/permissions";
import { visibleNavGroups } from "@/components/layout/nav-items";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { parseTerms, type Terms } from "@/lib/terms";

const everything = toModuleSet({
  recurring_jobs: true,
  checklists_forms: true,
  reports: true,
  distribution: true,
  warehouse: true,
  hr: true,
});
const coreOnly = toModuleSet({});

test("each gated page belongs to its module, and anything else is core", () => {
  assert.equal(moduleForPath("/orders"), "distribution");
  assert.equal(moduleForPath("/orders/123/pick"), "distribution");
  // Money is every trade's (Stage 7), not Distribution's.
  assert.equal(moduleForPath("/quotes"), "invoicing");
  assert.equal(moduleForPath("/invoices/9"), "invoicing");
  assert.equal(moduleForPath("/owed"), "invoicing");
  assert.equal(moduleForPath("/price-list"), "invoicing");
  assert.equal(moduleForPath("/contracts/1"), "invoicing");
  assert.equal(moduleForPath("/warehouse/insights"), "warehouse");
  assert.equal(moduleForPath("/inventory/stocktakes"), "warehouse");
  assert.equal(moduleForPath("/hr/me"), "hr");
  assert.equal(moduleForPath("/forms/abc"), "checklists_forms");
  assert.equal(moduleForPath("/reports/rep-performance"), "reports");
  assert.equal(moduleForPath("/"), "core");
  assert.equal(moduleForPath("/stores"), "core");
  assert.equal(moduleForPath("/schedule"), "core");
  assert.equal(moduleForPath("/tracking"), "core");
  assert.equal(moduleForPath("/logbook"), "vehicle_logbook");
  assert.equal(moduleForPath("/logbook/vehicles"), "vehicle_logbook");
});

test("prefixes match whole segments only", () => {
  assert.equal(moduleForPath("/hrx"), "core");
  assert.equal(moduleForPath("/orders-archive"), "core");
});

test("a module that is not explicitly true is off", () => {
  const m = toModuleSet({ hr: false, warehouse: "yes", distribution: true });
  assert.equal(canReachPath(m, "/hr"), false);
  assert.equal(canReachPath(m, "/warehouse"), false);
  assert.equal(canReachPath(m, "/orders"), true);
  assert.equal(canReachPath(coreOnly, "/stores"), true);
});

test("nobody is sent home to a page of a module their company lacks", () => {
  const clerk = toPermissionSet(["warehouse", "workday"]);
  assert.equal(homeFor(clerk, (h) => canReachPath(everything, h)), "/warehouse");
  assert.equal(homeFor(clerk, (h) => canReachPath(coreOnly, h)), "/rep-notice");
  const admin = toPermissionSet(["admin"]);
  assert.equal(homeFor(admin, (h) => canReachPath(coreOnly, h)), "/");
});

test("a permission with a page in another module still has a home", () => {
  const reportsOnly = toModuleSet({ reports: true });
  const analyst = toPermissionSet(["insights"]);
  assert.equal(homeFor(analyst, (h) => canReachPath(everything, h)), "/sales");
  assert.equal(homeFor(analyst, (h) => canReachPath(reportsOnly, h)), "/reports");
  const librarian = toPermissionSet(["resources"]);
  assert.equal(homeFor(librarian, (h) => canReachPath(everything, h)), "/products");
  assert.equal(homeFor(librarian, (h) => canReachPath(coreOnly, h)), "/files");
  // /tracking is core, so even a company with no paid modules has a page for them.
  assert.equal(homeFor(analyst, (h) => canReachPath(coreOnly, h)), "/tracking");
  const distributionOnly = toModuleSet({ distribution: true });
  const clerk = toPermissionSet(["warehouse"]);
  assert.equal(homeFor(clerk, (h) => canReachPath(distributionOnly, h)), "/orders");
});

test("the sidebar offers no page of a module the company lacks", () => {
  const admin = toPermissionSet(["admin"]);
  const hrefs = (modules: ReturnType<typeof toModuleSet>) =>
    visibleNavGroups(admin, modules).flatMap((g) => g.items.map((i) => i.href));

  const full = hrefs(everything);
  assert.ok(full.includes("/orders"));
  assert.ok(full.includes("/hr"));

  const bare = hrefs(coreOnly);
  for (const href of bare) {
    assert.equal(moduleForPath(href), "core", `${href} offered without its module`);
  }
  assert.ok(bare.includes("/stores"));
  assert.ok(!bare.includes("/orders"));
  assert.ok(!bare.includes("/hr/me"));
});

test("the sidebar names things in the company's words", () => {
  const admin = toPermissionSet(["admin"]);
  const labels = (terms?: Terms) =>
    new Map(
      visibleNavGroups(admin, everything, terms).flatMap((g) =>
        g.items.map((i) => [i.href, i.label] as const)
      )
    );

  const neutral = labels();
  assert.equal(neutral.get("/stores"), "Sites");
  assert.equal(neutral.get("/representatives"), "Staff");
  assert.equal(neutral.get("/activities"), "Jobs & Activities");

  // Gold Fortune's menu reads as it always has, bar "Representatives".
  const gf = labels(
    parseTerms({
      site: { one: "Store", many: "Stores" },
      job: { one: "Visit", many: "Visits" },
      staff: { one: "Rep", many: "Reps" },
      territory: { one: "Territory", many: "Territories" },
    })
  );
  assert.equal(gf.get("/stores"), "Stores");
  assert.equal(gf.get("/territories"), "Territories");
  assert.equal(gf.get("/representatives"), "Reps");
  assert.equal(gf.get("/activities"), "Visits & Activities");
  assert.equal(gf.get("/reports/rep-performance"), "Rep performance");
  assert.equal(gf.get("/leads"), "Leads");
  // Words that are not terms stay as written.
  assert.equal(gf.get("/orders"), "Orders");
});

test("the vehicle logbook is offered with its module, to those who read the km", () => {
  const items = (permissions: string[], modules: ReturnType<typeof toModuleSet>) =>
    visibleNavGroups(toPermissionSet(permissions), modules).flatMap((g) => g.items.map((i) => i.href));
  const withLogbook = toModuleSet({ vehicle_logbook: true });
  assert.ok(items(["insights"], withLogbook).includes("/logbook"));
  assert.ok(!items(["insights"], coreOnly).includes("/logbook"));
  assert.ok(!items(["field_ops", "workday"], withLogbook).includes("/logbook"));
  assert.ok(!canAccessPath(toPermissionSet(["field_ops"]), "/logbook/vehicles"));
  assert.ok(canAccessPath(toPermissionSet(["insights"]), "/logbook/vehicles"));
});

test("money is the company's currency, written as the business writes it", () => {
  assert.equal(formatMoney(101223.5, "BWP"), "P101,223.50");
  assert.equal(formatMoney(1499, "ZAR"), "R1,499.00");
  assert.equal(formatMoneyShort(101223.5, "BWP"), "P101,224");
  assert.equal(formatMoney(null, "BWP"), "—");
  assert.equal(formatMoney(5, "XYZ"), "XYZ5.00");
});
