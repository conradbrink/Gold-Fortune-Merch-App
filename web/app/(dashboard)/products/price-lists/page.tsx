"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  deletePriceList,
  differenceFromOwn,
  fetchPriceLists,
  fetchStoreGroupUse,
  savePriceList,
  type PriceList,
  type StoreGroupUse,
} from "@/lib/price-lists";
import { validPrice } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

type Product = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  units_per_shrink: number | null;
  shrink_price_excl_vat: number | null;
};

type Draft = {
  id: string | null;
  name: string;
  groupIds: string[];
  /** Product id to the price typed, per case; blank is "own price". */
  prices: Record<string, string>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Price lists: a group of stores that pays different prices gets its own
 * list (owner, 15 Oct 2026: "my admin staff invoices for a forecourt, then the
 * forecourt prices are already put in"). A store is charged its group's list
 * price, and the product's own price for anything the list leaves out; the
 * database prices every order line saved without one the same way.
 *
 * One page: the lists, and the one being edited opened under them. Saving
 * sends the name, every price and the groups together, so a half-saved list
 * cannot exist.
 */
export default function PriceListsPage() {
  const supabase = createClient();
  const t = useTerms();
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const [lists, setLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<StoreGroupUse[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, g, p] = await Promise.all([
        fetchPriceLists(supabase),
        fetchStoreGroupUse(supabase),
        supabase
          .from("products")
          .select("id, name, brand, category, units_per_shrink, shrink_price_excl_vat")
          .eq("active", true)
          .order("category")
          .order("name"),
      ]);
      if (p.error) throw new Error(p.error.message);
      setLists(l);
      setGroups(g);
      setProducts(
        ((p.data ?? []) as Product[]).map((x) => ({
          ...x,
          shrink_price_excl_vat: x.shrink_price_excl_vat == null ? null : Number(x.shrink_price_excl_vat),
        }))
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists]);
  const storesIn = (groupIds: string[]) =>
    groupIds.reduce((n, id) => n + (groups.find((g) => g.id === id)?.stores ?? 0), 0);

  function open(list: PriceList | null) {
    setNotice(null);
    setError(null);
    setSearch("");
    setDraft(
      list
        ? {
            id: list.id,
            name: list.name,
            groupIds: list.groupIds,
            prices: Object.fromEntries(Object.entries(list.prices).map(([k, v]) => [k, v.toFixed(2)])),
          }
        : { id: null, name: "", groupIds: [], prices: {} }
    );
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.brand, p.category].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [products, search]);

  // Prices this list holds for products no longer in use: kept as they are,
  // because saving replaces the whole list.
  const hiddenPrices = draft
    ? Object.keys(draft.prices).filter((id) => draft.prices[id] !== "" && !products.some((p) => p.id === id)).length
    : 0;

  async function save() {
    if (!draft) return;
    setError(null);
    setNotice(null);
    const name = draft.name.trim();
    if (!name) return setError("Give the price list a name, for example Forecourts.");
    const bad = Object.entries(draft.prices).find(([, v]) => v.trim() !== "" && !validPrice(v));
    if (bad) {
      const p = products.find((x) => x.id === bad[0]);
      return setError(`${p?.name ?? "A product"}: a price is a number of 0 or more, to the cent.`);
    }
    setBusy(true);
    try {
      const prices = Object.fromEntries(
        Object.entries(draft.prices)
          .filter(([, v]) => v.trim() !== "")
          .map(([k, v]) => [k, Number(v)])
      );
      await savePriceList(supabase, { id: draft.id, name, groupIds: draft.groupIds, prices });
      const n = Object.keys(prices).length;
      setNotice(
        `${name} saved: ${plural(n, "price", "prices")}, used by ${plural(storesIn(draft.groupIds), lower(t.site.one), lower(t.site.many))}.`
      );
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (
      !window.confirm(
        `Delete the ${draft.name} price list? Its ${lower(t.site_group.many)} go back to the products' own prices. Orders already priced keep their prices.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deletePriceList(supabase, draft.id);
      setNotice(`${draft.name} deleted.`);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleGroup(id: string, on: boolean) {
    setDraft((d) =>
      d && { ...d, groupIds: on ? [...d.groupIds, id] : d.groupIds.filter((g) => g !== id) }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Price lists</h1>
          <p className="text-sm text-muted-foreground">
            Give a {lower(t.site_group.one)} of {lower(t.site.many)} its own prices. Every order for a{" "}
            {lower(t.site.one)} in that {lower(t.site_group.one)} is priced from its list, and from the
            product&rsquo;s own price for anything the list leaves out. Your team&rsquo;s orders arrive
            with these prices already filled in.
          </p>
        </div>
        <Button disabled={busy || draft !== null} onClick={() => open(null)}>
          <Plus className="mr-1.5 h-4 w-4" /> New price list
        </Button>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Price list</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead className="w-36 text-right">Prices set</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={4}>Loading…</EmptyRow>}
            {!loading && lists.length === 0 && (
              <EmptyRow colSpan={4}>
                No price lists yet. Make one for a {lower(t.site_group.one)} that pays different prices,
                like your forecourts, and tick the {lower(t.site_group.many)} it is for. Until then every{" "}
                {lower(t.site.one)} pays the products&rsquo; own prices.
              </EmptyRow>
            )}
            {lists.map((l) => {
              const set = Object.keys(l.prices).filter((id) => products.some((p) => p.id === id)).length;
              return (
                <TableRow key={l.id} className={draft?.id === l.id ? "bg-muted/40" : undefined}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>
                    {l.groupIds.length === 0 ? (
                      <span className="text-muted-foreground">
                        No {lower(t.site_group.one)} yet, so no {lower(t.site.one)} uses it
                      </span>
                    ) : (
                      <>
                        {l.groupIds.map((g) => groupName.get(g) ?? "").join(", ")}
                        <span className="block text-xs text-muted-foreground">
                          {plural(storesIn(l.groupIds), lower(t.site.one), lower(t.site.many))}
                        </span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {set} of {products.length}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={busy || draft !== null} onClick={() => open(l)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {draft.id ? `Edit ${listName.get(draft.id) ?? draft.name}` : "New price list"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="max-w-sm">
              <Label htmlFor="list-name">Name</Label>
              <Input
                id="list-name"
                value={draft.name}
                maxLength={80}
                autoFocus
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium">Used by these {lower(t.site_group.many)}</legend>
              <p className="mb-2 text-xs text-muted-foreground">
                A {lower(t.site_group.one)} uses one list. Ticking one that is on another list moves it to this one.
              </p>
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You have no {lower(t.site_group.many)} yet. Add them on the {t.site.many} page.
                </p>
              ) : (
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {groups.map((g) => {
                    const on = draft.groupIds.includes(g.id);
                    const elsewhere = g.priceListId && g.priceListId !== draft.id ? listName.get(g.priceListId) : null;
                    return (
                      <label key={g.id} className="flex min-h-11 items-start gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4"
                          checked={on}
                          onChange={(e) => toggleGroup(g.id, e.target.checked)}
                        />
                        <span>
                          {g.name}{" "}
                          <span className="text-muted-foreground">
                            ({plural(g.stores, lower(t.site.one), lower(t.site.many))})
                          </span>
                          {elsewhere && (
                            <span className="block text-xs text-muted-foreground">
                              {on ? `Moves here from ${elsewhere}` : `On ${elsewhere}`}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Prices per case, excluding VAT</p>
                  <p className="text-xs text-muted-foreground">
                    Leave a box empty to charge the product&rsquo;s own price.
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search products"
                    aria-label="Search products"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="w-24 text-right">Per case</TableHead>
                      <TableHead className="w-32 text-right">Own price</TableHead>
                      <TableHead className="w-40 text-right">This list</TableHead>
                      <TableHead className="w-24 text-right">Difference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.length === 0 && (
                      <EmptyRow colSpan={5}>
                        {products.length === 0 ? "You have no products in use yet." : `No product matches "${search.trim()}".`}
                      </EmptyRow>
                    )}
                    {shown.map((p) => {
                      const raw = draft.prices[p.id] ?? "";
                      const typed = raw.trim() !== "" && validPrice(raw) ? Number(raw) : null;
                      const diff = typed == null ? null : differenceFromOwn(typed, p.shrink_price_excl_vat);
                      const invalid = raw.trim() !== "" && !validPrice(raw);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <span className="font-medium">{p.name}</span>
                            {p.category && <span className="block text-xs text-muted-foreground">{p.category}</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{p.units_per_shrink ?? "Not set"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.shrink_price_excl_vat == null ? (
                              <span className="text-muted-foreground">Not set</span>
                            ) : (
                              formatMoney(p.shrink_price_excl_vat, currency)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              className="ml-auto h-8 w-32 text-right tabular-nums"
                              aria-label={`${draft.name || "This list"}'s price per case for ${p.name}`}
                              aria-invalid={invalid || undefined}
                              placeholder={p.shrink_price_excl_vat == null ? "" : p.shrink_price_excl_vat.toFixed(2)}
                              value={raw}
                              onChange={(e) =>
                                setDraft({ ...draft, prices: { ...draft.prices, [p.id]: e.target.value } })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                            {invalid ? <span className="text-destructive">Not a price</span> : (diff ?? "")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {hiddenPrices > 0 && (
                <p className="text-xs text-muted-foreground">
                  This list also keeps {plural(hiddenPrices, "price", "prices")} for products no longer in use.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <div>
                {draft.id && (
                  <Button variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>
                    Delete price list
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={save}>
                  {busy ? "Saving…" : "Save price list"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
