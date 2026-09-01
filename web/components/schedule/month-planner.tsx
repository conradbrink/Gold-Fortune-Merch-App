"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { MonthGrid } from "@/components/schedule/month-grid";
import { DayPlanPanel } from "@/components/schedule/day-plan-panel";
import { createClient } from "@/lib/supabase/client";
import { fromLocalDateInput, toLocalDateInput } from "@/lib/date-range";
import {
  fetchOrgId,
  fetchRepDirectory,
  type RepSummary,
} from "@/lib/representatives";
import {
  DEFAULT_ORG_SETTINGS,
  fetchOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";
import {
  addDays,
  addStop,
  buildMonthCalendar,
  fetchLastGeneratedDate,
  fetchRepDayPlans,
  isoWeekday,
  nextSequenceFor,
  removeStop,
  type DayPlanStop,
  type PlannedDay,
} from "@/lib/schedule";

/**
 * One rep's month, planned by hand.
 *
 * The screen this product was missing. Everything else here plans by *pattern*:
 * give a shop a weekday and a frequency, then generate. That is the right tool
 * for a round that repeats and the wrong one for a month somebody wants to lay
 * out themselves — and until now there was no other way in, because the only
 * calendar was drawn from the call cycle, which meant a rep with no assignments
 * got an empty state telling them to go and make some.
 *
 * So this reads `routes` and nothing else. A rep with no call cycle at all gets
 * a working calendar; a rep with one sees what the generator wrote alongside
 * what was pinned by hand, and every row says which of the two it is.
 *
 * Writes are optimistic and isolated per stop: a failure rolls back the one row
 * it touched, never a snapshot of the day, because two stops can be in flight at
 * once and restoring a snapshot discards whatever the other one committed.
 */
export function MonthPlanner() {
  const supabase = createClient();

  const [reps, setReps] = useState<RepSummary[]>([]);
  const [repId, setRepId] = useState("");
  const [loadingReps, setLoadingReps] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The first of the month being shown. Always day 1, never a mutated date. */
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [plans, setPlans] = useState<Record<string, PlannedDay>>({});
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);
  /** `toDateString()` of the open day, or null. Keyed by date rather than by
      object identity: the calendar is rebuilt on every edit, so holding the day
      itself would leave the panel showing a stale list. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Route ids being removed, plus "add" while an insert is in flight. */
  const [stopBusy, setStopBusy] = useState<ReadonlySet<string>>(() => new Set());

  const [orgId, setOrgId] = useState<string | null>(null);
  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);
  /** Every active store. A hand-added stop is often one this rep does not cover. */
  const [storeOptions, setStoreOptions] = useState<
    { id: string; name: string; city: string | null }[]
  >([]);

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
        // Plainly the first rep, unlike the call-cycle planner, which opens on
        // someone who already has stores so that its grid is not empty. That
        // heuristic is backwards here: a rep with no assignments is exactly who
        // this screen exists for, and skipping past them would hide the case.
        setRepId(active[0]?.rep_id ?? "");
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

  /**
   * The grid's own outer bounds, so the leading and trailing cells borrowed
   * from the neighbouring months are filled too — a stop on the 1st of next
   * month shows in this month's last row, and it would be odd for that to be
   * the one cell that never has anything on it.
   *
   * Two numbers rather than two `Date`s in the dependency list: a `Date` is a
   * fresh object on every render, so keying the fetch on one would refetch the
   * month forever.
   */
  const [fromKey, toKey] = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return [
      toLocalDateInput(addDays(first, -(isoWeekday(first) - 1))),
      toLocalDateInput(addDays(last, 7 - isoWeekday(last))),
    ];
  }, [month]);

  useEffect(() => {
    // No clearing branch here. `repId` only ever goes from "" to a rep — the
    // select offers no empty option once the directory has loaded — so the
    // state this would reset is already the initial state, and writing it
    // synchronously in an effect just costs a cascading render.
    if (!repId) return;
    let cancelled = false;
    (async () => {
      // Inside the async body rather than the effect's, so the spinner and the
      // cleared error are not two synchronous cascading renders on every month
      // step. The fetch is awaited immediately after, so nothing is delayed.
      setLoadingPlans(true);
      setError(null);
      try {
        const [rows, generated] = await Promise.all([
          // Back through the repo's own parser rather than `new Date(key)`:
          // the bare form is UTC midnight, which west of Greenwich is the
          // evening before and would shift the whole window by a day.
          fetchRepDayPlans(
            supabase,
            repId,
            fromLocalDateInput(fromKey),
            fromLocalDateInput(toKey)
          ),
          fetchLastGeneratedDate(supabase, repId),
        ]);
        if (cancelled) return;
        setPlans(rows);
        setLastGenerated(generated);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingPlans(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId, fromKey, toKey]);

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

  /** Re-reads one date. Cheaper than the month, and leaves every other day alone. */
  async function refreshDay(date: Date) {
    const fresh = await fetchRepDayPlans(supabase, repId, date, date);
    const key = toLocalDateInput(date);
    setPlans((prev) => {
      const next = { ...prev };
      // An absence is meaningful — the day may have just lost its last stop.
      if (fresh[key]) next[key] = fresh[key];
      else delete next[key];
      return next;
    });
  }

  /**
   * Adds one store to one date. Resolves true when it landed, so the picker
   * clears on success only.
   *
   * The day is re-read rather than patched locally: `addStop` is a no-op on a
   * duplicate (the unique index on rep/store/date), so inventing a row would put
   * a second copy of a store on screen that the database does not have.
   */
  async function addToDay(date: Date, storeId: string): Promise<boolean> {
    if (!orgId) {
      setError("Could not determine your organisation.");
      return false;
    }
    markStopBusy("add");
    setError(null);
    try {
      // max + 1 over the rows actually on the day. Counting them would reuse a
      // number on any day that has been re-ordered or has had a stop removed,
      // and the rep's phone sorts on this column with no tiebreak.
      const sequence = nextSequenceFor(plans[toLocalDateInput(date)]);
      await addStop(supabase, orgId, repId, storeId, date, sequence);
      await refreshDay(date);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      clearStopBusy("add");
    }
  }

  /** Removes one route row, rolling back that row alone if the write fails. */
  async function removeFromDay(date: Date, stop: DayPlanStop) {
    // Guarded here as well as in the panel: deleting a visited route sets
    // `visits.route_id` to null and orphans the check-in, and the database will
    // happily do it.
    if (stop.visited) return;

    const key = toLocalDateInput(date);
    markStopBusy(stop.route_id);
    setError(null);

    setPlans((prev) => {
      const day = prev[key];
      if (!day) return prev;
      return {
        ...prev,
        [key]: {
          ...day,
          stops: day.stops.filter((s) => s.route_id !== stop.route_id),
        },
      };
    });

    try {
      await removeStop(supabase, stop.route_id);
    } catch (e) {
      // Puts back this one stop, not a snapshot of the day: another removal may
      // have committed while this one was in flight, and restoring the whole
      // list would resurrect what it took away.
      setPlans((prev) => {
        const day = prev[key];
        if (!day) return prev;
        if (day.stops.some((s) => s.route_id === stop.route_id)) return prev;
        return { ...prev, [key]: { ...day, stops: [...day.stops, stop] } };
      });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearStopBusy(stop.route_id);
    }
  }

  const calendar = useMemo(
    () => buildMonthCalendar(month, plans, settings.workingDays),
    [month, plans, settings.workingDays]
  );

  const selected = useMemo(
    () =>
      selectedKey
        ? calendar.weeks
            .flat()
            .find((d) => d.date.toDateString() === selectedKey) ?? null
        : null,
    [calendar, selectedKey]
  );

  const monthTotal = useMemo(
    () =>
      calendar.weeks
        .flat()
        .filter((d) => d.inMonth)
        .reduce((n, d) => n + (d.plan?.stops.length ?? 0), 0),
    [calendar]
  );

  /**
   * The whole month sits past the last route the generator wrote.
   *
   * Worth a sentence: a month that is empty because nobody has generated yet
   * and a month that is empty because nothing is planned look identical, and
   * they are opposite problems.
   */
  const beyondGenerated =
    lastGenerated !== null &&
    lastGenerated.getTime() <
      new Date(month.getFullYear(), month.getMonth(), 1).getTime();

  const selectedRep = reps.find((r) => r.rep_id === repId) ?? null;

  /** The panel's date is no longer on screen once the rep or month changes. */
  function showMonth(next: Date) {
    setMonth(next);
    setSelectedKey(null);
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="month-rep">Representative</Label>
          <NativeSelect
            id="month-rep"
            value={repId}
            disabled={loadingReps}
            onChange={(e) => {
              setRepId(e.target.value);
              setSelectedKey(null);
            }}
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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              showMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            This month
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous month"
            // Rebuilt from year and month, never `setMonth` on the existing
            // date: on the 31st that overflows into the month after next.
            onClick={() =>
              showMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-semibold text-foreground">
            {month.toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Next month"
            onClick={() =>
              showMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!loadingReps && reps.length === 0 ? (
        <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          No active representatives, so there is nobody to plan for.
        </p>
      ) : loadingPlans ? (
        <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          Loading the month…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{monthTotal}</span>{" "}
              {monthTotal === 1 ? "stop" : "stops"} for{" "}
              {selectedRep?.rep_name ?? "this rep"} in{" "}
              {month.toLocaleDateString("en-GB", { month: "long" })}
            </p>
            {lastGenerated === null ? (
              <p className="text-xs text-muted-foreground">
                The call cycle has never been generated for this rep, so
                everything here is what you put on it.
              </p>
            ) : (
              beyondGenerated && (
                <p className="text-xs text-muted-foreground">
                  Call-cycle routes are written through{" "}
                  {lastGenerated.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                  })}
                  . Later days stay empty until you generate again.
                </p>
              )
            )}
          </div>

          <MonthGrid
            weeks={calendar.weeks}
            storesPerDay={settings.storesPerDay}
            selectedKey={selectedKey}
            onSelect={(d) =>
              setSelectedKey((prev) =>
                prev === d.toDateString() ? null : d.toDateString()
              )
            }
          />

          {selected && (
            <DayPlanPanel
              date={selected.date}
              plan={selected.plan}
              storeOptions={storeOptions}
              storesPerDay={settings.storesPerDay}
              readOnly={selected.isPast || !selected.inMonth}
              canAddStops={orgId !== null && repId !== ""}
              stopBusy={stopBusy}
              onAdd={addToDay}
              onRemove={(stop) => removeFromDay(selected.date, stop)}
              onClose={() => setSelectedKey(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
