"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { CustomiseDashboard } from "@/components/dashboard/customise-dashboard";
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  findWidget,
  type WidgetData,
  type WidgetSource,
} from "@/components/dashboard/widget-registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { rangeDays, rangeForPreset, type DateRange } from "@/lib/date-range";
import {
  fetchDashboardSummary,
  fetchOperationsSummary,
  fetchRepDayTimes,
  type DashboardSummary,
  type OperationsSummary,
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
  const [ops, setOps] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [customising, setCustomising] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  /** Which sources failed, so a card can say so instead of rendering blank. */
  const [failedSources, setFailedSources] = useState<Set<WidgetSource>>(new Set());

  const load = useCallback(async () => {
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
      const [summary, times, operations] = await Promise.allSettled([
        fetchDashboardSummary(supabase, range),
        fetchRepDayTimes(supabase, range),
        fetchOperationsSummary(supabase, range),
      ]);

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
      if (operations.status === "fulfilled") setOps(operations.value);
      else {
        setOps(null);
        failed.add("operations");
      }
      setFailedSources(failed);

      // Reported rather than swallowed — a section quietly missing is how a
      // broken RPC survives for weeks.
      const rejected = [summary, times, operations].find(
        (r) => r.status === "rejected"
      );
      setError(
        rejected && rejected.status === "rejected"
          ? rejected.reason instanceof Error
            ? rejected.reason.message
            : String(rejected.reason)
          : null
      );
    } finally {
      setLoading(false);
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
        const [saved, org] = await Promise.all([
          fetchLayout(supabase),
          fetchOrgId(supabase),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setLayout(reconcileLayout(saved, WIDGET_IDS, DEFAULT_LAYOUT));
      } catch (e) {
        if (cancelled) return;
        // The default is a safe thing to show, but say why it is what you are
        // looking at — otherwise a customised dashboard silently reverts and the
        // next save overwrites the real one.
        setLayout(DEFAULT_LAYOUT);
        setLayoutError(
          `Your saved layout could not be read, so this is the default: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveLayout(widgetIds: string[]) {
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

  const days = rangeDays(range);
  const widgetData: WidgetData = {
    summary: data,
    dayTimes,
    operations: ops,
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
              {failedSources.size === 3
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
