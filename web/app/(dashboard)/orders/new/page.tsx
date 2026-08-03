"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import {
  createManualOrder,
  createStoreInline,
  fetchOrderableProducts,
  fetchStoresForOrder,
  fetchRepsForOrder,
  fetchVatRate,
  orderTotals,
  RECEIVED_VIA,
} from "@/lib/orders";
import { fetchStockOnHand, type StockLine } from "@/lib/warehouse";

type Draft = { key: string; productId: string; qty: string; unitPrice: string };

const blankLine = (): Draft => ({
  key: crypto.randomUUID(),
  productId: "",
  qty: "1",
  unitPrice: "",
});

/**
 * The trade price on a product is per shrink, but a line is priced per base
 * unit — the same unit `qty_ordered` counts in, and the same unit the shortage
 * hint and the reservation work in. Dividing here is what stops a ten-unit line
 * being charged at ten times the pack price.
 *
 * Null when the pack size is unknown, so the clerk is asked rather than given a
 * figure derived from a missing factor.
 */
function unitPriceFor(p: {
  units_per_shrink: number | null;
  shrink_price_excl_vat: number | null;
}): string | null {
  if (p.shrink_price_excl_vat == null) return null;
  if (p.units_per_shrink == null || p.units_per_shrink <= 0) return null;
  return (p.shrink_price_excl_vat / p.units_per_shrink).toFixed(2);
}

/**
 * Keying an order that arrived by WhatsApp, email or telephone.
 *
 * Available stock is shown beside each line as it is chosen, because the clerk
 * is often still on the phone and "we have 40" is the answer the customer needs
 * before the order is placed rather than after it is confirmed. It is a hint,
 * not a gate: the order is saved regardless, and the real check happens at
 * confirm time under a row lock, where it cannot race.
 */
