"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Plus } from "lucide-react";
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
import { can } from "@/lib/permissions";
import { usePermissions } from "@/lib/use-permissions";
import { fetchAdjustments, type AdjustmentListRow } from "@/lib/stock-moves";

export default function AdjustmentsPage() {
  const supabase = createClient();
  const permissions = usePermissions();
  const canApprove = permissions !== null && can(permissions, "warehouse_approve");
  const [rows, setRows] = useState<AdjustmentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAdjustments(supabase);
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

  const waiting = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/inventory" className="text-sm text-muted-foreground hover:underline">
            ← Inventory
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Stock adjustments</h1>
          <p className="text-sm text-muted-foreground">
            Damage, expiry, losses, and stock given away for promotions. A manager
            approves before the balance changes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Its own button rather than a line in the reason list, because
              giving stock away is a routine job with its own name, and a clerk
              doing it should not have to know it is filed as an "adjustment".
              It lands on the same form with the reason already chosen. */}
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/inventory/adjustments/new?reason=promotional_issue" />}
          >
            <Gift className="mr-1.5 h-4 w-4" /> Book out promo stock
          </Button>
          <Button nativeButton={false} render={<Link href="/inventory/adjustments/new" />}>
            <Plus className="mr-1.5 h-4 w-4" /> Raise an adjustment
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {waiting > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
          {waiting} adjustment{waiting === 1 ? " is" : "s are"} waiting for a decision.
          {!canApprove && " Someone who can approve stock changes has to sign them off."}
        </p>
      )}

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Adjustment</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Raised</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={6}>Loading…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>
                No adjustments yet. Raise one when the stock on the shelf does not match
                the system and you know why.
              </EmptyRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/adjustments/${a.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {a.adjustment_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.reason_code.replace("_", " ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.location_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.line_count}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        a.status === "approved"
                          ? "default"
                          : a.status === "pending"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.requested_at
                      ? new Date(a.requested_at).toLocaleDateString()
                      : new Date(a.created_at).toLocaleDateString()}
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
