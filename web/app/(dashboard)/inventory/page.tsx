"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  CalendarClock,
  ClipboardList,
  PackagePlus,
  ArrowLeftRight,
  SlidersHorizontal,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  fetchLocations,
  fetchStockOnHand,
  fetchStockPosition,
  fetchExpiring,
  type StockLocation,
  type StockLine,
  type StockPosition,
  type ExpiringBatch,
} from "@/lib/warehouse";

/**
 * What we have, where, and in what condition.
 *
 * The seven buckets are shown as separate columns rather than rolled into one
 * "stock" figure, because the difference between them is the whole point:
 * available is what can be sold, reserved is already promised, and damaged and
 * expired are losses that somebody needs to look at. A single number would hide
 * all three.
 *
 * The location picker only appears when there is more than one place to choose
 * between — asking somebody to pick from a list of one is noise.
 */
export default function InventoryPage() {
  const supabase = createClient();
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [lines, setLines] = useState<StockLine[]>([]);
  const [position, setPosition] = useState<StockPosition | null>(null);
  const [expiring, setExpiring] = useState<ExpiringBatch[]>([]);
  const [search, setSearch] = useState("");
  const [onlyBelowMin, setOnlyBelowMin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No state is set before the first await. The `cancelled` flag matters here
  // more than elsewhere: changing the location or the filter re-runs this, and
  // a slow earlier response must not overwrite a newer one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loc = locationId || null;
        const [locs, rows, pos, exp] = await Promise.all([
          fetchLocations(supabase),
          fetchStockOnHand(supabase, { locationId: loc, onlyBelowMin }),
          fetchStockPosition(supabase, loc),
          fetchExpiring(supabase, 90, loc),
        ]);
        if (cancelled) return;
        setLocations(locs);
        setLines(rows);
        setPosition(pos);
        setExpiring(exp);
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
  }, [supabase, locationId, onlyBelowMin]);

  // Filtered in the browser rather than re-querying on every keystroke. The
  // RPC takes a search term too, and the page uses it on reload; this keeps
  // typing instant on a list this size.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.product_name.toLowerCase().includes(q) ||
        (l.brand ?? "").toLowerCase().includes(q) ||
        (l.sku_code ?? "").toLowerCase().includes(q)
    );
  }, [lines, search]);

  const expiringSoon = expiring.filter((e) => Number(e.days_until_expiry) <= 30);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Stock on hand, by product and condition.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/inventory/adjustments" />}
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Adjustments
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/inventory/transfers" />}
          >
            <ArrowLeftRight className="mr-1.5 h-4 w-4" /> Transfers
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/inventory/stocktakes" />}
          >
            <ClipboardList className="mr-1.5 h-4 w-4" /> Stocktakes
          </Button>
          <Button nativeButton={false} render={<Link href="/inventory/receive" />}>
            <PackagePlus className="mr-1.5 h-4 w-4" /> Receive stock
          </Button>
        </div>
        {locations.length > 1 && (
          <NativeSelect
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-56"
            aria-label="Location"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile label="Available" value={Number(position?.qty_available ?? 0)} />
        <StatTile label="Reserved" value={Number(position?.qty_reserved ?? 0)} sub="promised to orders" />
        <StatTile label="In transit" value={Number(position?.qty_in_transit ?? 0)} sub="on a van or between sites" />
        <StatTile
          label="Damaged"
          value={Number(position?.qty_damaged ?? 0)}
          tone={Number(position?.qty_damaged ?? 0) > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Expired"
          value={Number(position?.qty_expired ?? 0)}
          tone={Number(position?.qty_expired ?? 0) > 0 ? "bad" : "neutral"}
        />
        <StatTile label="Promotional" value={Number(position?.qty_promotional ?? 0)} />
      </div>

      {expiringSoon.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Expiring within 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {expiringSoon.slice(0, 8).map((e) => (
                <li key={`${e.batch_id}-${e.location_id}`} className="flex justify-between gap-3">
                  <span className="truncate">
                    {e.product_name}{" "}
                    <span className="text-muted-foreground">· {e.batch_number}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {e.qty_on_hand} units ·{" "}
                    <span className={e.already_expired ? "text-destructive" : "text-amber-600"}>
                      {e.already_expired
                        ? `expired ${Math.abs(Number(e.days_until_expiry))} d ago`
                        : `${e.days_until_expiry} d left`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, brand or SKU"
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyBelowMin}
            onChange={(e) => setOnlyBelowMin(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Only below minimum
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              {locations.length > 1 && <TableHead>Location</TableHead>}
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Damaged</TableHead>
              <TableHead className="text-right">Expired</TableHead>
              <TableHead className="text-right">In transit</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Minimum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={9}>Loading…</EmptyRow>
            ) : visible.length === 0 ? (
              <EmptyRow colSpan={9}>
                {search.trim() || onlyBelowMin
                  ? "Nothing matches those filters."
                  : "No stock recorded yet. Receive a delivery to get started."}
              </EmptyRow>
            ) : (
              visible.map((l) => (
                <TableRow key={`${l.product_id}-${l.location_id}`}>
                  <TableCell>
                    <div className="font-medium">{l.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[l.brand, l.sku_code].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  {locations.length > 1 && (
                    <TableCell className="text-muted-foreground">{l.location_name}</TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    <span className={l.is_out_of_stock ? "font-semibold text-destructive" : undefined}>
                      {l.qty_available}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {l.qty_reserved}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.qty_damaged > 0 ? (
                      <span className="text-amber-600 dark:text-amber-500">{l.qty_damaged}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.qty_expired > 0 ? (
                      <span className="text-destructive">{l.qty_expired}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {l.qty_in_transit}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {l.qty_on_hand}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.min_stock_level == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : l.is_below_min ? (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                        below {l.min_stock_level}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{l.min_stock_level}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
