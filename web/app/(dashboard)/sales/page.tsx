"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  StatTiles,
  TopCard,
  type SortState,
} from "@/components/dashboard/detail-page";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { fromLocalDateInput, rangeForPreset, toLocalDate, toLocalDateInput, type DateRange, type RangePreset } from "@/lib/date-range";
import { lastDayOf, nextMonth, rangeFromQuery, rangeQuery } from "@/lib/dashboard-links";
import { companyMidnight } from "@/lib/company-time";
import { localDay } from "@/lib/dashboard-numbers";
import type { ExportSheet } from "@/lib/export";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { lower } from "@/lib/terms";
import { moduleEnabled } from "@/lib/modules";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { achievedFor, fetchTargetProgress, type Measure, type TargetProgress } from "@/lib/targets";
import { fetchSales, saleWord, totalsFor, within, type Period, type Sale } from "@/lib/sales";
import { useStoreGroupFilter } from "@/lib/use-store-group-filter";
import { StoreGroupChip, StoreGroupPicker } from "@/components/dashboard/store-group-picker";

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

/** "2026-10-01" shifted by `n` months, as the first of that month. */
function monthDay(first: string, n: number): string {
  const [y, m] = first.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** "2026-10-01" as "Oct" or "October 2026": a calendar month, so read without a timezone. */
function monthName(first: string, style: "short" | "long"): string {
  const [y, m] = first.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", style === "short" ? { month: "short", timeZone: "UTC" } : { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

type SortKey = "date" | "net" | "number";

/** The picker's presets as a period is named on this page. */
const PRESET_NAMES: [RangePreset, string][] = [
  ["week", "This week"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["month", "This month"],
];

/** The "By rep" and "By store" key for a sale with nobody (or nowhere) on it. */
const NONE = "none";

/**
 * Sales: the dashboard's Sales card, opened up.
 *
 * The dates are chosen in the dashboard's own picker (owner, 13 Oct 2026: "i'd
 * like there to be a place where you can select the dates"), and the card's
 * months sit under the totals, each one a period to choose; then who sold it
 * and where it went; then every invoice behind the figure. Each invoice counts
 * on the day it was issued and each credit note takes off on its own, excluding
 * VAT (owner, 20 Oct 2026): the dashboard's revenue, the same rule
 * (`sales_documents`). A company that does not invoice in Tickd sees its
 * delivered orders instead, so the words follow the invoicing module.
 *
 * Opened from the dashboard with its dates (`?from=&to=`), a month bar, or a
 * person's line (`&rep=`), so the figure on top is the one that was clicked.
 */
export default function SalesPage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const currency = config?.settings.currency_code ?? "";
  const money = (n: number) => formatMoney(n, currency);
  const moneyShort = (n: number) => formatMoneyShort(n, currency);
  /**
   * Weeks and months are the company's, as on the dashboard's Sales card (its
   * month bars are counted in the company's timezone): a sale belongs to the
   * company's day, wherever the page is opened.
   */
  const zone = config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  /** Whether sales are invoices here, or delivered orders for a company that does not invoice. */
  const invoices = config ? moduleEnabled(config.modules, "invoicing") : true;
  const word = (n: number) => saleWord(n, invoices);

  const [sales, setSales] = useState<Sale[]>([]);
  const [targets, setTargets] = useState<TargetProgress[]>([]);
  /** The sales themselves; `loading` below also waits for a store group a link asked for. */
  const [loadingRows, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The dates chosen in the picker (or carried by a link): the viewer's days, end exclusive. */
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("month"));
  /** "All time" in the picker: every sale, whatever the dates say. */
  const [allTime, setAllTime] = useState(false);
  /**
   * A month bar chosen: that month in the company's time, exactly as the card's
   * bar counts it. Null when the picker's dates are the period.
   */
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [rep, setRep] = useState("");
  /**
   * The person's name from their profile: somebody who has sold nothing yet
   * has no sale to take it from, and the page should still say whose it is.
   */
  const [profileName, setProfileName] = useState<string | null>(null);
  const [store, setStore] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "desc" });

  /**
   * One store group's sales, or every sale: what the figures, the month bars,
   * the panels and the list count. A store belongs to one group, so a store
   * picked under another group is let go. No numbers on the picker: it would
   * count every sale ever, not the period on screen.
   */
  const storeGroup = useStoreGroupFilter(sales, t, { key: "storeId", onChoose: () => setStore(""), counted: false });
  const inStoreGroup = storeGroup.rows;
  const loading = loadingRows || storeGroup.loading;

  // Fixed at first render, so every figure is measured against one instant: a
  // page open across midnight otherwise starts disagreeing with itself.
  const now = useMemo(() => new Date(), []);
  /** The company's today and the first of its month: where the month bars end. */
  const periods = useMemo(() => {
    const today = localDay(zone, now);
    return { today, monthFirst: `${today.slice(0, 8)}01` };
  }, [now, zone]);

  /** A whole company month as a period: this month runs to now. */
  const monthPeriod = useCallback(
    (first: string): Period => {
      const from = companyMidnight(first, zone);
      const end = new Date(+companyMidnight(monthDay(first, 1), zone) - 1);
      return { from, to: end > now ? now : end, label: monthName(first, "long") };
    },
    [zone, now]
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on Reports: the picker owns the dates from here. A month
    // bar on the dashboard's card sends a whole month, which opens as that
    // month in the company's time; any other dates open as they are.
    const q = new URLSearchParams(window.location.search);
    const r = rangeFromQuery(q);
    if (r) {
      const from = q.get("from")!;
      if (from.endsWith("-01") && q.get("to") === nextMonth(from)) setMonthKey(from);
      setRange(r);
    }
    const who = q.get("rep");
    if (who) setRep(who);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Keeps the address in step with the dates, so a reload or a shared link opens the same view. */
  function remember(next: DateRange | null) {
    const url = new URL(window.location.href);
    if (next) {
      const q = rangeQuery(next);
      url.searchParams.set("from", q.from);
      url.searchParams.set("to", q.to);
    } else {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    }
    window.history.replaceState(null, "", url);
  }

  function chooseRange(next: DateRange) {
    setRange(next);
    setMonthKey(null);
    setAllTime(false);
    setStore("");
    remember(next);
  }

  function chooseAllTime() {
    setAllTime(true);
    setMonthKey(null);
    setStore("");
    remember(null);
  }

  // The company's words only name a sale nobody took; they change identity
  // when the config arrives, and reading every sale again for that would page
  // the whole table twice. So the read waits for the config and keys on the
  // words themselves.
  const staffOne = config ? t.staff.one : null;
  useEffect(() => {
    if (staffOne === null) return;
    let cancelled = false;
    (async () => {
      try {
        const [rows, tg] = await Promise.all([
          fetchSales(supabase, t),
          // Against target, this month only. Without targets the panel still
          // ranks people by what they sold.
          fetchTargetProgress(supabase, periods.monthFirst).catch(() => [] as TargetProgress[]),
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
    // `t` is read for the one word keyed above; `periods.monthFirst` is fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, staffOne]);

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

  /** Whether the picker's dates are exactly one of its presets, by name. */
  // Against the presets as they are now, the same way the picker lights its
  // buttons, so the name and the lit button never disagree after midnight.
  const presetName = useCallback((r: DateRange): string | null => {
    for (const [p, name] of PRESET_NAMES) {
      const x = rangeForPreset(p);
      if (+x.from === +r.from && +x.to === +r.to) return name;
    }
    return null;
  }, []);
  const period = useMemo<Period | undefined>(
    () =>
      allTime
        ? undefined
        : monthKey
          ? monthPeriod(monthKey)
          : { from: range.from, to: new Date(+range.to - 1), label: presetName(range) ?? periodLabel(toLocalDateInput(range.from), lastDayOf(range)) },
    [allTime, monthKey, monthPeriod, range, presetName]
  );
  const periodName = period?.label ?? "All time";
  /** This month so far, by the bar or the picker: the one period targets are set for. */
  const isThisMonth =
    !allTime && (monthKey === periods.monthFirst || (!monthKey && presetName(range) === "This month"));

  /**
   * The period before, for the comparison: the month before a chosen month
   * (this month against the same point last month), or as many days again
   * before the picker's dates. Nothing to compare "All time" with.
   */
  const compareMonth = monthKey ?? (isThisMonth ? periods.monthFirst : null);
  const before: { period: Period; label: string } | null = allTime || !period
    ? null
    : compareMonth
      ? compareMonth === periods.monthFirst
        ? (() => {
            const p = monthPeriod(monthDay(compareMonth, -1));
            const elapsed = +now - +period.from;
            return { period: { ...p, to: new Date(Math.min(+p.from + elapsed, +period.from - 1)) }, label: "this point last month" };
          })()
        : { period: monthPeriod(monthDay(compareMonth, -1)), label: "the month before" }
      : presetName(range) === "This week"
        ? (() => {
            // This week so far against the same point last week, as the old tile did.
            const from = new Date(+range.from - 7 * 86_400_000);
            return { period: { from, to: new Date(+from + (+now - +range.from)), label: "" }, label: "this point last week" };
          })()
        : (() => {
            const len = +range.to - +range.from;
            const days = Math.round(len / 86_400_000);
            return {
              period: { from: new Date(+range.from - len), to: new Date(+range.from - 1), label: "" },
              label: `the ${days === 1 ? "day" : `${days} days`} before`,
            };
          })();

  /** The months the card shows, in the company's time: from the first with a sale, at most six. */
  const months = useMemo(() => {
    const list = [5, 4, 3, 2, 1, 0].map((back) => {
      const first = monthDay(periods.monthFirst, -back);
      const p = monthPeriod(first);
      return { key: first, short: monthName(first, "short"), period: p, net: totalsFor(inStoreGroup, p).net, current: back === 0 };
    });
    const firstWithSales = list.findIndex((m) => m.net > 0);
    return firstWithSales === -1 ? list.slice(-1) : list.slice(firstWithSales);
  }, [inStoreGroup, periods.monthFirst, monthPeriod]);
  const monthScale = Math.max(1, ...months.map((m) => m.net));

  /** A month bar: that month, as the card counts it. The picker shows its dates. */
  function chooseMonth(m: (typeof months)[number]) {
    const shown = m.current ? rangeForPreset("month", now) : { from: fromLocalDateInput(m.key), to: fromLocalDateInput(nextMonth(m.key)) };
    setRange(shown);
    setMonthKey(m.key);
    setAllTime(false);
    setStore("");
    remember(shown);
  }

  const inPeriod = useMemo(() => (period ? inStoreGroup.filter((s) => within(s, period)) : inStoreGroup), [inStoreGroup, period]);

  /** "By rep", over the period and the chosen store, so picking a store shows who sold there. */
  const byRep = useMemo(() => {
    const m = new Map<string, { name: string; net: number; gross: number; units: number; n: number }>();
    for (const s of inPeriod) {
      if (store && (s.storeId ?? NONE) !== store) continue;
      const id = s.repId ?? NONE;
      const cur = m.get(id) ?? { name: s.repName, net: 0, gross: 0, units: 0, n: 0 };
      cur.net += s.net;
      cur.gross += s.gross;
      cur.units += s.units;
      if (s.kind !== "credit_note") cur.n += 1;
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
      if (s.kind !== "credit_note") cur.n += 1;
      m.set(id, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [inPeriod, rep]);

  /**
   * This month's target for each person, when the period is this month and one
   * is set. Not within a store group: a target is for everything a person sells,
   * and one group's share of it would read as falling short.
   */
  const targetFor = useMemo(() => {
    const m = new Map<string, number>();
    if (!isThisMonth || storeGroup.active) return m;
    for (const tg of targets) {
      const target = Number(tg.target ?? 0);
      if (target <= 0) continue;
      const measure = (tg.measure as Measure) ?? "revenue";
      m.set(tg.rep_id, achievedFor(tg, measure) / target);
    }
    return m;
  }, [targets, isThisMonth, storeGroup.active]);

  // A person or store picked under another period may have nothing in this one.
  const repName = rep ? (sales.find((s) => (s.repId ?? NONE) === rep)?.repName ?? profileName) : null;
  const storeName = store ? (sales.find((s) => (s.storeId ?? NONE) === store)?.storeName ?? null) : null;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inPeriod.filter((s) => {
      if (rep && (s.repId ?? NONE) !== rep) return false;
      if (store && (s.storeId ?? NONE) !== store) return false;
      if (!q) return true;
      return s.number.toLowerCase().includes(q) || s.storeName.toLowerCase().includes(q) || s.repName.toLowerCase().includes(q);
    });
    const sign = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) =>
      sort.key === "net"
        ? sign * (a.net - b.net)
        : sort.key === "number"
          ? sign * a.number.localeCompare(b.number)
          : sign * (new Date(a.at).getTime() - new Date(b.at).getTime())
    );
  }, [inPeriod, rep, store, search, sort]);
  const shownTotals = totalsFor(shown);

  function chooseSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "number" ? "asc" : "desc" }));
  }

  const totals = totalsFor(inPeriod);
  const stats = [
    {
      label: "Sales, excluding VAT",
      value: moneyShort(totals.net),
      sub: before ? comparison(totals.net, totalsFor(inStoreGroup, before.period).net, before.label) : periodName,
    },
    { label: invoices ? "Invoices" : "Deliveries", value: totals.count, sub: `${totals.units} units` },
    { label: "Including VAT", value: moneyShort(totals.gross), sub: invoices ? "As invoiced" : "At each order's own rate" },
  ];

  const filteredBy = [repName, storeName].filter(Boolean).join(", ");
  const meaning = `${periodName}${storeGroup.phrase ? `, ${storeGroup.phrase}` : ""}${filteredBy ? `, ${filteredBy}` : ""}: ${money(shownTotals.net)} excluding VAT from ${shownTotals.count} ${word(
    shownTotals.count
  )}, ${money(shownTotals.gross)} with VAT.`;

  /** Every sale in view, valued: the working behind the totals. */
  function buildSalesSheet(): ExportSheet {
    return {
      title: invoices ? "Sales by invoice" : "Sales by delivery",
      context: [
        periodName,
        ...storeGroup.context,
        ...(repName ? [`${t.staff.one}: ${repName}`] : []),
        ...(storeName ? [`${t.site.one}: ${storeName}`] : []),
        `${shown.length} ${invoices ? "invoices and credit notes" : "deliveries"}`,
        invoices
          ? "Counted on the day each invoice was issued, less credit notes on theirs."
          : "Counted on the day the goods were delivered, valued on what actually arrived.",
      ],
      filename: "sales",
      columns: [
        { header: invoices ? "Number" : "Order", key: "number" },
        { header: invoices ? "Date" : "Delivered", key: "date" },
        { header: t.site.one, key: "store" },
        { header: t.staff.one, key: "rep" },
        { header: "Units", key: "units", numeric: true },
        { header: "Sales excl. VAT", key: "net", numeric: true },
        { header: "VAT", key: "vat", numeric: true },
        { header: "Incl. VAT", key: "gross", numeric: true },
      ],
      rows: shown.map((r) => ({
        number: r.number,
        date: toLocalDate(r.at),
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
  const selectedMonth = allTime ? undefined : monthKey ?? (isThisMonth ? periods.monthFirst : undefined);

  return (
    <div className="space-y-4">
      <DetailHeader
        title="Sales"
        subtitle={
          invoices
            ? "Every invoice on the day it was issued, less credit notes on theirs, excluding VAT."
            : "Counted on the day the goods were delivered, and valued on what actually arrived, excluding VAT. Short-picked and returned units are not in these figures."
        }
        action={<ExportMenu build={buildSalesSheet} disabled={loading} />}
      />

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>Could not load the sales: {error}</span>
        </div>
      )}

      <DateRangePicker
        value={range}
        onChange={chooseRange}
        allTime={allTime}
        onAllTime={chooseAllTime}
        presets={["week", "month", "7d", "30d", "90d"]}
      />

      <StoreGroupPicker filter={storeGroup} t={t} ready={!loading && !error} />

      <TopCard>
        <StatTiles tiles={stats} loading={loading} />
        {!loading && months.length > 0 && (
          <div className="flex flex-col gap-1 border-t pt-4">
            <span className="pb-1 text-xs text-muted-foreground">
              {invoices ? "Invoiced sales" : "Delivered sales"} by month, excluding VAT. Tap a month to open it.
            </span>
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
                // What the old By rep table showed, so nothing is lost: invoices,
                // units and the figure with VAT.
                sub: `${r.n} ${word(r.n)} · ${r.units} units · ${moneyShort(r.gross)} with VAT`,
                value: pct === undefined ? moneyShort(r.net) : `${moneyShort(r.net)} · ${Math.round(pct * 100)}%`,
                bar: pct === undefined ? r.net / Math.max(1, ...byRep.map(([, y]) => y.net)) : pct,
                aside: id === NONE ? "muted" : undefined,
              };
            })}
            active={rep}
            onToggle={(id) => setRep(rep === id ? "" : id)}
            limit={8}
            empty={storeGroup.within(invoices ? "Nothing was invoiced in this period." : "Nothing was delivered in this period.")}
            moreHint="Search the list below to find one."
            footnote={
              targetFor.size > 0
                ? `The bar is how far each one is towards this month's target. Tap a name to see only their ${word(2)}.`
                : `Tap a name to see only their ${word(2)} and where they went.`
            }
          />
          <InsightPanel
            title={`By ${lower(t.site.one)}`}
            caption={periodName}
            lines={byStore.map(([id, s]) => ({
              id,
              label: s.name,
              sub: `${s.n} ${word(s.n)}`,
              value: moneyShort(s.net),
              bar: s.net / Math.max(1, ...byStore.map(([, y]) => y.net)),
            }))}
            active={store}
            onToggle={(id) => setStore(store === id ? "" : id)}
            empty={storeGroup.within(invoices ? "Nothing was invoiced in this period." : "Nothing was delivered in this period.")}
            moreHint="Search the list below to find one."
            footnote={`Who bought the most. Tap one to see its ${word(2)} and who sold them.`}
          />
        </div>
      )}

      <ListTools
        search={search}
        onSearch={setSearch}
        placeholder={`Find ${invoices ? "an invoice" : "an order"}, ${lower(t.site.one)} or ${lower(t.staff.one)}`}
      >
        <StoreGroupChip filter={storeGroup} />
        {rep && <FilterChip onClear={() => setRep("")}>{repName ?? `One ${lower(t.staff.one)}`} only · everyone</FilterChip>}
        {store && <FilterChip onClear={() => setStore("")}>{storeName ?? `One ${lower(t.site.one)}`} only · every {lower(t.site.one)}</FilterChip>}
      </ListTools>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label={invoices ? "Invoice" : "Order"} sortKey="number" sort={sort} onSort={chooseSort} />
              <SortHead label={invoices ? "Date" : "Delivered"} sortKey="date" sort={sort} onSort={chooseSort} className="hidden sm:table-cell" />
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
                    storeGroup.within(invoices ? "Nothing was invoiced in this period." : "Nothing was delivered in this period.")
                  ) : (
                    <>
                      No {word(2)} match.{" "}
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
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={s.href} className="font-medium text-primary hover:underline">
                      {s.number}
                    </Link>
                    {s.kind === "credit_note" && <span className="ml-1.5 text-xs text-muted-foreground">Credit note</span>}
                    {/* On a phone the date rides under the number; it has its own column from sm up. */}
                    <span className="block text-xs text-muted-foreground sm:hidden">{toLocalDate(s.at)}</span>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{toLocalDate(s.at)}</TableCell>
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
            ? `The first ${SHOW} of ${shown.length}. Export for all of them.`
            : `${shown.length} ${invoices ? (shown.length === 1 ? "invoice or credit note" : "invoices and credit notes") : word(shown.length)}.`}{" "}
          Sales exclude VAT.
        </p>
      )}
    </div>
  );
}
