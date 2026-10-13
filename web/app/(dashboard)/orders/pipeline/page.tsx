"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExportMenu } from "@/components/export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DetailHeader,
  FigureStrip,
  FilterChip,
  InsightPanel,
  ListTools,
  SortHead,
  TilePicker,
  TopCard,
  type SortState,
  type Tile,
} from "@/components/dashboard/detail-page";
import {
  commissionsHref,
  invoicesHref,
  lowStockHref,
  quotesHref,
  rangeFromQuery,
  rangeQuery,
  recurringDueHref,
} from "@/lib/dashboard-links";
import { fetchBusinessSummary, type BusinessSummary } from "@/lib/dashboard";
import { rangeForPreset, toLocalDate, toLocalDateInput, type DateRange } from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  STAGE_NEXT,
  WAIT_BANDS,
  WAIT_LABELS,
  daysWaiting,
  describeWait,
  fetchPipelineOrders,
  stageFromQuery,
  stagesInView,
  waitBand,
  type PipelineOrder,
  type PipelineStage,
} from "@/lib/order-pipeline";
import { STATUS_LABELS } from "@/lib/warehouse";
import { createClient } from "@/lib/supabase/client";
import { lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/** The "By rep" line for orders nobody took (keyed in at the warehouse). */
const NO_REP = "none";

type SortKey = "order" | "waiting" | "value";

/**
 * The Orders pipeline card, opened up: every order still to go out, and every
 * delivery still waiting for its proof, with how long each has sat where it is.
 *
 * The tiles are the card's stages with the card's counts (`stageOf` is the
 * card's rule). With no stage chosen the page shows what the headline calls
 * "Orders needing action": everything not yet delivered. Each order opens on
 * its own page, where the next step is a button.
 */
export default function OrdersPipelinePage() {
  const t = useTerms();
  const router = useRouter();
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const money = (n: number) => formatMoney(n, currency);
  const moneyShort = (n: number) => formatMoneyShort(n, currency);

  const [orders, setOrders] = useState<PipelineOrder[]>([]);
  const [business, setBusiness] = useState<BusinessSummary | null>(null);
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [urlRead, setUrlRead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [band, setBand] = useState("");
  const [rep, setRep] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "waiting", dir: "desc" });
  const [attempt, setAttempt] = useState(0);
  /** One instant per load, so every "days" on the page is measured from the same moment. */
  const [now, setNow] = useState(() => Date.now());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the tiles own the stage from here.
    const q = new URLSearchParams(window.location.search);
    setStage(stageFromQuery(q));
    const r = rangeFromQuery(q);
    if (r) setRange(r);
    setUrlRead(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!urlRead) return;
    let stale = false;
    const supabase = createClient();
    Promise.all([
      fetchPipelineOrders(supabase),
      // The card's other figures. A failure costs that strip, not the orders.
      fetchBusinessSummary(supabase, range).catch(() => null),
    ])
      .then(([rows, biz]) => {
        if (stale) return;
        setOrders(rows);
        setBusiness(biz);
        setNow(Date.now());
        setError(null);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [urlRead, range, attempt]);

  function chooseStage(next: PipelineStage | null) {
    setStage(next);
    setBand("");
    setRep("");
    // In the address, so a reload, a shared link or Back opens the same view.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("stage", next);
    else url.searchParams.delete("stage");
    window.history.replaceState(null, "", url);
  }

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }

  const waited = (o: PipelineOrder) => daysWaiting(o.enteredAt, now);

  /** Each stage's count, value and oldest wait: the tiles. */
  const byStage = useMemo(() => {
    const m = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, { n: 0, value: 0, oldest: 0 }])) as Record<
      PipelineStage,
      { n: number; value: number; oldest: number }
    >;
    for (const o of orders) {
      const cur = m[o.stage];
      cur.n += 1;
      cur.value += o.total;
      cur.oldest = Math.max(cur.oldest, daysWaiting(o.enteredAt, now));
    }
    return m;
  }, [orders, now]);

  const inView = useMemo(() => {
    const stages = stagesInView(stage);
    return orders.filter((o) => stages.includes(o.stage));
  }, [orders, stage]);

  /** "How long they have waited", over the orders in view. */
  const bands = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of inView) {
      const b = waitBand(daysWaiting(o.enteredAt, now));
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    return WAIT_BANDS.map((b) => ({ id: b, n: m.get(b) ?? 0 }));
  }, [inView, now]);

  /** "By rep": whose orders these are. */
  const reps = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const o of inView) {
      const id = o.repId ?? NO_REP;
      const cur = m.get(id) ?? { name: o.repName ?? (o.repId ? `Unnamed ${lower(t.staff.one)}` : `No ${lower(t.staff.one)}`), n: 0 };
      cur.n += 1;
      m.set(id, cur);
    }
    return [...m.entries()].sort((a, b) => Number(a[0] === NO_REP) - Number(b[0] === NO_REP) || b[1].n - a[1].n);
  }, [inView, t.staff.one]);

  // A band or person picked under another stage may have nothing in this one.
  const activeBand = bands.some((b) => b.id === band && b.n > 0) ? band : "";
  const activeRep = reps.some(([id]) => id === rep) ? rep : "";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inView.filter((o) => {
      if (activeBand && waitBand(daysWaiting(o.enteredAt, now)) !== activeBand) return false;
      if (activeRep && (o.repId ?? NO_REP) !== activeRep) return false;
      if (!q) return true;
      return o.orderNumber.toLowerCase().includes(q) || (o.storeName ?? "").toLowerCase().includes(q);
    });
    const sign = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === "order") return sign * a.orderNumber.localeCompare(b.orderNumber);
      if (sort.key === "value") return sign * (a.total - b.total) || a.orderNumber.localeCompare(b.orderNumber);
      // Waiting: by the moment it arrived, so two "3 days" keep their real order.
      return sign * (new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime()) || a.orderNumber.localeCompare(b.orderNumber);
    });
  }, [inView, activeBand, activeRep, search, sort, now]);

  function chooseSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "order" ? "asc" : "desc" }));
  }

  const today = toLocalDateInput(new Date(now));
  const viewTotal = inView.reduce((n, o) => n + o.total, 0);
  const plural = (n: number) => (n === 1 ? "order" : "orders");
  const meaning =
    stage === null
      ? `${inView.length} ${plural(inView.length)} not yet delivered, worth ${money(viewTotal)} with VAT. Tap a stage to see only those.`
      : `${inView.length} ${plural(inView.length)} in "${STAGE_LABELS[stage]}", worth ${money(viewTotal)} with VAT. What to do next: ${lower(STAGE_NEXT[stage])}.`;

  const tiles: Tile[] = PIPELINE_STAGES.map((s) => {
    const x = byStage[s];
    return {
      id: s,
      label: STAGE_LABELS[s],
      value: x.n,
      sub: x.n > 0 ? `${moneyShort(x.value)} · oldest ${lower(describeWait(x.oldest))}` : "None",
      tone: x.n === 0 ? undefined : s === "no_pod" ? "bad" : s === "to_confirm" || s === "packed" ? "warn" : undefined,
    };
  });

  function buildSheet(): ExportSheet {
    return {
      title: stage ? `Orders pipeline: ${STAGE_LABELS[stage]}` : "Orders not yet delivered",
      context: [
        ...(activeBand ? [`Waiting: ${WAIT_LABELS[activeBand as keyof typeof WAIT_LABELS]}`] : []),
        ...(activeRep ? [`${t.staff.one}: ${reps.find(([id]) => id === activeRep)?.[1].name ?? ""}`] : []),
        ...(search.trim() ? [`Matching "${search.trim()}"`] : []),
      ],
      filename: "orders-pipeline",
      columns: [
        { header: "Order", key: "order" },
        { header: "Captured", key: "captured" },
        { header: t.site.one, key: "site" },
        { header: t.staff.one, key: "rep" },
        { header: "Stage", key: "stage" },
        { header: "Days waiting", key: "days", numeric: true },
        { header: "Needed by", key: "due" },
        { header: "Value incl. VAT", key: "value", numeric: true },
      ],
      rows: shown.map((o) => ({
        order: o.orderNumber,
        captured: toLocalDate(o.createdAt),
        site: o.storeName ?? "",
        rep: o.repName ?? "",
        stage: STAGE_LABELS[o.stage],
        days: waited(o),
        due: o.requiredBy ?? "",
        value: o.total.toFixed(2),
      })),
    };
  }

  const b = business;
  const figures = b
    ? [
        { label: "Quotes waiting", value: b.pipeline.quotes_waiting, href: quotesHref("sent") },
        { label: "Recurring this week", value: b.pipeline.recurring_due_7d, href: recurringDueHref() },
        { label: "Below reorder point", value: b.pipeline.low_stock, href: lowStockHref() },
        { label: "Invoiced", value: moneyShort(b.money.invoiced), href: invoicesHref(rangeQuery(range)) },
        {
          label: "Overdue",
          value: moneyShort(b.money.overdue),
          href: "/owed",
          tone: b.money.overdue > 0 ? ("bad" as const) : undefined,
        },
        { label: "Commission to approve", value: moneyShort(b.money.commission_pending), href: commissionsHref("pending", "all") },
      ]
    : [];

  const colSpan = 6;

  return (
    <div className="space-y-4">
      <DetailHeader
        title="Orders pipeline"
        subtitle="Every order still to go out, and every delivery still waiting for its proof, with how long each has waited where it is."
        action={<ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />}
      />

      <TopCard>
        <TilePicker tiles={tiles} active={stage} onChoose={(id) => chooseStage(id as PipelineStage | null)} label="Which stage" allowNone loading={loading} />
        <p className="text-sm text-foreground">{loading ? "\u00a0" : meaning}</p>
        {figures.length > 0 && <FigureStrip figures={figures} />}
      </TopCard>

      {!loading && !error && orders.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightPanel
            title="How long they have waited"
            caption={stage ? STAGE_LABELS[stage] : "Not yet delivered"}
            lines={bands.map((x) => ({
              id: x.id,
              label: WAIT_LABELS[x.id],
              value: x.n,
              bar: x.n / Math.max(1, ...bands.map((y) => y.n)),
              disabled: x.n === 0,
            }))}
            active={activeBand}
            onToggle={(id) => setBand(activeBand === id ? "" : id)}
            empty="Nothing waiting."
            footnote="Counted from when each order reached the stage it is in now."
          />
          <InsightPanel
            title={`By ${lower(t.staff.one)}`}
            caption={stage ? STAGE_LABELS[stage] : "Not yet delivered"}
            lines={reps.map(([id, r]) => ({
              id,
              label: r.name,
              value: r.n,
              bar: r.n / Math.max(1, ...reps.map(([, y]) => y.n)),
              aside: id === NO_REP ? "muted" : undefined,
            }))}
            active={activeRep}
            onToggle={(id) => setRep(activeRep === id ? "" : id)}
            limit={8}
            empty="Nothing waiting."
            footnote={`Who took the order. Orders keyed in at the warehouse have no ${lower(t.staff.one)}.`}
          />
        </div>
      )}

      <ListTools search={search} onSearch={setSearch} placeholder={`Find an order or ${lower(t.site.one)}`}>
        {activeBand && (
          <FilterChip onClear={() => setBand("")}>
            Waiting {lower(WAIT_LABELS[activeBand as keyof typeof WAIT_LABELS])} · any time
          </FilterChip>
        )}
        {activeRep && (
          <FilterChip onClear={() => setRep("")}>
            {reps.find(([id]) => id === activeRep)?.[1].name} only · everyone
          </FilterChip>
        )}
      </ListTools>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Order" sortKey="order" sort={sort} onSort={chooseSort} />
              <TableHead>{t.site.one}</TableHead>
              <TableHead className="hidden md:table-cell">{t.staff.one}</TableHead>
              <TableHead className={stage ? "hidden" : "hidden sm:table-cell"}>Stage</TableHead>
              <SortHead label="Waiting" sortKey="waiting" sort={sort} onSort={chooseSort} />
              <SortHead label="Value" sortKey="value" sort={sort} onSort={chooseSort} className="hidden text-right sm:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
                  Loading orders…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">Could not load the orders</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
                    Try again
                  </Button>
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
                  {inView.length === 0 ? (
                    stage === null ? (
                      "Nothing is waiting to be delivered."
                    ) : stage === "no_pod" ? (
                      "Every delivery has its proof of delivery."
                    ) : (
                      `Nothing is in "${STAGE_LABELS[stage]}" right now.`
                    )
                  ) : (
                    <>
                      No orders match.{" "}
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => {
                          setSearch("");
                          setBand("");
                          setRep("");
                        }}
                      >
                        Show them all
                      </button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((o) => {
                const days = waited(o);
                const late = o.requiredBy !== null && o.requiredBy < today && o.stage !== "no_pod";
                return (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/orders/${o.id}`)}>
                    <TableCell className="text-sm">
                      <Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
                        {o.orderNumber}
                      </Link>
                      {o.onHold && (
                        <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-700 dark:text-amber-400">
                          on hold
                        </Badge>
                      )}
                      {/* On a phone the value rides under the number; it has its own column from sm up. */}
                      <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">{money(o.total)}</span>
                    </TableCell>
                    <TableCell className="min-w-[120px] whitespace-normal text-sm">
                      {o.storeName ?? "Unknown"}
                      <span className="block text-xs text-muted-foreground md:hidden">{o.repName ?? ""}</span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{o.repName ?? ""}</TableCell>
                    <TableCell className={stage ? "hidden" : "hidden text-sm sm:table-cell"}>
                      <Badge variant="secondary">{o.stage === "no_pod" ? "Delivered, no proof" : (STATUS_LABELS[o.status] ?? o.status)}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums" title={`Since ${toLocalDate(o.enteredAt)}`}>
                      <span className={days > 7 ? "font-medium text-red-700 dark:text-red-400" : "font-medium text-foreground"}>
                        {describeWait(days)}
                      </span>
                      {late && <span className="block text-xs text-red-700 dark:text-red-400">Needed by {o.requiredBy}</span>}
                    </TableCell>
                    <TableCell className="hidden text-right text-sm tabular-nums sm:table-cell">{money(o.total)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {shown.length === inView.length ? `${inView.length} ${plural(inView.length)}.` : `${shown.length} of ${inView.length} ${plural(inView.length)}.`}{" "}
          Values include VAT. Open an order to take its next step.
        </p>
      )}
    </div>
  );
}
