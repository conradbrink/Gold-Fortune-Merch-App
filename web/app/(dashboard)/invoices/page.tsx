"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Printer, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { exportCsv } from "@/lib/export";
import { fetchSendSummary, indexSummaries, sentCell, type SendSummaries } from "@/lib/document-sends";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import {
  fetchInvoices,
  INVOICE_KIND_LABELS,
  INVOICE_SOURCE_LABELS,
  money,
  PAYMENT_STATUS_LABELS,
  paymentStatus,
  printInvoicePdfs,
  type InvoiceListRow,
} from "@/lib/invoices";
import { tooManyToPrint } from "@/lib/money-pdf";
import { invoiceSources, switchesOf } from "@/lib/money-workflow";
import { moduleEnabled } from "@/lib/modules";
import { lastDayOf, rangeFromQuery } from "@/lib/dashboard-links";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The invoice register.
 *
 * Invoices are made where the work is — from an accepted quote, from completed
 * jobs, typed in ("New invoice"), or from an order that has gone out — so this
 * page is the record: what was issued, what has been credited and paid, and
 * what is still owed.
 */

/** What an invoice was made from, for the second line under its number. */
function sourceNote(r: InvoiceListRow): string {
  // Brought over from QuickBooks: say so, with the order it was for if known.
  if (r.source === "quickbooks") return [INVOICE_SOURCE_LABELS.quickbooks, r.order_number].filter(Boolean).join(" · ");
  if (r.order_number) return r.order_number;
  const kind = INVOICE_KIND_LABELS[r.kind] ?? "";
  const from = r.source === "quote" && r.reference ? r.reference : (INVOICE_SOURCE_LABELS[r.source] ?? "");
  return [kind, from].filter(Boolean).join(" · ");
}
export default function InvoicesPage() {
  const supabase = createClient();
  const terms = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const sw = config ? switchesOf(config.settings) : null;
  const canStart =
    sw !== null && invoiceSources(sw, config!.modules).some((s) => s === "jobs" || s === "direct");
  const sells = config ? moduleEnabled(config.modules, "distribution") : false;
  const [range, setRange] = useState(() => {
    const now = new Date();
    return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: ymd(now) };
  });
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [search, setSearch] = useState("");
  const [pay, setPay] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendSummaries | null>(null);
  /** Invoices ticked to print together. Only those still on screen print, so a filter never prints what it hides. */
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Seeded from the link, so the dashboard's "Invoiced" lands on the same days
  // it added up. The link's `to` is the day after the last (as everywhere the
  // dashboard links), and the boxes here show the last day itself.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = rangeFromQuery(q);
    // Browser-only state, read once on mount as on Orders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (r) setRange({ from: ymd(r.from), to: lastDayOf(r) });
    const p = q.get("pay");
    if (p && (p === "outstanding" || p in PAYMENT_STATUS_LABELS)) setPay(p);
  }, []);

  // When each invoice was last sent. A column of notes: if it cannot be read, it stays blank.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchSendSummary(supabase, "invoice");
        if (!cancelled) setSent(indexSummaries(r));
      } catch {
        if (!cancelled) setSent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchInvoices(supabase, range);
        if (!cancelled) {
          setRows(r);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, range]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = paymentStatus(r, r.balance);
      if (pay === "outstanding" && !(st === "unpaid" || st === "part_paid")) return false;
      if (pay !== "all" && pay !== "outstanding" && st !== pay) return false;
      if (!q) return true;
      return (
        r.invoice_number.toLowerCase().includes(q) ||
        (r.order_number ?? "").toLowerCase().includes(q) ||
        (r.reference ?? "").toLowerCase().includes(q) ||
        (r.customer_po_number ?? "").toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q)
      );
    });
  }, [rows, search, pay]);

  const totals = useMemo(() => {
    let issued = 0;
    let outstanding = 0;
    let overdue = 0;
    const today = ymd(new Date());
    for (const r of rows) {
      if (r.status === "void") continue;
      issued += Number(r.total);
      const o = Number(r.balance?.outstanding ?? 0);
      outstanding += o;
      if (o > 0 && r.due_date < today) overdue += o;
    }
    return { issued, outstanding, overdue };
  }, [rows]);

  function exportRows() {
    void exportCsv({
      title: "Invoices",
      context: [`Issued ${range.from} to ${range.to}`],
      filename: "invoices",
      letterhead: false,
      columns: [
        { header: "Invoice", key: "inv" },
        { header: "Date", key: "date" },
        { header: "Due", key: "due" },
        { header: terms.client.one, key: "customer" },
        { header: "Made from", key: "order" },
        { header: "Excl. VAT", key: "sub", numeric: true },
        { header: "VAT", key: "vat", numeric: true },
        { header: "Total", key: "total", numeric: true },
        { header: "Credited", key: "credited", numeric: true },
        { header: "Paid", key: "paid", numeric: true },
        { header: "Outstanding", key: "out", numeric: true },
        { header: "Status", key: "status" },
      ],
      rows: visible.map((r) => ({
        inv: r.invoice_number,
        date: r.issue_date,
        due: r.due_date,
        customer: r.customer_name,
        order: sourceNote(r),
        sub: Number(r.subtotal).toFixed(2),
        vat: Number(r.vat).toFixed(2),
        total: Number(r.total).toFixed(2),
        credited: Number(r.balance?.credited ?? 0).toFixed(2),
        paid: Number(r.balance?.paid ?? 0).toFixed(2),
        out: Number(r.balance?.outstanding ?? 0).toFixed(2),
        status: PAYMENT_STATUS_LABELS[paymentStatus(r, r.balance)],
      })),
    });
  }

  const today = ymd(new Date());
  const tickedRows = visible.filter((r) => ticked.has(r.id));
  const allTicked = visible.length > 0 && tickedRows.length === visible.length;

  // Ticks and unticks only these: a filter's hidden ticks stay as they were.
  function tick(ids: string[], on: boolean) {
    setTicked((t) => {
      const next = new Set(t);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function printTicked() {
    // Said here, before a print tab opens only to close again.
    const tooMany = tooManyToPrint(tickedRows.length);
    if (tooMany) {
      setError(tooMany);
      return;
    }
    setError(null);
    printInvoicePdfs(supabase, tickedRows).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Corrected with credit notes, never edited.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportRows}>
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          {sw?.jobs && (
            <Button variant="outline" nativeButton={false} render={<Link href="/invoices/unbilled" />}>
              Unbilled work
            </Button>
          )}
          {canStart && (
            <Button nativeButton={false} render={<Link href="/invoices/new" />}>
              <Plus className="mr-1.5 h-4 w-4" /> New invoice
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Issued in period" value={money(totals.issued)} />
        <Tile label="Outstanding" value={money(totals.outstanding)} />
        <Tile label="Overdue" value={money(totals.overdue)} loud={totals.overdue > 0} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Invoice, reference, PO or ${lower(terms.client.one)}`}
            className="pl-8"
            aria-label="Search invoices"
          />
        </div>
        <NativeSelect value={pay} onChange={(e) => setPay(e.target.value)} className="w-44" aria-label="Payment">
          <option value="all">All</option>
          <option value="outstanding">Outstanding</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-40" aria-label="From" />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-40" aria-label="To" />
      </div>

      {/* What the ticks are for: every ticked invoice in one PDF, one print box. */}
      {tickedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <p className="mr-auto text-sm">
            {tickedRows.length === 1 ? "1 invoice ticked" : `${tickedRows.length} invoices ticked`}
          </p>
          <Button size="sm" onClick={printTicked}>
            <Printer className="mr-1.5 h-4 w-4" /> {tickedRows.length === 1 ? "Print it" : `Print all ${tickedRows.length}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {visible.length > 0 && (
                  <Checkbox
                    checked={allTicked}
                    aria-label="Tick every invoice shown"
                    onCheckedChange={(v) => tick(visible.map((r) => r.id), v === true)}
                  />
                )}
              </TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>{terms.client.one}</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={9}>Loading…</EmptyRow>}
            {!loading && visible.length === 0 && (
              <EmptyRow colSpan={9}>
                {rows.length === 0 ? (
                  sells && !canStart ? (
                    <>
                      No invoices in this period. Open an order that has gone out (Dispatched on the{" "}
                      <Link href="/orders" className="text-primary hover:underline">orders board</Link>, or
                      delivered in the{" "}
                      <Link href="/orders/archive" className="text-primary hover:underline">archive</Link>) and
                      choose Issue tax invoice.
                    </>
                  ) : (
                    "No invoices in this period."
                  )
                ) : (
                  "No invoices match."
                )}
              </EmptyRow>
            )}
            {visible.map((r) => {
              const st = paymentStatus(r, r.balance);
              const out = Number(r.balance?.outstanding ?? 0);
              const overdue = out > 0 && r.due_date < today;
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${r.id}`)}>
                  {/* Ticking is not opening: the click stays in the cell. */}
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={ticked.has(r.id)}
                      aria-label={`Tick ${r.invoice_number}`}
                      onCheckedChange={(v) => tick([r.id], v === true)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/invoices/${r.id}`} className="text-primary hover:underline">
                      {r.invoice_number}
                    </Link>
                    <div className="text-xs text-muted-foreground">{sourceNote(r)}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.issue_date}</TableCell>
                  <TableCell>{r.customer_name}</TableCell>
                  <TableCell className={overdue ? "whitespace-nowrap text-destructive" : "whitespace-nowrap text-muted-foreground"}>
                    {r.due_date}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(Number(r.total))}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(out)}</TableCell>
                  <TableCell>
                    <Badge variant={st === "void" || overdue ? "destructive" : st === "paid" ? "outline" : "secondary"}>
                      {overdue && st !== "void" ? "Overdue" : PAYMENT_STATUS_LABELS[st]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    <SentCell cell={sentCell(sent?.byDocument.get(r.id))} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** When it was last emailed to the client; blank if it never was. */
function SentCell({ cell }: { cell: ReturnType<typeof sentCell> }) {
  if (!cell) return null;
  return (
    <span className="text-sm text-muted-foreground">
      {cell.date}
      {cell.opened && <span className="text-foreground">{" · Opened"}</span>}
      {cell.problem && <span className="text-destructive">{" · Not delivered"}</span>}
    </span>
  );
}

function Tile({ label, value, loud }: { label: string; value: string; loud?: boolean }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={loud ? "mt-1 text-xl font-semibold tabular-nums text-destructive" : "mt-1 text-xl font-semibold tabular-nums"}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
