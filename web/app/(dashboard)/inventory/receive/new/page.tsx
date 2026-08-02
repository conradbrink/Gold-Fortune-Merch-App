"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import { fetchLocations, type StockLocation } from "@/lib/warehouse";
import {
  createReceipt,
  fetchSuppliers,
  RECEIPT_TYPES,
  UOMS,
} from "@/lib/receiving";

type Draft = {
  key: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  uom: string;
  unitsPerUom: string;
  qtyReceived: string;
  qtyDamaged: string;
  unitCost: string;
};

const blank = (): Draft => ({
  key: crypto.randomUUID(),
  productId: "",
  batchNumber: "",
  expiryDate: "",
  uom: "each",
  unitsPerUom: "",
  qtyReceived: "1",
  qtyDamaged: "0",
  unitCost: "",
});

/**
 * Keying a delivery.
 *
 * The line shows what the quantity will become in base units as it is typed,
 * because "10" of a shrink of twelve is a hundred and twenty and that is the
 * number the shelf will hold. The multiplier itself is only asked for on a
 * case, which the catalogue has no factor for; for `each` and `shrink` the
 * server resolves it at post time and freezes what it used onto the line.
 *
 * Batch and expiry appear only for products that are batch-tracked, because the
 * post RPC refuses a batch number on a product that is not — better to not
 * offer the box than to explain the refusal afterwards.
 */
