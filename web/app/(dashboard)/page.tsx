"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { CustomiseDashboard } from "@/components/dashboard/customise-dashboard";
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  WIDGET_SOURCES,
  companyDefaultLayout,
  findWidget,
  numberCodesFor,
  widgetAvailable,
  type BusinessData,
  type WidgetData,
  type WidgetSource,
} from "@/components/dashboard/widget-registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { getCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { rangeDays, rangeForPreset, toLocalDateInput, type DateRange } from "@/lib/date-range";
import { fetchLiveReps, type LiveReps } from "@/lib/live-reps";
import { fetchTargetProgress, monthStart } from "@/lib/targets";
import {
  fetchBusinessSummary,
  fetchDashboardSummary,
  fetchOperationsSummary,
  fetchRepDayDetail,
  fetchRepDayDistance,
  fetchRepDayTimes,
  type DashboardSummary,
  type OperationsSummary,
  type RepDayDetail,
  type RepDayDistance,
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
import { AccountCards } from "@/components/dashboard/account-cards";
import {
  fetchContractsDue,
  fetchNumbers,
  fetchToday,
  type ContractsDue,
  type Numbers,
  type Today,
} from "@/lib/dashboard-numbers";
import { codesFromSetting, findKpi } from "@/lib/kpis";
import { usePermissions } from "@/lib/use-permissions";

/**
 * The dashboard is composed, not fixed.
 *
 * Every card comes from the registry in `widget-registry.tsx`, and which ones
 * appear — and in what order — is this user's own saved layout. The page itself
 * knows only three things: how to fetch the sources, how wide a card asked to be,
 * and what to render when a card's source did not arrive.
 */

const TODAY_LABEL = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

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
  const [dayDistance, setDayDistance] = useState<RepDayDistance[]>([]);
  const [liveReps, setLiveReps] = useState<LiveReps | null>(null);
  const [ops, setOps] = useState<OperationsSummary | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT);
  const company = useCompanyConfig();
  const terms = useTerms();
  const permissions = usePermissions();
  /** The trade's cards, for someone who has not arranged their own (the company setting). */
  const companyDefault = companyDefaultLayout(company?.settings.dashboard_layout);
  const cardCodes = codesFromSetting(company?.settings.dashboard_cards ?? "", (c) => !!findKpi(c));
  const [numbers, setNumbers] = useState<Numbers | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [contractsDue, setContractsDue] = useState<ContractsDue | null>(null);
  /** The trade cards' sources that failed, apart from the page's own load. */
  const [tradeFailed, setTradeFailed] = useState<Set<WidgetSource>>(new Set());
  /** Bumped by Retry, so the trade cards try again with the rest. */
  const [tradeTick, setTradeTick] = useState(0);
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
      const [summary, times, dayRows, distanceRows, operations, live, biz] =
        await Promise.allSettled([
        fetchDashboardSummary(supabase, range),
        fetchRepDayTimes(supabase, range),
        // Same source as `times`: the averages and the days behind them are one
        // feature, and a card showing an average whose detail failed to load
        // would offer a day picker that silently finds nothing.
        fetchRepDayDetail(supabase, range),
        // A failed config lookup must not cost the distance column: fall
        // back the same way as a company with no timezone.
        getCompanyConfig().catch(() => null).then((c) =>
          fetchRepDayDistance(supabase, range, c?.timezone ?? "UTC")
        ),
        fetchOperationsSummary(supabase, range),
        // Not range-scoped, unlike everything else here: "where is the team"
        // is a question about now, and a date filter would answer a different
        // one while looking like it had answered this.
        fetchLiveReps(supabase, terms),
        // Sales, pipeline, money and store health, plus this month's targets.
        // The targets are always the calendar month, whatever the range — a
        // target is set per month, and progress against it is only meaningful
        // over that month. A failed targets read must not take the business
        // cards with it, so it falls back to no targets.
        Promise.all([
          fetchBusinessSummary(supabase, range),
          fetchTargetProgress(supabase, monthStart()).catch(() => []),
        ]).then(([s, targets]): BusinessData => ({ summary: s, targets })),
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
      if (distanceRows.status === "fulfilled") setDayDistance(distanceRows.value);
      else {
        // Distance is an addition to the card, not the card. Losing it should
        // grey one column, not take the working-day figures down with it.
        setDayDistance([]);
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
      if (biz.status === "fulfilled") setBusiness(biz.value);
      else {
        setBusiness(null);
        failed.add("business");
      }
      setFailedSources(failed);

      // Reported rather than swallowed — a section quietly missing is how a
      // broken RPC survives for weeks.
      //
      // A source that *answers* `null` counts here too. Its cards go unavailable
      // either way, and without an error there would be no banner and no Retry —
      // the card would say "Retry above" pointing at nothing.
      const rejected = [summary, times, dayRows, operations, live, biz].find(
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
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `load` still starts before this returns.
    void (async () => {
      await load();
    })();
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
        const [saved, org, cfg] = await Promise.allSettled([
          fetchLayout(supabase),
          fetchOrgId(supabase),
          getCompanyConfig(),
        ]);
        if (cancelled) return;
        const fallback = companyDefaultLayout(
          cfg.status === "fulfilled" ? cfg.value?.settings.dashboard_layout : null
        );

        // Only blocks saving, which `handleSaveLayout` reports if it comes to it.
        if (org.status === "fulfilled") setOrgId(org.value);

        if (saved.status === "fulfilled") {
          setLayout(reconcileLayout(saved.value, WIDGET_IDS, fallback));
          // Only now is editing safe. `NO_SAVED_LAYOUT` counts as a successful
          // read — it means this person has never customised, which is a fact,
          // not a failure.
          setLayoutLoaded(true);
        } else {
          // Show the default, and say so. But *do not* unlock Customise: the
          // banner explains what you are looking at, it does not stop you saving
          // the default over a layout that exists and simply could not be read.
          // Explaining is not preventing.
          setLayout(fallback);
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
      setLayout(companyDefault);
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
  /** Whether the map card is actually on this manager's dashboard. */
  const showsLiveReps = layout.includes("live_reps") || layout.includes("field_team");

  useEffect(() => {
    // Two conditions, and both are needed.
    //
    // **The card has to be in the layout.** It is optional — a manager who
    // removed it should not be paying four requests a minute, one of them over
    // `location_pings`, for a card that is not rendered. Waiting for the layout
    // to load first, so the default is not polled against before the saved one
    // arrives.
    //
    // **And the tab has to be visible.** A dashboard left open overnight is
    // otherwise sixty ticks an hour at nobody. Bound to `visibilitychange` as
    // well as the interval, so returning to the tab refreshes at once rather
    // than showing a stale card for up to a minute.
    if (!layoutLoaded || !showsLiveReps) return;

    const poll = () => {
      if (document.visibilityState !== "visible") return;
      fetchLiveReps(supabase, terms)
        .then(setLiveReps)
        .catch(() => {});
    };
    const t = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded, showsLiveReps]);

  /**
   * The trade cards' data: the numbers, today's work and contracts due. Only
   * what the cards on this layout need, so Gold Fortune's dashboard, which
   * shows none of them, asks for nothing more than before.
   */
  const codes = numberCodesFor(layout, cardCodes);
  const codesKey = codes.join(",");
  const wantsToday = layout.includes("today");
  const wantsContracts = layout.includes("money") && !!company?.settings.money_contracts;
  useEffect(() => {
    if (!layoutLoaded || !company) return;
    let cancelled = false;
    void (async () => {
      const failed = new Set<WidgetSource>();
      const [n, td, cd] = await Promise.allSettled([
        codes.length > 0 ? fetchNumbers(supabase, range, codes) : Promise.resolve(null),
        wantsToday ? fetchToday(supabase, company.timezone) : Promise.resolve(null),
        wantsContracts
          ? fetchContractsDue(supabase, toLocalDateInput(new Date()))
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (n.status === "fulfilled") setNumbers(n.value);
      else {
        setNumbers(null);
        failed.add("numbers");
      }
      if (td.status === "fulfilled") setToday(td.value);
      else {
        setToday(null);
        failed.add("today");
      }
      // Contracts due are one line of the Money card, not the card.
      setContractsDue(cd.status === "fulfilled" ? cd.value : null);
      setTradeFailed(failed);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded, company, range.from, range.to, codesKey, wantsToday, wantsContracts, tradeTick]);

  const days = rangeDays(range);
  const widgetData: WidgetData = {
    summary: data,
    dayTimes,
    dayDetail,
    dayDistance,
    operations: ops,
    liveReps,
    business,
    days,
    range,
    terms,
    numbers,
    cardCodes,
    today,
    contractsDue,
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
    business: business !== null,
    numbers: numbers !== null && !tradeFailed.has("numbers"),
    today: today !== null && !tradeFailed.has("today"),
  };

  // Cards for modules the company does not have are left out, not shown empty.
  // Nothing until the company is known, for the same reason the sidebar waits.
  const cards = company
    ? layout
        .map((id) => findWidget(id))
        .filter((w) => w !== undefined)
        .filter((w) => widgetAvailable(w, company.modules, permissions))
    : [];

  return (
    <div className="space-y-4">
      <AccountCards />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            {TODAY_LABEL.format(new Date())}
            {/* The sales cards count delivered orders before VAT; invoices include it. */}
            {layout.some((id) => id === "headline" || id === "sales" || id === "pipeline") ? " · money excludes VAT" : ""}
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

      {(error || tradeFailed.size > 0) && (
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
            <p className="mt-1 text-muted-foreground">{error ?? "Some of your numbers could not be loaded."}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                void load();
                setTradeTick((n) => n + 1);
              }}
            >
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
              ) : (widget.source === "numbers" || widget.source === "today") && !tradeFailed.has(widget.source) ? (
                // Still on its way: the card's shape, not an error.
                <div
                  className={`animate-pulse rounded-xl bg-secondary motion-reduce:animate-none ${widget.span === 4 ? "h-[112px]" : "h-[260px]"}`}
                  aria-label={`${widget.title(terms)}: loading`}
                />
              ) : (
                <UnavailableCard title={widget.title(terms)} />
              )}
            </div>
          ))}
        </div>
      )}

      <CustomiseDashboard
        modules={company?.modules ?? null}
        permissions={permissions}
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
