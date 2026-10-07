// Module gating in the web: which page belongs to which module, where a person
// lands, and what the sidebar offers. The database is the real boundary
// (supabase/tests/module_enforcement.sql); these pin the web's half so a page
// cannot be gated in the proxy and forgotten in the menu, or the reverse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canReachPath, moduleForPath, toModuleSet } from "@/lib/modules";
import { homeFor, toPermissionSet } from "@/lib/permissions";
import { visibleNavGroups } from "@/components/layout/nav-items";
import { formatMoney, formatMoneyShort } from "@/lib/money";

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
  assert.equal(moduleForPath("/quotes"), "distribution");
  assert.equal(moduleForPath("/invoices/9"), "distribution");
  assert.equal(moduleForPath("/warehouse/insights"), "warehouse");
  assert.equal(moduleForPath("/inventory/stocktakes"), "warehouse");
  assert.equal(moduleForPath("/hr/me"), "hr");
  assert.equal(moduleForPath("/forms/abc"), "checklists_forms");
  assert.equal(moduleForPath("/reports/rep-performance"), "reports");
  assert.equal(moduleForPath("/"), "core");
  assert.equal(moduleForPath("/stores"), "core");
  assert.equal(moduleForPath("/schedule"), "core");
  assert.equal(moduleForPath("/tracking"), "core");
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

test("money is the company's currency, written as the business writes it", () => {
  assert.equal(formatMoney(101223.5, "BWP"), "P101,223.50");
  assert.equal(formatMoney(1499, "ZAR"), "R1,499.00");
  assert.equal(formatMoneyShort(101223.5, "BWP"), "P101,224");
  assert.equal(formatMoney(null, "BWP"), "—");
  assert.equal(formatMoney(5, "XYZ"), "XYZ5.00");
});
