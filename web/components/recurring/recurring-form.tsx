"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import {
  fetchOrderableProducts,
  fetchRepsForOrder,
  fetchStoresForOrder,
  unitPriceFor,
} from "@/lib/orders";
import {
  FREQUENCIES,
  saveRecurringOrder,
  type RecurringDetail,
} from "@/lib/recurring";

type Product = Awaited<ReturnType<typeof fetchOrderableProducts>>[number];
type Line = { productId: string; qty: string; price: string; discount: string };

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Creating or editing a recurring order.
 *
 * A blank price means "the catalogue price on the day it is placed", which is
 * what most standing orders want: when the price list changes, next month's
 * order follows it. Type a price only for an agreed one that should not move.
 */
export function RecurringForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: RecurringDetail;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const r = existing?.recurring;
  const [orgId, setOrgId] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reps, setReps] = useState<{ id: string; full_name: string }[]>([]);

  const [name, setName] = useState(r?.name ?? "");
  const [storeId, setStoreId] = useState(r?.store_id ?? "");
  const [repId, setRepId] = useState(r?.rep_id ?? "");
  const [contactName, setContactName] = useState(r?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(r?.contact_phone ?? "");
  const [frequency, setFrequency] = useState(r?.frequency ?? "weekly");
  const [nextRun, setNextRun] = useState(r?.next_run ?? today());
  const [maxRuns, setMaxRuns] = useState(r?.max_runs == null ? "" : String(r.max_runs));
  const [notes, setNotes] = useState(r?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(
    (existing?.lines ?? []).map((l) => ({
      productId: l.product_id,
      qty: String(l.qty),
      price: l.unit_price == null ? "" : String(l.unit_price),
      discount: Number(l.discount_pct) ? String(l.discount_pct) : "",
    }))
  );
  const [productQuery, setProductQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, s, p, rp] = await Promise.all([
          fetchOrgId(supabase),
          fetchStoresForOrder(supabase),
          fetchOrderableProducts(supabase),
          fetchRepsForOrder(supabase),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setStores(s);
        setProducts(p);
        setReps(rp);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // Name or brand anywhere, SKU from the start. Kept local rather than shared
  // with the order form's search so this branch does not depend on that one;
  // the two can become one helper once both are merged.
  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.brand ?? "").toLowerCase().includes(q) ||
          (p.sku_code ?? "").toLowerCase().startsWith(q)
      )
      .slice(0, 8);
  }, [products, productQuery]);
  const shownStores = useMemo(() => {
    const q = storeFilter.trim().toLowerCase();
    const list = q ? stores.filter((s) => s.name.toLowerCase().includes(q) || (s.city ?? "").toLowerCase().includes(q)) : stores;
    // The chosen store stays in the list whatever the filter, or the select
    // would silently show the first match instead.
    return storeId && !list.some((s) => s.id === storeId)
      ? [...stores.filter((s) => s.id === storeId), ...list]
      : list;
  }, [stores, storeFilter, storeId]);

  function add(p: Product) {
    setLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev.map((l) => (l.productId === p.id ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
        : [...prev, { productId: p.id, qty: "1", price: "", discount: "" }]
    );
    setProductQuery("");
  }

  async function save() {
    setError(null);
    if (!orgId) return setError("Still loading your company. Try again in a moment.");
    if (!name.trim()) return setError("Give it a name, like “Weekly bread order”.");
    if (!storeId) return setError("Choose the store.");
    if (!nextRun) return setError("Choose the date of the first order.");
    if (lines.length === 0) return setError("Add at least one product.");
    if (lines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0))
      return setError("Quantities are whole units above zero.");
    if (lines.some((l) => Number(l.discount) < 0 || Number(l.discount) > 100))
      return setError("A discount is a percentage between 0 and 100.");
    setSaving(true);
    try {
      const id = await saveRecurringOrder(
        supabase,
        orgId,
        {
          name: name.trim(),
          storeId,
          repId: repId || null,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          frequency,
          nextRun,
          maxRuns: maxRuns ? Math.max(1, Math.round(Number(maxRuns))) : null,
          notes: notes.trim() || null,
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: Number(l.qty),
            unitPrice: l.price === "" ? null : Number(l.price),
            discountPct: Number(l.discount) || 0,
          })),
        },
        r?.id
      );
      onSaved(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="rname">Name</Label>
            <Input id="rname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly top-up" />
          </div>
          <div>
            <Label htmlFor="rstore-filter">Store</Label>
            <Input id="rstore-filter" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} placeholder="Type to narrow the list" className="mb-1.5" />
            <NativeSelect value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Store">
              <option value="">Choose a store</option>
              {shownStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.city ? ` — ${s.city}` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="rrep">Rep</Label>
            <NativeSelect id="rrep" value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">No rep</option>
              {reps.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.full_name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="rfreq">How often</Label>
            <NativeSelect id="rfreq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {Object.entries(FREQUENCIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="rnext">{r ? "Next order on" : "First order on"}</Label>
            <Input id="rnext" type="date" value={nextRun} onChange={(e) => setNextRun(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rmax">Stop after (orders)</Label>
            <Input id="rmax" type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} placeholder="No limit" />
          </div>
          <div>
            <Label htmlFor="rcontact">Contact name</Label>
            <Input id="rcontact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rphone">Contact phone</Label>
            <Input id="rphone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rnotes">Notes on every order</Label>
            <Input id="rnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && productMatches[0]) {
                  e.preventDefault();
                  add(productMatches[0]);
                }
              }}
              placeholder="Search by product name or SKU"
              aria-label="Search products"
              className="pl-9"
            />
            {productQuery.trim() && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                {productMatches.map((p) => (
                  <button key={p.id} type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => add(p)}>
                    <span className="truncate">{p.name}</span>
                    {p.sku_code && <span className="font-mono text-xs text-muted-foreground">{p.sku_code}</span>}
                  </button>
                ))}
                {productMatches.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No product matches.</p>}
              </div>
            )}
          </div>
          {lines.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No products yet. Search above to add one.</p>
          )}
          {lines.map((l) => {
            const p = byId.get(l.productId);
            const catalogue = p ? unitPriceFor(p) : null;
            return (
              <div key={l.productId} className="grid items-center gap-2 sm:grid-cols-[1fr_5rem_8rem_5.5rem_2.5rem]">
                <span className="truncate text-sm">{p?.name ?? "…"}</span>
                <Input type="number" min={1} value={l.qty} aria-label="Quantity"
                  onChange={(e) => setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, qty: e.target.value } : x)))} />
                <Input type="number" min={0} step="0.01" value={l.price} aria-label="Price per unit"
                  placeholder={catalogue ? `${catalogue} (list)` : "List price"}
                  onChange={(e) => setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, price: e.target.value } : x)))} />
                <div className="relative">
                  <Input type="number" min={0} max={100} step="0.5" value={l.discount} placeholder="0" aria-label="Discount percentage" className="pr-7"
                    onChange={(e) => setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, discount: e.target.value } : x)))} />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <Button variant="ghost" size="icon" aria-label="Remove"
                  onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Leave the price blank to use the catalogue price on the day each order is placed.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save recurring order"}</Button>
      </div>
    </div>
  );
}
