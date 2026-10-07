"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  deletePayment,
  downloadCreditNotePdf,
  downloadInvoicePdf,
  fetchInvoice,
  issueCreditNote,
  money,
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABELS,
  paymentStatus,
  recordPayment,
  voidInvoice,
  type InvoiceDetail,
} from "@/lib/invoices";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One tax invoice. Nothing on it can be edited — the panels below add to it
 * (a payment, a credit note) or void it, and the database decides whether
 * each is allowed.
 */
export default function InvoiceDetailPage() {
  const supabase = createClient();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [panel, setPanel] = useState<"pay" | "credit" | "void" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(today);
  const [payMethod, setPayMethod] = useState("eft");
  const [payRef, setPayRef] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditQty, setCreditQty] = useState<Record<string, string>>({});
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    try {
      setDetail(await fetchInvoice(supabase, id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPanel(null);
      await load();
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

  const inv = detail.invoice;
  const st = paymentStatus(inv, detail.balance);
  const outstanding = Number(detail.balance?.outstanding ?? 0);
  const live = inv.status === "issued";
  const creditedQty = new Map<string, number>();
  for (const c of detail.credits)
    for (const l of c.lines) creditedQty.set(l.invoice_line_id, (creditedQty.get(l.invoice_line_id) ?? 0) + l.qty);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
            ← Tax invoices
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{inv.invoice_number}</h1>
            <Badge variant={st === "void" ? "destructive" : st === "paid" ? "outline" : "secondary"}>
              {PAYMENT_STATUS_LABELS[st]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {inv.customer_name} · issued {inv.issue_date} · due {inv.due_date} · order{" "}
            <Link href={`/orders/${inv.order_id}`} className="text-primary hover:underline">
              {inv.order_number}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadInvoicePdf(detail)}>
            <Download className="mr-1.5 h-4 w-4" /> PDF
          </Button>
          {live && outstanding > 0 && (
            <Button variant="outline" onClick={() => { setPayAmount(outstanding.toFixed(2)); setPanel("pay"); }}>
              Record payment
            </Button>
          )}
          {live && (
            <Button variant="outline" onClick={() => setPanel("credit")}>
              Credit note
            </Button>
          )}
          {live && detail.payments.length === 0 && detail.credits.length === 0 && (
            <Button variant="ghost" onClick={() => setPanel("void")}>
              Void
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />

      {inv.status === "void" && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Void on {inv.voided_at ? new Date(inv.voided_at).toLocaleDateString() : "—"}: {inv.void_reason}
        </p>
      )}

      {panel === "pay" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Record a payment</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" type="number" min={0} step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pdate">Paid on</Label>
              <Input id="pdate" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pmethod">Method</Label>
              <NativeSelect id="pmethod" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="pref">Reference</Label>
              <Input id="pref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank reference" />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-4">
              <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
              <Button disabled={busy} onClick={() => run(() => recordPayment(supabase, {
                invoiceId: inv.id, amount: Number(payAmount), paidOn: payDate, method: payMethod, reference: payRef,
              }))}>
                Save payment
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {panel === "credit" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Credit note</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="creason">Reason</Label>
              <Input id="creason" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Damaged in delivery, price corrected, returned…" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Already credited</TableHead>
                  <TableHead className="w-32 text-right">Credit qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((l) => {
                  const done = creditedQty.get(l.id) ?? 0;
                  return (
                    <TableRow key={l.id}>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{done}</TableCell>
                      <TableCell className="text-right">
                        <Input type="number" min={0} max={l.qty - done} disabled={done >= l.qty}
                          value={creditQty[l.id] ?? ""} placeholder="0" className="ml-auto w-24 text-right"
                          onChange={(e) => setCreditQty((p) => ({ ...p, [l.id]: e.target.value }))}
                          aria-label={`Credit quantity for ${l.description}`} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
              <Button disabled={busy} onClick={() => run(async () => {
                await issueCreditNote(supabase, inv.id, creditReason,
                  Object.entries(creditQty)
                    .map(([invoiceLineId, q]) => ({ invoiceLineId, qty: Number(q) || 0 }))
                    .filter((l) => l.qty > 0));
                setCreditQty({});
                setCreditReason("");
              })}>
                Issue credit note
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {panel === "void" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Void {inv.invoice_number}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A void invoice stays in the register, marked void, and the order can be invoiced again.
              Use this only for an invoice that should never have been issued.
            </p>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why it is being voided" aria-label="Reason" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
              <Button variant="destructive" disabled={busy} onClick={() => run(() => voidInvoice(supabase, inv.id, voidReason))}>
                Void invoice
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_17rem]">
        <Card>
          <CardHeader><CardTitle className="text-base">Lines</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.description}
                      {l.sku && <span className="ml-1 font-mono text-xs text-muted-foreground">{l.sku}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(l.unit_price))}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(l.line_total))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ml-auto w-60 space-y-0.5 text-sm">
              <Line k="Subtotal" v={money(Number(inv.subtotal))} />
              <Line k={`VAT ${Number(inv.vat_rate)}%`} v={money(Number(inv.vat))} />
              <Line k="Total" v={money(Number(inv.total))} strong />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Balance</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Line k="Invoiced" v={money(Number(inv.total))} />
            <Line k="Credited" v={`− ${money(Number(detail.balance?.credited ?? 0))}`} />
            <Line k="Paid" v={`− ${money(Number(detail.balance?.paid ?? 0))}`} />
            <Line k="Outstanding" v={money(outstanding)} strong />
          </CardContent>
        </Card>
      </div>

      {detail.credits.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Credit notes</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {detail.credits.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.credit_number}</TableCell>
                    <TableCell className="text-muted-foreground">{c.issue_date}</TableCell>
                    <TableCell>{c.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(c.total))}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => downloadCreditNotePdf(detail, c)}>
                        <Download className="mr-1 h-3.5 w-3.5" /> PDF
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {detail.payments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {detail.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{p.paid_on}</TableCell>
                    <TableCell>{PAYMENT_METHODS[p.method] ?? p.method}</TableCell>
                    <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(p.amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" aria-label="Remove payment" disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove the payment of ${money(Number(p.amount))}?`))
                            run(() => deletePayment(supabase, p.id));
                        }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <p className={strong ? "flex justify-between border-t border-border pt-1 font-medium" : "flex justify-between text-muted-foreground"}>
      {k} <span className={strong ? "tabular-nums" : "tabular-nums text-foreground"}>{v}</span>
    </p>
  );
}
