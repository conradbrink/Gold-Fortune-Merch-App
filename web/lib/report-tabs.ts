import type { Terms } from "@/lib/terms";

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
 * The tabs with their labels, in the company's words: "Perfect Store" and
 * "Reps" at Gold Fortune, "Perfect Site" and "Staff" by default. The ids stay
 * fixed because links and saved dashboards use them.
 */
export function reportTabs(t: Terms): { value: ReportTab; label: string }[] {
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
  return REPORT_TAB_VALUES.map((value) => ({ value, label: labels[value] }));
}
