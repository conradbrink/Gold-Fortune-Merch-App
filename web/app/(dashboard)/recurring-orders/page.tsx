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
import { useTerms } from "@/lib/use-company-config";

/** Every standing order, the next due first. */
export default function RecurringOrdersPage() {
  const supabase = createClient();
  const t = useTerms();
  const router = useRouter();
  const [rows, setRows] = useState<RecurringListRow[]>([]);
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const visible = rows.filter((r) => status === "all" || r.status === status);

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

      <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status">
        <option value="all">All</option>
        {Object.entries(RECURRING_STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </NativeSelect>

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
            {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
            {!loading && visible.length === 0 && (
              <EmptyRow colSpan={7}>{rows.length === 0 ? "No recurring orders yet." : "None with this status."}</EmptyRow>
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
