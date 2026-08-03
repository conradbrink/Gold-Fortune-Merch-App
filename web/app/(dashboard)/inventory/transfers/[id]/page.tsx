"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import {
  fetchTransfer,
  dispatchTransfer,
  receiveTransfer,
  TRANSFER_VARIANCE_REASONS,
  type TransferRow,
} from "@/lib/stock-moves";

type Line = {
  id: string;
  product_name: string;
  batch_number: string | null;
  qty_sent: number;
  qty_received: number | null;
  variance_reason: string | null;
};

/**
 * One transfer, and the two moments that matter: sending it and receiving it.
 *
 * On receipt each line defaults to the quantity that was sent, because that is
 * what usually arrives. A shortfall has to carry a reason — the RPC refuses one
 * without — and the difference is written off as `transfer_loss` rather than
 * left in transit, which is how stock quietly disappears from systems that look
 * like they are working.
 */
export default function TransferDetailPage() {
  const supabase = createClient();
  const { id } = useParams<{ id: string }>();

  const [head, setHead] = useState<TransferRow | null>(null);
  const [fromName, setFromName] = useState<string | null>(null);
  const [toName, setToName] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const d = await fetchTransfer(supabase, id);
    setHead(d.transfer);
    setFromName(d.fromName);
    setToName(d.toName);
    setLines(d.lines);
    setReceived(
      Object.fromEntries(
        d.lines.map((l) => [l.id, String(l.qty_received ?? l.qty_sent)])
      )
    );
    setReasons(Object.fromEntries(d.lines.map((l) => [l.id, l.variance_reason ?? ""])));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!head) return <ErrorBanner message={error ?? "That transfer could not be loaded."} />;

  const isDraft = head.status === "draft";
  const inTransit = head.status === "in_transit";
  const missingReason = lines.some((l) => {
    const got = Number(received[l.id]);
    return got < l.qty_sent && !reasons[l.id];
  });

  // `min`/`max` on a number input are advisory, and this figure goes straight
  // into the ledger: a fractional or negative count fails on a cast, and more
  // received than was sent would create stock out of nothing. Refused here so
  // the button explains itself rather than the RPC doing it afterwards.
  const badQty = lines.find((l) => {
    const got = Number(received[l.id]);
    return !Number.isInteger(got) || got < 0 || got > l.qty_sent;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/inventory/transfers"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Transfers
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {head.transfer_number}
            <Badge
              variant={
                head.status === "received"
                  ? "default"
                  : head.status === "cancelled"
                    ? "outline"
                    : "secondary"
              }
            >
              {head.status.replace("_", " ")}
            </Badge>
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {fromName} <ArrowRight className="h-3.5 w-3.5" /> {toName}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <Button
              onClick={() =>
                run(
                  () => dispatchTransfer(supabase, id),
                  "Sent. The stock is in transit at the destination."
                )
              }
              disabled={busy || lines.length === 0}
            >
              {busy ? "Sending…" : "Send it"}
            </Button>
          )}
          {inTransit && (
            <Button
              onClick={() =>
                run(
                  () =>
                    receiveTransfer(
                      supabase,
                      id,
                      lines.map((l) => ({
                        line_id: l.id,
                        qty_received: Number(received[l.id]) || 0,
                        variance_reason: reasons[l.id] || null,
                      }))
                    ),
                  "Received."
                )
              }
              disabled={busy || missingReason || badQty !== undefined}
            >
              {busy ? "Receiving…" : "Receive it"}
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}
      {inTransit && badQty && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
          {badQty.product_name} has a received quantity that is not a whole number
          between 0 and the {badQty.qty_sent} sent.
        </p>
      )}
      {inTransit && missingReason && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
          One or more lines are short. Each needs a reason before the transfer can be
          received — the difference is written off, so it has to be explained.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="w-28 text-right">Received</TableHead>
                <TableHead className="w-48">If short, why?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const got = Number(received[l.id]);
                const short = inTransit && got < l.qty_sent;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.product_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.batch_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty_sent}</TableCell>
                    <TableCell>
                      {inTransit ? (
                        <Input
                          type="number"
                          min={0}
                          max={l.qty_sent}
                          value={received[l.id] ?? ""}
                          onChange={(e) =>
                            setReceived((p) => ({ ...p, [l.id]: e.target.value }))
                          }
                          className="text-right"
                          aria-label={`Received quantity for ${l.product_name}`}
                        />
                      ) : (
                        <p className="text-right tabular-nums">
                          {l.qty_received ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {inTransit ? (
                        short ? (
                          <NativeSelect
                            value={reasons[l.id] ?? ""}
                            onChange={(e) =>
                              setReasons((p) => ({ ...p, [l.id]: e.target.value }))
                            }
                            aria-label={`Shortfall reason for ${l.product_name}`}
                          >
                            <option value="">Choose a reason</option>
                            {TRANSFER_VARIANCE_REASONS.map((r) => (
                              <option key={r} value={r}>
                                {r.replace(/_/g, " ")}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">
                          {l.variance_reason?.replace(/_/g, " ") ?? "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
