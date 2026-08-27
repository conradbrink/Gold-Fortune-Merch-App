/**
 * The Reports page's tab ids, in one place.
 *
 * Here rather than on the page because the dashboard tiles link into a tab by
 * name, and a `string` parameter meant a renamed tab would keep compiling and
 * quietly land somebody on the default. The page renders its triggers from this
 * list, so the two cannot drift.
 */
export const REPORT_TABS = [
  { value: "score", label: "Perfect Store" },
  { value: "oos", label: "Out of stock" },
  { value: "coverage", label: "Coverage" },
  { value: "adherence", label: "Adherence" },
  { value: "reps", label: "Reps" },
  { value: "trends", label: "Trends" },
  { value: "form", label: "Form" },
  { value: "photos", label: "Photos" },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["value"];
