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
import { DiscountInput, DiscountNote } from "@/components/money/discount-input";
import { fetchOrgId } from "@/lib/representatives";
import {
  discountProblem,
  fetchOrderableProducts,
  fetchRepsForOrder,
  fetchStoresForOrder,
  matchProducts,
  netUnitPrice,
  unitPriceFor,
  type DiscountKind,
} from "@/lib/orders";
import { createQuote, fetchQuote, updateQuote, whyQuoteIsFixed, type NewQuoteLine, type QuoteDetail } from "@/lib/quotes";
import { fetchServiceItems, type ServiceItem } from "@/lib/service-items";
import { daysFromToday, fetchDocumentSettings, type DocumentSettings } from "@/lib/document-settings";
import { grossPrice, validPrice } from "@/lib/money-docs";
import { moduleEnabled } from "@/lib/modules";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import { fetchPriceBook, listForGroup, type PriceBook } from "@/lib/price-lists";

type Product = Awaited<ReturnType<typeof fetchOrderableProducts>>[number];
type ProductLine = {
  /** The saved line's id, or a new one: see `updateQuote`. */
  id: string;
  productId: string;
  qty: string;
  price: string;
  discount: string;
  /** A percentage, or an amount off the whole line. */
  discountKind: DiscountKind;
};

/** A saved quote as the form holds it: its client, details and lines, at the prices it was written with. */
function formFromQuote({ quote: q, lines: saved }: QuoteDetail) {
  const billTo: BillTo = q.store_id
    ? { mode: "store", storeId: q.store_id, name: "", email: "", address: "" }
    : { mode: "new", storeId: "", name: q.customer_name ?? "", email: q.contact_email ?? "", address: q.customer_address ?? "" };
  return {
    billTo,
    contactName: q.contact_name ?? "",
    contactPhone: q.contact_phone ?? "",
    repId: q.rep_id ?? "",
    validUntil: q.valid_until ?? "",
    deliveryAddress: q.delivery_address ?? "",
    notes: q.notes ?? "",
    productLines: saved
      .filter((l) => l.product_id !== null)
      .map((l): ProductLine => {
        const amount = Number(l.discount_amount);
        const pct = Number(l.discount_pct);
        return {
          id: l.id,
          productId: l.product_id as string,
          qty: String(Number(l.qty)),
          price: Number(l.list_price).toFixed(2),
          discount: amount > 0 ? String(amount) : pct > 0 ? String(pct) : "",
          discountKind: amount > 0 ? "amount" : "pct",
        };
      }),
    lines: saved
      .filter((l) => l.product_id === null)
      .map(
        (l): EditableLine => ({
          key: l.id,
          serviceItemId: l.service_item_id,
          description: l.description ?? "",
          unit: l.unit ?? "",
          qty: String(Number(l.qty)),
          price: Number(l.list_price).toFixed(2),
        })
      ),
  };
}

/**
 * Writing a quote, or changing one that is still a draft or sent.
 *
 * For a place on the books or for anyone else. Lines come from the price list
 * or are typed in; a company that sells products (Distribution) adds them
 * through the search box as before, and a quote of products can later become
 * an order. A new quote's prices are with or without VAT as the company's
 * settings say; an edited one keeps the VAT rate and basis it was written with.
 */
