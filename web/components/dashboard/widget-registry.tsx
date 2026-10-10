"use client";

import { moduleEnabled, type ModuleCode, type ModuleSet } from "@/lib/modules";
import { can, type PermissionCode, type PermissionSet } from "@/lib/permissions";
import { codesFromSetting } from "@/lib/kpis";
import type { ContractsDue, Numbers, Today } from "@/lib/dashboard-numbers";
import { MoneyCard, QuotesCard, TodayCard, YourNumbers } from "@/components/dashboard/number-cards";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import {
  count,
  lower,
  possessive,
  title,
  withArticle,
  type Terms,
} from "@/lib/terms";
import { useMemo, useState, type ReactNode } from "react";
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
import { RepMap } from "@/components/dashboard/rep-map";
import type { LiveReps } from "@/lib/live-reps";
import { toLocalDateInput, type DateRange } from "@/lib/date-range";
import type { ReportId, ViewId } from "@/lib/report-catalogue";
import type { ReportTab } from "@/lib/report-tabs";
import { UnitsTrendChart } from "@/components/dashboard/units-trend-chart";
import {
  FieldTeamCard,
  Headline,
  PipelineCard,
  SalesCard,
  StoreHealthCard,
} from "@/components/dashboard/business-widgets";
import type { TargetProgress } from "@/lib/targets";
import { SettleDriving } from "@/components/workday/settle-driving";
import {
  companyDayTimes,
  deltaPct,
  formatDuration,
  formatPct,
  formatKm,
  formatTimeOfDay,
  type BusinessSummary,
  type DashboardSummary,
  type OperationsSummary,
  type RepDayDetail,
  type RepDayDistance,
  type RepDayTimes,
  mondayOf,
  shiftDay,
  summariseWeek,
  type RepWeek,
  reportingDay,
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
export type WidgetSource = "summary" | "dayTimes" | "operations" | "liveReps" | "business" | "numbers" | "today";

/** Sales, pipeline, money and store health, with this month's rep targets. */
export type BusinessData = {
  summary: BusinessSummary;
  /** Empty when the targets could not be read; the Sales card then shows reps without them. */
  targets: TargetProgress[];
};

export type WidgetData = {
  summary: DashboardSummary | null;
  dayTimes: RepDayTimes[];
  /** Every rep-day behind `dayTimes`, for the Working day card's day picker. */
  dayDetail: RepDayDetail[];
  /** Road distance per rep-day. Empty when the settle step has not run. */
  dayDistance: RepDayDistance[];
  operations: OperationsSummary | null;
  /** Last-known rep positions. Not range-scoped — "where are they" is about now. */
  liveReps: LiveReps | null;
  business: BusinessData | null;
  /** How many days the chosen range covers, for labels like "vs previous 30 days". */
  days: number;
  /** The chosen range, so a tile can hand it to the page it links into. */
  range: DateRange;
  /** The company's words, so a card says "stores" or "sites" as the company does. */
  terms: Terms;
  /** The trade dashboards' numbers (`dashboard_kpis`), fetched only when a card shows them. */
  numbers: Numbers | null;
  /** The numbers "Your numbers" shows, in order (the company setting `dashboard_cards`). */
  cardCodes: string[];
  /** Today's planned work, fetched only when the Today card is on the layout. */
  today: Today | null;
  /** Contract invoices due in the next week, for the Money card. */
  contractsDue: ContractsDue | null;
};

/**
 * Where a tile's number can be taken apart.
 *
 * A rate on a dashboard is the start of a question, not the end of one — "out
 * of stock is 6.2%" is only useful next to *which stores*. Reports already has
 * those tables, so the tiles link into the right tab carrying the same days
 * they were measured over; landing on the default 30 days would answer a
 * different question from the one that was clicked.
 */
function reportHref(tab: ReportId | ReportTab, range: DateRange, view?: ViewId): string {
  // A report and view, or an old tab name: Reports opens the nearest view the
  // company has (`openReport`).
  const params = new URLSearchParams({
    tab,
    ...(view ? { view } : {}),
    from: toLocalDateInput(range.from),
    to: toLocalDateInput(range.to),
  });
  return `/reports?${params.toString()}`;
}

export type WidgetDefinition = {
  /** Stored in `dashboard_layouts.widget_ids`. Never change one in place. */
  id: string;
  /**
   * In the company's words, so a function of them rather than a string: the
   * catalogue is shared by every company, the wording is not.
   */
  title: (t: Terms) => string;
  /** What this card tells you. Shown in the Customise panel. */
  description: (t: Terms) => string;
  /** Columns out of four. 1 = tile, 2 = half width, 4 = full width. */
  span: 1 | 2 | 4;
  source: WidgetSource;
  /**
   * The module this card reports on, when it is not core. A company without
   * it does not see the card or get it offered in Customise — the numbers
   * would be zeros from a feature they do not have.
   */
  module?: ModuleCode;
  /**
   * The permission it needs, when not everyone with the dashboard may see what
   * it shows (money). The database leaves those figures out regardless.
   */
  permission?: PermissionCode;
  render: (data: WidgetData) => ReactNode;
};

/** Whether a card belongs on this person's dashboard. Without the permissions yet, permission-bound cards wait. */
export function widgetAvailable(
  widget: WidgetDefinition,
  modules: ModuleSet,
  permissions: PermissionSet | null = null
): boolean {
  if (widget.module !== undefined && !moduleEnabled(modules, widget.module)) return false;
  if (widget.permission !== undefined) return permissions !== null && can(permissions, widget.permission);
  return true;
}

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
  // ---- Each trade's dashboard (Stage 7 Part 3): its numbers, today, money.
  {
    id: "kpis",
    title: () => "Your numbers",
    description: (t) => `The numbers your trade runs on: ${lower(t.job.many)} done, proof, money. Choose them in Settings.`,
    span: 4,
    source: "numbers",
    render: (d) => <YourNumbers codes={d.cardCodes} numbers={d.numbers!} range={d.range} days={d.days} />,
  },
  {
    id: "today",
    title: () => "Today",
    description: (t) => `Today's ${lower(t.job.many)}: who is on site, who has not started, how many are done.`,
    span: 2,
    source: "today",
    render: (d) => <TodayCard today={d.today!} />,
  },
  {
    id: "money",
    title: () => "Money",
    description: (t) => `Finished ${lower(t.job.many)} not invoiced, what you are owed, what came in, contracts due.`,
    span: 2,
    source: "numbers",
    module: "invoicing",
    permission: "invoicing",
    render: (d) => <MoneyCard numbers={d.numbers!} contractsDue={d.contractsDue} days={d.days} />,
  },
  {
    id: "quotes",
    title: () => "Quotes",
    description: () => "Quotes waiting for an answer, how many you win, and won quotes not yet invoiced.",
    span: 2,
    source: "numbers",
    module: "invoicing",
    permission: "invoicing",
    render: (d) => <QuotesCard numbers={d.numbers!} days={d.days} />,
  },
  // ---- The redesigned dashboard (October 2026). Read top to bottom: the five
  // numbers that matter, then where each comes from. Everything after these is
  // the earlier field-only catalogue, kept for anyone who wants it back.
  {
    id: "headline",
    title: () => "Headline numbers",
    description: (t) =>
      `Revenue, orders needing action, money owed, ${lower(t.site.one)} coverage and ${lower(t.site.many)} needing attention.`,
    span: 4,
    source: "business",
    render: (d) =>
      d.business && <Headline business={d.business.summary} summary={d.summary} days={d.days} />,
  },
  {
    id: "sales",
    title: () => "Sales",
    description: (t) =>
      `Delivered revenue by month with this month's pace, and each ${lower(t.staff.one)} against target.`,
    span: 2,
    source: "business",
    module: "distribution",
    render: (d) => d.business && <SalesCard business={d.business.summary} targets={d.business.targets} />,
  },
  {
    id: "pipeline",
    title: () => "Orders pipeline",
    description: () =>
      "Orders by stage, missing proofs of delivery, quotes, recurring orders, low stock and money owed.",
    span: 2,
    source: "business",
    module: "distribution",
    render: (d) => d.business && <PipelineCard business={d.business.summary} />,
  },
  {
    id: "field_team",
    title: () => "Field team",
    description: (t) =>
      `Where each ${lower(t.staff.one)} last was, who has gone quiet, out-of-stock, planogram and far-from-${lower(t.site.one)} check-ins.`,
    span: 2,
    source: "liveReps",
    render: (d) =>
      d.liveReps && (
        <FieldTeamCard liveReps={d.liveReps} summary={d.summary} business={d.business?.summary ?? null} range={d.range} />
      ),
  },
  {
    id: "store_health",
    title: (t) => `${t.site.one} health`,
    description: (t) =>
      `${t.site.many} ordering, visited without ordering, and not visited — with the ones to go to first.`,
    span: 2,
    source: "business",
    module: "distribution",
    render: (d) => d.business && <StoreHealthCard business={d.business.summary} />,
  },
  {
    id: "visits_completed",
    title: (t) => `${t.job.many} completed`,
    description: (t) =>
      `Completed ${lower(t.job.many)} in the period, against the period before it.`,
    span: 1,
    source: "summary",
    render: ({ summary, days, terms: t }) => {
      if (!summary) return null;
      const { current, previous } = summary;
      return (
        <StatTile
          label={`${title(t.job.many)} Completed`}
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
    title: (t) => `${t.site.one} coverage`,
    description: (t) =>
      `Share of active ${lower(t.site.many)} visited at least once in the period.`,
    span: 1,
    source: "summary",
    render: ({ summary, range, terms: t }) => {
      if (!summary) return null;
      const pct = coveragePctOf(summary);
      return (
        <StatTile
          label={`${title(t.site.one)} Coverage`}
          value={pct === null ? "—" : `${pct}%`}
          sublabel={`${summary.current.stores_covered} of ${summary.stores_active} active ${lower(t.site.many)} visited`}
          icon={<Store className="h-5 w-5 opacity-80" />}
          tone="outline"
          href={reportHref("coverage", range)}
        />
      );
    },
  },
  {
    id: "oos_rate",
    module: "distribution",
    title: () => "Out of stock rate",
    description: () =>
      "Share of stock checks answered “no”. Reads the in_stock metric on your forms.",
    span: 1,
    source: "summary",
    render: ({ summary, days, range }) => {
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
          href={reportHref("availability", range)}
        />
      );
    },
  },
  {
    id: "planogram",
    module: "distribution",
    title: () => "Planogram compliance",
    description: () =>
      "Share of planogram checks answered “yes”. Reads the planogram_ok metric.",
    span: 1,
    source: "summary",
    render: ({ summary, days, range }) => {
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
          // Trends rather than a planogram table: the rate is only readable
          // against its own history, and no per-store planogram table exists.
          href={reportHref("perfect_store", range, "trends")}
        />
      );
    },
  },
  {
    id: "live_reps",
    title: () => "Where the team is",
    description: (t) =>
      `Each ${possessive(lower(t.staff.one))} latest position on a map, with how long ago it arrived. Phones report at the interval set in company settings while the ${lower(t.workday.one)} is open.`,
    span: 4,
    source: "liveReps",
    render: ({ liveReps }) => (liveReps ? <RepMap data={liveReps} /> : null),
  },
  {
    id: "working_day",
    title: () => "Working day",
    description: (t) =>
      `When each ${lower(t.staff.one)} starts, closes and how long they work — from the day's evidence, not from what anyone typed.`,
    span: 4,
    source: "dayTimes",
    render: ({ dayTimes, dayDetail, dayDistance, range }) => (
      <WorkingDay
        rows={dayTimes}
        detail={dayDetail}
        distance={dayDistance}
        range={range}
      />
    ),
  },
  {
    id: "visits_trend",
    title: (t) => `${t.job.many} completed — trend`,
    description: (t) => `Completed ${lower(t.job.many)} per day across the period.`,
    span: 2,
    source: "summary",
    render: ({ summary, days, terms: t }) => {
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
              {t.job.many} completed — last {days} days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnitsTrendChart data={trend} valueLabel="Completed" />
            {active < 3 && trend.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Only {active === 1 ? "one day" : `${active} days`} of activity in
                this period — the trend will fill out as {lower(t.staff.many)} work.
              </p>
            )}
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "coverage_donut",
    title: (t) => `${t.site.one} coverage — chart`,
    description: () => "The same coverage figure as a proportion of the estate.",
    span: 2,
    source: "summary",
    render: ({ summary, terms: t }) => {
      if (!summary) return null;
      const pct = coveragePctOf(summary);
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.site.one} coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {pct === null ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No active {lower(t.site.many)} yet.
              </p>
            ) : (
              <>
                <CoverageDonut covered={pct} notCovered={100 - pct} />
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {summary.stores_active - summary.current.stores_covered} of{" "}
                  {summary.stores_active} active {lower(t.site.many)} not yet
                  visited in this period.
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
    module: "checklists_forms",
    title: () => "Forms submitted",
    description: (t) =>
      `Submissions in the period, and what share of completed ${lower(t.job.many)} carried one.`,
    span: 1,
    source: "summary",
    render: ({ summary, terms: t }) => {
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
              ? `No completed ${lower(t.job.many)} yet`
              : `${rate}% of completed ${lower(t.job.many)}`
          }
          icon={<ClipboardCheck className="h-5 w-5 opacity-80" />}
          tone="outline"
          href="/visits?filter=with-forms"
        />
      );
    },
  },
  {
    // From the plan, as the "Missed" number and the reports count it: planned
    // work on days gone by that nobody did. It used to count visit rows with
    // status 'missed', which nothing ever writes, so it always read 0.
    id: "missed_visits",
    title: (t) => `Missed ${lower(t.job.many)}`,
    description: (t) => `Planned ${lower(t.job.many)} on days gone by that nobody did.`,
    span: 1,
    source: "numbers",
    render: ({ numbers, days, terms: t, range }) => {
      const missed = numbers?.kpis.missed;
      if (!missed) return null;
      return (
        <StatTile
          label={`Missed ${title(t.job.many)}`}
          value={missed.value ?? 0}
          deltaPct={deltaPct(missed.value ?? 0, missed.previous ?? 0)}
          deltaLabel={`vs previous ${days} days`}
          invertDelta
          icon={<XCircle className="h-5 w-5 opacity-80" />}
          tone="outline"
          href={reportHref("service", range, "missed")}
        />
      );
    },
  },
  {
    id: "active_reps",
    title: (t) => `Active ${lower(t.staff.many)}`,
    description: (t) =>
      `${t.staff.many} who recorded anything in the period, and the average ${lower(t.job.one)} length.`,
    span: 1,
    source: "summary",
    render: ({ summary, terms: t }) => {
      if (!summary) return null;
      return (
        <StatTile
          label={`Active ${title(t.staff.many)}`}
          value={summary.current.active_reps}
          sublabel={`Avg ${lower(t.job.one)} ${formatDuration(summary.current.avg_duration_seconds)}`}
          icon={<Users className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      );
    },
  },
  {
    id: "unscheduled_visits",
    title: (t) => `Unscheduled ${lower(t.job.many)}`,
    description: (t) => `Calls ${withArticle(t, "staff")} started outside the plan.`,
    span: 1,
    source: "summary",
    render: ({ summary, terms: t }) => {
      if (!summary) return null;
      return (
        <StatTile
          label={`Unscheduled ${title(t.job.many)}`}
          value={summary.current.visits_unscheduled}
          sublabel={`${t.staff.one}-initiated, outside the plan`}
          icon={<MapPin className="h-5 w-5 opacity-80" />}
          tone="outline"
          href="/activities"
        />
      );
    },
  },
  {
    id: "prospecting",
    module: "distribution",
    title: () => "Prospecting",
    description: () => "Sales calls, pipeline stages and follow-ups owed.",
    span: 2,
    source: "operations",
    render: ({ operations, terms: t }) => {
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
              Open the {t.prospect.many} board →
            </Link>
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "territories",
    title: (t) => t.territory.many,
    description: (t) =>
      `The ${lower(t.territory.one)} structure, and ${lower(t.site.many)} that are not in one.`,
    span: 1,
    source: "operations",
    render: ({ operations, terms: t }) => {
      if (!operations) return null;
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.territory.many}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Line
              label={`Main ${lower(t.territory.many)}`}
              value={operations.territories_main}
            />
            <Line
              label={`Sub-${lower(t.territory.many)}`}
              value={operations.territories_sub}
            />
            <Line
              label={`${t.site.many} with no ${lower(t.territory.one)}`}
              value={operations.stores_unplaced}
              tone={operations.stores_unplaced > 0 ? "bad" : undefined}
            />
            <Link
              href="/territories"
              className="inline-block pt-1 text-xs text-primary hover:underline"
            >
              Manage {lower(t.territory.many)} →
            </Link>
          </CardContent>
        </Card>
      );
    },
  },
  {
    id: "confirmed_positions",
    title: () => "Confirmed positions",
    description: (t) =>
      `How much of the estate stands on a position ${withArticle(t, "staff")} measured, rather than a geocoder's guess.`,
    span: 1,
    source: "operations",
    render: ({ operations, summary, terms: t }) => {
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
            <Line
              label={`Measured by ${withArticle(t, "staff")} on site`}
              value={operations.stores_confirmed}
            />
            <Line label="Still on a geocoder's guess" value={operations.stores_guessed} />
            <p className="pt-1 text-xs text-muted-foreground">
              Every &ldquo;at {lower(t.site.one)}&rdquo; verdict rests on this. A
              guessed pin can put {withArticle(t, "staff")} off site while they
              are actually there.
            </p>
          </CardContent>
        </Card>
      );
    },
  },
];

