"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, Send, Trash2 } from "lucide-react";
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
import { SendDocumentDialog } from "@/components/send/send-document-dialog";
import { SentLines } from "@/components/send/sent-lines";
import { fetchSendsFor, type SendRow } from "@/lib/document-sends";
import {
  deletePayment,
  downloadCreditNotePdf,
  downloadInvoicePdf,
  downloadProofOfServicePdf,
  fetchInvoice,
  fetchProofOfService,
  INVOICE_KIND_LABELS,
  invoicePeriod,
  invoiceHeading,
  issueCreditNote,
  money,
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABELS,
  paymentStatus,
  recordPayment,
  voidInvoice,
  type InvoiceDetail,
  type ProofRow,
} from "@/lib/invoices";
import { formatQty, validQty } from "@/lib/money-docs";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One invoice. Nothing on it can be edited — the panels below add to it (a
 * payment, a credit note) or void it, and the database decides whether each is
 * allowed. It says what it was made from: an order, a quote, completed jobs,
 * or nothing (typed in).
 */
export default function InvoiceDetailPage() {
  const supabase = createClient();
  const t = useTerms();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [proof, setProof] = useState<ProofRow[] | null>(null);
  const [panel, setPanel] = useState<"pay" | "credit" | "void" | null>(null);
  const [sending, setSending] = useState(false);
  const [sends, setSends] = useState<SendRow[]>([]);
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
      const d = await fetchInvoice(supabase, id);
      setDetail(d);
      // The jobs behind it, for an invoice made from work or a contract.
      setProof(d.invoice.source === "jobs" || d.invoice.source === "contract" ? await fetchProofOfService(supabase, id) : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Where it has been sent. Only a note under the header: if it cannot be read, the page goes on without it.
  const loadSends = useCallback(async () => {
    try {
      setSends(await fetchSendsFor(supabase, "invoice", id));
    } catch {
      setSends([]);
    }
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSends();
  }, [loadSends]);

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
    for (const l of c.lines) creditedQty.set(l.invoice_line_id, (creditedQty.get(l.invoice_line_id) ?? 0) + Number(l.qty));
  const rate = Number(inv.vat_rate);
  const kind = INVOICE_KIND_LABELS[inv.kind] ?? "";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
            ← Invoices
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{inv.invoice_number}</h1>
            <Badge variant={st === "void" ? "destructive" : st === "paid" ? "outline" : "secondary"}>
              {PAYMENT_STATUS_LABELS[st]}
            </Badge>
            {kind && <Badge variant="outline">{kind}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {invoiceHeading(inv) === "TAX INVOICE" ? "Tax invoice" : "Invoice"} for {inv.customer_name} · issued{" "}
            {inv.issue_date} · due {inv.due_date}
            {inv.order_id && (
              <>
                {" "}· order{" "}
                <Link href={`/orders/${inv.order_id}`} className="text-primary hover:underline">
                  {inv.order_number}
                </Link>
              </>
            )}
            {inv.quote_id && (
              <>
                {" "}· quote{" "}
                <Link href={`/quotes/${inv.quote_id}`} className="text-primary hover:underline">
                  {inv.reference ?? "—"}
                </Link>
              </>
            )}
            {!inv.order_id && !inv.quote_id && inv.reference && ` · reference ${inv.reference}`}
            {invoicePeriod(inv) && ` · for ${invoicePeriod(inv)}`}
            {detail.contract && (
              <>
                {" "}· contract{" "}
                <Link href={`/contracts/${detail.contract.id}`} className="text-primary hover:underline">
                  {detail.contract.name}
                </Link>
              </>
            )}
          </p>
          <div className="mt-1.5">
            <SentLines rows={sends} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <Button onClick={() => setSending(true)}>
              <Send className="mr-1.5 h-4 w-4" /> Send to client
            </Button>
          )}
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

      <SendDocumentDialog
        target={
          sending
            ? {
                kind: "invoice",
                id: inv.id,
                number: inv.invoice_number,
                clientName: inv.customer_name,
                storeId: inv.store_id,
                email: inv.customer_email,
              }
            : null
        }
        onClose={() => setSending(false)}
        onSent={loadSends}
      />

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
              <Input id="creason" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Price corrected, work not done, returned…" />
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
                  const qty = Number(l.qty);
                  // A deduction (a deposit taken off a final invoice) cannot be credited.
                  const creditable = Number(l.unit_price) >= 0 && done < qty;
                  return (
                    <TableRow key={l.id}>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(done)}</TableCell>
                      <TableCell className="text-right">
                        <Input type="number" min={0} step="0.01" max={qty - done} disabled={!creditable}
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
                if (Object.values(creditQty).some((q) => q.trim() !== "" && Number(q) !== 0 && !validQty(q))) {
                  throw new Error("A quantity is more than zero, to two decimals.");
                }
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
              A void invoice stays in the register, marked void, and what it was made from (the order,
              the quote or the {lower(t.job.many)}) can be invoiced again. Use this only for an invoice
              that should never have been issued.
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
                    <TableCell className="text-right tabular-nums">
                      {formatQty(Number(l.qty))}
                      {l.unit && <span className="text-muted-foreground"> {l.unit}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(l.unit_price))}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(l.line_total))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ml-auto w-60 space-y-0.5 text-sm">
              {rate > 0 && <Line k="Subtotal (excl. VAT)" v={money(Number(inv.subtotal))} />}
              {rate > 0 && (
                <Line k={inv.prices_include_vat ? `VAT ${rate}% (included)` : `VAT ${rate}%`} v={money(Number(inv.vat))} />
              )}
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

      {proof && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Proof of service</CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={proof.length === 0}
              onClick={() =>
                downloadProofOfServicePdf(detail, proof, {
                  job: lower(t.job.one),
                  jobs: t.job.many,
                  staff: t.staff.one,
                })
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" /> PDF
            </Button>
          </CardHeader>
          <CardContent>
            {proof.length === 0 ? (
              <p className="text-sm text-muted-foreground">{`No ${lower(t.job.many)} recorded for this invoice.`}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>{t.staff.one}</TableHead>
                    <TableHead className="text-right">On site</TableHead>
                    <TableHead>GPS</TableHead>
                    <TableHead className="text-right">Forms</TableHead>
                    <TableHead className="text-right">Photos</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proof.map((r, n) => (
                    <TableRow key={r.visit_id ?? `planned-${n}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{r.day}</TableCell>
                      <TableCell>{r.staff_name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.minutes === null ? "" : `${r.minutes} min`}</TableCell>
                      <TableCell>{r.gps_ok === null ? "" : r.gps_ok ? "On site" : "Away"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.forms ?? ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.photos ?? ""}</TableCell>
                      <TableCell className={r.status === "missed" ? "text-destructive" : "text-muted-foreground"}>
                        {r.status === "done" ? "" : r.status === "caught_up" ? "Caught up later" : "Missed"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

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
