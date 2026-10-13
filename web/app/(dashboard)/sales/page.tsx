"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportMenu } from "@/components/export-menu";
import {
  DetailHeader,
  FilterChip,
  InsightPanel,
  ListTools,
  SortHead,
  TilePicker,
  TopCard,
  type SortState,
  type Tile,
} from "@/components/dashboard/detail-page";
import { rangeForPreset, toLocalDate, toLocalDateInput } from "@/lib/date-range";
import { lastDayOf, rangeFromQuery } from "@/lib/dashboard-links";
import type { ExportSheet } from "@/lib/export";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { achievedFor, fetchTargetProgress, monthStart, type Measure, type TargetProgress } from "@/lib/targets";
import {
  addMonths,
  fetchSales,
  periodsFor,
  startOfMonth,
  totalsFor,
  within,
  type Period,
  type Sale,
} from "@/lib/sales";

/**
 * How a period compares with the one before it, as a sentence rather than a
 * number with an arrow.
 *
 * Nothing to compare against reads as "nothing at this point last week", not
 * as a triumphant +100%: a percentage against zero is arithmetic, not news.
 */
function comparison(now: number, before: number, label: string): string {
  if (before === 0) return `Nothing ${label}`;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return `Level with ${label}`;
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% on ${label}`;
}

/** 2026-10-01 to 2026-10-13 as "1 Oct to 13 Oct", and one day as just the day. */
function periodLabel(from: string, last: string): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return from === last ? fmt(from) : `${fmt(from)} to ${fmt(last)}`;
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

type PeriodId = "custom" | "week" | "month" | "30d" | "all";
type SortKey = "delivered" | "net" | "order";

/** The "By rep" and "By store" key for a sale with nobody (or nowhere) on it. */
const NONE = "none";

/**
 * Sales: the dashboard's Sales card, opened up.
 *
 * The card's months on top, each one a period to choose, beside the usual
 * periods; then who sold it and where it went; then every delivery behind the
 * figure. Counted on the day the goods were delivered and valued on what
 * arrived, excluding VAT: the dashboard's revenue, the same rule.
 *
 * Opened from the dashboard with its dates (`?from=&to=`), a month bar, or a
 * person's line (`&rep=`), so the figure on top is the one that was clicked.
 */
export default function SalesPage() {
  const supabase = createClient();
  const t = useTerms();
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const money = (n: number) => formatMoney(n, currency);
  const moneyShort = (n: number) => formatMoneyShort(n, currency);

  const [sales, setSales] = useState<Sale[]>([]);
  const [targets, setTargets] = useState<TargetProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<PeriodId>("month");
  /** Dates from a link or a month bar, held as a period of their own. */
  const [custom, setCustom] = useState<Period | null>(null);
  const [rep, setRep] = useState("");
  /**
   * The person's name from their profile: somebody who has sold nothing yet
   * has no delivery to take it from, and the page should still say whose it is.
   */
  const [profileName, setProfileName] = useState<string | null>(null);
  const [store, setStore] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "delivered", dir: "desc" });

  // Fixed at first render, so every figure is measured against one instant: a
  // page open across midnight otherwise starts disagreeing with itself.
  const now = useMemo(() => new Date(), []);
  const periods = useMemo(() => {
    const p = periodsFor(now);
    const last30 = rangeForPreset("30d", now);
    const len = +last30.to - +last30.from;
    return {
      ...p,
      last30: { from: last30.from, to: new Date(+last30.to - 1), label: "Last 30 days" },
      before30: { from: new Date(+last30.from - len), to: new Date(+last30.from - 1), label: "the 30 days before" },
    };
  }, [now]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on Reports: the tiles own the period from here.
    const q = new URLSearchParams(window.location.search);
    const range = rangeFromQuery(q);
    if (range) {
      // The dashboard's own "last 30 days" is a tile already; anything else is a
      // period of its own. The end is the last instant before the link's
      // exclusive end, because `within` includes its end.
      const preset = rangeForPreset("30d", now);
      if (+range.from === +preset.from && +range.to === +preset.to) setPeriodId("30d");
      else {
        setCustom({ from: range.from, to: new Date(+range.to - 1), label: periodLabel(toLocalDateInput(range.from), lastDayOf(range)) });
        setPeriodId("custom");
      }
    }
    const r = q.get("rep");
    if (r) setRep(r);
  }, [now]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, tg] = await Promise.all([
          fetchSales(supabase, t),
          // Against target, this month only. Without targets the panel still
          // ranks people by what they sold.
          fetchTargetProgress(supabase, monthStart(now)).catch(() => [] as TargetProgress[]),
        ]);
        if (cancelled) return;
        setSales(rows);
        setTargets(tg);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, t, now]);

  useEffect(() => {
    if (!rep || rep === NONE) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", rep)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfileName((data as { full_name: string | null } | null)?.full_name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, rep]);

  const period: Period | undefined =
    periodId === "custom" && custom
      ? custom
      : periodId === "week"
        ? periods.week
        : periodId === "month"
          ? periods.month
          : periodId === "30d"
            ? periods.last30
            : undefined;
  const periodName = periodId === "all" ? "All time" : (period?.label ?? "All time");

  /** The months the card shows: from the first with a sale, at most six. */
  const months = useMemo(() => {
    const first = startOfMonth(now);
    const list = [5, 4, 3, 2, 1, 0].map((back) => {
      const from = addMonths(first, -back);
      const to = back === 0 ? now : new Date(+addMonths(first, -back + 1) - 1);
      const p: Period = { from, to, label: MONTH_LONG.format(from) };
      return { key: toLocalDateInput(from), short: MONTH.format(from), period: p, net: totalsFor(sales, p).net, current: back === 0 };
    });
    const firstWithSales = list.findIndex((m) => m.net > 0);
    return firstWithSales === -1 ? list.slice(-1) : list.slice(firstWithSales);
  }, [sales, now]);
  const monthScale = Math.max(1, ...months.map((m) => m.net));

  function chooseMonth(m: (typeof months)[number]) {
    if (m.current) {
      setPeriodId("month");
    } else {
      setCustom(m.period);
      setPeriodId("custom");
    }
    setStore("");
  }

  const inPeriod = useMemo(() => (period ? sales.filter((s) => within(s, period)) : sales), [sales, period]);

  /** "By rep", over the period and the chosen store, so picking a store shows who sold there. */
  const byRep = useMemo(() => {
    const m = new Map<string, { name: string; net: number; n: number }>();
    for (const s of inPeriod) {
      if (store && (s.storeId ?? NONE) !== store) continue;
      const id = s.repId ?? NONE;
      const cur = m.get(id) ?? { name: s.repName, net: 0, n: 0 };
      cur.net += s.net;
      cur.n += 1;
      m.set(id, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [inPeriod, store]);

  /** "By store", over the period and the chosen person, so picking a person shows where they sold. */
  const byStore = useMemo(() => {
    const m = new Map<string, { name: string; net: number; n: number }>();
    for (const s of inPeriod) {
      if (rep && (s.repId ?? NONE) !== rep) continue;
      const id = s.storeId ?? NONE;
      const cur = m.get(id) ?? { name: s.storeName, net: 0, n: 0 };
      cur.net += s.net;
      cur.n += 1;
      m.set(id, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [inPeriod, rep]);

  /** This month's target for each person, when the period is this month and one is set. */
  const targetFor = useMemo(() => {
    const m = new Map<string, number>();
    if (periodId !== "month") return m;
    for (const tg of targets) {
      const target = Number(tg.target ?? 0);
      if (target <= 0) continue;
      const measure = (tg.measure as Measure) ?? "revenue";
      m.set(tg.rep_id, achievedFor(tg, measure) / target);
    }
    return m;
  }, [targets, periodId]);

  // A person or store picked under another period may have nothing in this one.
  const repName = rep ? (sales.find((s) => (s.repId ?? NONE) === rep)?.repName ?? profileName) : null;
  const storeName = store ? (sales.find((s) => (s.storeId ?? NONE) === store)?.storeName ?? null) : null;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inPeriod.filter((s) => {
      if (rep && (s.repId ?? NONE) !== rep) return false;
      if (store && (s.storeId ?? NONE) !== store) return false;
      if (!q) return true;
      return s.orderNumber.toLowerCase().includes(q) || s.storeName.toLowerCase().includes(q) || s.repName.toLowerCase().includes(q);
    });
    const sign = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) =>
      sort.key === "net"
        ? sign * (a.net - b.net)
        : sort.key === "order"
          ? sign * a.orderNumber.localeCompare(b.orderNumber)
          : sign * (new Date(a.deliveredAt).getTime() - new Date(b.deliveredAt).getTime())
    );
  }, [inPeriod, rep, store, search, sort]);
  const shownTotals = totalsFor(shown);

  function chooseSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "order" ? "asc" : "desc" }));
  }

  const tile = (id: PeriodId, label: string, p: Period | undefined, sub: string): Tile => ({
    id,
    label,
    value: moneyShort(totalsFor(sales, p).net),
    sub,
  });
  const deliveries = (p?: Period) => {
    const n = totalsFor(sales, p).orders;
    return `${n} ${n === 1 ? "delivery" : "deliveries"}`;
  };
  const tiles: Tile[] = [
    ...(custom ? [tile("custom", custom.label, custom, deliveries(custom))] : []),
    tile("week", "This week", periods.week, comparison(totalsFor(sales, periods.week).net, totalsFor(sales, periods.weekBefore).net, "this point last week")),
    tile("month", "This month", periods.month, comparison(totalsFor(sales, periods.month).net, totalsFor(sales, periods.monthBefore).net, "this point last month")),
    tile("30d", "Last 30 days", periods.last30, comparison(totalsFor(sales, periods.last30).net, totalsFor(sales, periods.before30).net, "the 30 days before")),
    tile("all", "All time", undefined, deliveries()),
  ];

  const filteredBy = [repName, storeName].filter(Boolean).join(", ");
  const meaning = `${periodName}${filteredBy ? `, ${filteredBy}` : ""}: ${money(shownTotals.net)} excluding VAT from ${shownTotals.orders} ${
    shownTotals.orders === 1 ? "delivery" : "deliveries"
  }, ${money(shownTotals.gross)} with VAT.`;

  /** Every delivery in view, valued: the working behind the totals. */
  function buildSalesSheet(): ExportSheet {
    return {
      title: "Sales by delivery",
      context: [
        periodName,
        ...(repName ? [`${t.staff.one}: ${repName}`] : []),
        ...(storeName ? [`${t.site.one}: ${storeName}`] : []),
        `${shown.length} deliveries`,
        "Counted on the day the goods were delivered, valued on what actually arrived.",
      ],
      filename: "sales",
      columns: [
        { header: "Order", key: "order" },
        { header: "Delivered", key: "delivered" },
        { header: t.site.one, key: "store" },
        { header: t.staff.one, key: "rep" },
        { header: "Units", key: "units", numeric: true },
        { header: "Sales excl. VAT", key: "net", numeric: true },
        { header: "VAT", key: "vat", numeric: true },
        { header: "Incl. VAT", key: "gross", numeric: true },
      ],
      rows: shown.map((r) => ({
        order: r.orderNumber,
        delivered: toLocalDate(r.deliveredAt),
        store: r.storeName,
        rep: r.repName,
        units: r.units,
        net: r.net,
        vat: r.vat,
        gross: r.gross,
      })),
    };
  }

  /** At most this many rows on screen; the export has them all. */
  const SHOW = 200;
  const selectedMonth = periodId === "month" ? months.find((m) => m.current)?.key : periodId === "custom" ? months.find((m) => +m.period.from === +(custom?.from ?? 0))?.key : undefined;

  return (
    <div className="space-y-4">
      <DetailHeader
        title="Sales"
        subtitle="Counted on the day the goods were delivered, and valued on what actually arrived, excluding VAT. Short-picked and returned units are not in these figures."
        action={<ExportMenu build={buildSalesSheet} disabled={loading} />}
      />

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>Could not load the sales: {error}</span>
        </div>
      )}

      <TopCard>
        <TilePicker
          tiles={tiles}
          active={periodId}
          onChoose={(id) => {
            if (!id) return;
            setPeriodId(id as PeriodId);
            setStore("");
          }}
          label="Which period"
          loading={loading}
        />
        {!loading && months.length > 0 && (
          <div className="flex flex-col gap-1 border-t pt-4">
            <span className="pb-1 text-xs text-muted-foreground">Delivered sales by month, excluding VAT. Tap a month to open it.</span>
            <div className="grid grid-cols-[2.5rem_1fr_6rem] gap-x-3 gap-y-0.5 text-sm">
              {months.map((m) => {
                const on = selectedMonth === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => chooseMonth(m)}
                    className={`col-span-3 -mx-1.5 grid grid-cols-subgrid items-center rounded-md px-1.5 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                      on ? "bg-primary/10" : "hover:bg-muted/60"
                    }`}
                  >
                    <span className={on || m.current ? "font-semibold" : "text-muted-foreground"}>{m.short}</span>
                    <span className="relative h-[22px] overflow-hidden rounded-md bg-muted" aria-hidden>
                      <span
                        className={`absolute inset-y-0 left-0 rounded-md ${on ? "bg-primary" : "bg-primary/35"}`}
                        style={{ width: `${(m.net / monthScale) * 100}%` }}
                      />
                    </span>
                    <span className={`text-right tabular-nums ${on ? "font-semibold" : ""}`}>{money(m.net)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-sm text-foreground">{loading ? "\u00a0" : meaning}</p>
      </TopCard>

      {!loading && !error && sales.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightPanel
            title={`By ${lower(t.staff.one)}`}
            caption={targetFor.size > 0 ? `${periodName}, against target` : periodName}
            lines={byRep.map(([id, r]) => {
              const pct = targetFor.get(id);
              return {
                id,
                label: r.name,
                value: pct === undefined ? moneyShort(r.net) : `${moneyShort(r.net)} · ${Math.round(pct * 100)}%`,
                bar: pct === undefined ? r.net / Math.max(1, ...byRep.map(([, y]) => y.net)) : pct,
                aside: id === NONE ? "muted" : undefined,
              };
            })}
            active={rep}
            onToggle={(id) => setRep(rep === id ? "" : id)}
            limit={8}
            empty="Nothing was delivered in this period."
            footnote={
              targetFor.size > 0
                ? "The bar is how far each one is towards this month's target. Tap a name to see only their deliveries."
                : "Tap a name to see only their deliveries and where they went."
            }
          />
          <InsightPanel
            title={`By ${lower(t.site.one)}`}
            caption={periodName}
            lines={byStore.map(([id, s]) => ({
              id,
              label: s.name,
              value: moneyShort(s.net),
              bar: s.net / Math.max(1, ...byStore.map(([, y]) => y.net)),
            }))}
            active={store}
            onToggle={(id) => setStore(store === id ? "" : id)}
            empty="Nothing was delivered in this period."
            footnote={`Who bought the most. Tap one to see its deliveries and who sold them.`}
          />
        </div>
      )}

      <ListTools search={search} onSearch={setSearch} placeholder={`Find an order, ${lower(t.site.one)} or ${lower(t.staff.one)}`}>
        {rep && <FilterChip onClear={() => setRep("")}>{repName ?? `One ${lower(t.staff.one)}`} only · everyone</FilterChip>}
        {store && <FilterChip onClear={() => setStore("")}>{storeName ?? `One ${lower(t.site.one)}`} only · every {lower(t.site.one)}</FilterChip>}
      </ListTools>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Order" sortKey="order" sort={sort} onSort={chooseSort} />
              <SortHead label="Delivered" sortKey="delivered" sort={sort} onSort={chooseSort} className="hidden sm:table-cell" />
              <TableHead>{t.site.one}</TableHead>
              <TableHead className="hidden md:table-cell">{t.staff.one}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Units</TableHead>
              <SortHead label="Sales" sortKey="net" sort={sort} onSort={chooseSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Loading sales…
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {inPeriod.length === 0 ? (
                    "Nothing was delivered in this period."
                  ) : (
                    <>
                      No deliveries match.{" "}
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={() => {
                          setSearch("");
                          setRep("");
                          setStore("");
                        }}
                      >
                        Show them all
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              shown.slice(0, SHOW).map((s) => (
                <TableRow key={s.orderId}>
                  <TableCell>
                    <Link href={`/orders/${s.orderId}`} className="font-medium text-primary hover:underline">
                      {s.orderNumber}
                    </Link>
                    {/* On a phone the date rides under the number; it has its own column from sm up. */}
                    <span className="block text-xs text-muted-foreground sm:hidden">{toLocalDate(s.deliveredAt)}</span>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{toLocalDate(s.deliveredAt)}</TableCell>
                  <TableCell className="min-w-[120px] whitespace-normal">
                    {s.storeName}
                    <span className="block text-xs text-muted-foreground md:hidden">{s.repName}</span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{s.repName}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{s.units}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(s.net)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {shown.length > SHOW
            ? `The first ${SHOW} of ${shown.length} deliveries. Export for all of them.`
            : `${shown.length} ${shown.length === 1 ? "delivery" : "deliveries"}.`}{" "}
          Sales exclude VAT.
        </p>
      )}
    </div>
  );
}
