"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { BillToPicker, billToProblem, type BillTo } from "@/components/money/bill-to-picker";
import { blankLine, LineEditor, lineProblem, type EditableLine } from "@/components/money/line-editor";
import { fetchStoresForOrder } from "@/lib/orders";
import { fetchServiceItems, type ServiceItem } from "@/lib/service-items";
import { fetchDocumentSettings, type DocumentSettings } from "@/lib/document-settings";
import { issueDirectInvoice, issueInvoiceForVisits, type NewInvoiceLine } from "@/lib/invoices";
import { fetchQuotes, type QuoteListRow } from "@/lib/quotes";
import { invoiceSources, type InvoiceSource } from "@/lib/money-workflow";
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/money-docs";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import type { Database } from "@/lib/supabase/types";

type Unbilled = Database["public"]["Functions"]["unbilled_visits"]["Returns"][number];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last month, first to last day: the usual period for invoicing completed work. */
function lastMonth(today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: ymd(first), to: ymd(last) };
}

const toInvoiceLines = (lines: EditableLine[]): NewInvoiceLine[] =>
  lines.map((l) => ({
    description: l.description.trim(),
    qty: Number(l.qty),
    unitPrice: Number(l.price),
    unit: l.unit.trim() || null,
    serviceItemId: l.serviceItemId,
  }));

/**
 * Starting an invoice, the ways the company's settings allow (lib/money-workflow):
 *
 *   completed work — a place and a period, the finished jobs not yet invoiced,
 *                    and the lines to charge for them (from the price list, the
 *                    time on site, or typed). The jobs are remembered so none
 *                    is invoiced twice.
 *   direct         — typed in, for a place on the books or anyone else.
 *   a quote        — the accepted quotes waiting to be invoiced; invoicing
 *                    happens on the quote, where deposits are offered.
 *
 * An order is invoiced from the order once it has gone out.
 */