export default function NewOrderPage() {
  const supabase = createClient();
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [products, setProducts] = useState<
    {
      id: string;
      name: string;
      brand: string | null;
      units_per_shrink: number | null;
      shrink_price_excl_vat: number | null;
    }[]
  >([]);
  const [stock, setStock] = useState<StockLine[]>([]);
  const [reps, setReps] = useState<{ id: string; full_name: string }[]>([]);
  const [vatRate, setVatRate] = useState(0);

  const [storeId, setStoreId] = useState("");
  const [receivedVia, setReceivedVia] = useState<string>("whatsapp");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [notes, setNotes] = useState("");
  const [repId, setRepId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");

  // The store picker. 211 stores makes a plain <select> a scroll through the
  // alphabet, so this is a search box over the same list. `storeQuery` is what
  // has been typed; a selection writes the store's name into it, and typing
  // anything afterwards clears the selection so the text and the choice can
  // never disagree.
  const [storeQuery, setStoreQuery] = useState("");
  const [storeOpen, setStoreOpen] = useState(false);
  const [addingStore, setAddingStore] = useState(false);
  const [newStoreCity, setNewStoreCity] = useState("");
  const [newStoreAddress, setNewStoreAddress] = useState("");
  const [creatingStore, setCreatingStore] = useState(false);
  const [lines, setLines] = useState<Draft[]>([blankLine()]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, s, p, st, r, vat] = await Promise.all([
          fetchOrgId(supabase),
          fetchStoresForOrder(supabase),
          fetchOrderableProducts(supabase),
          fetchStockOnHand(supabase, {}),
          fetchRepsForOrder(supabase),
          fetchVatRate(supabase),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setStores(s);
        setProducts(p);
        setStock(st);
        setReps(r);
        setVatRate(vat);
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

  const availableFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) {
      m.set(s.product_id, (m.get(s.product_id) ?? 0) + s.qty_available);
    }
    return m;
  }, [stock]);

  function update(key: string, patch: Partial<Draft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Line prices are VAT-exclusive, matching what the catalogue prefills, so
  // the subtotal is the sum of them and VAT sits on top.
  const totals = orderTotals(
    lines.map((l) => ({
      qty: Number(l.qty) || 0,
      unitPrice: Number(l.unitPrice) || 0,
    })),
    vatRate
  );

  const usedProducts = new Set(lines.map((l) => l.productId).filter(Boolean));

  // Name or town, case-blind, capped so the list stays a list. The full set is
  // already in memory — 211 stores is a couple of kilobytes — so this is a
  // filter, not a query.
  const storeMatches = useMemo(() => {
    const q = storeQuery.trim().toLowerCase();
    if (!q) return stores.slice(0, 8);
    return stores
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.city ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [stores, storeQuery]);

  async function addStore() {
    if (!orgId) return setError("Could not work out your organisation. Reload and try again.");
    const name = storeQuery.trim();
    if (!name) return setError("The store needs a name — type it in the search box.");
    setCreatingStore(true);
    setError(null);
    try {
      const created = await createStoreInline(supabase, {
        orgId,
        name,
        city: newStoreCity,
        address: newStoreAddress,
      });
      // Into the local list too, so it is findable again without a reload.
      setStores((prev) =>
        [...prev, { id: created.id, name: created.name, city: created.city }].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      setStoreId(created.id);
      setStoreQuery(created.name + (created.city ? ` — ${created.city}` : ""));
      setAddingStore(false);
      setNewStoreCity("");
      setNewStoreAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingStore(false);
    }
  }

  async function save() {
    setError(null);

    if (!orgId) {
      setError("Could not work out which organisation you belong to. Reload and try again.");
      return;
    }
    if (!storeId) {
      setError("Choose the store this order is for.");
      return;
    }
    const filled = lines.filter((l) => l.productId && Number(l.qty) > 0);
    if (filled.length === 0) {
      setError("Add at least one product with a quantity.");
      return;
    }
    // `min`/`step` on a number input are advisory; a typed or pasted 1.5 gets
    // through, and `order_lines.qty_ordered` is an integer column. Caught here
    // so the clerk gets this sentence rather than a PostgREST cast error.
    if (filled.some((l) => !Number.isInteger(Number(l.qty)))) {
      setError("Quantities are whole units. Round each line to a whole number.");
      return;
    }
    // One line per product is a database constraint; catching it here gives a
    // sentence instead of a unique-violation.
    const ids = filled.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) {
      setError("The same product appears on more than one line. Combine them into one.");
      return;
    }

    setSaving(true);
    try {
      const id = await createManualOrder(supabase, {
        orgId,
        storeId,
        receivedVia,
        contactName,
        contactPhone,
        requiredBy: requiredBy || null,
        notes,
        repId: repId || null,
        invoiceNumber: invoiceNumber.trim() || null,
        lines: filled.map((l) => ({
          productId: l.productId,
          qty: Number(l.qty),
          unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
        })),
      });
      router.push(`/orders/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-muted-foreground hover:underline">
          ← Orders
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Capture an order</h1>
        <p className="text-sm text-muted-foreground">
          For an order that came in by WhatsApp, email or telephone.
        </p>
      </div>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="relative sm:col-span-2">
            <Label htmlFor="store">Store</Label>
            <Input
              id="store"
              value={storeQuery}
              disabled={loading}
              placeholder={loading ? "Loading stores…" : "Search by name or town"}
              autoComplete="off"
              onFocus={() => setStoreOpen(true)}
              // Delayed so a click on a result lands before the list unmounts.
              onBlur={() => setTimeout(() => setStoreOpen(false), 150)}
              onChange={(e) => {
                setStoreQuery(e.target.value);
                setStoreOpen(true);
                if (storeId) setStoreId("");
              }}
            />
            {storeId && (
              <p className="mt-1 text-xs text-muted-foreground">
                Selected — typing again will change it.
              </p>
            )}
            {storeOpen && !storeId && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                {storeMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => {
                      // mousedown, not click: the input's blur fires first
                      // otherwise and the list is gone before the click lands.
                      e.preventDefault();
                      setStoreId(m.id);
                      setStoreQuery(m.name + (m.city ? ` — ${m.city}` : ""));
                      setStoreOpen(false);
                    }}
                  >
                    {m.name}
                    {m.city && <span className="text-muted-foreground"> — {m.city}</span>}
                  </button>
                ))}
                {storeMatches.length === 0 && storeQuery.trim() && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No store matches &ldquo;{storeQuery.trim()}&rdquo;.
                  </p>
                )}
                {storeQuery.trim() && (
                  <button
                    type="button"
                    className="block w-full border-t border-border px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setAddingStore(true);
                      setStoreOpen(false);
                    }}
                  >
                    + Add &ldquo;{storeQuery.trim()}&rdquo; as a new store
                  </button>
                )}
              </div>
            )}
            {addingStore && (
              <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">
                  New store: {storeQuery.trim()}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={newStoreCity}
                    onChange={(e) => setNewStoreCity(e.target.value)}
                    placeholder="Town / city"
                    aria-label="Town or city"
                  />
                  <Input
                    value={newStoreAddress}
                    onChange={(e) => setNewStoreAddress(e.target.value)}
                    placeholder="Address (optional)"
                    aria-label="Address"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={creatingStore} onClick={addStore}>
                    {creatingStore ? "Adding…" : "Add store"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAddingStore(false)}
                    disabled={creatingStore}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Just enough to take the order. Groups, territory and the map
                  pin live on the Stores screen.
                </p>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="via">How did it arrive?</Label>
            <NativeSelect
              id="via"
              value={receivedVia}
              onChange={(e) => setReceivedVia(e.target.value)}
            >
              {RECEIVED_VIA.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="required">Required by</Label>
            <Input
              id="required"
              type="date"
              value={requiredBy}
              onChange={(e) => setRequiredBy(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="contact">Contact name</Label>
            <Input
              id="contact"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Who placed the order"
            />
          </div>
          <div>
            <Label htmlFor="phone">Contact phone</Label>
            <Input
              id="phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rep">Rep responsible</Label>
            <NativeSelect
              id="rep"
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              disabled={loading}
            >
              {/* An order with nobody attached is a real answer, not a missing
                  one — a shop that rang the office is not any rep's call. */}
              <option value="">No rep</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="invoice">Invoice number</Label>
            <Input
              id="invoice"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="As on QuickBooks — can be added later"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the picker or driver needs to know"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {products.length === 0 && !loading && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
              There are no stock-tracked products yet. Load the product catalogue
              before capturing orders.
            </p>
          )}

          {lines.map((l) => {
            const available = l.productId ? (availableFor.get(l.productId) ?? 0) : null;
            const wanted = Number(l.qty) || 0;
            const short = available !== null && wanted > available;
            const chosen = products.find((p) => p.id === l.productId);
            return (
              <div key={l.key} className="grid gap-2 sm:grid-cols-[1fr_6rem_7rem_2.5rem]">
                <div>
                  <NativeSelect
                    value={l.productId}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      const prefill = p ? unitPriceFor(p) : null;

                      // Changing the product has to move the price with it.
                      // Only re-prefilling an empty box meant that picking A,
                      // taking its price, then switching the line to B left
                      // A's price sitting there — the order saves at the wrong
                      // figure and nothing on screen says so.
                      //
                      // A price the clerk typed themselves is theirs and is
                      // kept: a negotiated price is exactly what a phone order
                      // carries, and overwriting it would be worse.
                      const previous = products.find((x) => x.id === l.productId);
                      const previousPrefill = previous ? unitPriceFor(previous) : null;
                      const untouched =
                        l.unitPrice === "" || l.unitPrice === previousPrefill;

                      update(l.key, {
                        productId: e.target.value,
                        unitPrice:
                          untouched && prefill != null ? prefill : l.unitPrice,
                      });
                    }}
                    aria-label="Product"
                  >
                    <option value="">Choose a product</option>
                    {products
                      .filter((p) => p.id === l.productId || !usedProducts.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.brand ? ` — ${p.brand}` : ""}
                        </option>
                      ))}
                  </NativeSelect>
                  {available !== null && (
                    <p
                      className={
                        short
                          ? "mt-1 text-xs text-amber-600 dark:text-amber-500"
                          : "mt-1 text-xs text-muted-foreground"
                      }
                    >
                      {available} available
                      {chosen?.units_per_shrink
                        ? ` · ${chosen.units_per_shrink} per shrink`
                        : ""}
                      {short && ` — ${wanted - available} short of this order`}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => update(l.key, { qty: e.target.value })}
                  aria-label="Quantity"
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.unitPrice}
                  onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                  placeholder="Per unit"
                  aria-label="Price per unit"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line"
                  onClick={() =>
                    setLines((prev) =>
                      prev.length === 1 ? [blankLine()] : prev.filter((x) => x.key !== l.key)
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add a line
            </Button>
            <div className="space-y-0.5 text-right text-sm">
              <p className="text-muted-foreground">
                Subtotal{" "}
                <span className="ml-2 tabular-nums text-foreground">
                  {totals.subtotal.toFixed(2)}
                </span>
              </p>
              <p className="text-muted-foreground">
                VAT {vatRate}%{" "}
                <span className="ml-2 tabular-nums text-foreground">
                  {totals.vat.toFixed(2)}
                </span>
              </p>
              <p className="border-t border-border pt-1 font-medium">
                Total{" "}
                <span className="ml-2 tabular-nums">{totals.total.toFixed(2)}</span>
              </p>
              {vatRate === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  No VAT rate is set. A manager can set it in Settings → Company.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/orders" />}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save order"}
        </Button>
      </div>
    </div>
  );
}
