"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, Snowflake } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
import { StatTile, ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { ExportMenu } from "@/components/export-menu";
import { can } from "@/lib/permissions";
import { usePermissions } from "@/lib/use-permissions";
import {
  fetchStocktake,
  fetchVarianceReport,
  saveCounts,
  CountSaveError,
  submitStocktake,
  decideStocktake,
  cancelStocktake,
  recountLine,
  balanceKey,
  VARIANCE_REASONS,
  type StocktakePeople,
  type StocktakeRow,
  type VarianceRow,
} from "@/lib/stocktakes";
import { decidedLabel, stocktakeSheet, whoAndWhen } from "@/lib/stocktake-sheet";

type Line = {
  id: string;
  product_id: string;
  batch_id: string | null;
  product_name: string;
  brand: string | null;
  system_qty_at_open: number;
  counted_qty: number | null;
  recount_qty: number | null;
  variance_reason: string | null;
};

/**
 * Counting, and then deciding.
 *
 * While the count is open the sheet shows what the system thought when it
 * started — deliberately, because a counter who can see the "right" answer
 * writes it down. It is shown because a blind count is a different feature with
 * different tooling, but it is labelled as of-the-open rather than current.
 *
 * Once submitted the screen becomes the manager's: the variance is measured
 * against the reading taken at submit, and any line whose stock changed after
 * that has to be recounted before the count can be approved. There used to be
 * a "re-checked" tick that approved such a line as counted; on STK-000005 it
 * would have taken 51 Kiwi out of 19, and added undelivered stock twice, so it
 * is gone (20261017130000).
 *
 * A recount is measured against the system now, and the first count stays on
 * the line. It is also how a manager puts right a count that missed the boxes
 * packed for orders.
 *
 * A count started by mistake can be cancelled until it is handed in
 * (20261031163700). Nothing has touched the stock by then, and the sheet stays
 * on file, read-only, with whatever counts had been saved.
 */
export default function StocktakeDetailPage() {
  const supabase = createClient();
  const { id } = useParams<{ id: string }>();
  const permissions = usePermissions();
  // Approving a variance is deliberately not the same grant as counting the
  // stock — see the `warehouse_approve` permission.
  const canApprove = permissions !== null && can(permissions, "warehouse_approve");

  const [head, setHead] = useState<StocktakeRow | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [people, setPeople] = useState<StocktakePeople>({
    startedBy: null,
    submittedBy: null,
    decidedBy: null,
  });
  // Packed or set aside for orders now, by line id.
  const [setAside, setSetAside] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Lines a partial save could not write. Marked in the table, because a
  // count of failures is not something a counter can act on with forty rows
  // in front of them.
  const [failedLines, setFailedLines] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "approve" | "reject" | "cancel">(null);
  const [note, setNote] = useState("");
  const [recounting, setRecounting] = useState<VarianceRow | null>(null);
  const [recountQty, setRecountQty] = useState("");

  const reload = useCallback(async () => {
    const d = await fetchStocktake(supabase, id);
    setHead(d.stocktake);
    setLocationName(d.locationName);
    setPeople(d.people);
    setSetAside(
      Object.fromEntries(
        d.lines.map((l) => [l.id, d.setAside[balanceKey(l.product_id, l.batch_id)] ?? 0])
      )
    );
    setLines(d.lines);
    setCounts(
      Object.fromEntries(
        d.lines.map((l) => [l.id, l.counted_qty == null ? "" : String(l.counted_qty)])
      )
    );
    setReasons(
      Object.fromEntries(d.lines.map((l) => [l.id, l.variance_reason ?? ""]))
    );
    // A cancelled count was never handed in, so there is nothing to measure
    // its counts against.
    if (d.stocktake.status !== "counting" && d.stocktake.status !== "cancelled") {
      setVariance(await fetchVarianceReport(supabase, id));
    } else {
      setVariance([]);
    }
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

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
      setNotice(success);
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!head) return <ErrorBanner message={error ?? "That count could not be loaded."} />;

  const counting = head.status === "counting";
  const submitted = head.status === "submitted";
  const cancelled = head.status === "cancelled";
  const uncounted = lines.filter((l) => (counts[l.id] ?? "") === "").length;

  /** Saves the sheet, remembering which lines failed so the table can say so. */
  async function persistCounts() {
    setFailedLines(new Set());
    try {
      await saveCounts(
        supabase,
        lines.map((l) => {
          const countedQty = counts[l.id] === "" ? null : Number(counts[l.id]);
          // A reason belongs to a variance. Picking one, then correcting the
          // count back to what the system said, hides the select but leaves
          // the reason in state — and a zero-variance line would be filed
          // explaining a discrepancy that no longer exists.
          const differs = countedQty !== null && countedQty !== l.system_qty_at_open;
          return {
            id: l.id,
            countedQty,
            varianceReason: differs ? reasons[l.id] || null : null,
          };
        })
      );
    } catch (e) {
      if (e instanceof CountSaveError) setFailedLines(new Set(e.failedLineIds));
      throw e;
    }
  }
  const moved = variance.filter((v) => v.moved_since_submit);
  const withVariance = variance.filter((v) => v.variance_qty !== 0);
  // Short lines where stock is packed for orders: the usual reason is that the
  // packed boxes were not counted. Approving those writes off stock that is
  // sitting in the warehouse waiting for a driver.
  const shortWithPacked = withVariance.filter(
    (v) => (v.variance_qty ?? 0) < 0 && (setAside[v.line_id] ?? 0) > 0
  );
  const recountOf = new Map(lines.map((l) => [l.id, l.recount_qty]));
  const withBatch = variance.some((v) => v.batch_number);
  const showPacked = submitted && variance.some((v) => (setAside[v.line_id] ?? 0) > 0);
  const columnCount = 7 + (withBatch ? 1 : 0) + (showPacked ? 1 : 0) + (submitted && canApprove ? 1 : 0);
  const steps = whoAndWhen({ stocktake: head, people });

  function exportSheet() {
    if (!head) return null;
    // While counting, what is typed on screen, saved or not: the print-out
    // has to match the screen it was printed from.
    const sheetLines = counting
      ? lines.map((l) => ({
          ...l,
          counted_qty: (counts[l.id] ?? "") === "" ? null : Number(counts[l.id]),
          variance_reason: reasons[l.id] || null,
        }))
      : lines;
    return stocktakeSheet({
      stocktake: head,
      locationName,
      people,
      lines: sheetLines,
      variance,
      setAside,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/inventory/stocktakes"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Stocktakes
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {head.stocktake_number}
            <Badge variant={head.status === "approved" ? "default" : "secondary"}>
              {head.status}
            </Badge>
            {/* The freeze only holds while the count is open. */}
            {head.freeze_movements && (counting || submitted) && (
              <Badge variant="outline" className="border-sky-500/50 text-sky-600">
                <Snowflake className="mr-1 h-3 w-3" /> frozen
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {head.stocktake_type} count · {locationName}
          </p>
          {steps.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{steps.join(" · ")}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <ExportMenu label="Print or Excel" build={exportSheet} />
          {counting && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setNote("");
                  setError(null);
                  setDialog("cancel");
                }}
                disabled={busy}
              >
                Cancel count
              </Button>
              <Button
                variant="outline"
                onClick={() => run(persistCounts, "Counts saved.")}
                disabled={busy}
              >
                Save counts
              </Button>
              <Button
                onClick={() =>
                  run(async () => {
                    await persistCounts();
                    await submitStocktake(supabase, id);
                  }, "Submitted. A manager can now approve it.")
                }
                disabled={busy || uncounted > 0}
              >
                {uncounted > 0 ? `${uncounted} still to count` : "Hand the sheet in"}
              </Button>
            </>
          )}
          {submitted && canApprove && (
            <>
              {/* The database refuses these until they are recounted; saying so
                  on the button saves a trip into the dialog and back. */}
              <Button onClick={() => setDialog("approve")} disabled={busy || moved.length > 0}>
                {moved.length > 0
                  ? `Recount ${moved.length} line${moved.length === 1 ? "" : "s"} first`
                  : "Approve"}
              </Button>
              <Button variant="outline" onClick={() => setDialog("reject")} disabled={busy}>
                Reject
              </Button>
            </>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}
      {submitted && !canApprove && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          Handed in. The variances have to be approved before they change the
          stock.
        </p>
      )}
      {head.notes && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          Note — {head.notes}
        </p>
      )}
      {head.decision_note && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          {decidedLabel(head.status) ?? "Approved"} — {head.decision_note}
        </p>
      )}

      {!counting && !cancelled && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Lines counted" value={variance.length} />
          <StatTile
            label="With a variance"
            value={withVariance.length}
            tone={withVariance.length > 0 ? "warn" : "neutral"}
          />
          <StatTile
            label="Units over"
            value={withVariance
              .filter((v) => (v.variance_qty ?? 0) > 0)
              .reduce((n, v) => n + (v.variance_qty ?? 0), 0)}
          />
          <StatTile
            label="Units short"
            value={Math.abs(
              withVariance
                .filter((v) => (v.variance_qty ?? 0) < 0)
                .reduce((n, v) => n + (v.variance_qty ?? 0), 0)
            )}
            tone="bad"
          />
        </div>
      )}

      {submitted && canApprove && shortWithPacked.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4" /> {shortWithPacked.length} short line
            {shortWithPacked.length === 1 ? " has" : "s have"} stock packed for orders
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Were the packed boxes counted? If not, recount those lines and include
            them, or the approval takes that stock off. A count can never take away
            stock an order is waiting for, so a line counted below what is packed
            cannot be approved until it is recounted.
          </p>
        </div>
      )}

      {submitted && moved.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4" /> Recount {moved.length} line
            {moved.length === 1 ? "" : "s"} before approving
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Stock changed after {moved.length === 1 ? "it was" : "they were"} counted
            (orders dispatched or cancelled, stock returned or received), so the count
            no longer lines up with the system. Count what is on the shelf now and
            press Recount on {moved.length === 1 ? "that line" : "each one"}: the
            difference is worked out against the system now. They are marked in
            amber in the Now column.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {counting || cancelled ? "Count sheet" : "Variances"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {counting || cancelled ? (
            <>
            <p className="mb-3 text-sm text-muted-foreground">
              {counting
                ? "Count every single item at this location, including boxes packed for orders that have not left yet."
                : "This count was cancelled before it was handed in. Nothing in the stock changed."}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">System said</TableHead>
                  <TableHead className="w-32 text-right">Counted</TableHead>
                  <TableHead className="w-48">If different, why?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <EmptyRow colSpan={4}>
                    Nothing to count — there is no stock at this location.
                  </EmptyRow>
                ) : (
                  lines.map((l) => {
                    const v = counts[l.id];
                    const differs = v !== "" && Number(v) !== l.system_qty_at_open;
                    const didNotSave = failedLines.has(l.id);
                    return (
                      <TableRow
                        key={l.id}
                        className={didNotSave ? "bg-destructive/10" : undefined}
                      >
                        <TableCell>
                          <div className="font-medium">{l.product_name}</div>
                          {l.brand && (
                            <div className="text-xs text-muted-foreground">{l.brand}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {l.system_qty_at_open}
                          {counting && (setAside[l.id] ?? 0) > 0 && (
                            <div className="text-xs">
                              {setAside[l.id]} packed for orders now
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={cancelled ? "text-right tabular-nums" : undefined}>
                          {cancelled ? (
                            (l.counted_qty ?? "—")
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              value={v ?? ""}
                              onChange={(e) =>
                                setCounts((p) => ({ ...p, [l.id]: e.target.value }))
                              }
                              className="text-right"
                              aria-label={`Counted quantity for ${l.product_name}`}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {cancelled ? (
                            <span className="text-sm text-muted-foreground">
                              {l.variance_reason ? l.variance_reason.replace(/_/g, " ") : "—"}
                            </span>
                          ) : differs ? (
                            <NativeSelect
                              value={reasons[l.id] ?? ""}
                              onChange={(e) =>
                                setReasons((p) => ({ ...p, [l.id]: e.target.value }))
                              }
                              aria-label={`Variance reason for ${l.product_name}`}
                            >
                              <option value="">Choose a reason</option>
                              {VARIANCE_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {r.replace(/_/g, " ")}
                                </option>
                              ))}
                            </NativeSelect>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  {withBatch && <TableHead>Batch</TableHead>}
                  <TableHead className="text-right">At open</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">At submit</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  {showPacked && <TableHead className="text-right">For orders</TableHead>}
                  <TableHead>Reason</TableHead>
                  {submitted && canApprove && <TableHead>Check</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.length === 0 ? (
                  <EmptyRow colSpan={columnCount}>No lines.</EmptyRow>
                ) : (
                  variance.map((v) => (
                    <TableRow key={v.line_id}>
                      <TableCell className="font-medium">{v.product_name}</TableCell>
                      {withBatch && (
                        <TableCell className="text-muted-foreground">
                          {v.batch_number ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {v.system_qty_at_open}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {recountOf.get(v.line_id) != null ? (
                          <span title="First count, then the recount">
                            <span className="text-muted-foreground line-through">
                              {v.counted_qty ?? "—"}
                            </span>{" "}
                            {recountOf.get(v.line_id)}
                          </span>
                        ) : (
                          (v.counted_qty ?? "—")
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.system_qty_at_submit ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {v.variance_qty == null ? (
                          "—"
                        ) : v.variance_qty === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span
                            className={
                              v.variance_qty > 0 ? "text-primary" : "text-destructive"
                            }
                          >
                            {v.variance_qty > 0 ? "+" : ""}
                            {v.variance_qty}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {submitted && v.moved_since_submit ? (
                          <span className="text-amber-600 dark:text-amber-500">
                            {v.live_qty}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{v.live_qty}</span>
                        )}
                      </TableCell>
                      {showPacked && (
                        <TableCell className="text-right tabular-nums">
                          {(setAside[v.line_id] ?? 0) > 0 ? (
                            <span
                              className={
                                (v.variance_qty ?? 0) < 0
                                  ? "font-medium text-amber-600 dark:text-amber-500"
                                  : "text-muted-foreground"
                              }
                            >
                              {setAside[v.line_id]}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground">
                        {v.variance_reason?.replace(/_/g, " ") ?? "—"}
                      </TableCell>
                      {submitted && canApprove && (
                        <TableCell>
                          <div className="flex items-center gap-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRecounting(v);
                              setRecountQty("");
                              setError(null);
                            }}
                            disabled={busy}
                          >
                            Recount
                          </Button>
                          {v.moved_since_submit && (
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                              changed
                            </span>
                          )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={recounting !== null} onOpenChange={(v) => !v && setRecounting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recount {recounting?.product_name}</DialogTitle>
          </DialogHeader>
          {recounting && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Count it again now, including any boxes packed for orders that are
                still here.
                {(setAside[recounting.line_id] ?? 0) > 0 &&
                  ` ${setAside[recounting.line_id]} are packed or set aside for orders right now.`}{" "}
                The difference is worked out against what the system says now (
                {recounting.live_qty}). The first count ({recounting.counted_qty}) is
                kept on the sheet.
              </p>
              <div>
                <Label htmlFor="recount">Counted now (single items)</Label>
                <Input
                  id="recount"
                  type="number"
                  min={0}
                  value={recountQty}
                  onChange={(e) => setRecountQty(e.target.value)}
                  className="text-right"
                />
              </div>
              {recountQty !== "" && Number.isInteger(Number(recountQty)) && Number(recountQty) >= 0 && (
                <p className="text-sm">
                  Difference:{" "}
                  <span className="font-medium tabular-nums">
                    {Number(recountQty) - recounting.live_qty > 0 ? "+" : ""}
                    {Number(recountQty) - recounting.live_qty}
                  </span>
                </p>
              )}
              <ErrorBanner message={error} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecounting(null)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={async () => {
                if (!recounting) return;
                const qty = Number(recountQty);
                if (recountQty === "" || !Number.isInteger(qty) || qty < 0) {
                  setError("Enter how many single items are there now: a whole number, 0 or more.");
                  return;
                }
                const line = recounting;
                await run(async () => {
                  await recountLine(supabase, { lineId: line.line_id, counted: qty });
                  setRecounting(null);
                }, `${line.product_name} recounted at ${qty}.`);
              }}
              disabled={busy || recountQty === ""}
            >
              {busy ? "Saving…" : "Save the recount"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "cancel"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this count</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Nothing in the stock changes. The sheet is kept as cancelled, and a new
              count can be started at {locationName ?? "this location"}.
              {head.freeze_movements && " Stock can move there again straight away."}
            </p>
            <div>
              <Label htmlFor="cancel-reason">Why? (optional)</Label>
              <Input
                id="cancel-reason"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <ErrorBanner message={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={() =>
                run(async () => {
                  try {
                    await cancelStocktake(supabase, { id, reason: note.trim() || null });
                  } catch (e) {
                    // Most often someone else handed it in meanwhile: show the
                    // sheet as it is now behind the refusal.
                    await reload().catch(() => {});
                    throw e;
                  }
                }, "Cancelled. Nothing in the stock changed.")
              }
              disabled={busy}
            >
              {busy ? "Saving…" : "Cancel the count"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "approve" || dialog === "reject"}
        onOpenChange={(v) => !v && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "approve" ? "Approve this count" : "Reject this count"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {dialog === "approve"
                ? `${withVariance.length} line${withVariance.length === 1 ? "" : "s"} will be adjusted. This changes the stock and cannot be undone except by another adjustment.`
                : "The count is filed as rejected and nothing changes. The stock stays as it is."}
            </p>
            {dialog === "approve" && shortWithPacked.length > 0 && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
                {shortWithPacked.length} short line{shortWithPacked.length === 1 ? " has" : "s have"}{" "}
                stock packed for orders. If those boxes were not counted, go back and
                recount {shortWithPacked.length === 1 ? "it" : "them"} first.
              </p>
            )}
            <div>
              <Label htmlFor="note">
                {dialog === "approve" ? "Note (optional)" : "Why is it being rejected?"}
              </Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={() =>
                run(
                  () =>
                    decideStocktake(supabase, {
                      id,
                      approve: dialog === "approve",
                      note: note.trim() || null,
                    }),
                  dialog === "approve"
                    ? "Approved. The stock has been adjusted."
                    : "Rejected. Nothing changed."
                )
              }
              disabled={busy || (dialog === "reject" && !note.trim())}
            >
              {busy ? "Saving…" : dialog === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
