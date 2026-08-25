"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { CustomiseDashboard } from "@/components/dashboard/customise-dashboard";
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  WIDGET_SOURCES,
  findWidget,
  type WidgetData,
  type WidgetSource,
} from "@/components/dashboard/widget-registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { rangeDays, rangeForPreset, type DateRange } from "@/lib/date-range";
import { fetchLiveReps, type LiveReps } from "@/lib/live-reps";
import {
  fetchDashboardSummary,
  fetchOperationsSummary,
  fetchRepDayDetail,
  fetchRepDayTimes,
  type DashboardSummary,
  type OperationsSummary,
  type RepDayDetail,
  type RepDayTimes,
} from "@/lib/dashboard";
import {
  fetchLayout,
  NO_SAVED_LAYOUT,
  reconcileLayout,
  resetLayout,
  saveLayout,
} from "@/lib/dashboard-layout";
import { fetchOrgId } from "@/lib/representatives";

/**
 * The dashboard is composed, not fixed.
 *
 * Every card comes from the registry in `widget-registry.tsx`, and which ones
 * appear — and in what order — is this user's own saved layout. The page itself
 * knows only three things: how to fetch the sources, how wide a card asked to be,
 * and what to render when a card's source did not arrive.
 */

/** Tailwind cannot see a computed class name, so the spans are spelled out. */
const SPAN_CLASS: Record<1 | 2 | 4, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2 lg:col-span-2",
  4: "sm:col-span-2 lg:col-span-4",
};

