"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import {
  fetchReceipt,
  postReceipt,
  cancelReceipt,
  deleteDraftReceipt,
  type ReceiptDetail,
} from "@/lib/receiving";

/**
 * A goods received note.
 *
 * A draft can be posted or thrown away; a posted one can only be reversed, and
 * the reversal is refused by the ledger if the stock has already been used.
 * That refusal is surfaced as the RPC wrote it, because it names the product
 * that is the problem and no rewording here would improve on that.
 */
export default function ReceiptDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "cancel" | "discard">(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(async () => {
    setDetail(await fetchReceipt(supabase, id));
  }, [supabase, id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
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
  }, [reload]);

  /**
   * `reload: false` is for the paths that destroy the thing being displayed.
   * Discarding a draft deletes the row, so re-reading it afterwards fails on a
   * `.single()` that finds nothing, and the screen shows an error about the
   * record not existing at the exact moment that is the intended outcome.
   */
  async function run(
    fn: () => Promise<unknown>,
    success: string,
    opts: { reload?: boolean } = {}
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (opts.reload !== false) await reload();
      setNotice(success);
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!detail) return <ErrorBanner message={error ?? "That receipt could not be loaded."} />;

  const r = detail.receipt;
  const isDraft = r.status === "draft";
  const isPosted = r.status === "posted";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/inventory/receive"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Goods received
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {r.grn_number}
            <Badge
              variant={
                isPosted ? "default" : r.status === "cancelled" ? "outline" : "secondary"
              }
            >
              {r.status}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {r.supplier_name ?? r.receipt_type.replace("_", " ")}
            {r.invoice_number ? ` · invoice ${r.invoice_number}` : ""}
            {detail.locationName ? ` · into ${detail.locationName}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <>
              <Button
                onClick={() =>
                  run(
                    () => postReceipt(supabase, id),
                    "Posted. The stock is now on hand."
                  )
                }
                disabled={busy || detail.lines.length === 0}
              >
                {busy ? "Posting…" : "Post into stock"}
              </Button>
              <Button variant="outline" onClick={() => setDialog("discard")} disabled={busy}>
                Discard draft
              </Button>
            </>
          )}
          {isPosted && (
            <Button variant="outline" onClick={() => setDialog("cancel")} disabled={busy}>
              Reverse this receipt
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}
      {r.cancel_reason && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          Cancelled — {r.cancel_reason}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {detail.lines.length} line{detail.lines.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Damaged</TableHead>
                <TableHead className="text-right">Base units</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.product_name}</div>
                    {l.brand && (
                      <div className="text-xs text-muted-foreground">{l.brand}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {l.batch_number ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.expiry_date ? new Date(l.expiry_date).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.uom}
                    {l.units_per_uom ? ` × ${l.units_per_uom}` : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.qty_received}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.qty_damaged > 0 ? (
                      <span className="text-amber-600 dark:text-amber-500">
                        {l.qty_damaged}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {l.qty_base ?? (
                      <span className="font-normal text-muted-foreground">
                        on posting
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {l.unit_cost ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {isDraft && (
            <p className="mt-3 text-xs text-muted-foreground">
              Base units are worked out when the note is posted, using the pack size
              that is true at that moment — and frozen onto the line, so correcting a
              product later cannot restate this delivery.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialog === "cancel" || dialog === "discard"}
        onOpenChange={(v) => !v && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "cancel" ? "Reverse this receipt" : "Discard this draft"}
            </DialogTitle>
          </DialogHeader>
          {dialog === "cancel" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The opposite movements are posted, taking the stock back out. If any of
                it has already been sold or moved, this is refused and you will be told
                which product.
              </p>
              <div>
                <Label htmlFor="reason">Reason</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Wrong supplier, keyed twice…"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing has entered stock, so this can be thrown away cleanly. The GRN
              number is not reused.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={() =>
                dialog === "cancel"
                  ? run(
                      () => cancelReceipt(supabase, id, reason),
                      "Reversed. The stock has been taken back out."
                    )
                  : run(
                      async () => {
                        await deleteDraftReceipt(supabase, id);
                        router.push("/inventory/receive");
                      },
                      "Draft discarded.",
                      { reload: false }
                    )
              }
              disabled={busy || (dialog === "cancel" && !reason.trim())}
            >
              {busy ? "Working…" : dialog === "cancel" ? "Reverse it" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