export const WIDGET_IDS = WIDGETS.map((w) => w.id);

/**
 * The layout somebody sees before they have customised anything.
 *
 * Written out, no longer derived from the registry: since the October 2026
 * redesign the default is the five summary cards plus the team map, and the
 * fourteen earlier field cards stay in the catalogue for Customise rather than
 * all appearing at once, which was most of the old clutter. A new widget meant
 * for everyone must therefore be added here as well as to `WIDGETS`.
 *
 * Nobody had a saved layout when this changed (checked: `dashboard_layouts`
 * was empty), so every dashboard picked the new default up at once.
 */
export const DEFAULT_LAYOUT: string[] = [
  "headline",
  "sales",
  "pipeline",
  "field_team",
  "store_health",
  "live_reps",
];

/**
 * The cards a new user starts with: the company's setting (its trade's, at
 * sign-up), or the default above when the setting names nothing we know.
 */
export function companyDefaultLayout(settingValue: string | null | undefined): string[] {
  const ids = codesFromSetting(settingValue ?? "", (id) => BY_ID.has(id));
  return ids.length > 0 ? ids : DEFAULT_LAYOUT;
}

/** The codes `dashboard_kpis` must compute for the cards on this layout. */
export function numberCodesFor(layout: string[], cardCodes: string[]): string[] {
  const out = new Set<string>();
  if (layout.includes("kpis")) {
    for (const c of cardCodes) out.add(c);
    for (const c of ["jobs_done", "photos_taken", "forms_done", "first_week"]) out.add(c);
  }
  if (layout.includes("money")) {
    for (const c of ["unbilled_jobs", "owed", "invoiced", "received"]) out.add(c);
  }
  if (layout.includes("missed_visits")) out.add("missed");
  if (layout.includes("quotes")) {
    for (const c of ["quotes_waiting_value", "quote_win_rate", "quote_win_value", "accepted_not_invoiced"]) out.add(c);
  }
  return [...out];
}

