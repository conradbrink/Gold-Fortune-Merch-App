"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
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
  fetchPerformance,
  fetchVelocity,
  fetchMovementSummary,
  fetchAgeing,
  fetchValuation,
  totalValuation,
  type PerformanceRow,
  type VelocityRow,
  type MovementSummaryRow,
  type AgeingRow,
  type ValuationRow,
} from "@/lib/warehouse";

const PERIODS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const GROUPINGS = [
  { value: "overall", label: "Overall" },
  { value: "staff", label: "By staff member" },
  { value: "driver", label: "By driver" },
  { value: "area", label: "By area" },
  { value: "date", label: "By date" },
] as const;

/**
 * The manager's view of the warehouse.
 *
 * Fulfilment time and delivery time are shown separately on purpose. The first
 * is confirm-to-dispatch, which the warehouse controls; the second is
 * dispatch-to-delivered, which the driver does. A single "time to customer"
 * figure would be the sum of two teams' work and would tell neither of them
 * anything actionable.
 */
export default function WarehouseInsightsPage() {
  const supabase = createClient();
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] =
    useState<(typeof GROUPINGS)[number]["value"]>("overall");

  const [overall, setOverall] = useState<PerformanceRow | null>(null);
  const [grouped, setGrouped] = useState<PerformanceRow[]>([]);
  const [velocity, setVelocity] = useState<VelocityRow[]>([]);
  const [movements, setMovements] = useState<MovementSummaryRow[]>([]);
  const [ageing, setAgeing] = useState<AgeingRow[]>([]);
  const [valuation, setValuation] = useState<ValuationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No state set before the first await, and cancellation so that switching
  // period or grouping quickly cannot leave an older answer on screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        const [o, g, v, m, a, val] = await Promise.all([
          fetchPerformance(supabase, from, to, "overall"),
          fetchPerformance(supabase, from, to, groupBy),
          fetchVelocity(supabase, days, null),
          fetchMovementSummary(supabase, from, to, null),
          fetchAgeing(supabase, null),
          fetchValuation(supabase, null),
        ]);
        if (cancelled) return;
        setOverall(o[0] ?? null);
        setGrouped(g);
        setVelocity(v);
        setMovements(m);
        setAgeing(a);
        setValuation(val);
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
  }, [supabase, days, groupBy]);

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
  const hours = (v: number | null) =>
    v == null ? "—" : Number(v) < 48 ? `${Number(v).toFixed(1)} h` : `${(Number(v) / 24).toFixed(1)} d`;

  const value = totalValuation(valuation);
  const backordered = velocity.filter((v) => Number(v.times_backordered) > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Warehouse insights</h1>
          <p className="text-sm text-muted-foreground">
            Fulfilment, delivery and stock movement.
          </p>
        </div>
        <NativeSelect
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-44"
          aria-label="Period"
        >
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Orders delivered"
          value={Number(overall?.orders_delivered ?? 0)}
          sub={`in the last ${days} days`}
        />
        <StatTile
          label="Avg fulfilment"
          value={hours(overall?.avg_fulfilment_hours ?? null)}
          sub="confirm → dispatch"
        />
        <StatTile
          label="Avg delivery"
          value={hours(overall?.avg_delivery_hours ?? null)}
          sub="dispatch → delivered"
        />
        <StatTile
          label="Late deliveries"
          value={Number(overall?.late_deliveries ?? 0)}
          sub="past the expected date"
          tone={Number(overall?.late_deliveries ?? 0) > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Fulfilment accuracy"
          value={
            overall?.fulfilment_accuracy == null
              ? "—"
              : `${Number(overall.fulfilment_accuracy).toFixed(1)}%`
          }
          sub="units delivered vs ordered"
          tone={
            overall?.fulfilment_accuracy != null && Number(overall.fulfilment_accuracy) < 95
              ? "warn"
              : "neutral"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Performance</CardTitle>
            <NativeSelect
              value={groupBy}
              onChange={(e) =>
                setGroupBy(e.target.value as (typeof GROUPINGS)[number]["value"])
              }
              className="w-44"
              aria-label="Group performance by"
            >
              {GROUPINGS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </NativeSelect>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{GROUPINGS.find((g) => g.value === groupBy)?.label}</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Fulfil</TableHead>
                  <TableHead className="text-right">Deliver</TableHead>
                  <TableHead className="text-right">Late</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <EmptyRow colSpan={6}>Loading…</EmptyRow>
                ) : grouped.length === 0 ? (
                  <EmptyRow colSpan={6}>
                    Nothing delivered in this period yet.
                  </EmptyRow>
                ) : (
                  grouped.map((r) => (
                    <TableRow key={r.bucket}>
                      <TableCell className="font-medium">{r.bucket}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.orders_delivered}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hours(r.avg_fulfilment_hours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hours(r.avg_delivery_hours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.late_deliveries) > 0 ? (
                          <span className="text-amber-600">{r.late_deliveries}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.fulfilment_accuracy == null
                          ? "—"
                          : `${Number(r.fulfilment_accuracy).toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock movement</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Movements</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <EmptyRow colSpan={3}>Loading…</EmptyRow>
                ) : movements.length === 0 ? (
                  <EmptyRow colSpan={3}>No stock moved in this period.</EmptyRow>
                ) : (
                  movements.map((m) => (
                    <TableRow key={m.category}>
                      <TableCell>{m.category}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {m.movements}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {m.units}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inventory value</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-3xl font-semibold tabular-nums">{money(value.total)}</p>
            <p className="text-xs text-muted-foreground">
              At the last cost paid per product.
              {value.productsWithoutCost > 0 && (
                <>
                  {" "}
                  <span className="text-amber-600">
                    {value.productsWithoutCost} product
                    {value.productsWithoutCost === 1 ? " has" : "s have"} no cost on
                    record and {value.productsWithoutCost === 1 ? "is" : "are"} not in
                    this total.
                  </span>
                </>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock ageing</CardTitle>
          </CardHeader>
          <CardContent>
            {ageing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading…" : "No stock on hand."}
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {ageing.map((a) => (
                  <li key={a.age_band} className="flex justify-between">
                    <span className={a.age_band === "unknown" ? "text-muted-foreground" : ""}>
                      {a.age_band === "unknown" ? "Not batch-tracked" : a.age_band}
                    </span>
                    <span className="tabular-nums">
                      {a.qty_on_hand} units · {a.products} products
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Frequently back-ordered</CardTitle>
          </CardHeader>
          <CardContent>
            {backordered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading…" : "Nothing has been back-ordered in this period."}
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {backordered.slice(0, 8).map((v) => (
                  <li key={v.product_id} className="flex justify-between gap-2">
                    <span className="truncate">{v.product_name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {v.times_backordered}×
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product movement</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Per day</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Days of cover</TableHead>
                <TableHead>Class</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <EmptyRow colSpan={6}>Loading…</EmptyRow>
              ) : velocity.length === 0 ? (
                <EmptyRow colSpan={6}>
                  No stock-tracked products yet. Load the product catalogue to see
                  movement here.
                </EmptyRow>
              ) : (
                velocity.slice(0, 25).map((v) => (
                  <TableRow key={v.product_id}>
                    <TableCell>
                      <div className="font-medium">{v.product_name}</div>
                      {v.brand && (
                        <div className="text-xs text-muted-foreground">{v.brand}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.units_sold}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {Number(v.avg_units_per_day).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.qty_available}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.days_of_stock_remaining == null ? (
                        // Not "infinite" — a line with no sales has an unknown
                        // number of days of cover, and showing a big number would
                        // rank it as healthy when it is the opposite.
                        <span className="text-muted-foreground">—</span>
                      ) : Number(v.days_of_stock_remaining) < 14 ? (
                        <span className="font-medium text-amber-600">
                          {Number(v.days_of_stock_remaining).toFixed(0)}
                        </span>
                      ) : (
                        Number(v.days_of_stock_remaining).toFixed(0)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={v.movement_class === "no_movement" ? "outline" : "secondary"}
                      >
                        {v.movement_class.replace("_", " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
