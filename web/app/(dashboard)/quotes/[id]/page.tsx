"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
  convertQuote,
  deleteQuote,
  downloadQuotePdf,
  fetchQuote,
  fetchQuoteSeller,
  invoicedSoFar,
  invoiceQuote,
  isExpired,
  QUOTE_STATUS_LABELS,
  quoteClientName,
  quoteTotals,
  setQuoteStatus,
  type QuoteDetail,
} from "@/lib/quotes";
import { INVOICE_KIND_LABELS } from "@/lib/invoices";
import { formatQty, lineTotal } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import { moduleEnabled } from "@/lib/modules";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

/**
 * One quote: what was offered, where it stands, and the way to getting paid.
 *
 * The status buttons are only the ones that make sense next. An accepted quote
 * is invoiced here — in full, or as a deposit and then the balance where the
 * company takes deposits — or, for a quote of products, turned into an order
 * for the warehouse. The database checks every step again: an invoiced quote
 * stays accepted, a deposit never passes the quote's total.
 */
export default function QuoteDetailPage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositKind, setDepositKind] = useState<"percent" | "amount">("percent");
  const [depositValue, setDepositValue] = useState("50");

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
  const currency = config?.settings.currency_code ?? "";
  const m = (n: number) => formatMoney(n, currency);
  const expired = isExpired(q);
  const totals = quoteTotals(detail);
  const rate = Number(q.vat_rate);
  const hasProducts = detail.lines.some((l) => l.product_id !== null);
  const allProducts = detail.lines.length > 0 && detail.lines.every((l) => l.product_id !== null);
  const sells = config ? moduleEnabled(config.modules, "distribution") : false;
  const deposits = config?.settings.money_deposits ?? false;
  const live = detail.invoices.filter((i) => i.status === "issued");
  const liveDeposits = live.filter((i) => i.kind === "deposit");
  const fullyInvoiced = live.some((i) => i.kind !== "deposit");
  // What the live invoices charge, VAT included, against the quote's total.
  const charged = invoicedSoFar(detail);
  const canInvoice = q.status === "accepted" && !hasProducts && !fullyInvoiced;

  const setStatus = (s: "draft" | "sent" | "accepted" | "declined") =>
    run(async () => {
      await setQuoteStatus(supabase, q.id, s);
      await load();
    });

  const invoice = (mode: "full" | "deposit" | "final") =>
    run(async () => {
      let depositArg: { percent?: number; amount?: number } | undefined;
      if (mode === "deposit") {
        const v = Number(depositValue);
        if (!Number.isFinite(v) || v <= 0) {
          throw new Error(depositKind === "percent" ? "A deposit percentage is above zero." : "A deposit is above zero.");
        }
        depositArg = depositKind === "percent" ? { percent: v } : { amount: v };
      }
      const what =
        mode === "full" ? "an invoice for the whole quote" : mode === "deposit" ? "a deposit invoice" : "the final invoice";
      if (!window.confirm(`Issue ${what} for ${q.quote_number}? An issued invoice cannot be edited, only voided or credited.`)) {
        return;
      }
      const invoiceId = await invoiceQuote(supabase, q.id, mode, depositArg);
      router.push(`/invoices/${invoiceId}`);
    });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/quotes" className="text-sm text-muted-foreground hover:text-foreground">
            ← Quotes
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{q.quote_number}</h1>
            <Badge variant={expired ? "destructive" : "secondary"}>
              {expired ? "Expired" : (QUOTE_STATUS_LABELS[q.status] ?? q.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{quoteClientName(q, detail.storeName)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await downloadQuotePdf(detail, await fetchQuoteSeller(supabase));
              })
            }
          >
            Download PDF
          </Button>
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
          {(q.status === "draft" || q.status === "sent") && (
            <Button variant="outline" disabled={busy} onClick={() => setStatus("accepted")}>
              Accepted
            </Button>
          )}
          {(q.status === "declined" || (q.status === "accepted" && live.length === 0)) && (
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
          {sells && allProducts && q.status !== "converted" && q.status !== "declined" && (
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

      {(canInvoice || detail.invoices.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoicing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {detail.invoices.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {detail.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                      <Link href={`/invoices/${i.id}`} className="font-medium text-primary hover:underline">
                        {i.invoice_number}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {INVOICE_KIND_LABELS[i.kind] || "Invoice"} · {i.issue_date}
                        {i.status === "void" && " · void"}
                      </span>
                    </span>
                    <span className={`tabular-nums ${i.status === "void" ? "text-muted-foreground line-through" : ""}`}>
                      {m(i.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {liveDeposits.length > 0 && (
              <p className="text-muted-foreground">
                Deposits invoiced: {m(liveDeposits.reduce((n, i) => n + i.total, 0))} of {m(totals.total)}.
                {charged > 0 && !fullyInvoiced && " The final invoice takes them off the quote's total."}
              </p>
            )}
            {canInvoice && (
              <div className="flex flex-wrap items-end gap-3">
                {liveDeposits.length === 0 && (
                  <Button disabled={busy} onClick={() => invoice("full")}>
                    Invoice the whole quote
                  </Button>
                )}
                {deposits && (
                  <>
                    <div>
                      <Label htmlFor="dep-kind">Deposit</Label>
                      <div className="flex gap-2">
                        <NativeSelect
                          id="dep-kind"
                          value={depositKind}
                          onChange={(e) => setDepositKind(e.target.value as "percent" | "amount")}
                        >
                          <option value="percent">Percentage</option>
                          <option value="amount">Amount</option>
                        </NativeSelect>
                        <Input
                          type="number"
                          min={0}
                          step={depositKind === "percent" ? "1" : "0.01"}
                          value={depositValue}
                          onChange={(e) => setDepositValue(e.target.value)}
                          aria-label={depositKind === "percent" ? "Deposit percentage" : "Deposit amount"}
                          className="w-28"
                        />
                      </div>
                    </div>
                    <Button variant="outline" disabled={busy} onClick={() => invoice("deposit")}>
                      Invoice a deposit
                    </Button>
                    {liveDeposits.length > 0 && (
                      <Button disabled={busy} onClick={() => invoice("final")}>
                        Final invoice
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
            {q.status === "accepted" && hasProducts && !q.converted_order_id && (
              <p className="text-muted-foreground">
                This quote has products on it: convert it to an order, and invoice the order when it goes out.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price/unit</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.label}
                      {l.brand && <span className="text-muted-foreground"> — {l.brand}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(Number(l.qty))}
                      {l.unit && <span className="text-muted-foreground"> {l.unit}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m(Number(l.unit_price ?? 0))}
                      {Number(l.discount_pct) > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {m(Number(l.list_price))} less {Number(l.discount_pct)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m(lineTotal(Number(l.qty), Number(l.unit_price ?? 0)))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ml-auto w-64 space-y-0.5 text-sm">
              {rate > 0 && (
                <>
                  <p className="flex justify-between text-muted-foreground">
                    Subtotal (excl. VAT) <span className="tabular-nums text-foreground">{m(totals.subtotal)}</span>
                  </p>
                  <p className="flex justify-between text-muted-foreground">
                    {q.prices_include_vat ? `VAT ${rate}% (included)` : `VAT ${rate}%`}{" "}
                    <span className="tabular-nums text-foreground">{m(totals.vat)}</span>
                  </p>
                </>
              )}
              <p className="flex justify-between border-t border-border pt-1 font-medium">
                Total <span className="tabular-nums">{m(totals.total)}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t.client.one} value={quoteClientName(q, detail.storeName)} />
            {q.customer_address && <Row label="Address" value={q.customer_address} />}
            {q.contact_email && <Row label="Email" value={q.contact_email} />}
            {detail.storeName && <Row label={t.site.one} value={detail.storeName} />}
            <Row label={t.staff.one} value={detail.repName ?? `No ${lower(t.staff.one)}`} />
            {q.contact_name && <Row label="Contact" value={q.contact_name} />}
            {q.contact_phone && <Row label="Phone" value={q.contact_phone} />}
            <Row label="Created" value={new Date(q.created_at).toLocaleDateString()} />
            <Row label="Valid until" value={q.valid_until ?? "No end date"} />
            {sells && hasProducts && (
              <Row label="Deliver to" value={q.delivery_address ?? `The ${lower(t.site.one)}`} />
            )}
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
