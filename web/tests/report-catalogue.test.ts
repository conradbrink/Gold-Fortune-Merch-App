// Reports: fewer categories, more inside each (lib/report-catalogue.ts).
//
// The promise this pins: every old report is still a view somewhere, each
// trade gets the reports its owner reads, the company's own `report_tabs`
// still decides what it sees, every old link still opens the right place, and
// the new summary figures add up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISTRIBUTION_REPORTS,
  SERVICE_REPORTS,
  companyReports,
  openReport,
  viewFilters,
  viewsOf,
} from "@/lib/report-catalogue";
import { REPORT_TAB_VALUES, availableReportTabs } from "@/lib/report-tabs";
import { KPIS } from "@/lib/kpis";
import { toModuleSet } from "@/lib/modules";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";
import { daysBetween, jobsPerDay, missedRows, serviceSummary, teamBreakdown } from "@/lib/report-summary";
import type { Adherence, CoverageGap } from "@/lib/reports";
import type { ServiceLogRow } from "@/lib/service-log";
import type { HoursDay } from "@/lib/staff-hours";

const SERVICE = toModuleSet({ reports: true, checklists_forms: true, recurring_jobs: true });
const DISTRIBUTOR = toModuleSet({ reports: true, checklists_forms: true, recurring_jobs: true, distribution: true });
const GOLD_FORTUNE_TABS = "score,oos,coverage,adherence,reps,trends,form,photos";

function seededTabs(): Record<string, string> {
  const sql = readFileSync(join(process.cwd(), "../supabase/migrations/20261009120000_reports_per_trade.sql"), "utf8");
  const block = sql.slice(sql.indexOf("'report_tabs', to_jsonb(v.tabs)"), sql.indexOf("as v(template_code, tabs)"));
  return Object.fromEntries([...block.matchAll(/\('([a-z_]+)', '([a-z_,]+)'\)/g)].map((m) => [m[1], m[2]]));
}

const shape = (modules: typeof SERVICE, setting: string) =>
  companyReports(modules, setting, DEFAULT_TERMS).map((r) => `${r.id}:${r.views.map((v) => v.id).join("+")}`);

test("every old report is a view in both layouts, so nothing was lost", () => {
  const service = new Set(viewsOf(SERVICE_REPORTS));
  for (const tab of availableReportTabs(SERVICE)) assert.ok(service.has(tab), `${tab} missing from the service reports`);
  const sales = new Set(viewsOf(DISTRIBUTION_REPORTS));
  for (const tab of REPORT_TAB_VALUES) assert.ok(sales.has(tab), `${tab} missing from the distribution reports`);
});

test("every service trade gets the same five reports, in its own words", () => {
  const seeds = seededTabs();
  for (const [trade, tabs] of Object.entries(seeds)) {
    if (trade === "distribution") continue;
    const reports = companyReports(SERVICE, tabs, DEFAULT_TERMS).map((r) => r.id);
    assert.deepEqual(reports, ["performance", "service", "team", "compliance", "evidence"], trade);
  }
  // A cleaner sees "Cleaners", "Completed cleans", "Cleaner adherence".
  const cleaning = parseTerms({
    job: { one: "Clean", many: "Cleans" },
    staff: { one: "Cleaner", many: "Cleaners" },
  });
  const labels = companyReports(SERVICE, seeds.cleaning, cleaning).flatMap((r) => r.views.map((v) => v.label));
  for (const want of ["Completed cleans", "Cleaners", "Cleaner adherence", "Proof of service", "Photos", "Forms"]) {
    assert.ok(labels.includes(want), `${want} not in ${labels.join(", ")}`);
  }
  assert.ok(!labels.some((l) => /Trends|Out of stock|Perfect/.test(l)), labels.join(", "));
});

test("a cleaning company's reports, view by view", () => {
  assert.deepEqual(shape(SERVICE, seededTabs().cleaning), [
    "performance:summary+coverage",
    "service:completed+missed",
    "team:reps+hours",
    "compliance:adherence",
    "evidence:service_log+photos+form",
  ]);
  // Plumbing has no coverage tab, so Performance is the summary alone.
  assert.deepEqual(shape(SERVICE, seededTabs().plumbing)[0], "performance:summary");
});

test("a distributor keeps its own reports, and its audits' evidence", () => {
  assert.deepEqual(shape(DISTRIBUTOR, GOLD_FORTUNE_TABS), [
    "performance:summary",
    "perfect_store:score+trends",
    "availability:oos",
    "team:reps",
    "coverage:coverage",
    "compliance:adherence",
    "evidence:photos+form",
  ]);
  const gf = parseTerms({ site: { one: "Store", many: "Stores" } });
  assert.equal(companyReports(DISTRIBUTOR, GOLD_FORTUNE_TABS, gf)[1].label, "Perfect Store");
});