export function QuoteForm({ quoteId }: { quoteId?: string }) {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const sells = config ? moduleEnabled(config.modules, "distribution") : false;
  const currency = config?.settings.currency_code ?? "";

  const [orgId, setOrgId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentSettings | null>(null);
  // The quote being changed, as it was loaded.
  const [existing, setExisting] = useState<QuoteDetail | null>(null);
  const [stores, setStores] = useState<
    { id: string; name: string; address: string | null; city: string | null; store_group_id: string | null }[]
  >([]);
  // Each store group's price list: a quote to a store starts at that store's prices.
  const [priceBook, setPriceBook] = useState<PriceBook>({});
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
  // Which button was pressed, so only that one says it is saving.
  const [savingToSend, setSavingToSend] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      try {
        const [org, d, s, si, r, p, book, q] = await Promise.all([
          fetchOrgId(supabase),
          fetchDocumentSettings(supabase),
          fetchStoresForOrder(supabase),
          fetchServiceItems(supabase, { activeOnly: true }),
          fetchRepsForOrder(supabase),
          moduleEnabled(config.modules, "distribution") ? fetchOrderableProducts(supabase) : Promise.resolve([]),
          moduleEnabled(config.modules, "distribution") ? fetchPriceBook(supabase) : Promise.resolve({}),
          quoteId ? fetchQuote(supabase, quoteId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPriceBook(book);
        setOrgId(org);
        setDoc(d);
        // A quote for a store made inactive since still shows that store.
        setStores(
          q?.quote.store_id && !s.some((x) => x.id === q.quote.store_id)
            ? [...s, { id: q.quote.store_id, name: q.storeName ?? "—", address: q.storeAddress, city: null, store_group_id: null }]
            : s
        );
        setItems(si);
        setReps(r);
        setProducts(p);
        if (q) {
          const f = formFromQuote(q);
          setExisting(q);
          setBillTo(f.billTo);
          setContactName(f.contactName);
          setContactPhone(f.contactPhone);
          setRepId(f.repId);
          setValidUntil(f.validUntil);
          setDeliveryAddress(f.deliveryAddress);
          setNotes(f.notes);
          setProductLines(f.productLines);
          setLines(f.lines);
          const why = whyQuoteIsFixed(q.quote);
          if (why) setError(why);
        } else {
          setValidUntil(daysFromToday(d.quote_validity_days));
          // From the set-up wizard's last step: the first place, already picked.
          const site = new URLSearchParams(window.location.search).get("site");
          if (site && s.some((x) => x.id === site)) setBillTo((b) => ({ ...b, mode: "store", storeId: site }));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, config, quoteId]);

  const productMatches = matchProducts(products, productQuery);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // A product on the quote that can no longer be ordered still shows its name.
  const savedNames = useMemo(
    () =>
      new Map(
        (existing?.lines ?? [])
          .filter((l) => l.product_id !== null)
          .map((l) => [l.product_id as string, { name: l.label, brand: l.brand }])
      ),
    [existing]
  );
  const vatRate = Number((existing ? existing.quote.vat_rate : doc?.vat_rate) ?? 0);
  const inclusive = (existing ? existing.quote.prices_include_vat : doc?.prices_include_vat) ?? false;
  // Nothing to save over until the quote has loaded, and nothing once it is past changing.
  const locked = quoteId !== undefined && (existing === null || whyQuoteIsFixed(existing.quote) !== null);

  const listOf = (b: BillTo) =>
    b.mode === "store" ? listForGroup(priceBook, stores.find((s) => s.id === b.storeId)?.store_group_id) : null;
  const storeList = listOf(billTo);

  /** A product's price in the quote's own basis: the store's VAT-exclusive price (its price list, or the product's own), with the VAT added when the quote's prices include it. */
  function productPrice(p: Product, list = storeList): string {
    const net = unitPriceFor(p, list);
    return net !== null && inclusive ? grossPrice(Number(net), vatRate).toFixed(2) : (net ?? "");
  }

  /**
   * Changes who the quote is for, and moves the prefilled prices with it: a
   * line still at the last store's price, or empty, takes this one's. A price
   * typed in stays, as on the order screen.
   */
  function changeBillTo(next: BillTo) {
    const before = listOf(billTo);
    const after = listOf(next);
    setBillTo(next);
    if (before === after) return;
    setProductLines((prev) =>
      prev.map((l) => {
        const p = byId.get(l.productId);
        if (!p || (l.price !== "" && l.price !== productPrice(p, before))) return l;
        return { ...l, price: productPrice(p, after) };
      })
    );
  }

  const productTotalsLines = productLines.map((l) => ({
    qty: Number(l.qty) || 0,
    unitPrice: netUnitPrice(Number(l.price) || 0, Number(l.qty) || 0, Number(l.discount) || 0, l.discountKind),
  }));

  function addProduct(p: Product) {
    setProductLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev.map((l) => (l.productId === p.id ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
        : [
            ...prev,
            { id: crypto.randomUUID(), productId: p.id, qty: "1", price: productPrice(p), discount: "", discountKind: "pct" },
          ]
    );
    setProductQuery("");
  }

  function updateProduct(productId: string, patch: Partial<ProductLine>) {
    setProductLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  /** Saves the quote; "Save and send" then opens it with the send box ready. */
  async function save(thenSend = false) {
    setError(null);
    if (!orgId || !doc || locked) return;
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
    for (const l of productLines) {
      const problem = discountProblem({
        qty: Number(l.qty),
        price: Number(l.price),
        discount: Number(l.discount) || 0,
        kind: l.discountKind,
      });
      if (problem) return setError(problem);
    }
    const all: (NewQuoteLine & { id: string })[] = [
      ...productLines.map((l) => ({
        id: l.id,
        kind: "product" as const,
        productId: l.productId,
        qty: Number(l.qty),
        listPrice: Number(l.price),
        discountPct: l.discountKind === "pct" ? Number(l.discount) || 0 : 0,
        discountAmount: l.discountKind === "amount" ? Number(l.discount) || 0 : 0,
      })),
      ...lines.map((l) =>
        l.serviceItemId
          ? {
              id: l.key,
              kind: "service" as const,
              serviceItemId: l.serviceItemId,
              description: l.description,
              unit: l.unit || null,
              qty: Number(l.qty),
              price: Number(l.price),
            }
          : {
              id: l.key,
              kind: "text" as const,
              description: l.description,
              unit: l.unit || null,
              qty: Number(l.qty),
              price: Number(l.price),
            }
      ),
    ];
    setSaving(true);
    setSavingToSend(thenSend);
    const header = {
      orgId,
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
    };
    try {
      let id = quoteId;
      if (id) await updateQuote(supabase, id, header);
      else id = await createQuote(supabase, { ...header, prefix: doc.quote_prefix });
      router.push(thenSend ? `/quotes/${id}?send=1` : `/quotes/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const back = quoteId ? `/quotes/${quoteId}` : "/quotes";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={back} className="text-sm text-muted-foreground hover:text-foreground">
          {existing ? `← ${existing.quote.quote_number}` : "← Quotes"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
          {existing ? `Change ${existing.quote.quote_number}` : quoteId ? "Change quote" : "New quote"}
        </h1>
        {existing?.quote.status === "sent" && !locked && (
          <p className="mt-1 text-sm text-muted-foreground">
            This quote was sent. The {lower(t.client.one)} has the old one until you send it again.
          </p>
        )}
      </div>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.client.one}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <BillToPicker value={billTo} onChange={changeBillTo} stores={stores} disabled={loading} />
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
                <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_7rem_7rem_2.5rem]">
                  <span>Product</span>
                  <span>Qty</span>
                  <span>{inclusive ? "Price incl. VAT" : "Price/unit"}</span>
                  <span>Discount</span>
                  <span />
                </div>
                {productLines.map((l) => {
                  const p = byId.get(l.productId);
                  return (
                    <div key={l.productId} className="grid items-start gap-2 sm:grid-cols-[1fr_5rem_7rem_7rem_2.5rem]">
                      <span className="min-w-0 truncate py-1.5 text-sm">
                        {p?.name ?? savedNames.get(l.productId)?.name}
                        {(p ? p.brand : savedNames.get(l.productId)?.brand) && (
                          <span className="text-muted-foreground"> — {p ? p.brand : savedNames.get(l.productId)?.brand}</span>
                        )}
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
                        aria-label={inclusive ? "Price per unit, VAT included" : "Price per unit"}
                      />
                      <div>
                        <DiscountInput
                          value={l.discount}
                          kind={l.discountKind}
                          onChange={(discount, discountKind) => updateProduct(l.productId, { discount, discountKind })}
                          currency={currency}
                          aria-label="Discount"
                        />
                        <DiscountNote
                          listPrice={validPrice(l.price) ? Number(l.price) : null}
                          qty={Number(l.qty) || 0}
                          discount={Number(l.discount) || 0}
                          kind={l.discountKind}
                          currency={currency}
                        />
                      </div>
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
            otherLines={productTotalsLines}
            disabled={loading}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href={back} />}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => save()} disabled={saving || loading || locked}>
          {saving && !savingToSend ? "Saving…" : existing ? "Save changes" : "Save quote"}
        </Button>
        <Button onClick={() => save(true)} disabled={saving || loading || locked}>
          {saving && savingToSend ? "Saving…" : "Save and send"}
        </Button>
      </div>
    </div>
  );
}
