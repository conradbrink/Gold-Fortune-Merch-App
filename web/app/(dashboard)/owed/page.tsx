"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatementTable } from "@/components/money/statement-table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { ExportMenu } from "@/components/export-menu";
import {
  ageingTotals,
  downloadStatementPdf,
  fetchAgeing,
  fetchStatement,
  fetchStatementSeller,
  statementSheet,
  type AgeingRow,
  type StatementRow,
} from "@/lib/owed";
import { AGEING_COLUMNS } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Who owes you: every client with money outstanding, by how long it has been
 * due, as at a date — and each one's statement, to download and send.
 *
 * "Not yet due" is money invoiced but inside its payment terms; the other
 * columns are days past the due date. An earlier as-at date shows the book as
 * it stood then: payments and credits after it do not count.
 */
export default function OwedPage() {
  const supabase = createClient();
  const t = useTerms();
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const m = (n: number) => formatMoney(n, currency);

  const [asOf, setAsOf] = useState(() => ymd(new Date()));
  const [rows, setRows] = useState<AgeingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [client, setClient] = useState<AgeingRow | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return ymd(new Date(d.getFullYear(), d.getMonth() - 2, 1));
  });
  // A statement is for the dates it was asked for: changing either date
  // clears it, and an answer that arrives after a newer request is dropped.
  const [statement, setStatement] = useState<{ rows: StatementRow[]; from: string; to: string } | null>(null);
  const statementSeq = useRef(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The balances belong to their date: nothing from the previous date stays
    // on screen while this one loads, or after it fails.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([]);
    setLoading(true);
    (async () => {
      try {
        const r = await fetchAgeing(supabase, asOf);
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
  }, [supabase, asOf]);

  const totals = ageingTotals(rows);
  const statementClient = client ? { storeId: client.store_id, name: client.client_name } : null;

  async function openStatement(row: AgeingRow) {
    const n = ++statementSeq.current;
    const range = { from, to: asOf };
    setClient(row);
    setStatement(null);
    setBusy(true);
    setError(null);
    try {
      const rows = await fetchStatement(supabase, { storeId: row.store_id, name: row.client_name }, range.from, range.to);
      if (n === statementSeq.current) setStatement({ rows, ...range });
    } catch (e) {
      if (n === statementSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === statementSeq.current) setBusy(false);
    }
  }

  function changeDates(next: { from?: string; asOf?: string }) {
    statementSeq.current += 1;
    setStatement(null);
    setBusy(false);
    if (next.from !== undefined) setFrom(next.from);
    if (next.asOf !== undefined) setAsOf(next.asOf);
  }

  async function statementPdf() {
    if (!statementClient || !statement) return;
    setBusy(true);
    try {
      const seller = await fetchStatementSeller(supabase);
      await downloadStatementPdf(seller, statementClient, statement.from, statement.to, statement.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Who owes you</h1>
          <p className="text-sm text-muted-foreground">
            {`Every ${lower(t.client.one)} with money outstanding, by how long it has been due.`}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <Link href="/statements" className="pb-2 text-sm text-primary hover:underline">
            All statements
          </Link>
          <div>
            <Label htmlFor="as-of">As at</Label>
            <Input id="as-of" type="date" value={asOf} onChange={(e) => changeDates({ asOf: e.target.value })} className="w-40" />
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Outstanding" value={m(totals.total)} />
        <Tile label="Overdue" value={m(totals.total - totals.not_due)} loud={totals.total - totals.not_due > 0} />
        <Tile label="Over 90 days" value={m(totals.days_over_90)} loud={totals.days_over_90 > 0} />
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.client.one}</TableHead>
              {AGEING_COLUMNS.map((c) => (
                <TableHead key={c.key} className="text-right">
                  {c.label}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
            {!loading && rows.length === 0 && (
              <EmptyRow colSpan={8}>
                {error ? "Could not load the balances for this date." : "Nobody owes you anything as at this date."}
              </EmptyRow>
            )}
            {rows.map((r) => (
              <TableRow key={`${r.store_id ?? ""}|${r.client_name}`}>
                <TableCell>
                  <span className="font-medium">{r.client_name}</span>
                  <div className="text-xs text-muted-foreground">
                    {r.invoices} invoice{r.invoices === 1 ? "" : "s"}
                    {r.last_paid_on && ` · last paid ${r.last_paid_on}`}
                  </div>
                </TableCell>
                {AGEING_COLUMNS.map((c) => (
                  <TableCell
                    key={c.key}
                    className={`text-right tabular-nums ${c.key !== "not_due" && r[c.key] > 0 ? "text-destructive" : ""}`}
                  >
                    {r[c.key] > 0 ? m(r[c.key]) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">{m(r.total)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => openStatement(r)}>
                    Statement
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length > 0 && (
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                {AGEING_COLUMNS.map((c) => (
                  <TableCell key={c.key} className="text-right tabular-nums">
                    {m(totals[c.key])}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{m(totals.total)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {client && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{`Statement — ${client.client_name}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="st-from">From</Label>
                <Input id="st-from" type="date" value={from} onChange={(e) => changeDates({ from: e.target.value })} className="w-40" />
              </div>
              <p className="pb-2 text-sm text-muted-foreground">to {asOf}</p>
              <Button variant="outline" disabled={busy} onClick={() => openStatement(client)}>
                Refresh
              </Button>
              <Button variant="outline" disabled={busy || !statement} onClick={statementPdf}>
                <Download className="mr-1.5 h-4 w-4" /> PDF
              </Button>
              {statement && statementClient && (
                <ExportMenu
                  build={() => statementSheet(statementClient, statement.from, statement.to, statement.rows)}
                  disabled={busy}
                />
              )}
            </div>
            {statement && <StatementTable rows={statement.rows} />}
          </CardContent>
        </Card>
      )}
    </div>
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
