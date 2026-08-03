"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchOrders, type OrderListRow } from "@/lib/orders";
import { ORDER_STATUSES, STATUS_LABELS } from "@/lib/warehouse";

/** Which statuses read as "needs somebody to do something". */
const ACTIVE = new Set(["new", "confirmed", "picking", "packed", "dispatched"]);

export default function OrdersPage() {
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seeded from `?q=` and `?status=` so the warehouse tiles and the header
  // search can land here already filtered. Read from `window` rather than
  // `useSearchParams`, which in this version of Next forces the page into a
  // Suspense boundary — the build refuses to prerender otherwise. The same
  // reasoning, and the same suppression, as the representatives page: the
  // query string is browser-only state, so a lazy initialiser would read it on
  // the client and not on the server and the two renders would disagree.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const s = params.get("status");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setSearch(q);
    // Only a status this page actually offers. An unknown one from a stale or
    // hand-edited link would leave the select showing nothing and the table
    // empty, with no clue that the filter was the reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s && (s === "all" || (ORDER_STATUSES as readonly string[]).includes(s))) {
      setStatus(s);
    }
  }, []);

  // The term the *query* runs on, held a beat behind the box so typing does
  // not fire a request per keystroke. Without this the server-side search in
  // `fetchOrders` is never reached and the 200-row limit is still the real
  // horizon, which was the whole point of moving the filter into the query.
  const [queryTerm, setQueryTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQueryTerm(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchOrders(supabase, { status, search: queryTerm });
        if (cancelled) return;
        setOrders(rows);
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
  }, [supabase, status, queryTerm]);

  // Kept over the rows already fetched, so the table narrows on the keystroke
  // rather than waiting on the debounce. The query above is what decides which
  // orders exist to filter; this only makes the wait feel shorter.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        (o.store_name ?? "").toLowerCase().includes(q) ||
        (o.contact_name ?? "").toLowerCase().includes(q)
    );
  }, [orders, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Everything captured by a rep or keyed here.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/orders/new" />}>
          <Plus className="mr-1.5 h-4 w-4" /> Capture an order
        </Button>
      </div>

      <ErrorBanner message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number, store or contact"
            className="pl-8"
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-48"
          aria-label="Status"
        >
          <option value="all">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead>Captured</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={7}>Loading…</EmptyRow>
            ) : visible.length === 0 ? (
              <EmptyRow colSpan={7}>
                {search.trim() || status !== "all"
                  ? "No orders match those filters."
                  : "No orders yet. Capture one, or wait for a rep to send one in."}
              </EmptyRow>
            ) : (
              visible.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {o.order_number}
                    </Link>
                    {o.on_hold && (
                      <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-600">
                        on hold
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{o.store_name ?? "—"}</div>
                    {o.contact_name && (
                      <div className="text-xs text-muted-foreground">{o.contact_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.source === "rep_app" ? "Rep app" : "Keyed"}
                    {o.received_via !== "other" && (
                      <span className="text-xs"> · {o.received_via.replace("_", " ")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        o.status === "cancelled"
                          ? "outline"
                          : ACTIVE.has(o.status)
                            ? "secondary"
                            : "default"
                      }
                    >
                      {STATUS_LABELS[o.status] ?? o.status}
                    </Badge>
                    {o.status === "delivered" && o.pod_status === "outstanding" && (
                      <Badge variant="outline" className="ml-1.5 border-destructive/50 text-destructive">
                        POD due
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{o.line_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.units}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString()}
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
