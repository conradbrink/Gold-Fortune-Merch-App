"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  LayoutGrid,
  MapPin,
  PackageX,
  Store,
  Users,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { CoverageDonut } from "@/components/dashboard/coverage-donut";
import { UnitsTrendChart } from "@/components/dashboard/units-trend-chart";
import {
  companyDayTimes,
  deltaPct,
  formatDuration,
  formatPct,
  formatTimeOfDay,
  type DashboardSummary,
  type OperationsSummary,
  type RepDayTimes,
} from "@/lib/dashboard";

/**
 * The catalogue of cards the dashboard can show.
 *
 * A widget declares what it needs and renders itself; nothing central knows what
 * any card contains. Adding one means adding an entry here and nothing else —
 * the page, the Customise panel and the saved layouts all read from this list.
 *
 * **Why widgets share fetches rather than each running its own query.** "Each
 * widget owns its query" is the right shape for the *catalogue*, but taken
 * literally it would turn one dashboard load into twenty requests, because ten
 * of these cards read different fields of the same `dashboard_summary` row. So a
 * widget names the source it needs and the page fetches each distinct source
 * once. The widget still owns which query it depends on; it just does not own the
 * request.
 */

/** The RPCs behind the catalogue. One fetch each, however many cards use them. */
export type WidgetSource = "summary" | "dayTimes" | "operations";

export type WidgetData = {
  summary: DashboardSummary | null;
  dayTimes: RepDayTimes[];
  operations: OperationsSummary | null;
  /** How many days the chosen range covers, for labels like "vs previous 30 days". */
  days: number;
};

export type WidgetDefinition = {
  /** Stored in `dashboard_layouts.widget_ids`. Never change one in place. */
  id: string;
  title: string;
  /** What this card tells you. Shown in the Customise panel. */
  description: string;
  /** Columns out of four. 1 = tile, 2 = half width, 4 = full width. */
  span: 1 | 2 | 4;
  source: WidgetSource;
  render: (data: WidgetData) => ReactNode;
};

function Line({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note?: string;
  tone?: "bad";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          tone === "bad"
            ? "font-semibold tabular-nums text-destructive"
            : "font-semibold tabular-nums text-foreground"
        }
      >
        {value}
        {note && <span className="ml-1 text-xs font-normal">({note})</span>}
      </span>
    </div>
  );
}

/**
 * A rate compared against itself a period ago.
 *
 * Rates arrive as fractions, and `deltaPct` rounds to whole percent — so 0.062
 * against 0.058 would come out as a 0% change. Scaling both by 1000 first keeps
 * the difference visible, which is why the original tiles did the same.
 */
function rateDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  return deltaPct(current * 1000, previous * 1000);
}

function coveragePctOf(summary: DashboardSummary): number | null {
  if (summary.stores_active <= 0) return null;
  return Math.round((summary.current.stores_covered / summary.stores_active) * 100);
}

