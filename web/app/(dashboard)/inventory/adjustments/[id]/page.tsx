"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
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
import { useCurrentRole } from "@/lib/use-current-role";
import {
  fetchAdjustment,
  submitAdjustment,
  decideAdjustment,
  type AdjustmentRow,
} from "@/lib/stock-moves";

type Line = {
  id: string;
  product_name: string;
  batch_number: string | null;
  from_bucket: string | null;
  to_bucket: string | null;
  qty: number;
  note: string | null;
};

/**
 * One adjustment, and the approval gate.
 *
 * The approve button is shown only to a manager. A clerk seeing it and being
 * refused would be a worse experience than not seeing it — and the RPC refuses
 * either way, so this is presentation rather than the guard.
 */
export default function AdjustmentDetailPage() {
  const supabase = createClient();
  const { id } = useParams<{ id: string }>();
  const role = useCurrentRole();

  const [head, setHead] = useState<AdjustmentRow | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    const d = await fetchAdjustment(supabase, id);
    setHead(d.adjustment);
    setLocationName(d.locationName);
    setLines(d.lines);
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
  if (!head)
    return <ErrorBanner message={error ?? "That adjustment could not be loaded."} />;

  const isDraft = head.status === "draft";
  const isPending = head.status === "pending";
  const totalUnits = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/inventory/adjustments"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Adjustments
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {head.adjustment_number}
            <Badge
              variant={
                head.status === "approved"
                  ? "default"
                  : head.status === "pending"
                    ? "secondary"
                    : "outline"
              }
            >
              {head.status}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {head.reason_code.replace("_", " ")} · {locationName}
            {head.reason_note ? ` · ${head.reason_note}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <Button
              onClick={() =>
                run(
                  () => submitAdjustment(supabase, id),
                  "Submitted. A manager can now approve it."
                )
              }
              disabled={busy || lines.length === 0}
            >
              {busy ? "Submitting…" : "Submit for approval"}
            </Button>
          )}
          {isPending && role === "manager" && (
            <>
              <Button onClick={() => { setNote(""); setDialog("approve"); }} disabled={busy}>
                Approve
              </Button>
              <Button variant="outline" onClick={() => { setNote(""); setDialog("reject"); }} disabled={busy}>
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
      {isDraft && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm text-muted-foreground">
          Nothing has moved. Submitting sends this for approval; approving is what posts
          it to the ledger.
        </p>
      )}
      {isPending && role !== "manager" && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm text-muted-foreground">
          Waiting for a manager. The stock is unchanged until then.
        </p>
      )}
      {head.decision_note && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          {head.status === "rejected" ? "Rejected" : "Approved"} — {head.decision_note}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {lines.length} line{lines.length === 1 ? "" : "s"} · {totalUnits} unit
            {totalUnits === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.product_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.batch_number ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <span>{l.from_bucket ?? "outside"}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{l.to_bucket ?? "outside"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {l.qty}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={dialog === "approve" || dialog === "reject"}
        onOpenChange={(v) => {
          // The note is the reason for *this* decision. Left behind, a
          // rejection reason typed and abandoned would be filed as the note on
          // a later approval.
          if (!v) {
            setDialog(null);
            setNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "approve" ? "Approve this adjustment" : "Reject this adjustment"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {dialog === "approve"
                ? `${totalUnits} unit${totalUnits === 1 ? "" : "s"} will move. This posts to the ledger and can only be undone by another adjustment.`
                : "Nothing changes. The clerk can correct it and submit again."}
            </p>
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
                    decideAdjustment(
                      supabase,
                      id,
                      dialog === "approve",
                      note.trim() || null
                    ),
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
