"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { orderTotals } from "@/lib/orders";
import {
  convertQuote,
  deleteQuote,
  fetchQuote,
  isExpired,
  QUOTE_STATUS_LABELS,
  setQuoteStatus,
  type QuoteDetail,
} from "@/lib/quotes";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

/**
 * One quote: what was offered, where it stands, and the way to an order.
 *
 * The status buttons are only the ones that make sense next, so the page never
 * offers "mark as sent" on something the customer already accepted. Convert is
 * offered from draft, sent and accepted alike — a customer who rings back and
 * says yes has accepted it, and making the clerk click twice to record that
 * first would only be ceremony.
 */
export default function QuoteDetailPage() {
  const supabase = createClient();
  const t = useTerms();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchQuote(supabase, id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {!error && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  const q = detail.quote;
  const expired = isExpired(q);
  const open = q.status !== "converted";
  const totals = orderTotals(
    detail.lines.map((l) => ({ qty: l.qty, unitPrice: Number(l.unit_price ?? 0) })),
    Number(q.vat_rate)
  );

  const setStatus = (s: "draft" | "sent" | "accepted" | "declined") =>
    run(async () => {
      await setQuoteStatus(supabase, q.id, s);
      await load();
    });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/quotes" className="text-sm text-muted-foreground hover:text-foreground">
            ← Quotes
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {q.quote_number}
            </h1>
            <Badge variant={expired ? "destructive" : "secondary"}>
              {expired ? "Expired" : (QUOTE_STATUS_LABELS[q.status] ?? q.status)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {q.status === "draft" && (
            <Button variant="outline" disabled={busy} onClick={() => setStatus("sent")}>
              Mark as sent
            </Button>
          )}
          {(q.status === "draft" || q.status === "sent") && (
            <Button variant="outline" disabled={busy} onClick={() => setStatus("declined")}>
              Declined
            </Button>
          )}
          {q.status === "sent" && (
            <Button variant="outline" disabled={busy} onClick={() => setStatus("accepted")}>
              Accepted
            </Button>
          )}
          {q.status === "declined" && (
            <Button variant="outline" disabled={busy} onClick={() => setStatus("draft")}>
              Reopen
            </Button>
          )}
          {q.status === "draft" && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!window.confirm(`Delete ${q.quote_number}? This cannot be undone.`)) return;
                  await deleteQuote(supabase, q.id);
                  router.push("/quotes");
                })
              }
            >
              Delete
            </Button>
          )}
          {open && q.status !== "declined" && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    !window.confirm(
                      `Turn ${q.quote_number} into an order? The warehouse will see it as a new order.`
                    )
                  )
                    return;
                  const orderId = await convertQuote(supabase, q.id);
                  router.push(`/orders/${orderId}`);
                })
              }
            >
              Convert to order
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />

      {q.converted_order_id && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          Converted to order{" "}
          <Link href={`/orders/${q.converted_order_id}`} className="font-medium text-primary hover:underline">
            {detail.orderNumber ?? "—"}
          </Link>
          {q.converted_at && ` on ${new Date(q.converted_at).toLocaleDateString()}`}. Change the
          order, not the quote.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price/unit</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.product_name}
                      {l.brand && <span className="text-muted-foreground"> — {l.brand}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(l.unit_price ?? 0).toFixed(2)}
                      {Number(l.discount_pct) > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {Number(l.list_price).toFixed(2)} less {Number(l.discount_pct)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(l.qty * Number(l.unit_price ?? 0)).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ml-auto w-56 space-y-0.5 text-sm">
              <p className="flex justify-between text-muted-foreground">
                Subtotal <span className="tabular-nums text-foreground">{totals.subtotal.toFixed(2)}</span>
              </p>
              <p className="flex justify-between text-muted-foreground">
                VAT {Number(q.vat_rate)}%{" "}
                <span className="tabular-nums text-foreground">{totals.vat.toFixed(2)}</span>
              </p>
              <p className="flex justify-between border-t border-border pt-1 font-medium">
                Total <span className="tabular-nums">{totals.total.toFixed(2)}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t.site.one} value={detail.storeName ?? "—"} />
            <Row label={t.staff.one} value={detail.repName ?? `No ${lower(t.staff.one)}`} />
            {q.contact_name && <Row label="Contact" value={q.contact_name} />}
            {q.contact_phone && <Row label="Phone" value={q.contact_phone} />}
            <Row label="Created" value={new Date(q.created_at).toLocaleDateString()} />
            <Row label="Valid until" value={q.valid_until ?? "No end date"} />
            <Row label="Deliver to" value={q.delivery_address ?? `The ${lower(t.site.one)}`} />
            {q.notes && <Row label="Notes" value={q.notes} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
