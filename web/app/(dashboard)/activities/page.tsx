"use client";

import { useCallback, useEffect, useState } from "react";
import { Handshake, LogIn, LogOut, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
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
import { StorePicker } from "@/components/stores/store-picker";
import { ExportMenu } from "@/components/export-menu";
import type { ExportSheet } from "@/lib/export";
import {
  LocationVerdict,
  VERDICT_STYLES,
} from "@/components/activities/location-verdict";
import { SubmissionDetail } from "@/components/forms/submission-detail";
import { createClient } from "@/lib/supabase/client";
import {
  rangeForPreset,
  toLocalDateInput,
  toLocalDateTime,
  type DateRange,
} from "@/lib/date-range";
import {
  fetchActivityFeed,
  fetchActivitySummary,
  formatDistance,
  type ActivityEvent,
  type ActivitySummary,
} from "@/lib/activities";

const PAGE_SIZE = 50;

type Option = { id: string; label: string };

/**
 * The day before an exclusive end, as a calendar operation rather than a
 * subtraction of 86,400,000 milliseconds — a day is not always that many, and
 * across a daylight-saving boundary the subtraction lands on the wrong date.
 */
function dayBefore(exclusiveEnd: Date): Date {
  const d = new Date(exclusiveEnd);
  d.setDate(d.getDate() - 1);
  return d;
}

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
  /** Named `name` rather than `label` because the store picker searches it. */
  const [stores, setStores] = useState<
    { id: string; name: string; city: string | null }[]
  >([]);

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
        // `city` is here for the store picker's search, which matches on the
        // town as well as the name — a manager often knows an outlet by where
        // it is before they know what it is called.
        supabase.from("stores").select("id, name, city").order("name"),
      ]);
      if (cancelled) return;
      setReps(
        (repRows ?? []).map((r) => ({
          id: r.id,
          label: r.full_name ?? "Unnamed rep",
        }))
      );
      setStores(
        (storeRows ?? []).map((s) => ({ id: s.id, name: s.name, city: s.city }))
      );
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

  /**
   * The loaded rows, as a spreadsheet.
   *
   * The feed is paged, so this exports what has been loaded rather than the
   * whole period — and says which, because "42 of 310 events" in the header of
   * a file is the difference between a sample and a claim. Pressing "Show more"
   * first is how you get the rest.
   */
  function buildActivitySheet(): ExportSheet {
    return {
      title: onlyFlagged ? "Location discrepancies" : "Activities",
      orgName: "Gold Fortune Merchandising",
      context: [
        `${toLocalDateInput(range.from)} to ${toLocalDateInput(dayBefore(range.to))}`,
        repId !== "all"
          ? `Rep: ${reps.find((r) => r.id === repId)?.label ?? repId}`
          : "All reps",
        storeId !== "all"
          ? `Store: ${stores.find((st) => st.id === storeId)?.name ?? storeId}`
          : "All stores",
        onlyFlagged ? "Discrepancies only — off site and invalid GPS" : "Every event",
        `${events.length} of ${total} events loaded`,
      ],
      filename: onlyFlagged ? "gf-discrepancies" : "gf-activities",
      columns: [
        { header: "When", key: "when" },
        { header: "Event", key: "kind" },
        { header: "Rep", key: "rep" },
        { header: "Store", key: "store" },
        { header: "Verdict", key: "verdict" },
        { header: "Distance (m)", key: "distance", numeric: true },
        { header: "GPS accuracy (m)", key: "accuracy", numeric: true },
        { header: "Geofence (m)", key: "fence", numeric: true },
      ],
      rows: events.map((ev) => ({
        when: toLocalDateTime(ev.occurred_at),
        kind:
          ev.kind === "check_in"
            ? "Check in"
            : ev.kind === "check_out"
              ? "Check out"
              : "Sales call",
        rep: ev.rep_name ?? "",
        store: ev.store_name,
        // The label a person read on screen, not the enum. An exported
        // "off_site" is a column somebody has to be told how to read.
        verdict: VERDICT_STYLES[ev.verdict].label,
        distance: ev.distance_m,
        accuracy: ev.accuracy_m,
        fence: ev.geofence_radius_m,
      })),
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Activities
          </h1>
          <p className="text-sm text-muted-foreground">
            {/* A sales call has no store row and no geofence, so it has nothing
                to confirm against — the old wording promised a verdict for every
                row on the page, including the ones that cannot have one. */}
            Every check-in, check-out and sales call across your team, with
            location and store verification where there is a store to verify.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={onlyFlagged ? "default" : "outline"}
            onClick={() => setOnlyFlagged((v) => !v)}
          >
            {onlyFlagged ? "Showing discrepancies" : "Only discrepancies"}
          </Button>
          {/* Exports the rows on screen, which is the point: with "Only
              discrepancies" on, this is the off-site list somebody takes into a
              conversation. The file says so in its own header, so nobody has to
              remember which state it was exported from. */}
          {/* Disabled while the feed reloads. `loadFirstPage` sets `loading`
              on every filter change, so without this the menu would export the
              previous query's rows under the new filters' heading — a file that
              says one thing and contains another. */}
          <ExportMenu build={buildActivitySheet} disabled={loading} />
        </div>
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
          {/* "all" is this page's sentinel for no filter and the picker's is
              "", so the two are translated here rather than either one being
              bent to the other. */}
          <StorePicker
            stores={stores}
            value={storeId === "all" ? "" : storeId}
            onChange={(id) => setStoreId(id === "" ? "all" : id)}
            allLabel="All stores"
            placeholder="All stores"
          />
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
                const isSales = ev.kind === "sales_visit";
                return (
                  // The dialog this opens is the only place the sales-call panel
                  // and the form submission can be reached, and a click handler
                  // on a `tr` gives no focus, no role and no Enter/Space — so
                  // without these it could not be opened without a mouse.
                  <TableRow
                    key={ev.event_id}
                    onClick={() => setOpen(ev)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen(ev);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    title={isSales ? "View this sales call" : "View this visit"}
                  >
                    <TableCell className="min-w-[190px]">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
                            (isSales
                              ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                              : isIn
                                ? "bg-accent text-accent-foreground"
                                : "bg-secondary text-secondary-foreground")
                          }
                        >
                          {isSales ? (
                            <Handshake className="h-4 w-4" />
                          ) : isIn ? (
                            <LogIn className="h-4 w-4" />
                          ) : (
                            <LogOut className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {/* "Sales call" everywhere: the page description,
                                the row title attribute and the dialog's own
                                panel heading all say call, and one thing with
                                two names reads as two things. */}
                            {isSales
                              ? "Sales call"
                              : isIn
                                ? "Checked in"
                                : "Checked out"}
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
              {event.kind === "sales_visit"
                ? "Sales call"
                : event.kind === "check_in"
                  ? "Checked in"
                  : "Checked out"}{" "}
              {formatWhen(event.occurred_at).date} at{" "}
              {formatWhen(event.occurred_at).time}
            </p>

            {/* A prospect has no geofence, so the verification panel has
                nothing to report and would show "—" against every row. The
                Leads board is where this call's substance lives. */}
            {event.kind === "sales_visit" ? (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Handshake className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Sales call</span>
                </div>
                <dl className="space-y-1.5 text-sm">
                  <Row label="Company">{event.store_name}</Row>
                  <Row label="Position">
                    <LocationVerdict
                      verdict={event.verdict}
                      distanceM={event.distance_m}
                    />
                  </Row>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  This shop is not on the estate, so there is no geofence to
                  check the position against. The outcome and any follow-up are
                  on the{" "}
                  <Link href="/leads" className="underline">
                    Leads board
                  </Link>
                  .
                </p>
              </div>
            ) : (
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
                  <Row label="Store geofence">
                    {event.geofence_radius_m === null
                      ? "—"
                      : `${event.geofence_radius_m} m`}
                  </Row>
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
            )}

            {/* Forms belong to store visits. Saying "no form was submitted" on
                a sales call would report a gap where no form was ever due. */}
            {event.kind !== "sales_visit" &&
              (event.submission_id ? (
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
              ))}
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
