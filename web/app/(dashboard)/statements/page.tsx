"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatementTable } from "@/components/money/statement-table";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { ExportMenu } from "@/components/export-menu";
import { SendDocumentDialog } from "@/components/send/send-document-dialog";
import { fetchSendSummary, indexSummaries, shortDate, summaryForClient, type SendSummaries } from "@/lib/document-sends";
import {
  downloadStatementPdf,
  fetchAgeing,
  fetchStatement,
  fetchStatementSeller,
  statementSheet,
  type AgeingRow,
  type StatementRow,
} from "@/lib/owed";
import {
  ageingFor,
  balanceState,
  clientKey,
  fetchStatementClients,
  filterClients,
  PERIOD_PRESETS,
  periodFor,
  type PeriodPreset,
  type StatementClientRow,
} from "@/lib/statements";
import { AGEING_COLUMNS } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import { toLocalDateInput } from "@/lib/date-range";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

/** A statement is for one client and one set of dates; an answer is only shown while it still is. */
type Loaded = { key: string; from: string; to: string; rows: StatementRow[]; ageing: AgeingRow | null; error: null };
type Failed = { key: string; from: string; to: string; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Statements: every client the company has invoiced, paid up or not, and a
 * statement for any of them over any period, to download and send.
 *
 * Who owes you lists only the clients with money outstanding. This is the
 * other question: "what did we do with this client in March?"
 */
export default function StatementsPage() {
  const supabase = createClient();
  const t = useTerms();
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const m = (n: number) => formatMoney(n, currency);

  // The days are the viewer's, as Who owes you has them.
  const [today] = useState(() => toLocalDateInput(new Date()));
  const [clients, setClients] = useState<StatementClientRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<StatementClientRow | null>(null);
  const [preset, setPreset] = useState<PeriodPreset | "custom">("last_month");
  const [period, setPeriod] = useState(() => periodFor("last_month", today));
  const [result, setResult] = useState<Loaded | Failed | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SendSummaries | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // When each statement was last sent. A note on each row: if it cannot be read, the rows stay as they were.
  const loadSent = useCallback(async () => {
    try {
      setSent(indexSummaries(await fetchSendSummary(supabase, "statement")));
    } catch {
      setSent(null);
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSent();
  }, [loadSent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchStatementClients(supabase, today);
        if (!cancelled) setClients(r);
      } catch (e) {
        if (!cancelled) setListError(errorText(e));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, today]);

  const key = selected ? clientKey(selected) : null;
  const datesOk = Boolean(period.from) && Boolean(period.to) && period.from <= period.to;

  useEffect(() => {
    if (!selected || !key || !datesOk) return;
    const { from, to } = period;
    let cancelled = false;
    (async () => {
      try {
        const [rows, ageing] = await Promise.all([
          fetchStatement(supabase, { storeId: selected.store_id, name: selected.client_name }, from, to),
          fetchAgeing(supabase, to),
        ]);
        if (!cancelled) setResult({ key, from, to, rows, ageing: ageingFor(ageing, selected), error: null });
      } catch (e) {
        if (!cancelled) setResult({ key, from, to, error: errorText(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selected, key, datesOk, period]);

  // On a phone the list is above the statement: take the person to it.
  useEffect(() => {
    if (key && window.matchMedia("(max-width: 1023px)").matches) {
      detailRef.current?.scrollIntoView({ block: "start" });
    }
  }, [key]);

  const current = result && result.key === key && result.from === period.from && result.to === period.to ? result : null;
  const loaded = current && current.error === null ? current : null;
  const failed = current && current.error !== null ? current.error : null;
  const loading = Boolean(selected) && datesOk && !current;

  const visible = useMemo(() => filterClients(clients, query), [clients, query]);
  const rows = loaded?.rows ?? [];
  const closing = rows.length ? rows[rows.length - 1].balance : 0;
  const quiet = rows.every((r) => r.entry_kind === "opening");
  const ageing = loaded?.ageing ?? null;
  const statementClient = selected ? { storeId: selected.store_id, name: selected.client_name } : null;

  function choosePreset(next: PeriodPreset) {
    setPreset(next);
    setPeriod(periodFor(next, today));
  }

  function changeDate(next: { from?: string; to?: string }) {
    setPreset("custom");
    setPeriod((p) => ({ ...p, ...next }));
  }

  async function statementPdf() {
    if (!statementClient || !loaded) return;
    setPdfBusy(true);
    setActionError(null);
    try {
      const seller = await fetchStatementSeller(supabase);
      await downloadStatementPdf(seller, statementClient, loaded.from, loaded.to, loaded.rows);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Statements</h1>
        <p className="text-sm text-muted-foreground">
          {`Pick a ${lower(t.client.one)} and the dates, and send or download their statement.`}
        </p>
      </div>

      <ErrorBanner message={listError ?? actionError} />

      <SendDocumentDialog
        target={
          sending && selected && loaded
            ? { kind: "statement", clientName: selected.client_name, storeId: selected.store_id, from: loaded.from, to: loaded.to }
            : null
        }
        onClose={() => setSending(false)}
        onSent={loadSent}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section aria-label={t.client.many} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <div className="border-b border-foreground/10 p-3">
            <Label htmlFor="client-search" className="sr-only">
              {`Search ${lower(t.client.many)}`}
            </Label>
            <Input
              id="client-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${lower(t.client.many)}`}
            />
          </div>
          <div className="max-h-72 overflow-y-auto lg:max-h-[70vh]">
            {listLoading && <ListNote>Loading…</ListNote>}
            {!listLoading && clients.length === 0 && (
              <ListNote>
                {listError
                  ? `Could not load your ${lower(t.client.many)}.`
                  : `No invoices yet. Once you issue an invoice, your ${lower(t.client.many)} show up here.`}
              </ListNote>
            )}
            {!listLoading && clients.length > 0 && visible.length === 0 && (
              <ListNote>{`No ${lower(t.client.one)} matches "${query.trim()}".`}</ListNote>
            )}
            <ul className="divide-y divide-foreground/10">
              {visible.map((c) => {
                const k = clientKey(c);
                const state = balanceState(c.balance);
                const lastSent = sent ? summaryForClient(sent, { storeId: c.store_id, name: c.client_name }) : undefined;
                return (
                  <li key={k}>
                    <button
                      type="button"
                      aria-current={k === key ? "true" : undefined}
                      onClick={() => setSelected(c)}
                      className={`flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none ${
                        k === key ? "bg-muted" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{c.client_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {`${c.invoices} invoice${c.invoices === 1 ? "" : "s"} · last activity ${c.last_date}`}
                        </span>
                        {lastSent && (
                          <span className="block text-xs text-muted-foreground">{`Last sent ${shortDate(lastSent.lastSentAt)}`}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {state === "settled" ? (
                          <span className="text-muted-foreground">Paid up</span>
                        ) : (
                          <>
                            <span className="font-medium">{m(c.balance)}</span>
                            {state === "credit" && <span className="block text-xs text-muted-foreground">in credit</span>}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <div ref={detailRef} className="min-w-0 scroll-mt-4">
          {!selected ? (
            <p className="rounded-xl p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
              {`Pick a ${lower(t.client.one)} to see their statement.`}
            </p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selected.client_name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
                    {PERIOD_PRESETS.map((p) => (
                      <Button
                        key={p.key}
                        size="sm"
                        variant={preset === p.key ? "default" : "outline"}
                        aria-pressed={preset === p.key}
                        onClick={() => choosePreset(p.key)}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <Label htmlFor="st-from">From</Label>
                      <Input
                        id="st-from"
                        type="date"
                        value={period.from}
                        max={period.to || undefined}
                        onChange={(e) => changeDate({ from: e.target.value })}
                        className="w-40"
                      />
                    </div>
                    <div>
                      <Label htmlFor="st-to">To</Label>
                      <Input
                        id="st-to"
                        type="date"
                        value={period.to}
                        min={period.from || undefined}
                        onChange={(e) => changeDate({ to: e.target.value })}
                        className="w-40"
                      />
                    </div>
                  </div>
                </div>

                {!datesOk && (
                  <p role="alert" className="text-sm text-destructive">
                    Pick a start date that is on or before the end date.
                  </p>
                )}
                {failed && (
                  <p role="alert" className="text-sm text-destructive">
                    {`Could not load this statement. ${failed}`}
                  </p>
                )}
                {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

                {loaded && statementClient && (
                  <>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{`Balance on ${loaded.to}`}</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{m(closing)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={() => setSending(true)}>
                          <Send className="mr-1.5 h-4 w-4" /> Send to client
                        </Button>
                        <Button variant="outline" disabled={pdfBusy} onClick={statementPdf}>
                          <Download className="mr-1.5 h-4 w-4" />
                          {pdfBusy ? "Preparing…" : "Download PDF"}
                        </Button>
                        <ExportMenu
                          build={() => statementSheet(statementClient, loaded.from, loaded.to, loaded.rows)}
                          disabled={pdfBusy}
                        />
                      </div>
                    </div>

                    {quiet && (
                      <p className="text-sm text-muted-foreground">
                        {`Nothing happened between ${loaded.from} and ${loaded.to}.`}
                      </p>
                    )}
                    {rows.length > 0 && <StatementTable rows={rows} />}

                    <div className="space-y-2 border-t border-foreground/10 pt-4">
                      <h2 className="text-sm font-medium">{`Owing on ${loaded.to}, by days past due`}</h2>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-6">
                        {AGEING_COLUMNS.map((c) => {
                          const v = ageing?.[c.key] ?? 0;
                          return (
                            <AgeingCell key={c.key} label={c.label} value={m(v)} muted={v === 0} loud={c.key === "days_over_90" && v > 0} />
                          );
                        })}
                        <AgeingCell label="Total" value={m(ageing?.total ?? 0)} muted={(ageing?.total ?? 0) === 0} strong />
                      </dl>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ListNote({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function AgeingCell({
  label,
  value,
  muted,
  loud,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  loud?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-sm tabular-nums ${strong ? "font-semibold" : "font-medium"} ${
          loud ? "text-destructive" : muted ? "text-muted-foreground" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
