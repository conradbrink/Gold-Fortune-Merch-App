"use client";

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
import type { ReportTab } from "@/lib/report-tabs";
import { UnitsTrendChart } from "@/components/dashboard/units-trend-chart";
import { SettleDriving } from "@/components/workday/settle-driving";
import {
  companyDayTimes,
  deltaPct,
  formatDuration,
  formatPct,
  formatKm,
  formatTimeOfDay,
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
export type WidgetSource = "summary" | "dayTimes" | "operations" | "liveReps";

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
  /** How many days the chosen range covers, for labels like "vs previous 30 days". */
  days: number;
  /** The chosen range, so a tile can hand it to the page it links into. */
  range: DateRange;
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
function reportHref(tab: ReportTab, range: DateRange): string {
  const params = new URLSearchParams({
    tab,
    from: toLocalDateInput(range.from),
    to: toLocalDateInput(range.to),
  });
  return `/reports?${params.toString()}`;
}

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
    render: ({ summary, range }) => {
      if (!summary) return null;
      const pct = coveragePctOf(summary);
      return (
        <StatTile
          label="Store Coverage"
          value={pct === null ? "—" : `${pct}%`}
          sublabel={`${summary.current.stores_covered} of ${summary.stores_active} active stores visited`}
          icon={<Store className="h-5 w-5 opacity-80" />}
          tone="outline"
          href={reportHref("coverage", range)}
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
          href={reportHref("oos", range)}
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
          href={reportHref("trends", range)}
        />
      );
    },
  },
  {
    id: "live_reps",
    title: "Where the team is",
    description:
      "Each rep's latest position on a map, with how long ago it arrived. Phones report every 5 minutes once the current app build reaches them; until then most fixes come from check-ins.",
    span: 4,
    source: "liveReps",
    render: ({ liveReps }) => (liveReps ? <RepMap data={liveReps} /> : null),
  },
  {
    id: "working_day",
    title: "Working day",
    description:
      "When each rep starts, closes and how long they work — from the day's evidence, not from what anyone typed.",
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

export const WIDGET_IDS = WIDGETS.map((w) => w.id);

/**
 * The layout somebody sees before they have customised anything: the dashboard
 * exactly as it was when it was a fixed page.
 *
 * Derived rather than restated. It was a second hand-written list of the same
 * fourteen ids, and a new widget added to `WIDGETS` but forgotten here would have
 * been missing from every uncustomised dashboard with nothing to show it was
 * meant to be there. `WIDGETS` is ordered to be read top to bottom for this
 * reason — registry order *is* the default layout.
 */
export const DEFAULT_LAYOUT: string[] = [...WIDGET_IDS];

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
    // is built from the viewer's own midnight, and for a viewer outside CAT
    // the calendar date of that instant is not the Gaborone date the rows
    // are keyed to — off by one at either end, and the note wrong with it.
    // The last covered day is the day of the instant just before the
    // exclusive end.
    const from = reportingDay(range.from.toISOString());
    const last = reportingDay(new Date(+range.to - 1).toISOString());
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = shiftDay(week, i);
      if (d >= from && d <= last) n += 1;
    }
    return n;
  }, [week, range.from, range.to]);

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
                Average of {company.days} rep-
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
              {chosenDay.length} rep{chosenDay.length === 1 ? "" : "s"} worked.
              These are the actual first and last activity of that day, not an
              average.
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Rep</th>
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
                        {d.rep_name ?? "Unnamed rep"}
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
                {rows.length - chosenDay.length} rep
                {rows.length - chosenDay.length === 1 ? "" : "s"} recorded no
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
              {weekSummary.reps.length} rep
              {weekSummary.reps.length === 1 ? "" : "s"} worked,{" "}
              {weekSummary.repDays} rep-{weekSummary.repDays === 1 ? "day" : "days"}{" "}
              in all. Starts, closes and length are each rep&rsquo;s average over
              the days they worked that week; driving is the week&rsquo;s total.
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
                {rows.length - weekSummary.reps.length} rep
                {rows.length - weekSummary.reps.length === 1 ? "" : "s"} recorded
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
              Across {company.days} rep-{company.days === 1 ? "day" : "days"},
              weighted by days worked so a rep with one day does not count the
              same as a rep with twenty.
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
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">Rep</th>
            <th className="py-2 text-right font-medium">Days</th>
            <th className="py-2 text-right font-medium">Starts</th>
            <th className="py-2 text-right font-medium">Closes</th>
            <th className="py-2 text-right font-medium">Length</th>
            <th className="py-2 text-right font-medium">Driving</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = driving.get(r.rep_id);
            return (
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
                <td className="py-2 text-right tabular-nums text-foreground">
                  {!t || t.settled === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      {formatKm(t.metres)}
                      {/* Counted against the rep's *working days*, the number
                          in the column two to the left — not against workday
                          sessions, which is a smaller and unexplained figure on
                          screen.

                          The gap is itself worth seeing: a distance needs a
                          workday session, and a rep who worked by every other
                          measure but never pressed Start has no route to
                          measure. */}
                      {t.settled < r.days_worked && (
                        <span
                          className="ml-1 text-xs font-normal text-muted-foreground"
                          title={`${t.settled} of ${r.days_worked} working days have a road distance. A day only has one if the rep started a workday on it.`}
                        >
                          ({t.settled}/{r.days_worked})
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
