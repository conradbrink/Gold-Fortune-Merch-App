"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ClipboardCheck, Store, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmissionDetail } from "@/components/forms/submission-detail";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import type { VisitStatus } from "@/lib/mock-data";

type VisitRow = {
  id: string;
  status: string;
  checkin_at: string | null;
  checkout_at: string | null;
  duration_seconds: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /// No route — the rep started this visit themselves rather than working
  /// from their schedule.
  unscheduled: boolean;
  storeName: string;
  repName: string;
  formCount: number;
};

function statusToVisitStatus(status: string): VisitStatus {
  switch (status) {
    case "checked_out":
      return "done";
    case "checked_in":
      return "upcoming";
    case "missed":
      return "missed";
    default:
      return "unplanned";
  }
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

function VisitsContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const withForms = searchParams.get("filter") === "with-forms";

  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openVisit, setOpenVisit] = useState<VisitRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
      const { data: visitRows, error: visitsError } = await supabase
        .from("visits")
        .select(
          // `stores!visits_store_id_fkey` — two foreign keys join these tables
          // (visits.store_id, and stores.geocode_visit_id pointing back), so
          // the embed has to say which one it means or PostgREST refuses it.
          "id, status, checkin_at, checkout_at, duration_seconds, stores!visits_store_id_fkey(name), profiles(full_name), routes(scheduled_start_at, scheduled_end_at)"
        )
        .order("checkin_at", { ascending: false, nullsFirst: false });
      if (visitsError) throw visitsError;

      const { data: submissionRows, error: subsError } = await supabase
        .from("form_submissions")
        .select("visit_id");
      if (subsError) throw subsError;

      const formCounts: Record<string, number> = {};
      for (const s of submissionRows ?? []) {
        formCounts[s.visit_id] = (formCounts[s.visit_id] ?? 0) + 1;
      }

      const rows: VisitRow[] = (visitRows ?? []).map((v) => {
        const store = v.stores as unknown as { name: string } | null;
        const rep = v.profiles as unknown as { full_name: string | null } | null;
        const route = v.routes as unknown as {
          scheduled_start_at: string | null;
          scheduled_end_at: string | null;
        } | null;
        return {
          id: v.id,
          status: v.status,
          checkin_at: v.checkin_at,
          checkout_at: v.checkout_at,
          duration_seconds: v.duration_seconds,
          scheduledStart: route?.scheduled_start_at ?? null,
          scheduledEnd: route?.scheduled_end_at ?? null,
          unscheduled: route === null,
          storeName: store?.name ?? "Unknown store",
          repName: rep?.full_name ?? "Unassigned",
          formCount: formCounts[v.id] ?? 0,
        };
      });

      setVisits(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = visits
    .filter((v) => (withForms ? v.formCount > 0 : true))
    .filter((v) => (statusFilter === "all" ? true : v.status === statusFilter))
    .filter((v) =>
      `${v.storeName} ${v.repName}`.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {withForms ? "Visits with Forms Submitted" : "Visits"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {withForms
              ? "Every visit where a rep submitted at least one form."
              : "Every visit logged across your team."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={withForms ? "outline" : "default"}
            size="sm"
            className={withForms ? "" : "bg-primary text-primary-foreground"}
            onClick={() => router.push("/visits")}
          >
            All visits
          </Button>
          <Button
            variant={withForms ? "default" : "outline"}
            size="sm"
            className={withForms ? "bg-primary text-primary-foreground" : ""}
            onClick={() => router.push("/visits?filter=with-forms")}
          >
            <ClipboardCheck className="mr-1.5 h-4 w-4" />
            With forms
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <Input
            placeholder="Search by store or rep"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <NativeSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="checked_out">Done</option>
            <option value="checked_in">In progress</option>
            <option value="not_started">Not started</option>
            <option value="missed">Missed</option>
          </NativeSelect>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Store</TableHead>
              <TableHead className="hidden sm:table-cell">Rep</TableHead>
              <TableHead>Date &amp; time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Duration</TableHead>
              <TableHead className="hidden md:table-cell">Forms</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Loading visits…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">
                    Could not load visits
                  </p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {withForms
                    ? "No visits have form submissions yet — reps submit forms from the mobile app."
                    : "No visits match these filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((visit) => (
                <TableRow
                  key={visit.id}
                  onClick={
                    visit.formCount > 0 ? () => setOpenVisit(visit) : undefined
                  }
                  title={
                    visit.formCount > 0
                      ? "View submitted forms for this visit"
                      : undefined
                  }
                  className={visit.formCount > 0 ? "cursor-pointer" : undefined}
                >
                  <TableCell className="min-w-[180px]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-foreground">
                            {visit.storeName}
                          </span>
                          {visit.unscheduled && (
                            <span
                              title="The rep started this visit themselves; it was not on their schedule."
                              className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            >
                              Unscheduled
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground sm:hidden">
                          {visit.repName}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {visit.repName}
                  </TableCell>
                  <TableCell className="min-w-[150px] text-sm">
                    {(() => {
                      const actual = formatDateTime(visit.checkin_at);
                      const planned = formatDateTime(visit.scheduledStart);
                      const shown = actual ?? planned;
                      if (!shown) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      const end = formatDateTime(
                        actual ? visit.checkout_at : visit.scheduledEnd
                      );
                      return (
                        <>
                          <div className="text-foreground">{shown.date}</div>
                          <div className="text-xs text-muted-foreground">
                            {shown.time}
                            {end ? ` – ${end.time}` : ""}
                            {!actual && " (scheduled)"}
                          </div>
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={statusToVisitStatus(visit.status)} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {formatDuration(visit.duration_seconds)}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {visit.formCount > 0 ? (
                      <span className="inline-flex items-center gap-0.5 font-semibold text-primary">
                        {visit.formCount}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {visits.length} visits.
      </p>

      <VisitFormsDialog
        visit={openVisit}
        onClose={() => setOpenVisit(null)}
      />
    </div>
  );
}

type SubmissionRow = {
  id: string;
  submitted_at: string;
  templateName: string;
};

/**
 * The forms a rep submitted during one visit, with every answer expanded.
 * Most visits have a single submission, so it renders inline rather than
 * making the manager click through a list of one.
 */
function VisitFormsDialog({
  visit,
  onClose,
}: {
  visit: VisitRow | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visit) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("form_submissions")
        .select("id, submitted_at, form_templates(name)")
        .eq("visit_id", visit!.id)
        .order("submitted_at", { ascending: true });

      if (cancelled) return;
      setSubs(
        (data ?? []).map((s) => ({
          id: s.id,
          submitted_at: s.submitted_at,
          templateName:
            (s.form_templates as unknown as { name: string } | null)?.name ??
            "Form",
        }))
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.id]);

  return (
    <Dialog open={visit !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{visit?.storeName ?? "Visit"}</DialogTitle>
        </DialogHeader>

        {visit && (
          <p className="-mt-2 text-sm text-muted-foreground">
            {visit.repName}
            {(() => {
              const when = formatDateTime(visit.checkin_at);
              return when ? ` · ${when.date} at ${when.time}` : "";
            })()}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading forms…
          </p>
        ) : subs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No forms were submitted during this visit.
          </p>
        ) : (
          <div className="space-y-5">
            {subs.map((s) => (
              <section key={s.id}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {s.templateName}
                  </h3>
                  {(() => {
                    const when = formatDateTime(s.submitted_at);
                    return when ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Submitted {when.time}
                      </span>
                    ) : null;
                  })()}
                </div>
                <SubmissionDetail submissionId={s.id} />
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function VisitsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Loading visits…
        </div>
      }
    >
      <VisitsContent />
    </Suspense>
  );
}
