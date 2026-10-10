import { moduleEnabled, type ModuleSet } from "@/lib/modules";
import { lower, type Terms } from "@/lib/terms";
import { companyReportTabs, type ReportTab } from "@/lib/report-tabs";

/**
 * Reports: fewer categories, more inside each.
 *
 * A service business gets five reports, each answering one question an owner
 * asks: how are we doing (Performance), what work happened (Service), how is
 * the team doing (Team), did they do what was planned (Compliance), and can I
 * prove it (Evidence). A distributor gets the reports its business runs on:
 * Performance, Perfect Store, Availability, Team, Coverage and Compliance.
 *
 * Each report is made of views, and most views are the reports Tickd already
 * had (the same tables, the same database functions, the same exports): Hours
 * is a view of Team, Proof of service, Photos and Forms are views of
 * Evidence, Adherence is Compliance, the trend is a view of the report it
 * charts. Three views are new and built from the same data: the Performance
 * summary, the Service list of completed work, and the Missed list.
 *
 * Which views a company sees still comes from its `report_tabs` setting
 * (seeded from its trade, kept as it is): a view is shown when the old tab it
 * grew from is in the company's list. Nothing about a company's reports is
 * changed in the database, and every old `?tab=` link still opens the right
 * report (`openReport`).
 */

export type ReportId =
  | "performance"
  | "service"
  | "team"
  | "compliance"
  | "evidence"
  | "perfect_store"
  | "availability"
  | "coverage";

/** A view: one of the old report tabs, or one of the three new views. */
export type ViewId = ReportTab | "summary" | "completed" | "missed";

export type ReportFilter = "chain" | "staff" | "site" | "template";

type ViewDef = {
  id: ViewId;
  label: (t: Terms) => string;
  /** The old tabs this view is built from; it is shown when the company has any of them. */
  needs: readonly ReportTab[];
};

type ReportDef = {
  id: ReportId;
  label: (t: Terms) => string;
  /** The question the report answers, in plain words, under its title. */
  question: (t: Terms) => string;
  views: readonly ViewDef[];
};

/** Everything the Performance summary can draw on. */
const SERVICE_SUMMARY_SOURCES: readonly ReportTab[] = ["adherence", "service_log", "hours", "coverage", "reps"];
const SALES_SUMMARY_SOURCES: readonly ReportTab[] = ["score", "oos", "coverage", "adherence", "reps", "trends"];

const EVIDENCE: ReportDef = {
  id: "evidence",
  label: () => "Evidence",
  question: (t) => `Can you prove it? The reports, photos and forms from every ${lower(t.job.one)}.`,
  views: [
    { id: "service_log", label: () => "Proof of service", needs: ["service_log"] },
    { id: "photos", label: () => "Photos", needs: ["photos"] },
    { id: "form", label: () => "Forms", needs: ["form"] },
  ],
};

const COMPLIANCE: ReportDef = {
  id: "compliance",
  label: () => "Compliance",
  question: () => "Did the team do what was planned, when it was planned, where it was planned?",
  views: [{ id: "adherence", label: (t) => `${t.staff.one} adherence`, needs: ["adherence"] }],
};

export const SERVICE_REPORTS: readonly ReportDef[] = [
  {
    id: "performance",
    label: () => "Performance",
    question: () => "How is the business doing?",
    views: [
      { id: "summary", label: () => "Summary", needs: SERVICE_SUMMARY_SOURCES },
      { id: "coverage", label: (t) => `By ${lower(t.site.one)}`, needs: ["coverage"] },
    ],
  },
  {
    id: "service",
    label: () => "Service",
    question: (t) => `What work happened: every ${lower(t.job.one)} done, and every one missed.`,
    views: [
      { id: "completed", label: (t) => `Completed ${lower(t.job.many)}`, needs: ["service_log"] },
      { id: "missed", label: () => "Missed", needs: ["adherence"] },
    ],
  },
  {
    id: "team",
    label: () => "Team",
    question: (t) => `How each ${lower(t.staff.one)} is doing, and the hours they worked.`,
    views: [
      { id: "reps", label: (t) => t.staff.many, needs: ["reps"] },
      { id: "hours", label: () => "Hours", needs: ["hours"] },
    ],
  },
  COMPLIANCE,
  EVIDENCE,
];