export default function NewReceiptPage() {
  const supabase = createClient();
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<
    { id: string; name: string; brand: string | null; is_batch_tracked: boolean; units_per_shrink: number | null }[]
  >([]);

  const [receiptType, setReceiptType] = useState("supplier");
  const [supplierId, setSupplierId] = useState("");
  const [supplierText, setSupplierText] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [locationId, setLocationId] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Draft[]>([blank()]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, locs, sups, prods] = await Promise.all([
          fetchOrgId(supabase),
          fetchLocations(supabase),
          fetchSuppliers(supabase),
          supabase
            .from("products")
            .select("id, name, brand, is_batch_tracked, units_per_shrink")
            .eq("active", true)
            .eq("is_stock_tracked", true)
            .order("name"),
        ]);
        if (cancelled) return;
        if (prods.error) throw new Error(prods.error.message);
        setOrgId(org);
        setLocations(locs);
        setSuppliers(sups);
        setProducts(prods.data ?? []);
        setLocationId(locs.find((l) => l.is_default)?.id ?? locs[0]?.id ?? "");
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

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function update(key: string, patch: Partial<Draft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** What a line will become in base units, or null when it cannot be known yet. */
  function baseUnits(l: Draft): number | null {
    const qty = Number(l.qtyReceived) || 0;
    if (qty <= 0) return null;
    if (l.uom === "each") return qty;
    if (l.uom === "case") {
      const f = Number(l.unitsPerUom) || 0;
      return f > 0 ? qty * f : null;
    }
    const p = byId.get(l.productId);
    return p?.units_per_shrink ? qty * p.units_per_shrink : null;
  }

  async function save() {
    setError(null);
    if (!orgId) {
      setError("Could not work out which organisation you belong to. Reload and try again.");
      return;
    }
    if (!locationId) {
      setError("Choose where the stock is being received.");
      return;
    }
    const supplierName =
      receiptType === "supplier"
        ? (suppliers.find((s) => s.id === supplierId)?.name ?? supplierText.trim())
        : null;
    if (receiptType === "supplier" && !supplierName) {
      setError("A supplier delivery has to say who it came from.");
      return;
    }

    const filled = lines.filter((l) => l.productId && Number(l.qtyReceived) > 0);
    if (filled.length === 0) {
      setError("Add at least one line with a quantity.");
      return;
    }
    for (const l of filled) {
      const p = byId.get(l.productId);
      if (p?.is_batch_tracked && !l.batchNumber.trim()) {
        setError(`${p.name} is batch-tracked — every line needs a batch number.`);
        return;
      }
      if (l.uom === "case" && !(Number(l.unitsPerUom) > 0)) {
        setError(
          `How many units are in a case of ${p?.name ?? "that product"}? The catalogue does not know.`
        );
        return;
      }
      if (l.uom === "shrink" && !p?.units_per_shrink) {
        setError(
          `${p?.name ?? "That product"} has no pack size on record, so it cannot be received in shrinks.`
        );
        return;
      }
      if (Number(l.qtyDamaged) > Number(l.qtyReceived)) {
        setError("More damaged than received on one line.");
        return;
      }
    }

    setSaving(true);
    try {
      const id = await createReceipt(supabase, {
        orgId,
        receiptType,
        supplierId: supplierId || null,
        supplierName,
        invoiceNumber: invoiceNumber.trim() || null,
        locationId,
        receivedAt: receivedAt ? new Date(receivedAt).toISOString() : null,
        notes: notes.trim() || null,
        lines: filled.map((l) => ({
          productId: l.productId,
          batchNumber: l.batchNumber.trim() || null,
          expiryDate: l.expiryDate || null,
          uom: l.uom,
          unitsPerUom: l.unitsPerUom ? Number(l.unitsPerUom) : null,
          qtyReceived: Number(l.qtyReceived),
          qtyDamaged: Number(l.qtyDamaged) || 0,
          unitCost: l.unitCost === "" ? null : Number(l.unitCost),
        })),
      });
      router.push(`/inventory/receive/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/inventory/receive"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Goods received
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Receive a delivery</h1>
        <p className="text-sm text-muted-foreground">
          Saved as a draft. Nothing enters stock until you post it.
        </p>
      </div>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The delivery</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="type">Type</Label>
            <NativeSelect
              id="type"
              value={receiptType}
              onChange={(e) => setReceiptType(e.target.value)}
            >
              {RECEIPT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="location">Received into</Label>
            <NativeSelect
              id="location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              disabled={loading}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {receiptType === "supplier" && (
            <>
              <div>
                <Label htmlFor="supplier">Supplier</Label>
                <NativeSelect
                  id="supplier"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Not on the list</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
                {!supplierId && (
                  <Input
                    className="mt-2"
                    value={supplierText}
                    onChange={(e) => setSupplierText(e.target.value)}
                    placeholder="Supplier name"
                    aria-label="Supplier name"
                  />
                )}
              </div>
              <div>
                <Label htmlFor="invoice">Invoice number</Label>
                <Input
                  id="invoice"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <Label htmlFor="when">Received at</Label>
            <Input
              id="when"
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave blank for now. Yesterday&apos;s delivery keyed this morning should
              carry yesterday&apos;s date.
            </p>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What arrived</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {products.length === 0 && !loading && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
              There are no stock-tracked products yet. Load the product catalogue first.
            </p>
          )}

          {lines.map((l) => {
            const p = byId.get(l.productId);
            const base = baseUnits(l);
            return (
              <div key={l.key} className="rounded-lg border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <NativeSelect
                    value={l.productId}
                    onChange={(e) => update(l.key, { productId: e.target.value })}
                    aria-label="Product"
                  >
                    <option value="">Choose a product</option>
                    {products.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.brand ? ` — ${x.brand}` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length === 1 ? [blank()] : prev.filter((x) => x.key !== l.key)
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <NativeSelect
                      value={l.uom}
                      onChange={(e) => update(l.key, { uom: e.target.value })}
                      aria-label="Unit of measure"
                    >
                      {UOMS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  {l.uom === "case" && (
                    <div>
                      <Label className="text-xs">Units per case</Label>
                      <Input
                        type="number"
                        min={1}
                        value={l.unitsPerUom}
                        onChange={(e) => update(l.key, { unitsPerUom: e.target.value })}
                      />
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      value={l.qtyReceived}
                      onChange={(e) => update(l.key, { qtyReceived: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Damaged</Label>
                    <Input
                      type="number"
                      min={0}
                      value={l.qtyDamaged}
                      onChange={(e) => update(l.key, { qtyDamaged: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Cost per {l.uom}</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.unitCost}
                      onChange={(e) => update(l.key, { unitCost: e.target.value })}
                    />
                  </div>
                </div>

                {p?.is_batch_tracked && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Batch number</Label>
                      <Input
                        value={l.batchNumber}
                        onChange={(e) => update(l.key, { batchNumber: e.target.value })}
                        placeholder="Required — this product is batch-tracked"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Expiry date</Label>
                      <Input
                        type="date"
                        value={l.expiryDate}
                        onChange={(e) => update(l.key, { expiryDate: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  {base === null
                    ? l.uom === "shrink" && p && !p.units_per_shrink
                      ? "This product has no pack size on record, so it cannot be received in shrinks."
                      : "Enter a quantity to see the units."
                    : `${base} base unit${base === 1 ? "" : "s"} into stock` +
                      (Number(l.qtyDamaged) > 0
                        ? ` — ${Number(l.qtyDamaged) * (base / (Number(l.qtyReceived) || 1))} of them damaged`
                        : "")}
                </p>
              </div>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, blank()])}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add a line
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/inventory/receive" />}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