export const WIDGETS: WidgetDefinition[] = [
  {
    id: "visits_completed",
    title: "Visits completed",
    description: "Completed visits in the period, against the period before it.",
    span: 1,
    source: "summary",
    render: ({ summary, days }) => {
      if (!summary) return null;
      const { current, previous } = summary;
      return (
        <StatTile
          label="Visits Completed"
          value={current.visits_completed}
          deltaPct={deltaPct(current.visits_completed, previous.visits_completed)}
          deltaLabel={`vs previous ${days} days`}
          icon={<ClipboardCheck className="h-5 w-5 opacity-80" />}
          href="/visits"
        />
      );
    },
  },
  {
    id: "store_coverage",
    title: "Store coverage",
    description: "Share of active stores visited at least once in the period.",
    span: 1,
    source: "summary",
    render: ({ summary }) => {
      if (!summary) return null;
      const pct = coveragePctOf(summary);
      return (
        <StatTile
          label="Store Coverage"
          value={pct === null ? "—" : `${pct}%`}
          sublabel={`${summary.current.stores_covered} of ${summary.stores_active} active stores visited`}
          icon={<Store className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      );
    },
  },
  {
    id: "oos_rate",
    title: "Out of stock rate",
    description:
      "Share of stock checks answered “no”. Reads the in_stock metric on your forms.",
    span: 1,
    source: "summary",
    render: ({ summary, days }) => {
      if (!summary) return null;
      return (
        <StatTile
          label="Out of Stock Rate"
          value={formatPct(summary.current.oos_rate)}
          deltaPct={rateDelta(summary.current.oos_rate, summary.previous.oos_rate)}
          deltaLabel={`vs previous ${days} days`}
          // Down is good here, so the arrow colouring must flip.
          invertDelta
          icon={<PackageX className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      );
    },
  },
  {
    id: "planogram",
    title: "Planogram compliance",
    description:
      "Share of planogram checks answered “yes”. Reads the planogram_ok metric.",
    span: 1,
    source: "summary",
    render: ({ summary, days }) => {
      if (!summary) return null;
      return (
        <StatTile
          label="Planogram Compliance"
          value={formatPct(summary.current.planogram_rate)}
          deltaPct={rateDelta(
            summary.current.planogram_rate,
            summary.previous.planogram_rate
          )}
          deltaLabel={`vs previous ${days} days`}
          icon={<LayoutGrid className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      );
    },
  },
  {
    id: "working_day",
    title: "Working day",
    description:
      "When each rep starts, closes and how long they work — from the day's evidence, not from what anyone typed.",
    span: 4,
    source: "dayTimes",
    render: ({ dayTimes }) => <WorkingDay rows={dayTimes} />,
  },
  {
    id: "visits_trend",
    title: "Visits completed — trend",
    description: "Completed visits per day across the period.",
    span: 2,
    source: "summary",
    render: ({ summary, days }) => {
      if (!summary) return null;
      const trend = summary.series.map((p) => ({
        // "Jul 14" reads better than an ISO date on a crowded axis.
        label: new Date(p.day + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        value: p.completed,
      }));
      const active = trend.filter((t) => t.value > 0).length;
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Visits completed — last {days} days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnitsTrendChart data={trend} valueLabel="Completed" />
            {active < 3 && trend.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Only {active === 1 ? "one day" : `${active} days`} of activity in
                this period — the trend will fill out as reps work.
              </p>
            )}
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "coverage_donut",
    title: "Store coverage — chart",
    description: "The same coverage figure as a proportion of the estate.",
    span: 2,
    source: "summary",
    render: ({ summary }) => {
      if (!summary) return null;
      const pct = coveragePctOf(summary);
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Store coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {pct === null ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No active stores yet.
              </p>
            ) : (
              <>
                <CoverageDonut covered={pct} notCovered={100 - pct} />
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {summary.stores_active - summary.current.stores_covered} of{" "}
                  {summary.stores_active} active stores not yet visited in this
                  period.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "forms_submitted",
    title: "Forms submitted",
    description: "Submissions in the period, and what share of completed visits carried one.",
    span: 1,
    source: "summary",
    render: ({ summary }) => {
      if (!summary) return null;
      const { current } = summary;
      const rate =
        current.visits_completed > 0
          ? Math.round((current.submissions / current.visits_completed) * 100)
          : null;
      return (
        <StatTile
          label="Forms Submitted"
          value={current.submissions}
          sublabel={
            rate === null
              ? "No completed visits yet"
              : `${rate}% of completed visits`
          }
          icon={<ClipboardCheck className="h-5 w-5 opacity-80" />}
          tone="outline"
          href="/visits?filter=with-forms"
        />
      );
    },
  },
  {
    id: "missed_visits",
    title: "Missed visits",
    description: "Scheduled calls that were not made.",
    span: 1,
    source: "summary",
    render: ({ summary, days }) => {
      if (!summary) return null;
      return (
        <StatTile
          label="Missed Visits"
          value={summary.current.visits_missed}
          deltaPct={deltaPct(
            summary.current.visits_missed,
            summary.previous.visits_missed
          )}
          deltaLabel={`vs previous ${days} days`}
          invertDelta
          icon={<XCircle className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      );
    },
  },
  {
    id: "active_reps",
    title: "Active reps",
    description: "Reps who recorded anything in the period, and the average visit length.",
    span: 1,
    source: "summary",
    render: ({ summary }) => {
      if (!summary) return null;
      return (
        <StatTile
          label="Active Reps"
          value={summary.current.active_reps}
          sublabel={`Avg visit ${formatDuration(summary.current.avg_duration_seconds)}`}
          icon={<Users className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      );
    },
  },
  {
    id: "unscheduled_visits",
    title: "Unscheduled visits",
    description: "Calls a rep started outside the plan.",
    span: 1,
    source: "summary",
    render: ({ summary }) => {
      if (!summary) return null;
      return (
        <StatTile
          label="Unscheduled Visits"
          value={summary.current.visits_unscheduled}
          sublabel="Rep-initiated, outside the plan"
          icon={<MapPin className="h-5 w-5 opacity-80" />}
          tone="outline"
          href="/activities"
        />
      );
    },
  },
  {
    id: "prospecting",
    title: "Prospecting",
    description: "Sales calls, pipeline stages and follow-ups owed.",
    span: 2,
    source: "operations",
    render: ({ operations }) => {
      if (!operations) return null;
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prospecting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Line label="Sales calls in this period" value={operations.sales_visits} />
            <Line label="Open in the pipeline" value={operations.leads_open} />
            <Line label="Converted" value={operations.leads_converted} />
            {/* Overdue is called out on its own because it is the only figure
                here that is somebody's fault rather than somebody's progress. */}
            <Line
              label="Follow-ups due"
              value={operations.follow_ups_due}
              tone={operations.follow_ups_overdue > 0 ? "bad" : undefined}
              note={
                operations.follow_ups_overdue > 0
                  ? `${operations.follow_ups_overdue} overdue`
                  : undefined
              }
            />
            <Link
              href="/leads"
              className="inline-block pt-1 text-xs text-primary hover:underline"
            >
              Open the Leads board →
            </Link>
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "territories",
    title: "Territories",
    description: "The territory structure, and stores that are not in one.",
    span: 1,
    source: "operations",
    render: ({ operations }) => {
      if (!operations) return null;
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Territories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Line label="Main territories" value={operations.territories_main} />
            <Line label="Sub-territories" value={operations.territories_sub} />
            <Line
              label="Stores with no territory"
              value={operations.stores_unplaced}
              tone={operations.stores_unplaced > 0 ? "bad" : undefined}
            />
            <Link
              href="/territories"
              className="inline-block pt-1 text-xs text-primary hover:underline"
            >
              Manage territories →
            </Link>
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "confirmed_positions",
    title: "Confirmed positions",
    description:
      "How much of the estate stands on a position a rep measured, rather than a geocoder's guess.",
    span: 1,
    source: "operations",
    render: ({ operations, summary }) => {
      if (!operations) return null;
      // Falls back to the confirmed + guessed total when the summary is absent,
      // so this card still reads correctly on its own.
      const active =
        summary?.stores_active ??
        operations.stores_confirmed + operations.stores_guessed;
      const pct =
        active > 0 ? Math.round((operations.stores_confirmed / active) * 100) : null;
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirmed positions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {pct === null ? "—" : `${pct}%`}
            </p>
            <Line label="Measured by a rep on site" value={operations.stores_confirmed} />
            <Line label="Still on a geocoder's guess" value={operations.stores_guessed} />
            <p className="pt-1 text-xs text-muted-foreground">
              Every &ldquo;at store&rdquo; verdict rests on this. A guessed pin can
              put a rep off site while they stand in the shop.
            </p>
          </CardContent>
        </Card>
      );
    },
  },
];

/**
 * The layout somebody sees before they have customised anything: the dashboard
 * exactly as it was when it was a fixed page.
 */
export const DEFAULT_LAYOUT: string[] = [
  "visits_completed",
  "store_coverage",
  "oos_rate",
  "planogram",
  "working_day",
  "visits_trend",
  "coverage_donut",
  "forms_submitted",
  "missed_visits",
  "active_reps",
  "unscheduled_visits",
  "prospecting",
  "territories",
  "confirmed_positions",
];

export const WIDGET_IDS = WIDGETS.map((w) => w.id);

const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

export function findWidget(id: string): WidgetDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * When the team starts and finishes.
 *
 * Derived from the day's evidence rather than from anything the rep types: the
 * first of the workday being opened, a check-in, or a sales call starting, and
 * the last of the same. A rep who forgets to press "start workday" still has a
 * start time, because they checked in somewhere.
 *
 * Times are local. The RPC converts before averaging — averaging the stored
 * UTC values and formatting afterwards would report every day two hours early.
 */
function WorkingDay({ rows }: { rows: RepDayTimes[] }) {
  const company = companyDayTimes(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Working day</CardTitle>
      </CardHeader>
      <CardContent>
        {company.days === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recorded activity in this period, so there is no day to measure.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Company average start
                </p>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {formatTimeOfDay(company.start)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Company average close
                </p>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {formatTimeOfDay(company.end)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Average length</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {formatDuration(company.length ?? 0)}
                </p>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Across {company.days} rep-{company.days === 1 ? "day" : "days"},
              weighted by days worked so a rep with one day does not count the
              same as a rep with twenty.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Rep</th>
                    <th className="py-2 text-right font-medium">Days</th>
                    <th className="py-2 text-right font-medium">Starts</th>
                    <th className="py-2 text-right font-medium">Closes</th>
                    <th className="py-2 text-right font-medium">Length</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rep_id} className="border-b border-border/60">
                      <td className="py-2 text-foreground">
                        {r.rep_name ?? "Unnamed rep"}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {r.days_worked}
                      </td>
                      <td className="py-2 text-right tabular-nums text-foreground">
                        {formatTimeOfDay(r.avg_start_seconds)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-foreground">
                        {formatTimeOfDay(r.avg_end_seconds)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {formatDuration(Number(r.avg_length_seconds ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
