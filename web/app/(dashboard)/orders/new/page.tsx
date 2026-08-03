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
  fetchOrderableProducts,
  fetchStoresForOrder,
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

  const [storeId, setStoreId] = useState("");
  const [receivedVia, setReceivedVia] = useState<string>("whatsapp");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Draft[]>([blankLine()]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, s, p, st] = await Promise.all([
          fetchOrgId(supabase),
          fetchStoresForOrder(supabase),
          fetchOrderableProducts(supabase),
          fetchStockOnHand(supabase, {}),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setStores(s);
        setProducts(p);
        setStock(st);
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

  const total = lines.reduce((sum, l) => {
    const q = Number(l.qty) || 0;
    const p = Number(l.unitPrice) || 0;
    return sum + q * p;
  }, 0);

  const usedProducts = new Set(lines.map((l) => l.productId).filter(Boolean));

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
          <div className="sm:col-span-2">
            <Label htmlFor="store">Store</Label>
            <NativeSelect
              id="store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={loading}
            >
              <option value="">
                {loading ? "Loading stores…" : "Choose a store"}
              </option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.city ? ` — ${s.city}` : ""}
                </option>
              ))}
            </NativeSelect>
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
                      update(l.key, {
                        productId: e.target.value,
                        // Prefill the trade price so the clerk does not retype
                        // it, but leave it editable — a negotiated price is
                        // exactly the kind of thing a phone order carries.
                        unitPrice:
                          l.unitPrice === "" && prefill != null ? prefill : l.unitPrice,
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
            <p className="text-sm text-muted-foreground">
              Order total{" "}
              <span className="font-medium tabular-nums text-foreground">
                {total.toFixed(2)}
              </span>
            </p>
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
