"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { WeekLoadStrip } from "@/components/schedule/week-load-strip";
import { InsightsPanel } from "@/components/reports/insights-panel";
import { createClient } from "@/lib/supabase/client";
import {
  fetchOrgId,
  fetchRepDirectory,
  type RepSummary,
} from "@/lib/representatives";
import {
  addDays,
  addStop,
  isoWeekday,
  occursOn,
  computeWeekLoad,
  countPlannedVisits,
  cycleVisits,
  fetchManualStops,
  fetchPlannedStores,
  removeStop,
  reconcileWeekOfCycle,
  setAssignmentDay,
  setStoreFrequency,
  type ManualStop,
  type PlannedStore,
  type VisitFrequency,
} from "@/lib/schedule";
import {
  DEFAULT_ORG_SETTINGS,
  computeCapacity,
  fetchOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";
import { CapacityMeter } from "@/components/schedule/capacity-meter";
import { AdvancedTools } from "@/components/schedule/advanced-tools";
import { GenerateScheduleDialog } from "@/components/schedule/generate-schedule-dialog";
import { SpreadProposal } from "@/components/schedule/spread-proposal";
import { RouteOrderProposal } from "@/components/schedule/route-order-proposal";
import { PlanStoreList } from "@/components/schedule/plan-store-list";
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
  /**
   * The rep on screen right now, for the guard that runs after an await. State
   * captured in a closure would still be the value from the render that started
   * the write. Assigned from an effect because a ref write during render is not
   * allowed; the commit lands well before any awaited query resolves.
   */
  const repIdRef = useRef(repId);
  useEffect(() => {
    repIdRef.current = repId;
  }, [repId]);
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
   *
   * A set of ids rather than a count per id, which is sound here and is not on
   * every page: every control that calls `run` is disabled by
   * `busy.has(s.assignment_id)`, so one row cannot start a second write while
   * its first is in flight. `products` and `files` count instead, because
   * their controls stay live during a write.
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

  /**
   * Re-reads this rep's stores. Auto-spread can move every one of them, so
   * there is no narrower patch to make.
   *
   * The rep is captured before the await and re-checked after it. The caller
   * completes its own write first, so the select stays live throughout, and a
   * late result would otherwise load the previous rep's round into the grid,
   * the week-load strip and the capacity meter.
   */
  async function reloadStores() {
    const startedRepId = repIdRef.current;
    if (!startedRepId) return;
    try {
      const rows = await fetchPlannedStores(supabase, startedRepId);
      if (startedRepId !== repIdRef.current) return;
      setStores(rows);
    } catch (e) {
      if (startedRepId === repIdRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
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

        <GenerateScheduleDialog
          weeks={weeks}
          repName={selectedRep?.rep_name ?? null}
          disabled={loadingReps}
        />
      </div>

      {/* Everything in here reviews a plan rather than being one.

          All six sat open above the grid, so the screen answered questions
          nobody had asked yet and pushed the thing being planned below the
          fold. Nothing is gone — it is one click away. The children mount
          only once opened: `InsightsPanel` fetches on mount, and a closed
          `<details>` still mounts its subtree. */}
      <AdvancedTools hint="capacity, auto-spread, driving order, week load, plan review">
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

        {!loadingStores && stores.length > 0 && (
          <>
            <CapacityMeter
              capacity={capacity}
              settings={settings}
              repCount={1}
            />

            <SpreadProposal
              stores={stores}
              settings={settings}
              onApplied={reloadStores}
            />

            <RouteOrderProposal weeks={weeks} />

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
          </>
        )}
      </AdvancedTools>

      {/* True on this tab, and only this tab: a call cycle does need something
          to cycle through. It used to be the end of the road — the whole grid
          sat behind `stores.length > 0`, so a rep with no assignments could not
          be planned at all, by any route. Planning one by hand is a tab away
          now, and this says so rather than sending everybody off to build a
          recurring round they may not want. */}
      {selectedRep && !loadingStores && stores.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {selectedRep.rep_name ?? "This rep"} has no stores assigned, so there
          is no pattern to lay out. Assign stores on the Representatives page to
          build a recurring round — or plan their days one at a time on the{" "}
          <span className="font-medium text-foreground">Plan</span> tab, which
          needs no call cycle.
        </p>
      )}

      {loadingStores && (
        <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          Loading call cycle…
        </p>
      )}

      {!loadingStores && stores.length > 0 && (
        <>
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
            <PlanStoreList
              groups={cityGroups}
              query={query}
              onQueryChange={setQuery}
              busy={busy}
              onChangeDay={changeDay}
              onChangeWeek={changeWeek}
              onChangeFrequency={changeFrequency}
            />
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

    </div>
  );
}