export default function InsightsDashboardPage() {
  const supabase = createClient();
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [dayTimes, setDayTimes] = useState<RepDayTimes[]>([]);
  const [dayDetail, setDayDetail] = useState<RepDayDetail[]>([]);
  const [liveReps, setLiveReps] = useState<LiveReps | null>(null);
  const [ops, setOps] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [customising, setCustomising] = useState(false);
  /**
   * Whether the saved layout has been read yet, either way.
   *
   * `layout` starts as the default, so Customise opened before the fetch settles
   * would seed its draft from the default and Save would then write that over the
   * layout the person actually has — losing their customisation to a fast click.
   * The button waits.
   */
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  /** Which sources failed, so a card can say so instead of rendering blank. */
  const [failedSources, setFailedSources] = useState<Set<WidgetSource>>(new Set());
  /** Identifies the newest load, so an older one cannot land on top of it. */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    // Which load this is. Changing the range and pressing Retry can overlap, and
    // whichever *returns* last was winning — so the page could sit showing
    // figures for a range the picker no longer displays. Same guard as the global
    // search; it belonged here too.
    const runId = ++loadSeq.current;
    const isStale = () => runId !== loadSeq.current;

    setLoading(true);
    setError(null);
    try {
      // One RPC per source. This page used to run seven sequential queries, two
      // of which pulled entire tables to the browser to count distinct values in
      // JS. The working-day figures are a second one because they answer a
      // different question — when people work, not what they did — and are
      // grouped per rep rather than over the whole org.
      //
      // allSettled, not all: with `all`, either of the two secondary RPCs
      // rejecting — an environment where those migrations have not run, a
      // transient refusal — threw away headline KPIs that had loaded perfectly
      // well. Each source now fails on its own, and the cards that depend on it
      // say why.
      const [summary, times, dayRows, operations, live] = await Promise.allSettled([
        fetchDashboardSummary(supabase, range),
        fetchRepDayTimes(supabase, range),
        // Same source as `times`: the averages and the days behind them are one
        // feature, and a card showing an average whose detail failed to load
        // would offer a day picker that silently finds nothing.
        fetchRepDayDetail(supabase, range),
        fetchOperationsSummary(supabase, range),
        // Not range-scoped, unlike everything else here: "where is the team"
        // is a question about now, and a date filter would answer a different
        // one while looking like it had answered this.
        fetchLiveReps(supabase),
      ]);

      if (isStale()) return;

      const failed = new Set<WidgetSource>();
      if (summary.status === "fulfilled") setData(summary.value);
      else {
        setData(null);
        failed.add("summary");
      }
      if (times.status === "fulfilled") setDayTimes(times.value);
      else {
        setDayTimes([]);
        failed.add("dayTimes");
      }
      if (dayRows.status === "fulfilled") setDayDetail(dayRows.value);
      else {
        setDayDetail([]);
        failed.add("dayTimes");
      }
      if (operations.status === "fulfilled") setOps(operations.value);
      else {
        setOps(null);
        failed.add("operations");
      }
      if (live.status === "fulfilled") setLiveReps(live.value);
      else {
        setLiveReps(null);
        failed.add("liveReps");
      }
      setFailedSources(failed);

      // Reported rather than swallowed — a section quietly missing is how a
      // broken RPC survives for weeks.
      //
      // A source that *answers* `null` counts here too. Its cards go unavailable
      // either way, and without an error there would be no banner and no Retry —
      // the card would say "Retry above" pointing at nothing.
      const rejected = [summary, times, dayRows, operations, live].find(
        (r) => r.status === "rejected"
      );
      const answeredNothing =
        (summary.status === "fulfilled" && summary.value === null) ||
        (operations.status === "fulfilled" && operations.value === null);
      setError(
        rejected && rejected.status === "rejected"
          ? rejected.reason instanceof Error
            ? rejected.reason.message
            : String(rejected.reason)
          : answeredNothing
            ? "Some figures came back empty. Retrying may help; if it does not, the report may not be available for this period."
            : null
      );
    } finally {
      // The newest load owns the spinner; an older one finishing must not clear
      // it while the current one is still out.
      if (!isStale()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  // The layout does not depend on the date range, so it is fetched once rather
  // than on every range change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Settled independently: these answer unrelated questions, and with
        // `Promise.all` an org-lookup failure rejected the pair and forced the
        // default layout even though the layout had been read perfectly well —
        // the exact silent-revert-then-overwrite the catch below warns about.
        const [saved, org] = await Promise.allSettled([
          fetchLayout(supabase),
          fetchOrgId(supabase),
        ]);
        if (cancelled) return;

        // Only blocks saving, which `handleSaveLayout` reports if it comes to it.
        if (org.status === "fulfilled") setOrgId(org.value);

        if (saved.status === "fulfilled") {
          setLayout(reconcileLayout(saved.value, WIDGET_IDS, DEFAULT_LAYOUT));
          // Only now is editing safe. `NO_SAVED_LAYOUT` counts as a successful
          // read — it means this person has never customised, which is a fact,
          // not a failure.
          setLayoutLoaded(true);
        } else {
          // Show the default, and say so. But *do not* unlock Customise: the
          // banner explains what you are looking at, it does not stop you saving
          // the default over a layout that exists and simply could not be read.
          // Explaining is not preventing.
          setLayout(DEFAULT_LAYOUT);
          setLayoutError(
            `Your saved layout could not be read, so this is the default. Customising is disabled until it can be read, so it is not overwritten: ${
              saved.reason instanceof Error
                ? saved.reason.message
                : String(saved.reason)
            }`
          );
        }
      } catch (e) {
        if (cancelled) return;
        setLayout(DEFAULT_LAYOUT);
        setLayoutError(
          `Your saved layout could not be read, so this is the default. Customising is disabled until it can be read, so it is not overwritten: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
      // No `finally` unlocking the button: it is set only on a fulfilled read,
      // above. Unlocking here on failure as well was the whole bug — the gate
      // closed the timing window and left the failure case wide open.
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveLayout(widgetIds: string[]) {
    // Guarded here as well as on the button. What is being written could be the
    // default standing in for a layout that exists but was not read, and a
    // disabled button is a UI state — this is the one that decides.
    if (!layoutLoaded) {
      setLayoutError(
        "Your saved layout has not been read yet, so saving now could overwrite it. Try again in a moment."
      );
      return;
    }
    if (!orgId) {
      setLayoutError("Your organisation has not loaded yet. Try again in a moment.");
      return;
    }
    setSavingLayout(true);
    setLayoutError(null);
    try {
      await saveLayout(supabase, orgId, widgetIds);
      setLayout(widgetIds);
      setCustomising(false);
    } catch (e) {
      setLayoutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLayout(false);
    }
  }

  async function handleResetLayout() {
    setSavingLayout(true);
    setLayoutError(null);
    try {
      await resetLayout(supabase);
      setLayout(DEFAULT_LAYOUT);
      setCustomising(false);
    } catch (e) {
      setLayoutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLayout(false);
    }
  }

  /**
   * The map is the one card that has to keep moving on its own.
   *
   * Everything else here answers a question about a date range and is correct
   * until the range changes. "Where is the team" is only ever true for a minute,
   * and a manager leaves this page open — so this source, and only this source,
   * re-fetches on a timer. Sixty seconds against a five-minute ping cadence: fast
   * enough that a new fix appears promptly, slow enough not to hammer PostgREST
   * for a table that gains a handful of rows an hour.
   *
   * Failures are swallowed deliberately. A dropped poll leaves the previous
   * positions on screen with their ages ticking up, which is exactly what it
   * looks like when a rep goes quiet — the card is already built to show that
   * honestly, and an error banner for one missed refresh would be noise.
   */
  useEffect(() => {
    const t = setInterval(() => {
      fetchLiveReps(supabase)
        .then(setLiveReps)
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = rangeDays(range);
  const widgetData: WidgetData = {
    summary: data,
    dayTimes,
    dayDetail,
    operations: ops,
    liveReps,
    days,
  };

  /**
   * Whether a source actually has something to draw, which is not the same as
   * its fetch having settled.
   *
   * An RPC that answers `null` counts as fulfilled, so it never reaches
   * `failedSources` — and every card reading it would then render nothing,
   * leaving a page of blank grid cells with no explanation. Readiness is judged
   * on the data being there.
   *
   * `dayTimes` is the exception: it is an array, and empty is a legitimate answer
   * (nobody worked in this period), which its card already says in words.
   */
  const sourceReady: Record<WidgetSource, boolean> = {
    summary: data !== null,
    dayTimes: !failedSources.has("dayTimes"),
    operations: ops !== null,
    liveReps: liveReps !== null,
  };

  const cards = layout.map((id) => findWidget(id)).filter((w) => w !== undefined);

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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!layoutLoaded}
          title={
            layoutLoaded ? undefined : "Reading your saved layout…"
          }
          onClick={() => setCustomising(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Customise
        </Button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {layoutError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {layoutError}
        </p>
      )}

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-sm">
            {/* Cards whose own source arrived are still shown, so this must not
                claim the whole dashboard is gone when it is not. */}
            <p className="font-medium text-destructive">
              {/* Against the number of sources the catalogue actually has, so
                  the wording stays true if a fourth is ever added. */}
              {failedSources.size === WIDGET_SOURCES.length
                ? "Could not load the dashboard"
                : "Part of the dashboard could not be loaded"}
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
      ) : cards.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Your dashboard is empty. Use{" "}
            <span className="font-medium text-foreground">Customise</span> to add
            cards.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((widget) => (
            <div key={widget.id} className={SPAN_CLASS[widget.span]}>
              {sourceReady[widget.source] ? (
                widget.render(widgetData)
              ) : (
                <UnavailableCard title={widget.title} />
              )}
            </div>
          ))}
        </div>
      )}

      <CustomiseDashboard
        open={customising}
        onOpenChange={setCustomising}
        layout={layout}
        onSave={handleSaveLayout}
        onReset={handleResetLayout}
        saving={savingLayout}
        error={layoutError}
      />
    </div>
  );
}

/**
 * A card whose source did not load.
 *
 * Shown in place rather than dropped: a card silently missing from a layout the
 * user arranged themselves reads as the dashboard losing their settings.
 */
function UnavailableCard({ title }: { title: string }) {
  return (
    <Card className="h-full border-dashed">
      <CardContent className="flex h-full min-h-[124px] flex-col justify-center py-6 text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Could not be loaded. Retry above.
        </p>
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
