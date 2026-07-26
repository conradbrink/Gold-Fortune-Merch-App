"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ClipboardCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusPill } from "@/components/dashboard/status-pill";
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: visitRows } = await supabase
        .from("visits")
        .select(
          "id, status, checkin_at, checkout_at, duration_seconds, stores(name), profiles(full_name), routes(scheduled_start_at, scheduled_end_at)"
        )
        .order("checkin_at", { ascending: false, nullsFirst: false });

      const { data: submissionRows } = await supabase
        .from("form_submissions")
        .select("visit_id");

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
          storeName: store?.name ?? "Unknown store",
          repName: rep?.full_name ?? "Unassigned",
          formCount: formCounts[v.id] ?? 0,
        };
      });

      setVisits(rows);
      setLoading(false);
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
                <TableRow key={visit.id}>
                  <TableCell className="min-w-[180px]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {visit.storeName}
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
                    {visit.formCount}
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
    </div>
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