export const DISTRIBUTION_REPORTS: readonly ReportDef[] = [
  {
    id: "performance",
    label: () => "Performance",
    question: () => "How is the sales operation doing?",
    views: [{ id: "summary", label: () => "Summary", needs: SALES_SUMMARY_SOURCES }],
  },
  {
    id: "perfect_store",
    label: (t) => `Perfect ${t.site.one}`,
    question: (t) => `Are your ${lower(t.site.many)} meeting your standards?`,
    views: [
      { id: "score", label: () => "Scores", needs: ["score"] },
      { id: "trends", label: () => "Over time", needs: ["trends"] },
    ],
  },
  {
    id: "availability",
    label: () => "Availability",
    question: () => "Are your products on the shelf?",
    views: [{ id: "oos", label: () => "Out of stock", needs: ["oos"] }],
  },
  {
    id: "team",
    label: () => "Team",
    question: (t) => `How each ${lower(t.staff.one)} is doing.`,
    views: [
      { id: "reps", label: (t) => t.staff.many, needs: ["reps"] },
      { id: "hours", label: () => "Hours", needs: ["hours"] },
    ],
  },
  {
    id: "coverage",
    label: () => "Coverage",
    question: (t) => `Are you reaching every ${lower(t.site.one)}?`,
    views: [{ id: "coverage", label: (t) => t.site.many, needs: ["coverage"] }],
  },
  COMPLIANCE,
  // Not in the six a distributor's reports are built around, but its audits'
  // photos and forms have to live somewhere: Tickd does not take a report away.
  EVIDENCE,
];

export function reportLayout(modules: ModuleSet): readonly ReportDef[] {
  return moduleEnabled(modules, "distribution") ? DISTRIBUTION_REPORTS : SERVICE_REPORTS;
}

export type ResolvedView = { id: ViewId; label: string };
export type ResolvedReport = { id: ReportId; label: string; question: string; views: ResolvedView[] };

/**
 * The reports this company has, with the views it has in each: a view when
 * the company has an old tab it is built from (its `report_tabs`, less any
 * whose module it lacks), a report when it has at least one view.
 */
export function companyReports(
  modules: ModuleSet | null,
  setting: string | null | undefined,
  t: Terms
): ResolvedReport[] {
  if (!modules) return [];
  const have = new Set<ReportTab>(companyReportTabs(modules, setting));
  return reportLayout(modules)
    .map((r) => ({
      id: r.id,
      label: r.label(t),
      question: r.question(t),
      views: r.views.filter((v) => v.needs.some((n) => have.has(n))).map((v) => ({ id: v.id, label: v.label(t) })),
    }))
    .filter((r) => r.views.length > 0);
}

const REPORT_IDS: readonly ReportId[] = [
  "performance",
  "service",
  "team",
  "compliance",
  "evidence",
  "perfect_store",
  "availability",
  "coverage",
];

/**
 * Which report and view a link opens. `?tab=` may be a report (`compliance`)
 * with an optional `?view=`, or one of the old tab names (`adherence`,
 * `photos`, `service_log`…), which opens the view it became. Anything the
 * company does not have opens its first report.
 */
export function openReport(
  reports: ResolvedReport[],
  tab: string | null | undefined,
  view: string | null | undefined
): { report: ResolvedReport; view: ResolvedView } | null {
  if (reports.length === 0) return null;
  const first = { report: reports[0], view: reports[0].views[0] };
  const wanted = (tab ?? "").trim();
  const find = (id: string | null | undefined) => {
    if (!id) return null;
    for (const report of reports) {
      const v = report.views.find((x) => x.id === id);
      if (v) return { report, view: v };
    }
    return null;
  };
  if ((REPORT_IDS as readonly string[]).includes(wanted)) {
    const report = reports.find((r) => r.id === wanted);
    const inReport = report?.views.find((v) => v.id === view);
    if (report && (inReport || !view)) return { report, view: inReport ?? report.views[0] };
    // The report or view is not this company's (a distributor has no Missed
    // list): the nearest thing it does have, else the report, else the first.
    return (
      find(view) ??
      find(view ? NEAREST[view] : null) ??
      (report ? { report, view: report.views[0] } : null) ??
      // "coverage" is a distributor's report and a service trade's view.
      find(wanted) ??
      first
    );
  }
  return find(wanted) ?? first;
}

/** Where a view's question is answered for a company that does not have the view itself. */
const NEAREST: Record<string, ViewId> = {
  missed: "adherence",
  completed: "service_log",
  hours: "reps",
};

/**
 * The filters a view uses. A filter a view ignores is not shown with it, so
 * nobody picks a {staff} and reads a table that took no notice.
 */
export function viewFilters(view: ViewId, modules: ModuleSet | null): ReportFilter[] {
  switch (view) {
    case "score":
    case "oos":
    case "coverage":
    case "trends":
      return ["chain"];
    case "summary":
      // A distributor's summary is mostly per store, so its chain applies.
      return modules && moduleEnabled(modules, "distribution") ? ["chain"] : [];
    case "form":
    case "photos":
      return ["template", "staff", "site"];
    case "service_log":
    case "completed":
      return ["site"];
    default:
      return [];
  }
}

/** Every old tab is a view in both layouts, so no report was lost. */
export function viewsOf(layout: readonly ReportDef[]): ViewId[] {
  return layout.flatMap((r) => r.views.map((v) => v.id));
}
