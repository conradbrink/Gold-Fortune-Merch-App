"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { LocationVerdict } from "@/components/activities/location-verdict";
import { SubmissionDetail } from "@/components/forms/submission-detail";
import { createClient } from "@/lib/supabase/client";
import { rangeForPreset, type DateRange } from "@/lib/date-range";
import {
  fetchActivityFeed,
  fetchActivitySummary,
  formatDistance,
  type ActivityEvent,
  type ActivitySummary,
} from "@/lib/activities";

const PAGE_SIZE = 50;

type Option = { id: string; label: string };

function formatWhen(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

export default function ActivitiesPage() {
  const supabase = createClient();

  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [repId, setRepId] = useState("all");
  const [storeId, setStoreId] = useState("all");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ActivityEvent | null>(null);

  const [reps, setReps] = useState<Option[]>([]);
  const [stores, setStores] = useState<Option[]>([]);

  // Filter dropdown options — fetched once, independent of the feed.
  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const [{ data: repRows }, { data: storeRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "rep")
          .order("full_name"),
        supabase.from("stores").select("id, name").order("name"),
      ]);
      if (cancelled) return;
      setReps(
        (repRows ?? []).map((r) => ({
          id: r.id,
          label: r.full_name ?? "Unnamed rep",
        }))
      );
      setStores((storeRows ?? []).map((s) => ({ id: s.id, label: s.name })));
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFirstPage = useCallback(async () => {
    const filters = {
      from: range.from,
      to: range.to,
      repIds: repId === "all" ? null : [repId],
      storeIds: storeId === "all" ? null : [storeId],
      onlyFlagged,
    };
    setLoading(true);
    setError(null);
    try {
      const [rows, sum] = await Promise.all([
        fetchActivityFeed(supabase, filters, PAGE_SIZE, 0),
        fetchActivitySummary(supabase, filters),
      ]);
      setEvents(rows);
      setTotal(rows[0]?.total_count ?? 0);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
      setTotal(0);
      setSummary(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, repId, storeId, onlyFlagged]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const rows = await fetchActivityFeed(
        supabase,
        {
          from: range.from,
          to: range.to,
          repIds: repId === "all" ? null : [repId],
          storeIds: storeId === "all" ? null : [storeId],
          onlyFlagged,
        },
        PAGE_SIZE,
        events.length
      );
      setEvents((prev) => [...prev, ...rows]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const flagged = (summary?.off_site ?? 0) + (summary?.invalid_gps ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Activities
          </h1>
          <p className="text-sm text-muted-foreground">
            Every check-in and check-out across your team, with the store
            location confirmed.
          </p>
        </div>
        <Button
          size="sm"
          variant={onlyFlagged ? "default" : "outline"}
          onClick={() => setOnlyFlagged((v) => !v)}
        >
          {onlyFlagged ? "Showing discrepancies" : "Only discrepancies"}
        </Button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="w-full sm:w-56">
          <NativeSelect
            aria-label="Filter by rep"
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
          >
            <option value="all">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-full sm:w-56">
          <NativeSelect
            aria-label="Filter by store"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="all">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {/* The at-a-glance answer: were they where they said they were? */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile
            label="Confirmed at store"
            value={summary.at_store ?? 0}
            tone="good"
          />
          <SummaryTile label="Nearby" value={summary.nearby ?? 0} tone="warn" />
          <SummaryTile label="Off site" value={flagged} tone="bad" />
          <SummaryTile
            label="No GPS fix"
            value={summary.unknown ?? 0}
            tone="muted"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Event</TableHead>
              <TableHead className="hidden sm:table-cell">Rep</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Loading activity…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">
                    Could not load activity
                  </p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                </TableCell>
              </TableRow>
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {onlyFlagged
                    ? "No location discrepancies in this period — every check-in was at the store."
                    : "No activity in this period. Try widening the date range."}
                </TableCell>
              </TableRow>
            ) : (
              events.map((ev) => {
                const when = formatWhen(ev.occurred_at);
                const isIn = ev.kind === "check_in";
                return (
                  <TableRow
                    key={ev.event_id}
                    onClick={() => setOpen(ev)}
                    className="cursor-pointer"
                    title="View this visit"
                  >
                    <TableCell className="min-w-[190px]">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
                            (isIn
                              ? "bg-accent text-accent-foreground"
                              : "bg-secondary text-secondary-foreground")
                          }
                        >
                          {isIn ? (
                            <LogIn className="h-4 w-4" />
                          ) : (
                            <LogOut className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {isIn ? "Checked in" : "Checked out"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {ev.store_name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground sm:hidden">
                            {ev.rep_name ?? "Unassigned"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {ev.rep_name ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="min-w-[130px] text-sm">
                      <div className="text-foreground">{when.date}</div>
                      <div className="text-xs text-muted-foreground">
                        {when.time}
                      </div>
                    </TableCell>
                    <TableCell>
                      <LocationVerdict
                        verdict={ev.verdict}
                        distanceM={ev.distance_m}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Showing {events.length} of {total} events.
        </p>
        {events.length < total && (
          <Button
            size="sm"
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>

      <ActivityDialog event={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "muted";
}) {
  const toneClass = {
    good: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    bad: "text-red-700 dark:text-red-400",
    muted: "text-muted-foreground",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tracking-tight ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function ActivityDialog({
  event,
  onClose,
}: {
  event: ActivityEvent | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={event !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{event?.store_name ?? "Activity"}</DialogTitle>
        </DialogHeader>

        {event && (
          <>
            <p className="-mt-2 text-sm text-muted-foreground">
              {event.rep_name ?? "Unassigned"} ·{" "}
              {event.kind === "check_in" ? "Checked in" : "Checked out"}{" "}
              {formatWhen(event.occurred_at).date} at{" "}
              {formatWhen(event.occurred_at).time}
            </p>

            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <StoreIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  Location verification
                </span>
              </div>
              <dl className="space-y-1.5 text-sm">
                <Row label="Verdict">
                  <LocationVerdict
                    verdict={event.verdict}
                    distanceM={event.distance_m}
                  />
                </Row>
                <Row label="Distance from store">
                  {formatDistance(event.distance_m)}
                </Row>
                <Row label="Store geofence">{event.geofence_radius_m} m</Row>
                {event.accuracy_m !== null && (
                  <Row label="GPS accuracy">
                    ± {Math.round(event.accuracy_m)} m
                  </Row>
                )}
              </dl>
              {event.verdict === "unknown" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No position was recorded, so this visit cannot be confirmed
                  either way.
                </p>
              )}
            </div>

            {event.submission_id ? (
              <section>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  Submitted form
                </h3>
                <SubmissionDetail submissionId={event.submission_id} />
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                No form was submitted during this visit.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
