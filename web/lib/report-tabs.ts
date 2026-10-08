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
};

/** The tabs this company has, in order. Before the config loads: none. */
export function availableReportTabs(modules: ModuleSet | null): ReportTab[] {
  if (!modules) return [];
  return REPORT_TAB_VALUES.filter((tab) => moduleEnabled(modules, REPORT_TAB_MODULE[tab]));
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
  };
  return (only ?? REPORT_TAB_VALUES).map((value) => ({ value, label: labels[value] }));
}
