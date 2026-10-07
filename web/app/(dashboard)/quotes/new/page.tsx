"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  fetchVatRate,
  matchProducts,
  netPrice,
  orderTotals,
  unitPriceFor,
} from "@/lib/orders";
import { createQuote } from "@/lib/quotes";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

type Product = Awaited<ReturnType<typeof fetchOrderableProducts>>[number];
type Line = { productId: string; qty: string; price: string; discount: string };

/** Thirty days out, as YYYY-MM-DD — the usual life of a price offer. */
function defaultValidUntil(today = new Date()) {
  const d = new Date(today);
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

/**
 * Writing a quote.
 *
 * Products are added only through the search box, one line each — a quote is
 * usually a handful of lines read off a customer's request, and a search that
 * takes a SKU or a scanned barcode is faster than a dropdown per line. Stock
 * is not shown: nothing is reserved until the quote becomes an order, and the
 * order screen checks availability then.
 */
export default function NewQuotePage() {
  const supabase = createClient();
  const t = useTerms();
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reps, setReps] = useState<{ id: string; full_name: string }[]>([]);
  const [vatRate, setVatRate] = useState(0);

  const [storeId, setStoreId] = useState("");
  const [storeQuery, setStoreQuery] = useState("");
  const [storeOpen, setStoreOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [repId, setRepId] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [productQuery, setProductQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, s, p, r, vat] = await Promise.all([
          fetchOrgId(supabase),
          fetchStoresForOrder(supabase),
          fetchOrderableProducts(supabase),
          fetchRepsForOrder(supabase),
          fetchVatRate(supabase),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setStores(s);
        setProducts(p);
        setReps(r);
        setVatRate(vat);
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

  const storeMatches = useMemo(() => {
    const q = storeQuery.trim().toLowerCase();
    const list = q
      ? stores.filter(
          (s) => s.name.toLowerCase().includes(q) || (s.city ?? "").toLowerCase().includes(q)
        )
      : stores;
    return list.slice(0, 8);
  }, [stores, storeQuery]);

  const productMatches = matchProducts(products, productQuery);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const totals = orderTotals(
    lines.map((l) => ({
      qty: Number(l.qty) || 0,
      unitPrice: netPrice(Number(l.price) || 0, Number(l.discount) || 0),
    })),
    vatRate
  );

  function addProduct(p: Product) {
    setLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev.map((l) =>
            l.productId === p.id ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l
          )
        : [...prev, { productId: p.id, qty: "1", price: unitPriceFor(p) ?? "", discount: "" }]
    );
    setProductQuery("");
  }

  function update(productId: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  async function save() {
    setError(null);
    if (!orgId) return;
    if (!storeId) {
      setError(`Choose the ${lower(t.site.one)} this quote is for.`);
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one product.");
      return;
    }
    if (lines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)) {
      setError("Quantities are whole units above zero.");
      return;
    }
    if (lines.some((l) => l.price === "" || Number(l.price) < 0)) {
      setError("Every line needs a price.");
      return;
    }
    if (lines.some((l) => Number(l.discount) < 0 || Number(l.discount) > 100)) {
      setError("A discount is a percentage between 0 and 100.");
      return;
    }
    setSaving(true);
    try {
      const id = await createQuote(supabase, {
        orgId,
        storeId,
        contactName,
        contactPhone,
        repId: repId || null,
        validUntil: validUntil || null,
        deliveryAddress: deliveryAddress.trim() || null,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: Number(l.qty),
          listPrice: Number(l.price),
          discountPct: Number(l.discount) || 0,
        })),
      });
      router.push(`/quotes/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/quotes" className="text-sm text-muted-foreground hover:text-foreground">
          ← Quotes
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">New quote</h1>
      </div>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.client.one}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="relative sm:col-span-2">
            <Label htmlFor="store">{t.site.one}</Label>
            <Input
              id="store"
              value={storeQuery}
              placeholder="Search by name or town"
              autoComplete="off"
              onFocus={() => setStoreOpen(true)}
              // Delayed, as on the order form: on touch screens blur can land before the
              // tap, and the list would unmount before the choice registers.
              onBlur={() => setTimeout(() => setStoreOpen(false), 150)}
              onChange={(e) => {
                setStoreQuery(e.target.value);
                setStoreOpen(true);
                if (storeId) setStoreId("");
              }}
            />
            {storeOpen && !storeId && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                {storeMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => {
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
                {storeMatches.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No {lower(t.site.one)} matches.
                  </p>
                )}
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="contact">Contact name</Label>
            <Input id="contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="phone">Contact phone</Label>
            <Input id="phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rep">{t.staff.one}</Label>
            <NativeSelect id="rep" value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">{`No ${lower(t.staff.one)}`}</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="valid">Valid until</Label>
            <Input
              id="valid"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="delivery">Delivery address</Label>
            <Input
              id="delivery"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder={`Leave blank to deliver to the ${lower(t.site.one)}`}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                  addProduct(productMatches[0]);
                }
              }}
              placeholder="Search by product name, SKU or barcode"
              aria-label="Search products"
              className="pl-9"
              disabled={loading}
            />
            {productQuery.trim() && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                {productMatches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => addProduct(p)}
                  >
                    <span className="min-w-0 truncate">
                      {p.name}
                      {p.brand && <span className="text-muted-foreground"> — {p.brand}</span>}
                    </span>
                    {p.sku_code && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {p.sku_code}
                      </span>
                    )}
                  </button>
                ))}
                {productMatches.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No product matches.</p>
                )}
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No products yet. Search above to add one.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_7rem_5.5rem_6rem_2.5rem]">
                <span>Product</span>
                <span>Qty</span>
                <span>Price/unit</span>
                <span>Discount</span>
                <span className="text-right">Line total</span>
                <span />
              </div>
              {lines.map((l) => {
                const p = byId.get(l.productId);
                const lineTotal =
                  (Number(l.qty) || 0) * netPrice(Number(l.price) || 0, Number(l.discount) || 0);
                return (
                  <div
                    key={l.productId}
                    className="grid items-center gap-2 sm:grid-cols-[1fr_5rem_7rem_5.5rem_6rem_2.5rem]"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {p?.name}
                      {p?.brand && <span className="text-muted-foreground"> — {p.brand}</span>}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => update(l.productId, { qty: e.target.value })}
                      aria-label="Quantity"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.price}
                      onChange={(e) => update(l.productId, { price: e.target.value })}
                      aria-label="Price per unit"
                    />
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={l.discount}
                        onChange={(e) => update(l.productId, { discount: e.target.value })}
                        placeholder="0"
                        aria-label="Discount percentage"
                        className="pr-7"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                    <span className="text-right text-sm tabular-nums">{lineTotal.toFixed(2)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove line"
                      onClick={() =>
                        setLines((prev) => prev.filter((x) => x.productId !== l.productId))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="ml-auto w-56 space-y-0.5 border-t border-border pt-2 text-sm">
            <p className="flex justify-between text-muted-foreground">
              Subtotal <span className="tabular-nums text-foreground">{totals.subtotal.toFixed(2)}</span>
            </p>
            <p className="flex justify-between text-muted-foreground">
              VAT {vatRate}% <span className="tabular-nums text-foreground">{totals.vat.toFixed(2)}</span>
            </p>
            <p className="flex justify-between font-medium">
              Total <span className="tabular-nums">{totals.total.toFixed(2)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/quotes" />}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save quote"}
        </Button>
      </div>
    </div>
  );
}