export default function NewInvoicePage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const currency = config?.settings.currency_code ?? "";

  const sources = useMemo<InvoiceSource[]>(
    () =>
      config
        ? invoiceSources(
            {
              quotes: config.settings.money_quotes,
              deposits: config.settings.money_deposits,
              jobs: config.settings.money_invoice_from_jobs,
              direct: config.settings.money_invoice_direct,
            },
            config.modules
          )
        : [],
    [config]
  );
  const [chosen, setChosen] = useState<InvoiceSource | null>(null);
  const source = chosen ?? sources.find((s) => s !== "order") ?? null;

  const [doc, setDoc] = useState<DocumentSettings | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; address: string | null; city: string | null }[]>([]);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Completed work.
  const [storeId, setStoreId] = useState("");
  const [range, setRange] = useState(lastMonth);
  const [unbilled, setUnbilled] = useState<Unbilled[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [jobLines, setJobLines] = useState<EditableLine[]>([]);
  // Direct.
  const [billTo, setBillTo] = useState<BillTo>({ mode: "new", storeId: "", name: "", email: "", address: "" });
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [reference, setReference] = useState("");
  const [issueDate, setIssueDate] = useState(() => ymd(new Date()));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, s, si, q] = await Promise.all([
          fetchDocumentSettings(supabase),
          fetchStoresForOrder(supabase),
          fetchServiceItems(supabase, { activeOnly: true }),
          fetchQuotes(supabase),
        ]);
        if (cancelled) return;
        setDoc(d);
        setStores(s);
        setItems(si);
        setQuotes(q.filter((x) => x.status === "accepted"));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // The finished jobs at the chosen place in the period, not yet invoiced.
  const jobsWord = t.job.many;
  const jobWord = lower(t.job.one);
  useEffect(() => {
    if (source !== "jobs" || !storeId) return;
    let cancelled = false;
    // Nothing from the previous place or period stays ticked while this one
    // loads, or if it fails: an invoice must only ever cover what is on screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnbilled([]);
    setPicked(new Set());
    (async () => {
      try {
        const { data, error: e } = await supabase.rpc("unbilled_visits", {
          p_store_id: storeId,
          p_from: range.from,
          p_to: range.to,
        });
        if (e) throw new Error(e.message);
        if (cancelled) return;
        const rows = (data ?? []) as Unbilled[];
        setUnbilled(rows);
        setPicked(new Set(rows.map((r) => r.visit_id)));
        // One line to start from: the jobs themselves, priced from the price
        // list if it has a per-job item. The office changes it as it needs.
        setJobLines((prev) =>
          prev.length > 0
            ? prev
            : [{ ...blankLine(), description: jobsWord, unit: jobWord, qty: String(rows.length || 1) }]
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, source, storeId, range, jobsWord, jobWord]);

  const pickedRows = unbilled.filter((r) => picked.has(r.visit_id));
  const pickedMinutes = pickedRows.reduce((n, r) => n + (r.minutes ?? 0), 0);
  const vatRate = Number(doc?.vat_rate ?? 0);
  const inclusive = doc?.prices_include_vat ?? false;

  async function issue() {
    setError(null);
    if (!source || source === "quote" || source === "order") return;
    const editable = source === "jobs" ? jobLines : lines;
    if (source === "jobs") {
      if (!storeId) return setError(`Choose the ${lower(t.site.one)}.`);
      if (pickedRows.length === 0) return setError(`Tick at least one finished ${lower(t.job.one)}.`);
    } else {
      const who = billToProblem(billTo, t);
      if (who) return setError(who);
    }
    const problem = lineProblem(editable);
    if (problem) return setError(problem);
    if (!window.confirm("Issue this invoice? An issued invoice cannot be edited, only voided or credited.")) return;
    setBusy(true);
    try {
      const id =
        source === "jobs"
          ? await issueInvoiceForVisits(supabase, {
              visitIds: pickedRows.map((r) => r.visit_id),
              lines: toInvoiceLines(editable),
              issueDate,
              reference: reference.trim() || null,
            })
          : await issueDirectInvoice(supabase, {
              billTo:
                billTo.mode === "store"
                  ? { storeId: billTo.storeId }
                  : { name: billTo.name, email: billTo.email, address: billTo.address },
              lines: toInvoiceLines(editable),
              issueDate,
              reference: reference.trim() || null,
            });
      router.push(`/invoices/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const labels: Record<InvoiceSource, string> = {
    jobs: `Invoice completed ${lower(t.job.many)}`,
    direct: "Type an invoice",
    quote: "From an accepted quote",
    order: "From an order",
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
          ← Invoices
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">New invoice</h1>
      </div>

      <ErrorBanner message={error} />

      {config && sources.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Invoicing is switched off in this company&apos;s settings (Settings → Company → How you get paid).
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {sources.map((s) => (
          <Button key={s} variant={s === source ? "default" : "outline"} onClick={() => setChosen(s)}>
            {labels[s]}
          </Button>
        ))}
      </div>

      {source === "order" && (
        <p className="text-sm text-muted-foreground">
          Open an order that has gone out and choose{" "}
          <Link href="/orders" className="text-primary hover:underline">
            Issue tax invoice
          </Link>
          .
        </p>
      )}

      {source === "quote" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accepted quotes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {quotes.length === 0 ? (
              <p className="text-muted-foreground">
                No accepted quotes. Mark a quote accepted, then invoice it from the quote.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <Link href={`/quotes/${q.id}`} className="font-medium text-primary hover:underline">
                      {q.quote_number}
                    </Link>
                    <span className="flex-1 truncate text-muted-foreground">{q.client_name}</span>
                    <span className="tabular-nums">{formatMoney(q.total_incl_vat, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {source === "jobs" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{`Which ${lower(t.job.many)}`}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label htmlFor="job-store">{t.site.one}</Label>
                  <NativeSelect
                    id="job-store"
                    value={storeId}
                    disabled={loading}
                    onChange={(e) => {
                      setStoreId(e.target.value);
                      setUnbilled([]);
                      setJobLines([]);
                    }}
                  >
                    <option value="">{`Choose the ${lower(t.site.one)}…`}</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.city ? ` — ${s.city}` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <Label htmlFor="job-from">From</Label>
                  <Input id="job-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="job-to">To</Label>
                  <Input id="job-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
                </div>
              </div>
              {storeId && unbilled.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {`No finished ${lower(t.job.many)} waiting to be invoiced here in these dates.`}
                </p>
              )}
              {unbilled.length > 0 && (
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={picked.size === unbilled.length}
                      onChange={(e) =>
                        setPicked(e.target.checked ? new Set(unbilled.map((r) => r.visit_id)) : new Set())
                      }
                    />
                    {`All ${unbilled.length} (${pickedRows.length} ticked, ${Math.round(pickedMinutes / 6) / 10} hours on site)`}
                  </label>
                  <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {unbilled.map((r) => (
                      <li key={r.visit_id} className="flex items-center gap-3 px-3 py-1.5">
                        <input
                          type="checkbox"
                          aria-label="Include"
                          checked={picked.has(r.visit_id)}
                          onChange={(e) =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(r.visit_id);
                              else next.delete(r.visit_id);
                              return next;
                            })
                          }
                        />
                        <span className="w-44 text-muted-foreground">
                          {r.checkin_at ? new Date(r.checkin_at).toLocaleString() : "—"}
                        </span>
                        <span className="flex-1 truncate">{r.staff_name ?? "—"}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {r.minutes !== null ? `${formatQty(r.minutes)} min` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pickedMinutes > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setJobLines((prev) => [
                          ...prev,
                          {
                            ...blankLine(items.find((i) => i.unit.toLowerCase().startsWith("hour")) ?? null),
                            qty: String(Math.round((pickedMinutes / 60) * 100) / 100),
                          },
                        ])
                      }
                    >
                      Add a line for the time on site
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          {storeId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What to charge</CardTitle>
              </CardHeader>
              <CardContent>
                <LineEditor
                  lines={jobLines}
                  onChange={setJobLines}
                  items={items}
                  currency={currency}
                  vatRate={vatRate}
                  pricesIncludeVat={inclusive}
                  disabled={busy}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {source === "direct" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.client.one}</CardTitle>
            </CardHeader>
            <CardContent>
              <BillToPicker value={billTo} onChange={setBillTo} stores={stores} disabled={loading} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lines</CardTitle>
            </CardHeader>
            <CardContent>
              <LineEditor
                lines={lines}
                onChange={setLines}
                items={items}
                currency={currency}
                vatRate={vatRate}
                pricesIncludeVat={inclusive}
                disabled={busy}
              />
            </CardContent>
          </Card>
        </>
      )}

      {(source === "jobs" || source === "direct") && (
        <Card>
          <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
            <div>
              <Label htmlFor="inv-date">Invoice date</Label>
              <Input id="inv-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="inv-ref">Reference</Label>
              <Input
                id="inv-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={`The ${lower(t.client.one)}'s order number, if they gave one`}
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-3">
              <Button variant="outline" nativeButton={false} render={<Link href="/invoices" />}>
                Cancel
              </Button>
              <Button onClick={issue} disabled={busy || loading}>
                {busy ? "Issuing…" : "Issue invoice"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
