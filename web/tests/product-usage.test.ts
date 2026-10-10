// The Product page's rules, and the dashboard's funnel sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moduleCompanies, moduleRows, USED_WHEN } from "@/lib/product-usage";
import { funnelSentence } from "@/lib/control-dashboard";

const modules = [
  { code: "core", name: "Core tracking", is_built: true, plan_type: "core" },
  { code: "hr", name: "HR", is_built: true },
  { code: "checklists_forms", name: "Checklists and forms", is_built: true },
  { code: "assets", name: "Assets and equipment", is_built: false },
];
const enabled = [
  { org_id: "a", module_code: "core" },
  { org_id: "b", module_code: "core" },
  { org_id: "a", module_code: "hr" },
  { org_id: "b", module_code: "hr" },
  { org_id: "a", module_code: "checklists_forms" },
];

test("switched on vs used, share of active companies, trend and idle", () => {
  const rows = moduleRows({
    modules,
    enabled,
    now: [
      { module_code: "core", org_id: "a", n: 40 },
      { module_code: "core", org_id: "b", n: 12 },
      { module_code: "checklists_forms", org_id: "a", n: 9 },
    ],
    before: [{ module_code: "core", org_id: "a", n: 30 }],
    activeOrgs: new Set(["a", "b"]),
    allOrgs: new Set(["a", "b", "c"]),
  });
  assert.deepEqual(
    rows.map((r) => [r.code, r.switchedOn, r.usedBy, r.usedByBefore, r.uses, r.ofActive, r.idle]),
    [
      ["core", 3, 2, 1, 52, 1, 1],
      ["checklists_forms", 1, 1, 0, 9, 0.5, 0],
      ["hr", 2, 0, 0, 0, 0, 2],
    ]
  );
  assert.ok(!rows.some((r) => r.code === "assets"), "unbuilt modules are left out");
  assert.equal(rows[0].usedWhen, "a job is checked into");
  assert.equal(moduleRows({ modules, enabled, now: [], before: [], activeOrgs: new Set(), allOrgs: new Set() })[0].ofActive, null);
});

test("every built module that's counted says what 'used' means", () => {
  for (const code of ["core", "recurring_jobs", "checklists_forms", "owner_notifications", "distribution", "warehouse", "hr", "vehicle_logbook", "invoicing"]) {
    assert.ok(USED_WHEN[code], code);
  }
});

test("the companies behind one module", () => {
  const names = new Map([["a", "Ndlovu Plumbing"], ["b", "Mokoena Cleaning"], ["c", "Sibiya Security"]]);
  const list = moduleCompanies(modules[0], enabled, [
    { module_code: "core", org_id: "b", n: 12 },
    { module_code: "core", org_id: "c", n: 3 },
  ], names);
  // Core is on for every company.
  assert.deepEqual(list.map((x) => [x.name, x.switchedOn, x.uses]), [
    ["Mokoena Cleaning", true, 12],
    ["Sibiya Security", true, 3],
    ["Ndlovu Plumbing", true, 0],
  ]);
});

test("the funnel sentence reads naturally at every stage", () => {
  assert.equal(funnelSentence(null, 0, 0, 0), "The funnel fills in as people come to the website and apply.");
  assert.equal(funnelSentence(0, 0, 0, 0), "Nobody has come to the website in this period yet.");
  assert.equal(funnelSentence(1, 0, 0, 0), "1 visitor so far, and no applications yet. Paying companies appear once billing is live.");
  assert.equal(funnelSentence(412, 4, 0, 0), "1.0% of visitors applied (4); none has a company set up yet. Paying companies appear once billing is live.");
  assert.equal(
    funnelSentence(412, 4, 2, 0),
    "1.0% of visitors applied (4), and 50% of applicants got a company; none has finished a first job yet. Paying companies appear once billing is live."
  );
  assert.equal(
    funnelSentence(400, 8, 4, 1),
    "2.0% of visitors applied (8), 50% of applicants got a company, and 25% of those finished a first job. Paying companies appear once billing is live."
  );
  assert.ok(!funnelSentence(1, 0, 0, 0).includes("none of"));
});

test("review fixes: reports isn't measured; more applications than counted visitors", () => {
  const rows = moduleRows({
    modules: [{ code: "reports", name: "Reports and exports", is_built: true, plan_type: "included" }],
    enabled: [{ org_id: "a", module_code: "reports" }],
    now: [], before: [], activeOrgs: new Set(["a"]), allOrgs: new Set(["a"]),
  });
  assert.deepEqual([rows[0].usedWhen, rows[0].idle, rows[0].ofActive], [null, null, null]);
  assert.equal(funnelSentence(1, 4, 0, 0), "4 applied; none has a company set up yet. Paying companies appear once billing is live.");
});
