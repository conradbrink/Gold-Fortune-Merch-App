"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportProductsButton } from "@/components/products/import-dialog";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgId } from "@/lib/representatives";
import type { Tables } from "@/lib/supabase/types";

type ProductRow = Tables<"products">;

type DeleteImpact = {
  product_name: string | null;
  promotions: number;
  promotions_live: number;
  checks: number;
  stores_answered: number;
};

const emptyForm = {
  name: "",
  brand: "",
  category: "",
  unit_barcode: "",
  shrink_barcode: "",
  units_per_shrink: "",
  shrink_price_excl_vat: "",
  shrink_price_incl_vat: "",
  sku_code: "",
};

/** Trade price of a shrink, as printed on the price card. */
function money(v: number | string | null): string {
  if (v === null) return "—";
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ProductsPage() {
  const supabase = createClient();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, org] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      fetchOrgId(supabase),
    ]);
    setProducts((data ?? []) as ProductRow[]);
    setOrgId(org);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Options come from what is actually present, like the Stores page's town
  // filter — an empty dropdown is worse than no dropdown, and nothing on the
  // current price card fills `category`.
  const brands = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.brand).filter(Boolean) as string[])).sort(),
    [products]
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(products.map((p) => p.category).filter(Boolean) as string[])
      ).sort(),
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => (showInactive ? true : p.active))
      .filter((p) => (brandFilter ? p.brand === brandFilter : true))
      .filter((p) => (categoryFilter ? p.category === categoryFilter : true))
      .filter((p) =>
        q === ""
          ? true
          : [p.name, p.brand, p.sku_code, p.unit_barcode, p.shrink_barcode]
              .filter(Boolean)
              .some((v) => (v as string).toLowerCase().includes(q))
      );
  }, [products, search, brandFilter, categoryFilter, showInactive]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      brand: p.brand ?? "",
      category: p.category ?? "",
      unit_barcode: p.unit_barcode ?? "",
      shrink_barcode: p.shrink_barcode ?? "",
      units_per_shrink: p.units_per_shrink === null ? "" : String(p.units_per_shrink),
      shrink_price_excl_vat:
        p.shrink_price_excl_vat === null ? "" : String(p.shrink_price_excl_vat),
      shrink_price_incl_vat:
        p.shrink_price_incl_vat === null ? "" : String(p.shrink_price_incl_vat),
      sku_code: p.sku_code ?? "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !orgId) return;
    setSaving(true);
    setError(null);
    // Empty strings must become null, or a blank barcode would collide with
    // every other blank barcode under the partial unique indexes.
    const blank = (v: string) => (v.trim() === "" ? null : v.trim());
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const payload = {
      org_id: orgId,
      name: form.name.trim(),
      brand: blank(form.brand),
      category: blank(form.category),
      unit_barcode: blank(form.unit_barcode),
      shrink_barcode: blank(form.shrink_barcode),
      units_per_shrink: num(form.units_per_shrink),
      shrink_price_excl_vat: num(form.shrink_price_excl_vat),
      shrink_price_incl_vat: num(form.shrink_price_incl_vat),
      sku_code: blank(form.sku_code),
    };
    try {
      const q = editingId
        ? supabase.from("products").update(payload).eq("id", editingId)
        : supabase.from("products").insert(payload);
      const { error: e } = await q;
      if (e) throw new Error(e.message);
      setDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  /** Deactivating is the ordinary action — it keeps every answer on record. */
  async function toggleActive(p: ProductRow) {
    setBusyRow(p.id);
    const before = products;
    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x))
    );
    const { error: e } = await supabase
      .from("products")
      .update({ active: !p.active })
      .eq("id", p.id);
    if (e) {
      setProducts(before);
      setError(e.message);
    }
    setBusyRow(null);
  }

  async function askDelete(p: ProductRow) {
    setDeleteTarget(p);
    setImpact(null);
    const { data } = await supabase.rpc("product_delete_impact", {
      p_product_id: p.id,
    });
    const row = (data as DeleteImpact[] | null)?.[0] ?? null;
    setImpact(row);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyRow(deleteTarget.id);
    const { error: e } = await supabase
      .from("products")
      .delete()
      .eq("id", deleteTarget.id);
    if (e) setError(e.message);
    else setProducts((prev) => prev.filter((x) => x.id !== deleteTarget.id));
    setDeleteTarget(null);
    setBusyRow(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Products
          </h1>
          <p className="text-sm text-muted-foreground">
            The lines you stock. A promotion is built from these, and an
            out-of-stock report can only name a line that is on this list.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportProductsButton onImported={load} />
          <Button
            size="sm"
            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            New product
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <Input
            placeholder="Search by name, brand, barcode or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {brands.length > 0 && (
          <div className="w-full sm:w-48">
            <NativeSelect
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              aria-label="Filter by brand"
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {categories.length > 0 && (
          <div className="w-full sm:w-48">
            <NativeSelect
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="hidden md:table-cell">Brand</TableHead>
              <TableHead className="hidden lg:table-cell">Unit barcode</TableHead>
              <TableHead className="hidden xl:table-cell">Shrink</TableHead>
              <TableHead className="text-right">Excl. VAT</TableHead>
              <TableHead className="text-right">Incl. VAT</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {products.length === 0
                    ? "No products yet. Import a price card to get started."
                    : "No products match."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((p) => (
              <TableRow key={p.id} className={busyRow === p.id ? "opacity-60" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {p.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          p.brand,
                          p.category,
                          p.units_per_shrink ? `${p.units_per_shrink} per shrink` : null,
                          p.active ? null : "Inactive",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {p.brand ?? "—"}
                </TableCell>
                <TableCell className="hidden font-mono text-xs lg:table-cell">
                  {p.unit_barcode ?? "—"}
                </TableCell>
                <TableCell className="hidden font-mono text-xs xl:table-cell">
                  {p.shrink_barcode ?? "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {money(p.shrink_price_excl_vat)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {money(p.shrink_price_incl_vat)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleActive(p)}>
                        {p.active ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => askDelete(p)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Prices are the trade price of a shrink, from the price card. Shelf prices
        differ store to store and are recorded per visit.
      </p>

      {/* Inline rather than a nested dialog, matching the Files page: the
          consequence is stated before the destructive button appears. */}
      {deleteTarget && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-semibold text-destructive">
            Delete “{deleteTarget.name}”?
          </p>
          {impact === null ? (
            <p className="mt-1 text-xs text-muted-foreground">Checking what this would affect…</p>
          ) : (
            <p className="mt-1 text-xs text-foreground">
              {impact.checks === 0 && impact.promotions === 0 ? (
                "Nothing references this line yet, so nothing else is affected."
              ) : (
                <>
                  It is on <strong>{impact.promotions}</strong> promotion
                  {impact.promotions === 1 ? "" : "s"}
                  {impact.promotions_live > 0 && (
                    <>
                      {" "}
                      (<strong>{impact.promotions_live}</strong> running right now)
                    </>
                  )}{" "}
                  and has <strong>{impact.checks}</strong> recorded answer
                  {impact.checks === 1 ? "" : "s"} from{" "}
                  <strong>{impact.stores_answered}</strong> outlet
                  {impact.stores_answered === 1 ? "" : "s"}. Deleting erases those
                  answers and changes the figures on promotions that have already
                  finished. Deactivating keeps them.
                </>
              )}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={impact === null}
              onClick={confirmDelete}
            >
              Delete anyway
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                toggleActive(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Deactivate instead
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit product" : "New product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Brand" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} />
              <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              <Field
                label="Unit barcode"
                hint="On the item a shopper picks up"
                value={form.unit_barcode}
                onChange={(v) => setForm({ ...form, unit_barcode: v })}
              />
              <Field
                label="Shrink barcode"
                hint="On the outer the store receives"
                value={form.shrink_barcode}
                onChange={(v) => setForm({ ...form, shrink_barcode: v })}
              />
              <Field
                label="Units per shrink"
                value={form.units_per_shrink}
                onChange={(v) => setForm({ ...form, units_per_shrink: v })}
              />
              <Field label="SKU code" value={form.sku_code} onChange={(v) => setForm({ ...form, sku_code: v })} />
              <Field
                label="Shrink price excl. VAT"
                value={form.shrink_price_excl_vat}
                onChange={(v) => setForm({ ...form, shrink_price_excl_vat: v })}
              />
              <Field
                label="Shrink price incl. VAT"
                value={form.shrink_price_incl_vat}
                onChange={(v) => setForm({ ...form, shrink_price_incl_vat: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={save}
              disabled={saving || !form.name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Create product"}
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
