"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  Store,
  ClipboardCheck,
  MapPin,
  XCircle,
  PackageX,
  LayoutGrid,
} from "lucide-react";
import { StatTile } from "@/components/dashboard/stat-tile";
import { CoverageDonut } from "@/components/dashboard/coverage-donut";
import { UnitsTrendChart } from "@/components/dashboard/units-trend-chart";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { rangeDays, rangeForPreset, type DateRange } from "@/lib/date-range";
import {
  companyDayTimes,
  deltaPct,
  fetchDashboardSummary,
  fetchRepDayTimes,
  formatDuration,
  formatPct,
  formatTimeOfDay,
  type DashboardSummary,
  type RepDayTimes,
} from "@/lib/dashboard";

export default function InsightsDashboardPage() {
  const supabase = createClient();
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [dayTimes, setDayTimes] = useState<RepDayTimes[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One RPC. This page used to run seven sequential queries, two of which
      // pulled entire tables to the browser to count distinct values in JS.
      // The working-day figures are a second one because they answer a
      // different question — when people work, not what they did — and are
      // grouped per rep rather than over the whole org.
      const [summary, times] = await Promise.all([
        fetchDashboardSummary(supabase, range),
        fetchRepDayTimes(supabase, range),
      ]);
      setData(summary);
      setDayTimes(times);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
      setDayTimes([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const days = rangeDays(range);
  const deltaLabel = `vs previous ${days} days`;

  const cur = data?.current;
  const prev = data?.previous;

  const coveragePct =
    data && data.stores_active > 0
      ? Math.round((cur!.stores_covered / data.stores_active) * 100)
      : null;

  const formRate =
    cur && cur.visits_completed > 0
      ? Math.round((cur.submissions / cur.visits_completed) * 100)
      : null;

  const trend =
    data?.series.map((p) => ({
      // "Jul 14" reads better than an ISO date on a crowded axis.
      label: new Date(p.day + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: p.completed,
    })) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Insights Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Live field performance across your Gold Fortune team.
          </p>
        </div>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-sm">
            <p className="font-medium text-destructive">
              Could not load the dashboard
            </p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <SkeletonGrid />
      ) : cur && prev && data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Visits Completed"
              value={cur.visits_completed}
              deltaPct={deltaPct(cur.visits_completed, prev.visits_completed)}
              deltaLabel={deltaLabel}
              icon={<ClipboardCheck className="h-5 w-5 opacity-80" />}
              href="/visits"
            />
            <StatTile
              label="Store Coverage"
              value={coveragePct === null ? "—" : `${coveragePct}%`}
              sublabel={`${cur.stores_covered} of ${data.stores_active} active stores visited`}
              icon={<Store className="h-5 w-5 opacity-80" />}
              tone="outline"
            />
            <StatTile
              label="Out of Stock Rate"
              value={formatPct(cur.oos_rate)}
              deltaPct={
                cur.oos_rate !== null && prev.oos_rate !== null
                  ? deltaPct(cur.oos_rate * 1000, prev.oos_rate * 1000)
                  : null
              }
              deltaLabel={deltaLabel}
              // Down is good here, so the arrow colouring must flip.
              invertDelta
              icon={<PackageX className="h-5 w-5 opacity-80" />}
              tone="outline"
            />
            <StatTile
              label="Planogram Compliance"
              value={formatPct(cur.planogram_rate)}
              deltaPct={
                cur.planogram_rate !== null && prev.planogram_rate !== null
                  ? deltaPct(cur.planogram_rate * 1000, prev.planogram_rate * 1000)
                  : null
              }
              deltaLabel={deltaLabel}
              icon={<LayoutGrid className="h-5 w-5 opacity-80" />}
              tone="outline"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">
                  Visits completed — last {days} days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UnitsTrendChart data={trend} valueLabel="Completed" />
                {trend.filter((t) => t.value > 0).length < 3 &&
                  trend.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Only{" "}
                      {trend.filter((t) => t.value > 0).length === 1
                        ? "one day"
                        : `${trend.filter((t) => t.value > 0).length} days`}{" "}
                      of activity in this period — the trend will fill out as
                      reps work.
                    </p>
                  )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Store coverage</CardTitle>
              </CardHeader>
              <CardContent>
                {coveragePct === null ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No active stores yet.
                  </p>
                ) : (
                  <>
                    <CoverageDonut
                      covered={coveragePct}
                      notCovered={100 - coveragePct}
                    />
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      {data.stores_active - cur.stores_covered} of{" "}
                      {data.stores_active} active stores not yet visited in this
                      period.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Forms Submitted"
              value={cur.submissions}
              sublabel={
                formRate === null
                  ? "No completed visits yet"
                  : `${formRate}% of completed visits`
              }
              icon={<ClipboardCheck className="h-5 w-5 opacity-80" />}
              tone="outline"
              href="/visits?filter=with-forms"
            />
            <StatTile
              label="Missed Visits"
              value={cur.visits_missed}
              deltaPct={deltaPct(cur.visits_missed, prev.visits_missed)}
              deltaLabel={deltaLabel}
              invertDelta
              icon={<XCircle className="h-5 w-5 opacity-80" />}
              tone="outline"
            />
            <StatTile
              label="Active Reps"
              value={cur.active_reps}
              sublabel={`Avg visit ${formatDuration(cur.avg_duration_seconds)}`}
              icon={<Users className="h-5 w-5 opacity-80" />}
              tone="outline"
            />
            <StatTile
              label="Unscheduled Visits"
              value={cur.visits_unscheduled}
              sublabel="Rep-initiated, outside the plan"
              icon={<MapPin className="h-5 w-5 opacity-80" />}
              tone="outline"
              href="/activities"
            />
          </div>

          <WorkingDay rows={dayTimes} />
        </>
      ) : (
        !error && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No activity in this period. Try widening the date range.
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
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

function SkeletonGrid() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[124px] animate-pulse rounded-lg bg-secondary" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-[260px] animate-pulse rounded-lg bg-secondary lg:col-span-2" />
        <div className="h-[260px] animate-pulse rounded-lg bg-secondary" />
      </div>
    </div>
  );
}
