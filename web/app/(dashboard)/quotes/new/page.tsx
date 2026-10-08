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
import { LineEditor, lineProblem, type EditableLine } from "@/components/money/line-editor";
import { BillToPicker, billToProblem, type BillTo } from "@/components/money/bill-to-picker";
import { fetchOrgId } from "@/lib/representatives";
import {
  fetchOrderableProducts,
  fetchRepsForOrder,
  fetchStoresForOrder,
  matchProducts,
  netPrice,
  unitPriceFor,
} from "@/lib/orders";
import { createQuote, type NewQuoteLine } from "@/lib/quotes";
import { fetchServiceItems, type ServiceItem } from "@/lib/service-items";
import { daysFromToday, fetchDocumentSettings, type DocumentSettings } from "@/lib/document-settings";
import { documentTotals, validPrice } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import { moduleEnabled } from "@/lib/modules";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

type Product = Awaited<ReturnType<typeof fetchOrderableProducts>>[number];
type ProductLine = { productId: string; qty: string; price: string; discount: string };

/**
 * Writing a quote.
 *
 * For a place on the books or for anyone else. Lines come from the price list
 * or are typed in; a company that sells products (Distribution) adds them
 * through the search box as before, and a quote of products can later become
 * an order. Prices are with or without VAT as the company's settings say.
 */
export default function NewQuotePage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const sells = config ? moduleEnabled(config.modules, "distribution") : false;
  const currency = config?.settings.currency_code ?? "";

  const [orgId, setOrgId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentSettings | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; address: string | null; city: string | null }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [reps, setReps] = useState<{ id: string; full_name: string }[]>([]);

  const [billTo, setBillTo] = useState<BillTo>({ mode: "new", storeId: "", name: "", email: "", address: "" });
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [repId, setRepId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [productQuery, setProductQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      try {
        const [org, d, s, si, r, p] = await Promise.all([
          fetchOrgId(supabase),
          fetchDocumentSettings(supabase),
          fetchStoresForOrder(supabase),
          fetchServiceItems(supabase, { activeOnly: true }),
          fetchRepsForOrder(supabase),
          moduleEnabled(config.modules, "distribution") ? fetchOrderableProducts(supabase) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setDoc(d);
        setValidUntil(daysFromToday(d.quote_validity_days));
        setStores(s);
        setItems(si);
        setReps(r);
        setProducts(p);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, config]);

  const productMatches = matchProducts(products, productQuery);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const vatRate = Number(doc?.vat_rate ?? 0);
  const inclusive = doc?.prices_include_vat ?? false;

  const totals = documentTotals(
    [
      ...productLines.map((l) => ({
        qty: Number(l.qty) || 0,
        unitPrice: netPrice(Number(l.price) || 0, Number(l.discount) || 0),
      })),
      ...lines.map((l) => ({ qty: Number(l.qty) || 0, unitPrice: Number(l.price) || 0 })),
    ],
    vatRate,
    inclusive
  );

  function addProduct(p: Product) {
    setProductLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev.map((l) => (l.productId === p.id ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
        : [...prev, { productId: p.id, qty: "1", price: unitPriceFor(p) ?? "", discount: "" }]
    );
    setProductQuery("");
  }

  function updateProduct(productId: string, patch: Partial<ProductLine>) {
    setProductLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  async function save() {
    setError(null);
    if (!orgId || !doc) return;
    const who = billToProblem(billTo, t);
    if (who) return setError(who);
    if (productLines.length === 0 && lines.length === 0) return setError("Add at least one line.");
    if (lines.length > 0) {
      const problem = lineProblem(lines);
      if (problem) return setError(problem);
    }
    if (productLines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)) {
      return setError("Product quantities are whole units above zero.");
    }
    if (productLines.some((l) => !validPrice(l.price))) {
      return setError("Every product needs a price, to the cent.");
    }
    if (productLines.some((l) => Number(l.discount) < 0 || Number(l.discount) > 100)) {
      return setError("A discount is a percentage between 0 and 100.");
    }
    const all: NewQuoteLine[] = [
      ...productLines.map((l) => ({
        kind: "product" as const,
        productId: l.productId,
        qty: Number(l.qty),
        listPrice: Number(l.price),
        discountPct: Number(l.discount) || 0,
      })),
      ...lines.map((l) =>
        l.serviceItemId
          ? {
              kind: "service" as const,
              serviceItemId: l.serviceItemId,
              description: l.description,
              unit: l.unit || null,
              qty: Number(l.qty),
              price: Number(l.price),
            }
          : { kind: "text" as const, description: l.description, unit: l.unit || null, qty: Number(l.qty), price: Number(l.price) }
      ),
    ];
    setSaving(true);
    try {
      const id = await createQuote(supabase, {
        orgId,
        prefix: doc.quote_prefix,
        billTo:
          billTo.mode === "store"
            ? { storeId: billTo.storeId }
            : { name: billTo.name, email: billTo.email, address: billTo.address },
        contactName,
        contactPhone,
        repId: repId || null,
        validUntil: validUntil || null,
        deliveryAddress: deliveryAddress.trim() || null,
        notes,
        lines: all,
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
          <div className="sm:col-span-2">
            <BillToPicker value={billTo} onChange={setBillTo} stores={stores} disabled={loading} />
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
            <Input id="valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          {sells && (
            <div className="sm:col-span-2">
              <Label htmlFor="delivery">Delivery address</Label>
              <Input
                id="delivery"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder={`Leave blank to deliver to the ${lower(t.site.one)}`}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Printed on the quote: what is included, how long the work takes"
            />
          </div>
        </CardContent>
      </Card>

      {sells && (
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
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku_code}</span>
                      )}
                    </button>
                  ))}
                  {productMatches.length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No product matches.</p>
                  )}
                </div>
              )}
            </div>
            {productLines.length > 0 && (
              <div className="space-y-2">
                <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_7rem_5.5rem_2.5rem]">
                  <span>Product</span>
                  <span>Qty</span>
                  <span>Price/unit</span>
                  <span>Discount</span>
                  <span />
                </div>
                {productLines.map((l) => {
                  const p = byId.get(l.productId);
                  return (
                    <div key={l.productId} className="grid items-center gap-2 sm:grid-cols-[1fr_5rem_7rem_5.5rem_2.5rem]">
                      <span className="min-w-0 truncate text-sm">
                        {p?.name}
                        {p?.brand && <span className="text-muted-foreground"> — {p.brand}</span>}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        value={l.qty}
                        onChange={(e) => updateProduct(l.productId, { qty: e.target.value })}
                        aria-label="Quantity"
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.price}
                        onChange={(e) => updateProduct(l.productId, { price: e.target.value })}
                        aria-label="Price per unit"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={l.discount}
                        onChange={(e) => updateProduct(l.productId, { discount: e.target.value })}
                        placeholder="0"
                        aria-label="Discount percentage"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove line"
                        onClick={() => setProductLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{sells ? "Services and other lines" : "Lines"}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineEditor
            lines={lines}
            onChange={setLines}
            items={items}
            currency={currency}
            vatRate={vatRate}
            pricesIncludeVat={inclusive}
            disabled={loading}
          />
          {productLines.length > 0 && (
            <p className="mt-3 text-right text-sm font-medium">
              Quote total, products included: {formatMoney(totals.total, currency)}
            </p>
          )}
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
