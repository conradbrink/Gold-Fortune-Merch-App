"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatTile, ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
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

export default function SalesPage() {
  const supabase = createClient();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"week" | "month" | "all">("month");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchSales(supabase);
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
  }, [supabase]);

  // Fixed at first render rather than read inside each calculation, so every
  // figure on the screen is measured against the same instant. A page open
  // across midnight otherwise starts disagreeing with itself.
  const now = useMemo(() => new Date(), []);
  const periods = useMemo(() => periodsFor(now), [now]);

  const week = totalsFor(sales, periods.week);
  const weekBefore = totalsFor(sales, periods.weekBefore);
  const month = totalsFor(sales, periods.month);
  const monthBefore = totalsFor(sales, periods.monthBefore);
  const all = totalsFor(sales);

  const scopePeriod: Period | undefined =
    scope === "week" ? periods.week : scope === "month" ? periods.month : undefined;
  const reps = byRep(sales, scopePeriod);
  const scopeTotals = totalsFor(sales, scopePeriod);
  const recent = useMemo(
    () =>
      (scopePeriod
        ? sales.filter((s) => {
            const t = new Date(s.deliveredAt).getTime();
            return t >= scopePeriod.from.getTime() && t <= scopePeriod.to.getTime();
          })
        : sales
      ).slice(0, 25),
    [sales, scopePeriod]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="text-sm text-muted-foreground">
            Counted on the day the goods were delivered, and valued on what
            actually arrived — short-picked and returned units are not in these
            figures.
          </p>
        </div>
        <NativeSelect
          value={scope}
          onChange={(e) => setScope(e.target.value as "week" | "month" | "all")}
          className="w-44"
          aria-label="Period"
        >
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </NativeSelect>
      </div>

      <ErrorBanner message={error} />

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
                    : "Invoiced this month"
              }
              value={money(scopeTotals.gross)}
              sub="Including VAT, at each order's own rate"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By rep</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rep</TableHead>
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
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Rep</TableHead>
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
