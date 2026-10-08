// Reports for every trade (Stage 7 Part 0): a company only sees, and the page
// only asks for, the report tabs whose module it has. Asking for a module's
// report without the module is refused by the database (`require_module`),
// which used to take the whole Reports page down for companies that don't sell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { availableReportTabs, reportTabs } from "@/lib/report-tabs";
import { toModuleSet } from "@/lib/modules";
import { DEFAULT_TERMS } from "@/lib/terms";

test("a cleaning company (reports + forms, no distribution) gets no retail tabs", () => {
  const tabs = availableReportTabs(toModuleSet({ reports: true, checklists_forms: true }));
  assert.deepEqual(tabs, ["coverage", "adherence", "reps", "form", "photos", "service_log", "hours"]);
});

test("a distribution company keeps every tab", () => {
  const tabs = availableReportTabs(
    toModuleSet({ reports: true, checklists_forms: true, distribution: true })
  );
  // Every tab its modules allow; which of them it shows is its `report_tabs` (below).
  assert.deepEqual(tabs, ["score", "oos", "coverage", "adherence", "reps", "trends", "form", "photos", "service_log", "hours"]);
});

test("before the company's modules are known, nothing is asked for", () => {
  assert.deepEqual(availableReportTabs(null), []);
});

test("the tab labels follow the available list", () => {
  const labels = reportTabs(DEFAULT_TERMS, ["coverage", "reps"]).map((t) => t.value);
  assert.deepEqual(labels, ["coverage", "reps"]);
});

// Stage 7 Part 4a: each trade's tabs, in its order, as data (`report_tabs`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORT_TAB_VALUES, companyReportTabs, tabsFromSetting } from "@/lib/report-tabs";

const TODAYS_TABS = ["score", "oos", "coverage", "adherence", "reps", "trends", "form", "photos"];
const SERVICE_TRADE = toModuleSet({ reports: true, checklists_forms: true });
const EVERYTHING = toModuleSet({ reports: true, checklists_forms: true, distribution: true });

/** The trade lists the migration seeds, read from the migration itself so the two cannot drift. */
function seededTabs(): Record<string, string> {
  const sql = readFileSync(join(process.cwd(), "../supabase/migrations/20261009120000_reports_per_trade.sql"), "utf8");
  const block = sql.slice(sql.indexOf("'report_tabs', to_jsonb(v.tabs)"), sql.indexOf("as v(template_code, tabs)"));
  return Object.fromEntries([...block.matchAll(/\('([a-z_]+)', '([a-z_,]+)'\)/g)].map((m) => [m[1], m[2]]));
}

test("every trade's seeded tabs are known tabs, each once, and its company can have them all", () => {
  const seeds = seededTabs();
  assert.equal(Object.keys(seeds).length, 11);
  for (const [trade, list] of Object.entries(seeds)) {
    const codes = list.split(",");
    assert.deepEqual(tabsFromSetting(list), codes, `${trade} names an unknown or repeated tab`);
    const modules = trade === "distribution" ? EVERYTHING : SERVICE_TRADE;
    assert.deepEqual(companyReportTabs(modules, list), codes, `${trade} lists a tab its modules refuse`);
  }
});

test("Gold Fortune keeps today's eight tabs in today's order", () => {
  assert.equal(seededTabs().distribution, TODAYS_TABS.join(","));
  assert.deepEqual(companyReportTabs(EVERYTHING, TODAYS_TABS.join(",")), TODAYS_TABS);
  // The setting's default (lib/company-config.ts) is the same list.
  assert.deepEqual(REPORT_TAB_VALUES.slice(0, 8), TODAYS_TABS);
});

test("service trades lead with proof of service and get hours", () => {
  const seeds = seededTabs();
  for (const trade of ["cleaning", "garden", "plumbing", "security", "pool", "delivery"]) {
    assert.equal(seeds[trade].split(",")[0], "service_log", trade);
    assert.ok(seeds[trade].split(",").includes("hours"), trade);
  }
});

test("a tab the modules refuse is dropped; a setting with nothing usable falls back to the modules", () => {
  assert.deepEqual(companyReportTabs(SERVICE_TRADE, "score,hours,adherence"), ["hours", "adherence"]);
  assert.deepEqual(companyReportTabs(SERVICE_TRADE, "score,oos"), availableReportTabs(SERVICE_TRADE));
  assert.deepEqual(companyReportTabs(SERVICE_TRADE, ""), availableReportTabs(SERVICE_TRADE));
  assert.deepEqual(companyReportTabs(null, "hours"), []);
  assert.deepEqual(tabsFromSetting("hours,nonsense,hours, adherence"), ["hours", "adherence"]);
});

test("the new tabs have names in the company's words", () => {
  const labels = Object.fromEntries(reportTabs(DEFAULT_TERMS, ["service_log", "hours"]).map((t) => [t.value, t.label]));
  assert.deepEqual(labels, { service_log: "Proof of service", hours: "Hours" });
});
