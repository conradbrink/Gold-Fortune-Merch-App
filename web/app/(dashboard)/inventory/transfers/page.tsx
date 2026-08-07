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
import { fetchTransfers, type TransferListRow } from "@/lib/stock-moves";

export default function TransfersPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<TransferListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchTransfers(supabase);
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Transfers</h1>
          <p className="text-sm text-muted-foreground">
            Stock moving between our own locations. In transit is held at the
            destination until it is received.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/inventory/transfers/new" />}>
          <Plus className="mr-1.5 h-4 w-4" /> New transfer
        </Button>
      </div>

      <ErrorBanner message={error} />

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transfer</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={6}>Loading…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>
                No transfers yet. A transfer is for stock moving between two places you
                own — a second warehouse, a van, or a rep.
              </EmptyRow>
            ) : (
              rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/transfers/${t.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {t.transfer_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.from_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.to_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.line_count}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        t.status === "received"
                          ? "default"
                          : t.status === "cancelled"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {t.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString()}
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
