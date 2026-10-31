"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Printer } from "lucide-react";
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
  startPicking,
  type PickingRow,
} from "@/lib/orders";
import { printPickingList, withoutStock } from "@/lib/order-paper";

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
 *
 * An order invoiced without stock (a company without Stock control) has no
 * batches and nothing reserved, so nothing is counted: the list is its lines
 * at the quantity ordered, and packing puts the whole order in the box.
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

  /** Invoiced without stock: no allocation behind any line, so nothing to count. */
  const noStock = withoutStock(rows);
  const anyShort =
    !noStock && rows.some((r) => (Number(picked[r.allocation_id]) || 0) < r.qty_to_pick);

  async function save(thenPack: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (noStock) {
        // Opened without pressing Start picking (a bookmark, the back button): start it here.
        // Already started is fine; anything else wrong is said by packing.
        await startPicking(supabase, orderId).catch(() => undefined);
        await markPacked(supabase, orderId);
        router.push(`/orders/${orderId}`);
        return;
      }
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/orders/${orderId}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Back to the order
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Picking list</h1>
          <p className="text-sm text-muted-foreground">
            {noStock
              ? "Take everything on the list. Your company does not track stock, so nothing is counted: the whole order goes in the box, as invoiced."
              : "Oldest stock first. Change a quantity only if what you took differs."}
          </p>
        </div>
        {/* The same list on paper, for a picker without a phone: tick each
            line on the sheet, then type in here what differs. */}
        {rows.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              printPickingList(supabase, orderId).catch((e) =>
                setError(e instanceof Error ? e.message : String(e))
              );
            }}
          >
            <Printer className="mr-1.5 h-4 w-4" /> Print picking list
          </Button>
        )}
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
          {noStock ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">To pick</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.order_line_id}>
                    <TableCell>
                      <div className="font-medium">{r.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[r.brand, r.unit_barcode].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{r.qty_to_pick}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
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
                  Nothing on this order is waiting to be picked. It may not be
                  confirmed yet, or it is packed already.
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
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {noStock
              ? "Pack it once everything on the list is in the box."
              : anyShort
                ? "Some lines are short. Packing will record this as a deliberate short pick."
                : "Everything on the sheet has been picked."}
          </p>
          <div className="flex gap-2">
            {!noStock && (
              <Button variant="outline" onClick={() => save(false)} disabled={busy}>
                {busy ? "Saving…" : "Save progress"}
              </Button>
            )}
            <Button onClick={() => save(true)} disabled={busy}>
              {busy ? "Saving…" : anyShort ? "Pack short" : "Pack and finish"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