test("old links open the view each old report became", () => {
  const service = companyReports(SERVICE, seededTabs().cleaning, DEFAULT_TERMS);
  const at = (reports: typeof service, tab: string | null, view?: string) => {
    const o = openReport(reports, tab, view ?? null);
    return o ? `${o.report.id}/${o.view.id}` : null;
  };
  assert.equal(at(service, "adherence"), "compliance/adherence");
  assert.equal(at(service, "service_log"), "evidence/service_log");
  assert.equal(at(service, "hours"), "team/hours");
  assert.equal(at(service, "reps"), "team/reps");
  assert.equal(at(service, "photos"), "evidence/photos");
  assert.equal(at(service, "form"), "evidence/form");
  assert.equal(at(service, "coverage"), "performance/coverage");
  assert.equal(at(service, null), "performance/summary");
  assert.equal(at(service, "nonsense"), "performance/summary");
  assert.equal(at(service, "service", "missed"), "service/missed");

  const gf = companyReports(DISTRIBUTOR, GOLD_FORTUNE_TABS, DEFAULT_TERMS);
  assert.equal(at(gf, "score"), "perfect_store/score");
  assert.equal(at(gf, "trends"), "perfect_store/trends");
  assert.equal(at(gf, "oos"), "availability/oos");
  assert.equal(at(gf, "coverage"), "coverage/coverage");
  // A distributor has no Missed list: the link opens where its answer is.
  assert.equal(at(gf, "service", "missed"), "compliance/adherence");
  assert.equal(at(gf, "evidence", "service_log"), "evidence/photos");
});

test("every dashboard number opens a report the company has", () => {
  const range = { from: new Date("2026-10-01T00:00:00"), to: new Date("2026-10-11T00:00:00") };
  const companies = [
    companyReports(SERVICE, seededTabs().cleaning, DEFAULT_TERMS),
    companyReports(DISTRIBUTOR, GOLD_FORTUNE_TABS, DEFAULT_TERMS),
  ];
  for (const kpi of KPIS) {
    const href = kpi.href(range);
    if (!href.startsWith("/reports?")) continue;
    const q = new URLSearchParams(href.slice("/reports?".length));
    for (const reports of companies) {
      assert.ok(openReport(reports, q.get("tab"), q.get("view")), `${kpi.code} opens nothing`);
    }
  }
});

test("each view offers only the filters it uses", () => {
  assert.deepEqual(viewFilters("form", SERVICE), ["template", "staff", "site"]);
  assert.deepEqual(viewFilters("completed", SERVICE), ["site"]);
  assert.deepEqual(viewFilters("summary", SERVICE), []);
  assert.deepEqual(viewFilters("summary", DISTRIBUTOR), ["chain"]);
  assert.deepEqual(viewFilters("adherence", SERVICE), []);
  assert.deepEqual(viewFilters("score", DISTRIBUTOR), ["chain"]);
});

test("the performance summary adds up from the existing reports", () => {
  const adherence: Adherence[] = [
    { rep_id: "a", rep_name: "Ann", planned: 10, completed: 8, missed: 2, adherence_rate: 0.8, missed_detail: [{ store: "Mall", date: "2026-10-02T00:00:00Z" }, { store: "Bank", date: "2026-10-05T00:00:00Z" }] },
    { rep_id: "b", rep_name: "Ben", planned: 5, completed: 5, missed: 0, adherence_rate: 1, missed_detail: [] },
  ];
  const log = [
    { visit_id: "1", store_id: "s1", day: "2026-10-02" },
    { visit_id: "2", store_id: "s1", day: "2026-10-02" },
    { visit_id: "3", store_id: "s2", day: "2026-10-04" },
  ] as ServiceLogRow[];
  const hours = [
    { staff_id: "a", staff_name: "Ann", workday_seconds: 8 * 3600 },
    { staff_id: "c", staff_name: "Cat", workday_seconds: 4 * 3600 },
  ] as HoursDay[];
  const gaps = [{ visits_in_period: 3 }, { visits_in_period: 0 }] as CoverageGap[];

  const s = serviceSummary({ adherence, serviceLog: log, hours, gaps });
  assert.equal(s.planned, 15);
  assert.equal(s.completed, 3); // every finished job in the log
  assert.equal(s.missed, 2);
  assert.equal(s.completionRate, 13 / 15);
  assert.equal(s.sitesServiced, 2);
  assert.equal(s.coverage, 0.5);
  assert.equal(s.hours, 12);
  // Without a report, its figure is left out rather than shown as nought.
  const none = serviceSummary({ adherence: null, serviceLog: null, hours: null, gaps: null });
  assert.deepEqual(Object.values(none), [null, null, null, null, null, null, null]);

  const team = teamBreakdown(adherence, hours);
  assert.deepEqual(team.map((r) => [r.name, r.completed, r.hours]), [["Ann", 8, 8], ["Ben", 5, null], ["Cat", null, 4]]);
  assert.deepEqual(missedRows(adherence).map((m) => m.date), ["2026-10-05", "2026-10-02"]);
  assert.deepEqual(daysBetween("2026-10-01", "2026-10-04"), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(jobsPerDay(log, daysBetween("2026-10-02", "2026-10-04")).map((d) => d.value), [2, 0, 1]);
});
