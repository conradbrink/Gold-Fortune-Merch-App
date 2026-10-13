"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import {
  fetchRecurringOrders,
  FREQUENCIES,
  RECURRING_STATUS,
  type RecurringListRow,
} from "@/lib/recurring";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { dueDaysFromQuery, recurringDueWithin } from "@/lib/dashboard-links";
import { localDay } from "@/lib/dashboard-numbers";

/** Every standing order, the next due first. */
export default function RecurringOrdersPage() {
  const supabase = createClient();
  const t = useTerms();
  const router = useRouter();
  const [rows, setRows] = useState<RecurringListRow[]>([]);
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timeZone = useCompanyConfig()?.timezone ?? null;
  /**
   * "Placing in the next N days", from the dashboard's "Recurring orders placing
   * this week" (`?due=7`). Counted from the company's today, as the dashboard
   * counts it, not the browser's.
   */
  const [dueDays, setDueDays] = useState<number | null>(null);

  useEffect(() => {
    const d = dueDaysFromQuery(new URLSearchParams(window.location.search));
    // Browser-only state, read once on mount as on Orders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (d !== null) setDueDays(d);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRecurringOrders(supabase)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // The company's today, not the browser's or UTC's: until it is known the
  // "placing soon" list waits rather than counting from the wrong day.
  const today = timeZone ? localDay(timeZone) : null;
  const waiting = dueDays !== null && today === null;
  const visible = rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (dueDays === null || (today !== null && recurringDueWithin(r, today, dueDays)))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Recurring orders</h1>
          <p className="text-sm text-muted-foreground">
            Standing orders, placed automatically each morning they fall due.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/recurring-orders/new" />}>
          <Plus className="mr-1.5 h-4 w-4" /> New recurring order
        </Button>
      </div>

      <ErrorBanner message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status">
          <option value="all">All</option>
          {Object.entries(RECURRING_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        {dueDays !== null && (
          <button
            type="button"
            onClick={() => setDueDays(null)}
            className="rounded-full border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary/5"
          >
            Placing in the next {dueDays} days · show all
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>{t.site.one}</TableHead>
              <TableHead>How often</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Placed</TableHead>
              <TableHead>Next</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(loading || waiting) && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
            {!loading && !waiting && visible.length === 0 && (
              <EmptyRow colSpan={7}>
                {rows.length === 0
                  ? "No recurring orders yet."
                  : dueDays !== null
                    ? `Nothing is placing in the next ${dueDays} days.`
                    : "None with this status."}
              </EmptyRow>
            )}
            {visible.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/recurring-orders/${r.id}`)}>
                <TableCell className="font-medium">
                  <Link href={`/recurring-orders/${r.id}`} className="text-primary hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>{r.store_name}</TableCell>
                <TableCell>{FREQUENCIES[r.frequency] ?? r.frequency}</TableCell>
                <TableCell className="text-right tabular-nums">{r.line_count}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.runs}
                  {r.max_runs ? ` of ${r.max_runs}` : ""}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {r.status === "active" ? r.next_run : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "active" ? "secondary" : "outline"}>
                    {RECURRING_STATUS[r.status] ?? r.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
