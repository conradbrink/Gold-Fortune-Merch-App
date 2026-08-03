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
import { useCurrentRole } from "@/lib/use-current-role";
import {
  fetchStocktake,
  fetchVarianceReport,
  saveCounts,
  CountSaveError,
  submitStocktake,
  decideStocktake,
  VARIANCE_REASONS,
  type StocktakeRow,
  type VarianceRow,
} from "@/lib/stocktakes";

type Line = {
  id: string;
  product_name: string;
  brand: string | null;
  system_qty_at_open: number;
  counted_qty: number | null;
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
 * against the reading taken at submit, and any line whose balance has moved
 * since then is flagged and has to be ticked individually before it can be
 * approved. That tick is the whole reason the RPC takes a list of line ids.
 */
export default function StocktakeDetailPage() {
  const supabase = createClient();
  const { id } = useParams<{ id: string }>();
  const role = useCurrentRole();

  const [head, setHead] = useState<StocktakeRow | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reconfirm, setReconfirm] = useState<Set<string>>(new Set());
  // Lines a partial save could not write. Marked in the table, because a
  // count of failures is not something a counter can act on with forty rows
  // in front of them.
  const [failedLines, setFailedLines] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    const d = await fetchStocktake(supabase, id);
    setHead(d.stocktake);
    setLocationName(d.locationName);
    setLines(d.lines);
    setCounts(
      Object.fromEntries(
        d.lines.map((l) => [l.id, l.counted_qty == null ? "" : String(l.counted_qty)])
      )
    );
    setReasons(
      Object.fromEntries(d.lines.map((l) => [l.id, l.variance_reason ?? ""]))
    );
    if (d.stocktake.status !== "counting") {
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
  const uncounted = lines.filter((l) => (counts[l.id] ?? "") === "").length;

  /** Saves the sheet, remembering which lines failed so the table can say so. */
  async function persistCounts() {
    setFailedLines(new Set());
    try {
      await saveCounts(
        supabase,
        lines.map((l) => ({
          id: l.id,
          countedQty: counts[l.id] === "" ? null : Number(counts[l.id]),
          varianceReason: reasons[l.id] || null,
        }))
      );
    } catch (e) {
      if (e instanceof CountSaveError) setFailedLines(new Set(e.failedLineIds));
      throw e;
    }
  }
  const moved = variance.filter((v) => v.moved_since_submit);
  const withVariance = variance.filter((v) => v.variance_qty !== 0);
  const blockedIds = moved.filter((m) => m.variance_qty !== 0).map((m) => m.line_id);
  const allBlockedTicked = blockedIds.every((b) => reconfirm.has(b));
  // What is still un-ticked, which is both the number the warning quotes and
  // the number its verb has to agree with. Taking the count from one and the
  // verb from the other produced "1 lines have moved".
  const blockedOutstanding = blockedIds.filter((b) => !reconfirm.has(b)).length;

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
            {head.freeze_movements && (
              <Badge variant="outline" className="border-sky-500/50 text-sky-600">
                <Snowflake className="mr-1 h-3 w-3" /> frozen
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {head.stocktake_type} count · {locationName}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {counting && (
            <>
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
          {submitted && role === "manager" && (
            <>
              <Button onClick={() => setDialog("approve")} disabled={busy}>
                Approve
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
      {submitted && role !== "manager" && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          Handed in. A manager has to approve the variances before they change the
          stock.
        </p>
      )}
      {head.decision_note && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          {head.status === "rejected" ? "Rejected" : "Approved"} — {head.decision_note}
        </p>
      )}

      {!counting && (
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

      {submitted && moved.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4" /> {moved.length} line
            {moved.length === 1 ? " has" : "s have"} moved since the sheet was handed in
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Stock traded while this count was waiting. Approving those lines as they
            stand would count that trade twice, so each one has to be confirmed
            individually below after checking the shelf.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {counting ? "Count sheet" : "Variances"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {counting ? (
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
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell>
                          {differs ? (
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">At open</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">At submit</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  <TableHead>Reason</TableHead>
                  {submitted && role === "manager" && <TableHead>Confirm</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.length === 0 ? (
                  <EmptyRow colSpan={9}>No lines.</EmptyRow>
                ) : (
                  variance.map((v) => (
                    <TableRow key={v.line_id}>
                      <TableCell className="font-medium">{v.product_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.batch_number ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {v.system_qty_at_open}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.counted_qty ?? "—"}
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
                        {v.moved_since_submit ? (
                          <span className="text-amber-600 dark:text-amber-500">
                            {v.live_qty}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{v.live_qty}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.variance_reason?.replace(/_/g, " ") ?? "—"}
                      </TableCell>
                      {submitted && role === "manager" && (
                        <TableCell>
                          {v.moved_since_submit && v.variance_qty !== 0 ? (
                            <label className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={reconfirm.has(v.line_id)}
                                onChange={(e) =>
                                  setReconfirm((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(v.line_id);
                                    else next.delete(v.line_id);
                                    return next;
                                  })
                                }
                                className="h-4 w-4"
                              />
                              re-checked
                            </label>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
            {dialog === "approve" && blockedIds.length > 0 && !allBlockedTicked && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
                {blockedOutstanding} line{blockedOutstanding === 1 ? " has" : "s have"} moved
                since the sheet was handed in and{" "}
                {blockedOutstanding === 1 ? "has" : "have"} not been re-checked. Tick{" "}
                {blockedOutstanding === 1 ? "it" : "them"} in the table first, or the
                database will refuse this.
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
                      reconfirmLineIds: Array.from(reconfirm),
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