/** Every distinct source the catalogue depends on. */
export const WIDGET_SOURCES: WidgetSource[] = [
  ...new Set(WIDGETS.map((w) => w.source)),
];

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
/**
 * `2026-08-24` → `Mon 24 Aug`.
 *
 * Parsed as local midnight, never `new Date("2026-08-24")` — that is parsed as
 * UTC, and in CAT it would render the previous day for every date in the list.
 * `en-GB` because 24/08 is the local reading.
 */
function formatDayLabel(localDay: string): string {
  const [y, m, d] = localDay.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** `2026-08-31` → `Mon 31 Aug – Sun 6 Sep`. */
function formatWeekLabel(monday: string): string {
  return `${formatDayLabel(monday)} – ${formatDayLabel(shiftDay(monday, 6))}`;
}

/** Picker values: a day is its own date; a week is its Monday, prefixed. */
const WEEK_PREFIX = "week:";

function WorkingDay({
  rows,
  detail,
  distance,
  range,
}: {
  rows: RepDayTimes[];
  detail: RepDayDetail[];
  distance: RepDayDistance[];
  range: DateRange;
}) {
  // The day keys are in the company's timezone (see `reportingDay`).
  const timeZone = useCompanyConfig()?.timezone ?? "UTC";
  const t = useTerms();
  /** "rep", mid-sentence: the person a row is about, and the "rep-day" unit. */
  const staff = lower(t.staff.one);
  /** Road metres by rep and local day, for the two tables below. */
  const kmFor = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const d of distance) m.set(`${d.rep_id}|${d.local_day}`, d.road_metres);
    return m;
  }, [distance]);

  /**
   * A rep's driving over the whole range, and how much of it is actually known.
   *
   * The count matters as much as the total: a rep with two settled days out of
   * twenty has a total that means almost nothing, and a bare figure would invite
   * comparing it with somebody whose days are all settled.
   */
  const totalFor = useMemo(() => {
    const m = new Map<string, { metres: number; settled: number; days: number }>();
    for (const d of distance) {
      const acc = m.get(d.rep_id) ?? { metres: 0, settled: 0, days: 0 };
      acc.days += 1;
      if (d.road_metres !== null) {
        acc.metres += d.road_metres;
        acc.settled += 1;
      }
      m.set(d.rep_id, acc);
    }
    return m;
  }, [distance]);
  const company = companyDayTimes(rows);

  /**
   * "" is the average, which is the default and the answer to "how does this
   * team work". A specific date answers a different question — "what happened on
   * Tuesday" — and a week a third: "how did last week go", Monday to Sunday,
   * which is the unit a manager actually reviews in. Each is a deliberate
   * choice rather than the landing state.
   */
  const [chosen, setChosen] = useState("");

  // Newest first: a manager checking a specific day is nearly always checking a
  // recent one. Derived from the rows themselves, so the list only ever offers
  // days somebody actually worked — no empty dates to pick and be puzzled by.
  const days = useMemo(
    () => [...new Set(detail.map((d) => d.local_day))].sort().reverse(),
    [detail]
  );
  // The weeks those days fall in, by their Mondays. Same rule: only weeks with
  // a worked day in them, and always Monday-start — never the locale's.
  const weeks = useMemo(
    () => [...new Set(days.map(mondayOf))].sort().reverse(),
    [days]
  );

  /**
   * The selection, but only if the current range still contains it.
   *
   * `chosen` outlives a range change — the card is not remounted — so a date
   * picked under "90 days" can vanish from `days` when the range narrows. The
   * `<select>` would then hold a value matching no option and render blank,
   * while the card took the single-day path with nothing in it: "0 reps worked"
   * and "3 reps recorded no activity on this day" for a range that plainly has
   * activity. Derived rather than reset in an effect, so there is no frame where
   * the two disagree.
   */
  const day = chosen !== "" && days.includes(chosen) ? chosen : "";
  const week =
    chosen.startsWith(WEEK_PREFIX) && weeks.includes(chosen.slice(WEEK_PREFIX.length))
      ? chosen.slice(WEEK_PREFIX.length)
      : "";
  const picked = day !== "" ? day : week !== "" ? WEEK_PREFIX + week : "";

  const weekSummary = useMemo(
    () => (week === "" ? null : summariseWeek(detail, distance, week)),
    [detail, distance, week]
  );
  /**
   * How many of the week's seven days the selected range actually covers.
   *
   * Under "7 days" on a Thursday, "this week" is Monday to Thursday, and a
   * total headed Mon–Sun over four days of data would read as a quiet week
   * rather than a short one. The count is against the *range*, not against
   * days worked — a Saturday nobody worked is still a day the range covered.
   */
  const weekDaysInRange = useMemo(() => {
    if (week === "") return 7;
    // Both ends in the reporting timezone, because `local_day` is. The range
    // is built from the viewer's own midnight, and for a viewer in another
    // zone the calendar date of that instant is not the company-timezone date
    // the rows are keyed to — off by one at either end, and the note wrong.
    // The last covered day is the day of the instant just before the
    // exclusive end.
    const from = reportingDay(range.from.toISOString(), timeZone);
    const last = reportingDay(new Date(+range.to - 1).toISOString(), timeZone);
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = shiftDay(week, i);
      if (d >= from && d <= last) n += 1;
    }
    return n;
  }, [week, range.from, range.to, timeZone]);

  const chosenDay = useMemo(
    () =>
      day === ""
        ? []
        : detail
            .filter((d) => d.local_day === day)
            .sort((a, b) =>
              (a.rep_name ?? "").localeCompare(b.rep_name ?? "")
            ),
    [detail, day]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Working day</CardTitle>
        <SettleDriving />
        {days.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="working-day-picker"
              className="text-xs text-muted-foreground"
            >
              Show
            </label>
            <select
              id="working-day-picker"
              value={picked}
              onChange={(e) => setChosen(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="">
                Average of {company.days} {staff}-
                {company.days === 1 ? "day" : "days"}
              </option>
              <optgroup label="Weeks (Mon – Sun)">
                {weeks.map((w) => (
                  <option key={w} value={WEEK_PREFIX + w}>
                    Week of {formatDayLabel(w)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Days">
                {days.map((d) => (
                  <option key={d} value={d}>
                    {formatDayLabel(d)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {company.days === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recorded activity in this period, so there is no day to measure.
          </p>
        ) : day !== "" ? (
          <>
            <p className="text-sm font-semibold text-foreground">
              {formatDayLabel(day)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {count(t, "staff", chosenDay.length)} worked. These are the actual
              first and last activity of that day, not an average.
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">{t.staff.one}</th>
                    <th className="py-2 text-right font-medium">In</th>
                    <th className="py-2 text-right font-medium">Out</th>
                    <th className="py-2 text-right font-medium">Length</th>
                    <th className="py-2 text-right font-medium">Driving</th>
                  </tr>
                </thead>
                <tbody>
                  {chosenDay.map((d) => (
                    <tr
                      key={`${d.rep_id}-${d.local_day}`}
                      className="border-b border-border/60"
                    >
                      <td className="py-2 text-foreground">
                        {d.rep_name ?? `Unnamed ${staff}`}
                      </td>
                      <td className="py-2 text-right tabular-nums text-foreground">
                        {formatTimeOfDay(d.start_seconds)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-foreground">
                        {formatTimeOfDay(d.end_seconds)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {formatDuration(Number(d.length_seconds ?? 0))}
                      </td>
                      <td
                        className="py-2 text-right tabular-nums text-foreground"
                        title={
                          kmFor.get(`${d.rep_id}|${d.local_day}`) == null
                            ? "No road distance for this day yet."
                            : "Driving distance along roads, from the day's recorded positions."
                        }
                      >
                        {formatKm(kmFor.get(`${d.rep_id}|${d.local_day}`) ?? null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Named rather than implied: a rep missing from this table did not
                work that day, which is a different thing from a missing record
                and is worth being able to tell apart at a glance. */}
            {chosenDay.length < rows.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                {count(t, "staff", rows.length - chosenDay.length)} recorded no
                activity on this day.
              </p>
            )}
          </>
        ) : weekSummary !== null ? (
          <>
            <p className="text-sm font-semibold text-foreground">
              {formatWeekLabel(weekSummary.monday)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {count(t, "staff", weekSummary.reps.length)} worked,{" "}
              {weekSummary.repDays} {staff}-{weekSummary.repDays === 1 ? "day" : "days"}{" "}
              in all. Starts, closes and length are each{" "}
              {/* Typographic apostrophe, as the sentence always had. */}
              {possessive(staff).replace("'", "\u2019")} average
              over the days they worked that week; driving is the week&rsquo;s
              total.
            </p>
            {/* Said before the numbers, not after: a total over four days of a
                seven-day heading reads as a quiet week unless told otherwise. */}
            {weekDaysInRange < 7 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Only {weekDaysInRange}{" "}of this week&rsquo;s 7 days fall
                inside the selected period. Widen the range to see the whole
                week.
              </p>
            )}
            <RepAveragesTable
              rows={weekSummary.reps}
              driving={
                new Map(
                  weekSummary.reps.map((r) => [
                    r.rep_id,
                    { metres: r.road_metres ?? 0, settled: r.settled },
                  ])
                )
              }
            />
            {weekSummary.reps.length < rows.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                {count(t, "staff", rows.length - weekSummary.reps.length)} recorded
                no activity this week.
              </p>
            )}
          </>
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
              Across {company.days} {staff}-{company.days === 1 ? "day" : "days"},
              weighted by days worked so {withArticle(t, "staff")} with one day
              does not count the same as {withArticle(t, "staff")} with twenty.
            </p>
            {/* Said once, plainly. The distance is a driving route computed
                through the day's recorded positions — closer to the truth than a
                straight line, and not a reading off an odometer. A dash means the
                day has not been worked out yet, never that nobody drove. */}
            <p className="text-xs text-muted-foreground">
              Driving is the route along roads through each day&rsquo;s recorded
              positions. A dash means that day has not been worked out yet.
            </p>

            <RepAveragesTable
              rows={rows}
              driving={
                new Map(
                  [...totalFor.entries()].map(([id, t]) => [
                    id,
                    { metres: t.metres, settled: t.settled },
                  ])
                )
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Per-rep averages over a stretch of days — the whole range, or one week.
 *
 * One table for both rather than two copies of the same six columns, so the
 * week reads exactly like the range it is a slice of. `driving` is keyed by
 * rep: the metres over the settled days and how many of the rep's days were
 * settled, which is what makes the total honest.
 */
function RepAveragesTable({
  rows,
  driving,
}: {
  rows: (RepDayTimes | RepWeek)[];
  driving: Map<string, { metres: number; settled: number }>;
}) {
  const t = useTerms();
  const staff = lower(t.staff.one);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">{t.staff.one}</th>
            <th className="py-2 text-right font-medium">Days</th>
            <th className="py-2 text-right font-medium">Starts</th>
            <th className="py-2 text-right font-medium">Closes</th>
            <th className="py-2 text-right font-medium">Length</th>
            <th className="py-2 text-right font-medium">Driving</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = driving.get(r.rep_id);
            return (
              <tr key={r.rep_id} className="border-b border-border/60">
                <td className="py-2 text-foreground">
                  {r.rep_name ?? `Unnamed ${staff}`}
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
                <td className="py-2 text-right tabular-nums text-foreground">
                  {!d || d.settled === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      {formatKm(d.metres)}
                      {/* Counted against the rep's *working days*, the number
                          in the column two to the left — not against workday
                          sessions, which is a smaller and unexplained figure on
                          screen.

                          The gap is itself worth seeing: a distance needs a
                          workday session, and a rep who worked by every other
                          measure but never pressed Start has no route to
                          measure. */}
                      {d.settled < r.days_worked && (
                        <span
                          className="ml-1 text-xs font-normal text-muted-foreground"
                          title={`${d.settled} of ${r.days_worked} working days have a road distance. A day only has one if the ${staff} started ${withArticle(t, "workday")} on it.`}
                        >
                          ({d.settled}/{r.days_worked})
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
