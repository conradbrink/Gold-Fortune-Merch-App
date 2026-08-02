"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { fetchReceipts, type ReceiptListRow } from "@/lib/receiving";

export default function ReceiveListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<ReceiptListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchReceipts(supabase);
        if (cancelled) return;
        setRows(r);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/inventory" className="text-sm text-muted-foreground hover:underline">
            ← Inventory
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Goods received</h1>
          <p className="text-sm text-muted-foreground">
            Deliveries, opening stock and customer returns. Nothing moves until a note
            is posted.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/inventory/receive/new" />}>
          <Plus className="mr-1.5 h-4 w-4" /> Receive a delivery
        </Button>
      </div>

      <ErrorBanner message={error} />

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GRN</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={8}>Loading…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={8}>
                No goods received notes yet. Receiving a delivery is how stock first
                enters the system.
              </EmptyRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/receive/${r.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.grn_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.receipt_type.replace("_", " ")}
                  </TableCell>
                  <TableCell>{r.supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.invoice_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.location_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.line_count}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "posted"
                          ? "default"
                          : r.status === "cancelled"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.received_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
