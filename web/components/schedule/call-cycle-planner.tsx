"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus, MapPin, Route, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WeekLoadStrip } from "@/components/schedule/week-load-strip";
import { InsightsPanel } from "@/components/reports/insights-panel";
import { createClient } from "@/lib/supabase/client";
import {
  fetchOrgId,
  fetchRepDirectory,
  type RepSummary,
} from "@/lib/representatives";
import {
  FREQUENCIES,
  WEEKDAYS,
  addDays,
  addStop,
  isoWeekday,
  occursOn,
  applySpread,
  autoSpreadDays,
  computeWeekLoad,
  countPlannedVisits,
  cycleVisits,
  describeCycle,
  fetchManualStops,
  fetchPlannedStores,
  generateRoutes,
  removeStop,
  reconcileWeekOfCycle,
  setAssignmentDay,
  setStoreFrequency,
  type GenerateResult,
  type ManualStop,
  type PlannedStore,
  type SpreadResult,
  type VisitFrequency,
} from "@/lib/schedule";
import {
  DEFAULT_ORG_SETTINGS,
  computeCapacity,
  fetchOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";
import { CapacityMeter } from "@/components/schedule/capacity-meter";
import { CoveragePlanner } from "@/components/schedule/coverage-planner";
import {
  applyStopOrder,
  fetchDaysToOrder,
  fetchRepStartAnchors,
  planStopOrder,
  type OrderSummary,
} from "@/lib/route-order";
import { CycleGrid } from "@/components/schedule/cycle-grid";

/**
 * The call-cycle planner: pick a rep, give each of their stores a day and a
 * frequency, then generate dated routes from the pattern.
 *
 * Stores are grouped by **city** because the single worst planning mistake is
 * sending a rep across two cities in one day, and a flat alphabetical list
 * hides exactly that. There is deliberately no auto-clustering — the manager
 * assigns the days; this view's job is to make a bad plan obvious, not to
 * refuse it.
 *
 * Edits save as you make them. Each control writes one row, so a failure
 * affects one store and rolls that store back rather than discarding the
 * session's work.
 */
/**
 * Horizons the planner offers, widest last.
 *
 * One-offs are fetched over the widest of these no matter which is selected, so
 * widening the view never needs a refetch — `buildCycleCalendar` clips the
 * stops to whatever is actually being drawn.
 */
const HORIZONS = [4, 8, 12];

/** Tomorrow to the end of the widest horizon — the window one-offs are read over. */
function manualWindow(): [Date, Date] {
  const now = new Date();
  return [addDays(now, 1), addDays(now, HORIZONS[HORIZONS.length - 1] * 7)];
}

export function CallCyclePlanner() {
  const supabase = createClient();

  const [reps, setReps] = useState<RepSummary[]>([]);
  const [repId, setRepId] = useState("");
  const [stores, setStores] = useState<PlannedStore[]>([]);
  const [loadingReps, setLoadingReps] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Every assignment with a write in flight, not just the most recent one.
   *
   * A single id cannot describe two rows at once: the second write to start
   * overwrote the first, so whichever settled first re-enabled *both* controls
   * while one was still pending. Every control here is a one-click select over
   * a rep's whole estate, so two at once is ordinary.
   */
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [weeks, setWeeks] = useState(8);
  /**
   * "days" lays the cycle out as the dated days it produces; "stores" is the
   * town-grouped list. Two views rather than one merged screen because they
   * answer different questions — the grid says what a given day holds, the list
   * says how often a shop is called on — and the list is still the better place
   * to change a frequency.
   */
  const [planView, setPlanView] = useState<"days" | "stores">("days");

  const [genOpen, setGenOpen] = useState(false);
  const [preview, setPreview] = useState<GenerateResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);

  /** Non-null while a proposed stop order is waiting to be accepted. */
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [orderingBusy, setOrderingBusy] = useState<string | null>(null);
  const [orderDone, setOrderDone] = useState<string | null>(null);

  /** One-off stops for the selected rep, across the horizon the grid draws. */
  const [manual, setManual] = useState<ManualStop[]>([]);
  /** Route id being removed, or "add" while an insert is in flight. */
  const [stopBusy, setStopBusy] = useState<ReadonlySet<string>>(() => new Set());
  /** Every active store, for the one-off picker. Fetched once, not per rep:
      a one-off is frequently a store this rep does not cover. */
  const [storeOptions, setStoreOptions] = useState<
    { id: string; name: string; city: string | null }[]
  >([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);
  /** Non-null while an auto-spread proposal is waiting to be accepted. */
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    fetchOrgSettings(supabase).then(setSettings).catch(() => {});
    fetchOrgId(supabase).then(setOrgId).catch(() => setOrgId(null));
    supabase
      .from("stores")
      .select("id, name, city")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setStoreOptions(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchRepDirectory(supabase);
        if (cancelled) return;
        const active = rows.filter((r) => r.is_active);
        setReps(active);
        // Open on someone who actually has stores — landing on an empty rep
        // makes the page look broken.
        setRepId(
          (active.find((r) => r.assigned_stores > 0) ?? active[0])?.rep_id ?? ""
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingReps(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!repId) {
      setStores([]);
      setManual([]);
      return;
    }
    let cancelled = false;
    setLoadingStores(true);
    (async () => {
      try {
        const [rows, oneOffs] = await Promise.all([
          fetchPlannedStores(supabase, repId),
          fetchManualStops(supabase, repId, ...manualWindow()),
        ]);
        if (!cancelled) {
          setStores(rows);
          setManual(oneOffs);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingStores(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on `weeks`. One-offs are fetched over the widest
    // horizon the selector offers, so widening the view has everything it needs
    // already and `buildCycleCalendar` clips to whatever is being drawn.
    // Keying on `weeks` would refetch both queries and flash the spinner for a
    // change that needs neither.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(
      (s) =>
        s.store_name.toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q)
    );
  }, [stores, query]);

  /** Grouped by city — the geography has to be visible while days are set. */
  const cityGroups = useMemo(() => {
    const groups: { city: string; stores: PlannedStore[] }[] = [];
    const index: Record<string, number> = {};
    for (const s of visible) {
      // Stores with no city still need a home or they vanish from the UI —
      // and a store with no city is itself worth noticing.
      const key = s.city ?? "No city set";
      if (index[key] === undefined) {
        index[key] = groups.length;
        groups.push({ city: key, stores: [] });
      }
      groups[index[key]].stores.push(s);
    }
    return groups.sort((a, b) => a.city.localeCompare(b.city));
  }, [visible]);

  const load = useMemo(() => computeWeekLoad(stores, weeks), [stores, weeks]);
  const unplanned = stores.filter((s) => s.active && s.day_of_week === null);
  const inactive = stores.filter((s) => !s.active);
  const plannedVisits = useMemo(
    () => countPlannedVisits(stores, weeks),
    [stores, weeks]
  );

  /**
   * This rep's share of capacity.
   *
   * Counted over every assigned store, planned or not, because the question is
   * "can this rep carry this patch" — a store with no day yet still has to fit
   * somewhere, and excluding it would make an impossible patch look fine until
   * the moment it is planned.
   */
  const capacity = useMemo(
    () =>
      computeCapacity(
        settings,
        1,
        stores
          .filter((s) => s.active)
          .reduce((n, s) => n + cycleVisits(s.visit_frequency), 0)
      ),
    [settings, stores]
  );

  /**
   * Runs one row's write, with optimistic state that is rolled back on failure.
   *
   * `rollback` must undo **this** row's change and nothing else. Rows are
   * written concurrently, so restoring a snapshot of the whole `stores` array
   * taken before the call — which is what this did — also throws away whatever
   * another row committed while this one was in flight. The planner's grid,
   * its week-load strip and its capacity meter all read that array, so a
   * reverted value moves figures the manager is planning against.
   */
  async function run(
    assignmentId: string,
    optimistic: () => void,
    rollback: () => void,
    write: () => Promise<void>
  ) {
    setBusy((prev) => new Set(prev).add(assignmentId));
    setError(null);
    optimistic();
    try {
      await write();
    } catch (e) {
      rollback();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Only this row's id. Another row may still be writing, and it is the one
      // that clears its own.
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(assignmentId);
        return next;
      });
    }
  }

  function markStopBusy(id: string) {
    setStopBusy((prev) => new Set(prev).add(id));
  }

  /** Only this stop's id — another may still be writing, and it clears its own. */
  function clearStopBusy(id: string) {
    setStopBusy((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** Replaces some fields on one assignment, leaving every other row alone. */
  function patchAssignment(
    assignmentId: string,
    patch: Partial<PlannedStore>
  ) {
    setStores((prev) =>
      prev.map((x) =>
        x.assignment_id === assignmentId ? { ...x, ...patch } : x
      )
    );
  }

  /**
   * Pins one store to one date for this rep.
   *
   * Writes a `routes` row with `source = 'manual'`, which is a different thing
   * from everything else on this screen: the rest of the planner edits the
   * recurring pattern, and this edits a single day. `generate_routes` retracts
   * only its own `'cycle'` rows, so a stop added here survives every re-plan —
   * that is the whole reason the column exists.
   *
   * Returns whether it landed, so the picker only clears on success.
   */
  async function addOneOff(date: Date, storeId: string): Promise<boolean> {
    if (!orgId || !repId) {
      setError("Could not determine your organisation.");
      return false;
    }
    markStopBusy("add");
    setError(null);
    try {
      // Append to the end of that date. `generate_routes` numbers stops per
      // rep and date, so this has to count the same population: the cycle
      // stores that land on this exact date plus the one-offs already on it.
      // Counting every assignment the rep has — which is what this did first —
      // numbers a one-off in the sixties on a day with four stops.
      const cycleOnDate = stores.filter(
        (s) =>
          s.active &&
          s.day_of_week === isoWeekday(date) &&
          occursOn(date, s.visit_frequency, s.week_of_cycle)
      );
      const onDate = manual.filter(
        (m) => m.date.toDateString() === date.toDateString()
      );
      await addStop(
        supabase,
        orgId,
        repId,
        storeId,
        date,
        cycleOnDate.length + onDate.length + 1
      );
      // Re-read rather than construct the row locally: the insert is a no-op on
      // a duplicate (unique rep/store/date), so guessing would put a second
      // copy on screen that the database does not have.
      setManual(await fetchManualStops(supabase, repId, ...manualWindow()));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      clearStopBusy("add");
    }
  }

  async function removeOneOff(stop: ManualStop) {
    markStopBusy(stop.route_id);
    setError(null);
    setManual((prev) => prev.filter((m) => m.route_id !== stop.route_id));
    try {
      await removeStop(supabase, stop.route_id);
    } catch (e) {
      // Put back the one row this took out, not a snapshot of every one-off:
      // another day's stop may have been added or removed meanwhile, and a
      // snapshot would undo that too. Order is never rendered — the grid
      // buckets by date — so the end of the list is where it was.
      setManual((prev) =>
        prev.some((m) => m.route_id === stop.route_id) ? prev : [...prev, stop]
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearStopBusy(stop.route_id);
    }
  }

  function changeDay(s: PlannedStore, day: number | null) {
    // Weekly ignores the week entirely, so don't leave a stale value behind.
    const week =
      day === null || s.visit_frequency === "weekly" ? null : s.week_of_cycle ?? 1;
    // The previous *values*, not a snapshot of the whole list — see `run`.
    const previous = { day_of_week: s.day_of_week, week_of_cycle: s.week_of_cycle };
    run(
      s.assignment_id,
      () =>
        patchAssignment(s.assignment_id, { day_of_week: day, week_of_cycle: week }),
      () => patchAssignment(s.assignment_id, previous),
      () => setAssignmentDay(supabase, s.assignment_id, day, week)
    );
  }

  function changeWeek(s: PlannedStore, week: number) {
    const previous = s.week_of_cycle;
    run(
      s.assignment_id,
      () => patchAssignment(s.assignment_id, { week_of_cycle: week }),
      () => patchAssignment(s.assignment_id, { week_of_cycle: previous }),
      () => setAssignmentDay(supabase, s.assignment_id, s.day_of_week, week)
    );
  }

  function changeFrequency(s: PlannedStore, frequency: VisitFrequency) {
    // Frequency belongs to the *store*, so this legitimately touches every row
    // for that store — which makes "just this one" mean the store's rows, not
    // the one assignment. Their previous values are captured per row, because
    // the reps covering one store need not share a week, so one restore value
    // would not do.
    const previous = new Map(
      stores
        .filter((x) => x.store_id === s.store_id)
        .map((x) => [
          x.assignment_id,
          { visit_frequency: x.visit_frequency, week_of_cycle: x.week_of_cycle },
        ])
    );
    run(
      s.assignment_id,
      () =>
        setStores((prev) =>
          prev.map((x) =>
            x.store_id === s.store_id
              ? {
                  ...x,
                  visit_frequency: frequency,
                  week_of_cycle: reconcileWeekOfCycle(frequency, x.week_of_cycle),
                }
              : x
          )
        ),
      () =>
        setStores((prev) =>
          prev.map((x) => {
            const was = previous.get(x.assignment_id);
            return was ? { ...x, ...was } : x;
          })
        ),
      // One call: `setStoreFrequency` writes the week as well, store-wide.
      // It used to be followed by a `setAssignmentDay` guarded on the week
      // having changed, which was exactly backwards — a monthly store on week
      // 3 dropping to bi-weekly computed the *same* 3, so the guard was false
      // and the one write that mattered never happened.
      () => setStoreFrequency(supabase, s.store_id, frequency)
    );
  }

  /** Proposes days for every store. Nothing is written until it is accepted. */
  function proposeSpread() {
    setError(null);
    setSpread(
      autoSpreadDays(stores, {
        storesPerDay: settings.storesPerDay,
        workingDays: settings.workingDays,
      })
    );
  }

  /** Stores the proposal actually put on a day. */
  const placedCount = useMemo(
    () => (spread?.assignments ?? []).filter((a) => a.dayOfWeek !== null).length,
    [spread]
  );

  async function acceptSpread() {
    if (!spread) return;
    setApplying(true);
    setError(null);
    try {
      await applySpread(supabase, spread.assignments);
      setStores(await fetchPlannedStores(supabase, repId));
      setSpread(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  /**
   * Works out a shorter order for every scheduled day. Writes nothing.
   *
   * Separate from generation on purpose: the days worth re-ordering are usually
   * ones that already exist, and a manager who has just moved a store between
   * days wants to re-order without creating anything.
   */
  async function proposeOrder() {
    setOrderingBusy("planning");
    setError(null);
    setOrderDone(null);
    try {
      const [anchors, { days, started }] = await Promise.all([
        fetchRepStartAnchors(supabase),
        fetchDaysToOrder(supabase, weeks),
      ]);
      const summary = planStopOrder(days, anchors);
      setOrder({ ...summary, started });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrderingBusy(null);
    }
  }

  /** Distance over the days that would actually change, which is what is named. */
  const changedKm = useMemo(() => {
    const changed = (order?.days ?? []).filter((d) => d.changed);
    return {
      current: changed.reduce((n, d) => n + d.currentKm, 0),
      planned: changed.reduce((n, d) => n + d.plannedKm, 0),
    };
  }, [order]);

  async function acceptOrder() {
    if (!order) return;
    setOrderingBusy("applying");
    setError(null);
    try {
      const { daysWritten, stopsWritten } = await applyStopOrder(
        supabase,
        order.days
      );
      setOrderDone(
        daysWritten === 0
          ? "Every day was already in its shortest order."
          : `Re-ordered ${stopsWritten} stops across ${daysWritten} ${daysWritten === 1 ? "day" : "days"}.`
      );
      setOrder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrderingBusy(null);
    }
  }

  async function openGenerate() {
    setGenOpen(true);
    setPreview(null);
    setGenResult(null);
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await generateRoutes(supabase, weeks, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGenOpen(false);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmGenerate() {
    setGenerating(true);
    setError(null);
    try {
      setGenResult(await generateRoutes(supabase, weeks, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const selectedRep = reps.find((r) => r.rep_id === repId) ?? null;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="plan-rep">Representative</Label>
          <NativeSelect
            id="plan-rep"
            value={repId}
            disabled={loadingReps}
            onChange={(e) => setRepId(e.target.value)}
          >
            {loadingReps && <option value="">Loading…</option>}
            {!loadingReps && reps.length === 0 && (
              <option value="">No active reps</option>
            )}
            {reps.map((r) => (
              <option key={r.rep_id} value={r.rep_id}>
                {r.rep_name ?? "Unnamed"} — {r.assigned_stores}{" "}
                {r.assigned_stores === 1 ? "store" : "stores"}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="w-32 space-y-1.5">
          <Label htmlFor="plan-weeks">Horizon</Label>
          <NativeSelect
            id="plan-weeks"
            value={String(weeks)}
            onChange={(e) => setWeeks(Number(e.target.value))}
          >
            {HORIZONS.map((w) => (
              <option key={w} value={w}>
                {w} weeks
              </option>
            ))}
          </NativeSelect>
        </div>

        <Button
          className="gap-1.5"
          onClick={openGenerate}
          disabled={previewing || loadingReps}
        >
          <CalendarPlus className="h-4 w-4" />
          {previewing ? "Checking…" : "Generate schedule"}
        </Button>
      </div>

      {/* Setup before review: coverage is where an estate is divided up, and
          nothing below it means anything until stores have a rep. */}
      <CoveragePlanner
        onChanged={() => {
          fetchRepDirectory(supabase)
            .then((rows) => setReps(rows.filter((r) => r.is_active)))
            .catch(() => {});
          if (repId) {
            fetchPlannedStores(supabase, repId).then(setStores).catch(() => {});
          }
        }}
      />

      {/* Org-wide, like the generator — deliberately outside the per-rep block
          below, because the gaps worth hearing about are the ones no single
          rep's view can show: stores nobody covers, and reps with no plan. */}
      <InsightsPanel
        request={{ reportType: "call_cycle", weeks }}
        title="Plan review"
        blurb="Review the whole team's call cycle: days that span two cities, days carrying more stops than fit, stores nobody covers, and stores with no day set."
        staleHint="Horizon changed since this was generated — regenerate to refresh."
        clearMessage="Nothing in the plan looks wrong."
      />

      {selectedRep && !loadingStores && stores.length === 0 && (
        <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          {selectedRep.rep_name ?? "This rep"} has no stores assigned. Assign
          stores on the Representatives page first — a call cycle needs
          something to cycle through.
        </p>
      )}

      {loadingStores && (
        <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          Loading call cycle…
        </p>
      )}

      {!loadingStores && stores.length > 0 && (
        <>
          <CapacityMeter
            capacity={capacity}
            settings={settings}
            repCount={1}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={proposeSpread}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              Auto-spread days
            </Button>
            <span className="text-xs text-muted-foreground">
              Groups stores by how close together they are and fills each day to{" "}
              {settings.storesPerDay}, putting outlying towns on a day of their
              own. You can change anything after.
            </span>
          </div>

          {/* Which day a shop belongs to, and the order it is called on within
              that day, are separate decisions — this one changes no day, no rep
              and no frequency, only the sequence the rep drives. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={proposeOrder}
              disabled={orderingBusy !== null}
            >
              <Route className="mr-1.5 h-3.5 w-3.5" />
              {orderingBusy === "planning"
                ? "Working out the order…"
                : "Shorten the driving"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Re-orders the stops within each scheduled day, nearest first from
              where that rep usually starts. Nothing moves between days or reps.
            </span>
          </div>

          {orderDone && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
              {orderDone}
            </p>
          )}

          {order && (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
              {/* Distances over the days being changed, not every day planned.
                  Unchanged days add the same figure to both totals and only
                  dilute the percentage, and the sentence names the changed
                  count — so the two halves described different sets of days. */}
              {order.days.filter((d) => d.changed).length === 0 ? (
                <p className="text-sm text-foreground">
                  Every scheduled day is already in its shortest order. Nothing
                  to change.
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">
                    {order.days.filter((d) => d.changed).length} day
                    {order.days.filter((d) => d.changed).length === 1
                      ? ""
                      : "s"}{" "}
                    would be re-ordered:{" "}
                    <span className="tabular-nums">
                      {Math.round(changedKm.current).toLocaleString("en-GB")} km
                    </span>{" "}
                    of driving becomes{" "}
                    <span className="tabular-nums">
                      {Math.round(changedKm.planned).toLocaleString("en-GB")} km
                    </span>
                    {/* Only claimed when it is true. A day whose anchor leg
                        costs more than its inter-stop saving can come out
                        longer, and "-4% less" is not a sentence. */}
                    {changedKm.current > 0 && changedKm.planned < changedKm.current && (
                      <>
                        {" "}
                        &mdash;{" "}
                        <span className="font-semibold text-emerald-700 dark:text-emerald-500">
                          {Math.round(
                            (1 - changedKm.planned / changedKm.current) * 100
                          )}
                          % less
                        </span>
                      </>
                    )}
                    .
                  </p>
                  {/* Said once, plainly, rather than attached to every figure:
                      this is crow-flies distance and it is not a drive time. */}
                  <p className="text-xs text-muted-foreground">
                    Straight-line distance, counted from where each rep usually
                    starts their day. Roads are longer, so treat this as the
                    shape of the saving rather than the number of kilometres.
                  </p>
                </>
              )}

              {order.started > 0 && (
                <p className="text-xs text-muted-foreground">
                  {order.started} day
                  {order.started === 1 ? " is" : "s are"} already underway and
                  left alone — renumbering a round a rep has started would move
                  the ground under them.
                </p>
              )}

              {order.skipped > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {order.skipped} day
                  {order.skipped === 1 ? "" : "s"} could not be ordered: fewer
                  than two of their stops have a location on file.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {order.days.some((d) => d.changed) && (
                  <Button
                    size="sm"
                    onClick={acceptOrder}
                    disabled={orderingBusy !== null}
                  >
                    {orderingBusy === "applying"
                      ? "Applying…"
                      : "Apply the new order"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOrder(null)}
                >
                  Discard
                </Button>
              </div>
            </div>
          )}

          {spread && (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium text-foreground">
                {/* Placed, not every assignment. Overflow stores are written with
                    a null day so they are cleared rather than left where they
                    were — which meant this count included the very stores the
                    next sentence says did not fit. The two disagreed. */}
                Proposed: {placedCount} store
                {placedCount === 1 ? "" : "s"} over{" "}
                {spread.daysUsed} of {spread.daysAvailable} working days, peak{" "}
                {Math.max(0, ...Object.values(spread.peakByDay))} on a day.
              </p>

              {/* The target is a floor now, not a ceiling. A day that comes out
                  short is the finding — the rep drives out and back either way,
                  so a half-empty day costs nearly what a full one does. */}
              {spread.underTarget.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Under {settings.storesPerDay} stops:{" "}
                  {spread.underTarget
                    .map(
                      (u) =>
                        `${WEEKDAYS.find((w) => w.value === u.day)?.long} (${u.stores})`
                    )
                    .join(", ")}
                  . There is not enough work to fill those days at this
                  frequency — either they take more stores, or this rep does not
                  need the whole week.
                </p>
              )}

              {spread.riders.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Riding along without a location:{" "}
                  {spread.riders
                    .map(
                      (r) =>
                        `${WEEKDAYS.find((w) => w.value === r.day)?.long} (${r.stores})`
                    )
                    .join(", ")}
                  . These could not be grouped by distance, so they follow their
                  town and add to that day&rsquo;s count.
                </p>
              )}

              {spread.splitTowns.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Too big for one day, so split across days:{" "}
                  {spread.splitTowns.join(", ")}.
                </p>
              )}

              {/* Not the alarm it once was. Days are grouped on position now, so
                  a day holding Gaborone and Mogoditshane — five kilometres apart
                  — is a sensible day, and saying otherwise trained people to
                  ignore the warning. */}
              {spread.sharedDays.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Days covering more than one town:{" "}
                  {spread.sharedDays
                    .map(
                      (d) =>
                        `${WEEKDAYS.find((w) => w.value === d.day)?.short} (${d.towns.join(", ")})`
                    )
                    .join("; ")}
                  . Grouped by distance, so these are neighbours rather than a
                  drive between towns.
                </p>
              )}

              {spread.overflow.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {spread.overflow.length} store
                  {spread.overflow.length === 1 ? "" : "s"} did not fit in the
                  week and {spread.overflow.length === 1 ? "was" : "were"} left
                  unplanned. Reduce their frequency, add a working day, or move
                  them to another rep.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={acceptSpread} disabled={applying}>
                  {applying ? "Applying…" : "Apply to all stores"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSpread(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}

          <WeekLoadStrip days={load} storesPerDay={settings.storesPerDay} />

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">
                {plannedVisits}
              </span>{" "}
              visits planned over {weeks} weeks
            </span>
            {unplanned.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                {unplanned.length} store{unplanned.length === 1 ? "" : "s"} with
                no day — {unplanned.length === 1 ? "it" : "they"} will never be
                scheduled
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {(
                [
                  ["days", "By day"],
                  ["stores", "By store"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPlanView(value)}
                  aria-pressed={planView === value}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    planView === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {planView === "days"
                ? "Every date the generator will write a route for, plus any one-off stops pinned to a day."
                : "Grouped by town, where frequency is set."}
            </p>
          </div>

          {planView === "days" && (
            <CycleGrid
              stores={stores}
              manual={manual}
              storeOptions={storeOptions}
              weeks={weeks}
              storesPerDay={settings.storesPerDay}
              workingDays={settings.workingDays}
              busy={busy}
              stopBusy={stopBusy}
              canAddStops={orgId !== null}
              onChangeDay={changeDay}
              onChangeWeek={changeWeek}
              onAddStop={addOneOff}
              onRemoveStop={removeOneOff}
            />
          )}

          {planView === "stores" && (
            <>
              <Input
                placeholder="Search stores or cities…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              <div className="space-y-4">
                {cityGroups.length === 0 && (
                  <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
                    No stores match &ldquo;{query}&rdquo;.
                  </p>
                )}

                {cityGroups.map((g) => (
                  <div
                    key={g.city}
                    className="overflow-hidden rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">
                        {g.city}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {g.stores.length} {g.stores.length === 1 ? "store" : "stores"}
                      </span>
                    </div>

                    <ul className="divide-y divide-border">
                      {g.stores.map((s) => (
                        <li
                          key={s.assignment_id}
                          className={[
                            "flex flex-wrap items-end gap-3 px-3 py-3",
                            busy.has(s.assignment_id) ? "opacity-60" : "",
                          ].join(" ")}
                        >
                          <div className="min-w-[180px] flex-1">
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <span className="truncate">{s.store_name}</span>
                              {s.is_primary && (
                                <Badge variant="secondary" className="shrink-0">
                                  Primary
                                </Badge>
                              )}
                              {!s.active && (
                                <Badge variant="destructive" className="shrink-0">
                                  Inactive
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {describeCycle(s)}
                            </p>
                          </div>

                          <div className="w-32 space-y-1">
                            <Label
                              htmlFor={`day-${s.assignment_id}`}
                              className="text-xs text-muted-foreground"
                            >
                              Day
                            </Label>
                            <NativeSelect
                              id={`day-${s.assignment_id}`}
                              value={s.day_of_week === null ? "" : String(s.day_of_week)}
                              disabled={busy.has(s.assignment_id)}
                              onChange={(e) =>
                                changeDay(
                                  s,
                                  e.target.value === "" ? null : Number(e.target.value)
                                )
                              }
                            >
                              <option value="">Not planned</option>
                              {WEEKDAYS.map((w) => (
                                <option key={w.value} value={w.value}>
                                  {w.long}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>

                          <div className="w-36 space-y-1">
                            <Label
                              htmlFor={`freq-${s.assignment_id}`}
                              className="text-xs text-muted-foreground"
                            >
                              Frequency
                            </Label>
                            <NativeSelect
                              id={`freq-${s.assignment_id}`}
                              value={s.visit_frequency}
                              disabled={busy.has(s.assignment_id)}
                              title="Frequency belongs to the store, so this changes it for every rep who covers it."
                              onChange={(e) =>
                                changeFrequency(s, e.target.value as VisitFrequency)
                              }
                            >
                              {FREQUENCIES.map((f) => (
                                <option key={f.value} value={f.value}>
                                  {f.label}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>

                          {/* Week only means anything above weekly — rendering it
                              always would invite setting a value that is ignored. */}
                          {s.visit_frequency !== "weekly" && (
                            <div className="w-32 space-y-1">
                              <Label
                                htmlFor={`week-${s.assignment_id}`}
                                className="text-xs text-muted-foreground"
                              >
                                Week
                              </Label>
                              <NativeSelect
                                id={`week-${s.assignment_id}`}
                                value={String(s.week_of_cycle ?? 1)}
                                disabled={
                                  busy.has(s.assignment_id) || s.day_of_week === null
                                }
                                onChange={(e) => changeWeek(s, Number(e.target.value))}
                              >
                                {s.visit_frequency === "biweekly" ? (
                                  <>
                                    <option value="1">Week A</option>
                                    <option value="2">Week B</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="1">1st</option>
                                    <option value="2">2nd</option>
                                    <option value="3">3rd</option>
                                    <option value="4">4th</option>
                                  </>
                                )}
                              </NativeSelect>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}

          {inactive.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {inactive.length} assigned store
              {inactive.length === 1 ? " is" : "s are"} deactivated and excluded
              from generation.
            </p>
          )}
        </>
      )}

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate schedule</DialogTitle>
            <DialogDescription>
              This covers every rep in the organisation, not just{" "}
              {selectedRep?.rep_name ?? "the selected rep"}.
            </DialogDescription>
          </DialogHeader>

          {previewing && (
            <p className="text-sm text-muted-foreground">
              Working out what would be created…
            </p>
          )}

          {!previewing && !genResult && preview && (
            <div className="space-y-2 text-sm">
              {preview.created === 0 && preview.removed === 0 ? (
                <p className="text-foreground">
                  Nothing to change. Every date in the next {weeks} weeks that
                  the call cycle calls for already has a route — or no store has
                  a day set yet.
                </p>
              ) : (
                <>
                  {preview.created > 0 && (
                    <p className="text-foreground">
                      Creates{" "}
                      <span className="font-semibold">{preview.created}</span>{" "}
                      route{preview.created === 1 ? "" : "s"} for{" "}
                      {preview.reps_covered} rep
                      {preview.reps_covered === 1 ? "" : "s"}, from{" "}
                      {preview.first_date} to {preview.last_date}.
                    </p>
                  )}
                  {/* Stated plainly: this is the only part that takes work off
                      a rep's phone, so it should never be a surprise. */}
                  {preview.removed > 0 && (
                    <p className="text-foreground">
                      Removes{" "}
                      <span className="font-semibold">{preview.removed}</span>{" "}
                      future route{preview.removed === 1 ? "" : "s"} the plan no
                      longer calls for.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Nothing in the past is touched, nothing a rep has already
                    checked into, and no stop added by hand. No visit records
                    are created — a visit belongs to a check-in.
                  </p>
                </>
              )}
            </div>
          )}

          {genResult && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
              Created {genResult.created} route
              {genResult.created === 1 ? "" : "s"}
              {genResult.created > 0 &&
                ` from ${genResult.first_date} to ${genResult.last_date}`}
              {genResult.removed > 0 &&
                `, and removed ${genResult.removed} that no longer matched`}
              .
            </p>
          )}

          <DialogFooter>
            {!genResult && (
              <Button
                onClick={confirmGenerate}
                disabled={generating || previewing || !preview || preview.created === 0}
              >
                {generating
                  ? "Generating…"
                  : `Create ${preview?.created ?? 0} route${preview?.created === 1 ? "" : "s"}`}
              </Button>
            )}
            <Button variant="outline" onClick={() => setGenOpen(false)}>
              {genResult ? "Done" : "Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
