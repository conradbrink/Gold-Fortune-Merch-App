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
  assert.deepEqual(tabs, ["coverage", "adherence", "reps", "form", "photos"]);
});

test("a distribution company keeps every tab", () => {
  const tabs = availableReportTabs(
    toModuleSet({ reports: true, checklists_forms: true, distribution: true })
  );
  assert.deepEqual(tabs, ["score", "oos", "coverage", "adherence", "reps", "trends", "form", "photos"]);
});

test("before the company's modules are known, nothing is asked for", () => {
  assert.deepEqual(availableReportTabs(null), []);
});

test("the tab labels follow the available list", () => {
  const labels = reportTabs(DEFAULT_TERMS, ["coverage", "reps"]).map((t) => t.value);
  assert.deepEqual(labels, ["coverage", "reps"]);
});
