"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { formatDateOnly } from "@/lib/format-date";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  fetchPickingList,
  recordPick,
  markPacked,
  type PickingRow,
} from "@/lib/orders";

/**
 * The picking list.
 *
 * Ordered oldest-expiry-first, which is the order the shelves should be walked
 * and the order the stock was allocated in. Each line starts filled in with the
 * quantity to pick, because the common case by a wide margin is that the picker
 * takes exactly what is on the sheet; the box only needs touching when it does
 * not.
 *
 * Packing is offered from here rather than making the picker go back to the
 * order, and a short pick has to be accepted deliberately — the database
 * refuses it otherwise, and that refusal is worth surfacing as a choice rather
 * than as an error.
 */
export default function PickingPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [rows, setRows] = useState<PickingRow[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await fetchPickingList(supabase, orderId);
    setRows(list);
    setPicked(
      Object.fromEntries(
        list.map((r) => [
          r.allocation_id,
          String(r.qty_picked > 0 ? r.qty_picked : r.qty_to_pick),
        ])
      )
    );
  }, [supabase, orderId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const anyShort = rows.some(
    (r) => (Number(picked[r.allocation_id]) || 0) < r.qty_to_pick
  );

  async function save(thenPack: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await recordPick(
        supabase,
        orderId,
        rows.map((r) => ({
          allocation_id: r.allocation_id,
          qty_picked: Number(picked[r.allocation_id]) || 0,
        }))
      );
      if (thenPack) {
        await markPacked(supabase, orderId, anyShort);
        router.push(`/orders/${orderId}`);
        return;
      }
      await load();
      setNotice("Pick saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/orders/${orderId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to the order
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Picking list</h1>
        <p className="text-sm text-muted-foreground">
          Oldest stock first. Change a quantity only if what you took differs.
        </p>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} line{rows.length === 1 ? "" : "s"} to pick
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">To pick</TableHead>
                <TableHead className="w-28 text-right">Picked</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <EmptyRow colSpan={7}>Loading…</EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow colSpan={7}>
                  Nothing is allocated to this order. Confirm it first so stock is
                  reserved against it.
                </EmptyRow>
              ) : (
                rows.map((r) => {
                  const value = Number(picked[r.allocation_id]) || 0;
                  const complete = value >= r.qty_to_pick;
                  return (
                    <TableRow key={r.allocation_id}>
                      <TableCell>
                        <div className="font-medium">{r.product_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.brand, r.unit_barcode].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.batch_number ?? (
                          <span className="text-muted-foreground">not batch-tracked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateOnly(r.expiry_date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.location_name}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {r.qty_to_pick}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={r.qty_to_pick}
                          value={picked[r.allocation_id] ?? ""}
                          onChange={(e) =>
                            setPicked((p) => ({ ...p, [r.allocation_id]: e.target.value }))
                          }
                          className="text-right"
                          aria-label={`Picked quantity for ${r.product_name}`}
                        />
                      </TableCell>
                      <TableCell>
                        {complete ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                            short {r.qty_to_pick - value}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {anyShort
              ? "Some lines are short. Packing will record this as a deliberate short pick."
              : "Everything on the sheet has been picked."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => save(false)} disabled={busy}>
              {busy ? "Saving…" : "Save progress"}
            </Button>
            <Button onClick={() => save(true)} disabled={busy}>
              {busy ? "Saving…" : anyShort ? "Pack short" : "Pack and finish"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
