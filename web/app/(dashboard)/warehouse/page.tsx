"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PackageCheck, Truck, FileWarning } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  fetchPipeline,
  fetchMissingPods,
  fetchLowStock,
  fetchStockPosition,
  STATUS_LABELS,
  type PipelineRow,
  type MissingPodRow,
  type LowStockAlert,
  type StockPosition,
} from "@/lib/warehouse";

/**
 * The warehouse clerk's home, and a manager's first glance at the floor.
 *
 * Answers the four questions somebody standing in the warehouse actually has,
 * in the order they have them: what has come in, what needs picking, what is
 * going out, and what paperwork is outstanding. Everything else is a click
 * away rather than on this page.
 */
export default function WarehousePage() {
  const supabase = createClient();
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [pods, setPods] = useState<MissingPodRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [position, setPosition] = useState<StockPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Nothing is set before the first await, so this does not trip
  // react-hooks/set-state-in-effect — and the `cancelled` flag stops a slow
  // response from a previous render overwriting a newer one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
        const [p, d, l, s] = await Promise.all([
          fetchPipeline(supabase, from, to),
          fetchMissingPods(supabase, 0),
          fetchLowStock(supabase, null),
          fetchStockPosition(supabase, null),
        ]);
        if (cancelled) return;
        setPipeline(p);
        setPods(d);
        setLowStock(l);
        setPosition(s);
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

  const count = (status: string) =>
    Number(pipeline.find((r) => r.status === status)?.orders ?? 0);

  const outOfStock = Number(position?.products_out_of_stock ?? 0);
  const belowMin = Number(position?.products_below_min ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse</h1>
        <p className="text-sm text-muted-foreground">
          What is waiting, what is moving, and what is outstanding.
        </p>
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="New orders"
          value={count("new")}
          sub="waiting to be confirmed"
          tone={count("new") > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Awaiting picking"
          value={count("confirmed") + count("picking")}
          sub="confirmed and being picked"
        />
        <StatTile
          label="Awaiting dispatch"
          value={count("packed")}
          sub="packed and ready to go"
        />
        <StatTile
          label="Outstanding PODs"
          value={pods.length}
          sub="delivered, not yet signed for"
          tone={pods.length > 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-4 w-4" /> Order pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Oldest waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <EmptyRow colSpan={4}>Loading…</EmptyRow>
                ) : pipeline.length === 0 ? (
                  <EmptyRow colSpan={4}>
                    No orders in the last 90 days. Orders captured by a rep or keyed
                    here will appear as soon as they arrive.
                  </EmptyRow>
                ) : (
                  pipeline.map((r) => (
                    <TableRow key={r.status}>
                      <TableCell>
                        <Badge variant={r.status === "cancelled" ? "outline" : "secondary"}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.units}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.hours_waiting == null
                          ? "—"
                          : Number(r.hours_waiting) < 24
                            ? `${Number(r.hours_waiting).toFixed(0)} h`
                            : `${Math.floor(Number(r.hours_waiting) / 24)} d`}
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
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Needs ordering
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Out of stock"
                value={outOfStock}
                tone={outOfStock > 0 ? "bad" : "neutral"}
              />
              <StatTile
                label="Below minimum"
                value={belowMin}
                tone={belowMin > 0 ? "warn" : "neutral"}
              />
            </div>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading…" : "Nothing below its reorder point."}
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {lowStock.slice(0, 6).map((a) => (
                  <li
                    key={`${a.product_id}-${a.location_id}`}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="truncate">{a.product_name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {a.qty_available} left · order {a.recommended_order_qty}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/inventory"
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              Open inventory →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileWarning className="h-4 w-4" /> Outstanding proof of delivery
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Received by</TableHead>
                <TableHead className="text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <EmptyRow colSpan={6}>Loading…</EmptyRow>
              ) : pods.length === 0 ? (
                <EmptyRow colSpan={6}>
                  <span className="inline-flex items-center gap-2">
                    <Truck className="h-4 w-4" /> Every delivery has its signed page in.
                  </span>
                </EmptyRow>
              ) : (
                pods.map((p) => (
                  <TableRow key={p.order_id}>
                    <TableCell className="font-medium">{p.order_number}</TableCell>
                    <TableCell>{p.store_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.delivered_at
                        ? new Date(p.delivered_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>{p.driver_name ?? "—"}</TableCell>
                    <TableCell>{p.received_by_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={
                          Number(p.days_outstanding) >= 3 ? "text-destructive" : undefined
                        }
                      >
                        {p.days_outstanding}
                      </span>
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
