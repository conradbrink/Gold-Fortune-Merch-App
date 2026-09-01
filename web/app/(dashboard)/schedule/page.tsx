"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { CallCyclePlanner } from "@/components/schedule/call-cycle-planner";
import { MonthPlanner } from "@/components/schedule/month-planner";
import { DayBoard } from "@/components/schedule/day-board";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgId } from "@/lib/representatives";
import { useIsManager } from "@/lib/use-is-manager";
import { StorePicker } from "@/components/stores/store-picker";
import { addStops, fetchDayBoard, type DayRep } from "@/lib/schedule";

/**
 * Day-month-year with the weekday, because a schedule is read as "which day of
 * the week is this" far more often than as a date. `en-GB` rather than the
 * previous `en-US`: this is a Botswana estate and 28/07 is the local reading.
 */
function formatDisplayDate(d: Date) {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Local date-only comparison — a timestamp comparison would flip at midnight UTC. */
function isBeforeToday(d: Date): boolean {
  const today = new Date();
  return (
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() <
    new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  );
}

type View = "today" | "plan" | "cycle";

/** The tabs, in the order the work happens: watch the day, lay out the month,
    then maintain the pattern the month is mostly generated from. */
const VIEWS: { value: View; label: string; blurb: string }[] = [
  {
    value: "today",
    label: "Today",
    blurb: "What each rep is covering today, and how far through they are.",
  },
  {
    value: "plan",
    label: "Plan",
    blurb: "One rep's month. Click a day to add or remove stores.",
  },
  {
    value: "cycle",
    label: "Call cycle",
    blurb: "The recurring pattern dated routes are generated from.",
  },
];

export default function SchedulePage() {
  const supabase = createClient();
  // Three questions, three tabs: is today going to plan, what does this rep's
  // month look like, and what pattern is it generated from. They were two, and
  // the middle one — laying a month out by hand — had nowhere to live, so it
  // ended up buried six panels down inside the pattern editor.
  const [view, setView] = useState<View>("today");
  const [date, setDate] = useState(() => new Date());
  const [dayReps, setDayReps] = useState<DayRep[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  /** Mirrors the RLS check on `routes`; see `lib/use-is-manager.ts`. */
  const isManager = useIsManager();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<{ repId: string; storeIds: string[] }>({
    repId: "",
    storeIds: [],
  });
  const [saving, setSaving] = useState(false);

  async function loadDay() {
    setLoading(true);
    setError(null);
    try {
      setDayReps(await fetchDayBoard(supabase, date));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // The planner fetches its own data; skip the day queries while it is shown.
    if (view !== "today") return;
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `loadDay` still starts before this returns.
    void (async () => {
      await loadDay();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, view]);

  useEffect(() => {
    fetchOrgId(supabase).then(setOrgId).catch(() => setOrgId(null));
    supabase
      .from("stores")
      .select("id, name, city")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setStores(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const stops = dayReps.flatMap((r) => r.stops);
    const past = isBeforeToday(date);
    return {
      reps: dayReps.filter((r) => r.stops.length > 0).length,
      stops: stops.length,
      done: stops.filter((s) => s.status === "done").length,
      active: stops.filter((s) => s.status === "in_progress").length,
      missed: past ? stops.filter((s) => s.status === "not_started").length : 0,
    };
  }, [dayReps, date]);

  function openAddStop(repId: string) {
    setForm({ repId, storeIds: [] });
    setDialogOpen(true);
  }

  async function handleAddStop() {
    if (!orgId) {
      setError("Could not determine your organisation.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Append to the end of that rep's day. Order is the rep's to choose, but
      // sequence_order still needs a sane value for the eventual mobile fix.
      // max + 1, never count + 1 — a day that has been re-ordered or has lost a
      // stop has gaps, and counting hands back a number already in use.
      const existing = dayReps.find((r) => r.repId === form.repId)?.stops ?? [];
      const next =
        existing.reduce((max, s) => Math.max(max, s.sequence ?? 0), 0) + 1;
      await addStops(supabase, orgId, form.repId, form.storeIds, date, next);
      setDialogOpen(false);
      await loadDay();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Schedule
          </h1>
          <p className="text-sm text-muted-foreground">
            {VIEWS.find((v) => v.value === view)?.blurb}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => {
                  // `error` is this page's, and only the Today load clears it.
                  // The other two tabs render their own banners, so a failed
                  // Today load would otherwise sit above a tab that did not
                  // produce it.
                  setError(null);
                  setView(v.value);
                }}
                aria-pressed={view === v.value}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === v.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {view === "plan" && <MonthPlanner />}

      {view === "cycle" && <CallCyclePlanner />}

      {view === "today" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Previous day"
                onClick={() => setDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold text-foreground">
                {formatDisplayDate(date)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Next day"
                onClick={() => setDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Counts, not a legend. The old legend described colours; this
                describes the day. */}
            {!loading && summary.stops > 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{summary.reps}</span>{" "}
                {summary.reps === 1 ? "rep" : "reps"} ·{" "}
                <span className="font-semibold text-foreground">{summary.stops}</span>{" "}
                {summary.stops === 1 ? "stop" : "stops"} ·{" "}
                <span className="font-semibold text-emerald-700 dark:text-emerald-500">
                  {summary.done}
                </span>{" "}
                done
                {summary.active > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-amber-700 dark:text-amber-500">
                      {summary.active}
                    </span>{" "}
                    in progress
                  </>
                )}
                {summary.missed > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-destructive">
                      {summary.missed}
                    </span>{" "}
                    not visited
                  </>
                )}
              </p>
            )}
          </div>

          {/* Said once here, as on the other two tabs. `routes` writes are
              manager-only in RLS while this page is gated on `field_ops`, so a
              disabled "Add stop" with nothing explaining it reads as a broken
              button rather than a decision. */}
          {isManager === false && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Scheduling is manager-only. You can see the day as it happens, but
              adding a stop needs a manager.
            </p>
          )}

          {loading ? (
            <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <DayBoard
              reps={dayReps}
              isPast={isBeforeToday(date)}
              onAddStop={openAddStop}
              canAddStops={isManager === true}
            />
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add stops — {formatDisplayDate(date)}</DialogTitle>
            <DialogDescription>
              No time is set. The rep decides when to call, as long as the store
              gets visited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="stop-rep">Representative</Label>
              <NativeSelect
                id="stop-rep"
                value={form.repId}
                onChange={(e) => setForm({ ...form, repId: e.target.value })}
              >
                <option value="" disabled>
                  Select a rep
                </option>
                {dayReps.map((r) => (
                  <option key={r.repId} value={r.repId}>
                    {r.repName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stop-store">Stores</Label>
              {/* Searchable rather than a dropdown of 230. Finding one outlet
                  meant scrolling the estate in alphabetical order, on the one
                  screen where somebody is usually working from a name a rep has
                  just said to them over the phone. */}
              <StorePicker
                multiple
                id="stop-store"
                stores={stores}
                value={form.storeIds}
                onChange={(storeIds) => setForm({ ...form, storeIds })}
                placeholder="Search stores…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleAddStop}
              disabled={
                saving || !form.repId || form.storeIds.length === 0 || !orgId
              }
            >
              {saving
                ? "Adding…"
                : form.storeIds.length > 1
                  ? `Add ${form.storeIds.length} stops`
                  : "Add stop"}
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
