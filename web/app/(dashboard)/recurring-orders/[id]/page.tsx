"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { RecurringForm } from "@/components/recurring/recurring-form";
import {
  deleteRecurringOrder,
  fetchRecurringOrder,
  FREQUENCIES,
  placeNow,
  RECURRING_STATUS,
  setRecurringStatus,
  type RecurringDetail,
} from "@/lib/recurring";

/**
 * One recurring order: what it places, when next, and every time it ran.
 *
 * A run that failed — no products, a store since deactivated — is listed with
 * its reason rather than vanishing, so "why didn't Friday's order come
 * through?" has an answer on this page.
 */
export default function RecurringOrderPage() {
  const supabase = createClient();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RecurringDetail | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchRecurringOrder(supabase, id);
      setDetail(d);
      const { data } = await supabase.from("stores").select("name").eq("id", d.recurring.store_id).maybeSingle();
      setStoreName((data as { name: string } | null)?.name ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {!error && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  const r = detail.recurring;

  if (editing) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Edit {r.name}</h1>
        <RecurringForm
          existing={detail}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/recurring-orders" className="text-sm text-muted-foreground hover:text-foreground">
            ← Recurring orders
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{r.name}</h1>
            <Badge variant={r.status === "active" ? "secondary" : "outline"}>{RECURRING_STATUS[r.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {storeName ?? "—"} · {FREQUENCIES[r.frequency] ?? r.frequency}
            {r.status === "active" && ` · next ${r.next_run}`} · placed {r.runs}
            {r.max_runs ? ` of ${r.max_runs}` : ""} times
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.status === "active" && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!window.confirm("Place this order now, as a new order for the warehouse?")) return;
                  const orderId = await placeNow(supabase, r.id);
                  // The RPC raises when nothing was placed; this guards the
                  // navigation anyway, because "/orders/null" is a dead end.
                  if (!orderId) {
                    await load();
                    throw new Error("No order was placed. It may already have run today.");
                  }
                  router.push(`/orders/${orderId}`);
                })
              }
            >
              Place now
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          {r.status === "active" ? (
            <Button variant="outline" disabled={busy} onClick={() => run(async () => { await setRecurringStatus(supabase, r.id, "paused"); await load(); })}>
              Pause
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => run(async () => { await setRecurringStatus(supabase, r.id, "active"); await load(); })}>
              Resume
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!window.confirm(`Delete "${r.name}"? Orders it already placed are kept.`)) return;
                await deleteRecurringOrder(supabase, r.id);
                router.push("/recurring-orders");
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {r.status === "active" && r.next_run < localToday() && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
          The next date has passed. It will be placed on the next morning run, once — not once for each missed date.
        </p>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Products</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((l) => (
                <ProductRow key={l.id} productId={l.product_id} qty={l.qty} price={l.unit_price} discount={Number(l.discount_pct)} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {detail.runs.length === 0 && <EmptyRow colSpan={3}>Not placed yet.</EmptyRow>}
              {detail.runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-muted-foreground">{run.run_date}</TableCell>
                  <TableCell>
                    {run.order_id ? (
                      <Link href={`/orders/${run.order_id}`} className="text-primary hover:underline">
                        {run.order_number ?? "Order"}
                      </Link>
                    ) : (
                      <span className="text-destructive">Not placed</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{run.error ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Today as YYYY-MM-DD in the browser's own zone; toISOString would give UTC's. */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ProductRow({ productId, qty, price, discount }: { productId: string; qty: number; price: number | null; discount: number }) {
  const supabase = createClient();
  const [name, setName] = useState("…");
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("products")
      .select("name")
      .eq("id", productId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setName((data as { name: string } | null)?.name ?? "Unknown product"));
    return () => {
      cancelled = true;
    };
  }, [supabase, productId]);
  return (
    <TableRow>
      <TableCell>{name}</TableCell>
      <TableCell className="text-right tabular-nums">{qty}</TableCell>
      <TableCell className="text-right tabular-nums">{price == null ? "List price" : Number(price).toFixed(2)}</TableCell>
      <TableCell className="text-right tabular-nums">{discount ? `${discount}%` : "—"}</TableCell>
    </TableRow>
  );
}
