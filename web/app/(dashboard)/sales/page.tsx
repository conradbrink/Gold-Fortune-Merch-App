"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocalDate, toLocalDateInput } from "@/lib/date-range";
import { lastDayOf, rangeFromQuery } from "@/lib/dashboard-links";
import { ExportMenu } from "@/components/export-menu";
import type { ExportSheet } from "@/lib/export";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatTile, ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { Button } from "@/components/ui/button";
import {
  fetchSales,
  periodsFor,
  totalsFor,
  byRep,
  type Sale,
  type Period,
} from "@/lib/sales";

function money(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * How a period compares with the one before it, as a sentence rather than a
 * number with an arrow.
 *
 * Nothing to compare against reads as "no sales at this point last week", not
 * as a triumphant +100% — a percentage against zero is arithmetic, not news.
 */
function comparison(now: number, before: number, label: string): string {
  if (before === 0) return now === 0 ? `Nothing ${label}` : `Nothing ${label}`;
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

type Scope = "week" | "month" | "all" | "range";

export default function SalesPage() {
  const supabase = createClient();
  const terms = useTerms();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("month");
  /**
   * The dates a dashboard link carried ("Revenue, last 30 days", one month's
   * bar, one person's month). Held as a period of its own, so the figure on
   * this page is the figure that was clicked. The end is the last instant
   * before the link's exclusive end, because `within` includes its end.
   */
  const [custom, setCustom] = useState<Period | null>(null);
  /** One person's sales only, from a person's line on the dashboard. */
  const [repId, setRepId] = useState<string | null>(null);
  /**
   * Their name from their profile: somebody who has sold nothing yet this
   * month has no delivery to take it from, and the page should still say
   * whose month it is.
   */
  const [profileName, setProfileName] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on Reports: the period box owns the scope from here.
    const q = new URLSearchParams(window.location.search);
    const range = rangeFromQuery(q);
    if (range) {
      setCustom({
        from: range.from,
        to: new Date(+range.to - 1),
        label: periodLabel(toLocalDateInput(range.from), lastDayOf(range)),
      });
      setScope("range");
    }
    const rep = q.get("rep");
    if (rep) setRepId(rep);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!repId) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", repId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfileName((data as { full_name: string | null } | null)?.full_name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, repId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchSales(supabase, terms);
        if (cancelled) return;
        setSales(rows);
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
  }, [supabase, terms]);

  // Fixed at first render rather than read inside each calculation, so every
  // figure on the screen is measured against the same instant. A page open
  // across midnight otherwise starts disagreeing with itself.
  const now = useMemo(() => new Date(), []);
  const periods = useMemo(() => periodsFor(now), [now]);

  // One person's, when a link asked for it: every figure on the page follows,
  // so nothing here disagrees with the line that was clicked.
  const pool = useMemo(() => (repId ? sales.filter((s) => s.repId === repId) : sales), [sales, repId]);
  const repName = repId ? (profileName ?? sales.find((s) => s.repId === repId)?.repName ?? null) : null;

  const week = totalsFor(pool, periods.week);
  const weekBefore = totalsFor(pool, periods.weekBefore);
  const month = totalsFor(pool, periods.month);
  const monthBefore = totalsFor(pool, periods.monthBefore);
  const all = totalsFor(pool);

  const scopePeriod: Period | undefined =
    scope === "range" && custom
      ? custom
      : scope === "week"
        ? periods.week
        : scope === "month"
          ? periods.month
          : undefined;
  const reps = byRep(pool, scopePeriod);
  const scopeTotals = totalsFor(pool, scopePeriod);
  /**
   * Every delivery when the page was opened on a question (dates or a person):
   * the list is the answer, so it is not cut. Otherwise the newest 25.
   */
  const drilled = (scope === "range" && custom !== null) || repId !== null;
  const inScope = useMemo(
    () =>
      scopePeriod
        ? pool.filter((s) => {
            const t = new Date(s.deliveredAt).getTime();
            // Half-open, matching the export below and `within()` in lib/sales.
            // An inclusive end put a delivery exactly on the boundary on screen
            // and left it out of the file.
            return t >= scopePeriod.from.getTime() && t < scopePeriod.to.getTime();
          })
        : pool,
    [pool, scopePeriod]
  );
  const recent = drilled ? inScope : inScope.slice(0, 25);

  /** Every delivery in the chosen period, valued — the working behind the totals. */
  function buildSalesSheet(): ExportSheet {
    const rows = inScope;
    return {
      title: "Sales by delivery",
      context: [
        scopePeriod ? scopePeriod.label : "All time",
        ...(repName ? [`${terms.staff.one}: ${repName}`] : []),
        `${rows.length} deliveries`,
        "Counted on the day the goods were delivered, valued on what actually arrived.",
      ],
      filename: "sales",
      columns: [
        { header: "Order", key: "order" },
        { header: "Delivered", key: "delivered" },
        { header: terms.site.one, key: "store" },
        { header: terms.staff.one, key: "rep" },
        { header: "Units", key: "units", numeric: true },
        { header: "Sales excl. VAT", key: "net", numeric: true },
        { header: "VAT", key: "vat", numeric: true },
        { header: "Incl. VAT", key: "gross", numeric: true },
      ],
      rows: rows.map((r) => ({
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Sales</h1>
          <p className="text-sm text-muted-foreground">
            Counted on the day the goods were delivered, and valued on what
            actually arrived — short-picked and returned units are not in these
            figures.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="w-44"
            aria-label="Period"
          >
            {custom && <option value="range">{custom.label}</option>}
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </NativeSelect>
          {/* The deliveries, not the rep summary: the summary is four numbers
              somebody can read off the screen, and the deliveries are the
              working that a total is only worth as much as. */}
          <ExportMenu build={buildSalesSheet} disabled={loading} />
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* The figure that was clicked, said back in full, with the way out. */}
      {!loading && drilled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          <p>
            <span className="font-medium">
              {[scopePeriod ? scopePeriod.label : "All time", repName].filter(Boolean).join(", ")}:
            </span>{" "}
            {money(scopeTotals.net)} excluding VAT, from {scopeTotals.orders}{" "}
            {scopeTotals.orders === 1 ? "delivery" : "deliveries"}.
          </p>
          {repId && (
            <Button size="sm" variant="outline" onClick={() => setRepId(null)}>
              Show everyone
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="This week"
              value={money(week.net)}
              sub={comparison(week.net, weekBefore.net, "this point last week")}
            />
            <StatTile
              label="This month"
              value={money(month.net)}
              sub={comparison(month.net, monthBefore.net, "this point last month")}
            />
            <StatTile
              label="All time"
              value={money(all.net)}
              sub={`${all.orders} orders delivered`}
            />
            <StatTile
              label={
                scope === "all"
                  ? "Invoiced, all time"
                  : scope === "week"
                    ? "Invoiced this week"
                    : scope === "range" && custom
                      ? `Invoiced, ${custom.label}`
                      : "Invoiced this month"
              }
              value={money(scopeTotals.gross)}
              sub="Including VAT, at each order's own rate"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By {lower(terms.staff.one)}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{terms.staff.one}</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Incl. VAT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reps.length === 0 ? (
                    <EmptyRow colSpan={5}>
                      Nothing delivered in this period.
                    </EmptyRow>
                  ) : (
                    reps.map((r) => (
                      <TableRow key={r.repName}>
                        <TableCell className="font-medium">{r.repName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.orders}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.units}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(r.net)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {money(r.gross)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* The figures above are only worth as much as the deliveries under
              them, so the deliveries are on the same screen. A total nobody can
              open is a total nobody argues with — right up until it is wrong. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">The deliveries behind it</CardTitle>
              {inScope.length > recent.length && (
                <p className="text-xs text-muted-foreground">
                  The newest {recent.length} of {inScope.length}. Export for all of them.
                </p>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>{terms.site.one}</TableHead>
                    <TableHead>{terms.staff.one}</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.length === 0 ? (
                    <EmptyRow colSpan={6}>
                      Nothing delivered in this period.
                    </EmptyRow>
                  ) : (
                    recent.map((s) => (
                      <TableRow key={s.orderId}>
                        <TableCell>
                          <Link
                            href={`/orders/${s.orderId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {s.orderNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(s.deliveredAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{s.storeName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.repName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.units}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(s.net)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
