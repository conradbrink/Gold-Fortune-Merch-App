import type { Terms } from "@/lib/terms";
import { moduleEnabled, type ModuleCode, type ModuleSet } from "@/lib/modules";

/**
 * The Reports page's tab ids, in one place.
 *
 * Here rather than on the page because the dashboard tiles link into a tab by
 * name, and a `string` parameter meant a renamed tab would keep compiling and
 * quietly land somebody on the default. The page renders its triggers from
 * `reportTabs`, so the two cannot drift.
 */
export const REPORT_TAB_VALUES = [
  "score",
  "oos",
  "coverage",
  "adherence",
  "reps",
  "trends",
  "form",
  "photos",
  "service_log",
  "hours",
] as const;

export type ReportTab = (typeof REPORT_TAB_VALUES)[number];

/**
 * The module each tab needs. Perfect Store, out of stock and their trends are
 * retail audits (Distribution); the form results and their photos need the
 * forms module; the rest is the reports module. The database refuses a
 * module's report to a company without it (`require_module`), so the page
 * must not even ask: one refused call used to take the whole page down for
 * every company that does not sell.
 */
export const REPORT_TAB_MODULE: Record<ReportTab, ModuleCode> = {
  score: "distribution",
  oos: "distribution",
  coverage: "reports",
  adherence: "reports",
  reps: "reports",
  trends: "distribution",
  form: "checklists_forms",
  photos: "checklists_forms",
  service_log: "reports",
  hours: "reports",
};

/** The tabs the company's modules allow, in the catalogue's order. Before the config loads: none. */
export function availableReportTabs(modules: ModuleSet | null): ReportTab[] {
  if (!modules) return [];
  return REPORT_TAB_VALUES.filter((tab) => moduleEnabled(modules, REPORT_TAB_MODULE[tab]));
}

function isReportTab(v: string): v is ReportTab {
  return (REPORT_TAB_VALUES as readonly string[]).includes(v);
}

/** The tab ids in a `report_tabs` setting, in its order: known ones only, each once. */
export function tabsFromSetting(setting: string): ReportTab[] {
  const out: ReportTab[] = [];
  for (const code of setting.split(",")) {
    const c = code.trim();
    if (isReportTab(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The tabs this company sees, in its order: the company setting `report_tabs`
 * (seeded from its trade), less any whose module it does not have. A setting
 * that names no tab it can have falls back to every tab its modules allow, so
 * the page is never empty. Gold Fortune's setting is today's eight in today's
 * order.
 */
export function companyReportTabs(modules: ModuleSet | null, setting: string | null | undefined): ReportTab[] {
  if (!modules) return [];
  const chosen = tabsFromSetting(setting ?? "").filter((tab) => moduleEnabled(modules, REPORT_TAB_MODULE[tab]));
  return chosen.length > 0 ? chosen : availableReportTabs(modules);
}

/**
 * The tabs with their labels, in the company's words: "Perfect Store" and
 * "Reps" at Gold Fortune, "Perfect Site" and "Staff" by default. The ids stay
 * fixed because links and saved dashboards use them.
 */
export function reportTabs(t: Terms, only?: readonly ReportTab[]): { value: ReportTab; label: string }[] {
  const labels: Record<ReportTab, string> = {
    score: `Perfect ${t.site.one}`,
    oos: "Out of stock",
    coverage: "Coverage",
    adherence: "Adherence",
    reps: t.staff.many,
    trends: "Trends",
    form: "Form",
    photos: "Photos",
    service_log: "Proof of service",
    hours: "Hours",
  };
  return (only ?? REPORT_TAB_VALUES).map((value) => ({ value, label: labels[value] }));
}
