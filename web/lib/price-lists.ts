import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { allByKey, type KeyedQuery } from "@/lib/all-pages";

/**
 * Price lists for groups of stores (owner, 15 Oct 2026: "automatic pricing
 * structures that I can create per group").
 *
 * A list is a name and a price per case for some products. Each store group
 * uses at most one; a store is charged from its group's list, and from the
 * product's own price for anything the list leaves out. The database applies
 * the same rule to every order line saved without a price
 * (`order_lines_price_from_list`), so the figure prefilled here is the figure a
 * rep's order arrives with.
 *
 * Prices are per case (shrink) excluding VAT, like
 * `products.shrink_price_excl_vat`. Written only through `price_list_save` and
 * `price_list_delete`, which need the invoicing permission.
 */

type Client = SupabaseClient<Database>;

export type PriceList = {
  id: string;
  name: string;
  updatedAt: string;
  /** The store groups that use this list. */
  groupIds: string[];
  /** Product id to price per case, excluding VAT. */
  prices: Record<string, number>;
};

/** The list one store is charged from, as the order screens need it. */
export type StorePriceList = {
  name: string;
  prices: Record<string, number>;
};

/** Store group id to its list. A group with no list is not in it. */
export type PriceBook = Record<string, StorePriceList>;

export type StoreGroupUse = {
  id: string;
  name: string;
  priceListId: string | null;
  /** Active stores in the group. */
  stores: number;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function fetchPriceLists(supabase: Client): Promise<PriceList[]> {
  const [lists, items, groups] = await Promise.all([
    supabase.from("customer_price_lists").select("id, name, updated_at").order("name"),
    supabase.from("customer_price_list_items").select("price_list_id, product_id, shrink_price_excl_vat"),
    supabase.from("store_groups").select("id, price_list_id").not("price_list_id", "is", null),
  ]);
  fail(lists.error);
  fail(items.error);
  fail(groups.error);
  return (lists.data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    updatedAt: l.updated_at,
    groupIds: (groups.data ?? []).filter((g) => g.price_list_id === l.id).map((g) => g.id),
    prices: Object.fromEntries(
      (items.data ?? [])
        .filter((i) => i.price_list_id === l.id)
        .map((i) => [i.product_id, Number(i.shrink_price_excl_vat)])
    ),
  }));
}

/**
 * Every group with a list, keyed by group. One read for a whole screen: a
 * company has a handful of lists, and the order screens change store often.
 */
export async function fetchPriceBook(supabase: Client): Promise<PriceBook> {
  const lists = await fetchPriceLists(supabase);
  const book: PriceBook = {};
  for (const l of lists) {
    for (const g of l.groupIds) book[g] = { name: l.name, prices: l.prices };
  }
  return book;
}

/** The list a store in this group is charged from, or null for own prices. */
export function listForGroup(book: PriceBook, groupId: string | null | undefined): StorePriceList | null {
  return groupId ? (book[groupId] ?? null) : null;
}

export async function fetchStoreGroupUse(supabase: Client): Promise<StoreGroupUse[]> {
  const [groups, stores] = await Promise.all([
    supabase.from("store_groups").select("id, name, price_list_id").order("name"),
    // Paged: a response stops at 1,000 rows whatever the limit asks for.
    allByKey<{ id: string; store_group_id: string | null }>(
      () =>
        supabase
          .from("stores")
          .select("id, store_group_id")
          .eq("active", true)
          .not("store_group_id", "is", null) as unknown as KeyedQuery<{ id: string; store_group_id: string | null }>
    ),
  ]);
  fail(groups.error);
  const counts = new Map<string, number>();
  for (const s of stores) {
    if (s.store_group_id) counts.set(s.store_group_id, (counts.get(s.store_group_id) ?? 0) + 1);
  }
  return (groups.data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    priceListId: g.price_list_id,
    stores: counts.get(g.id) ?? 0,
  }));
}

/**
 * Saves a list's name, every price on it and the groups using it, in one
 * call: all of it or none. A product with no price here is charged its own
 * price. A group ticked here moves to this list from any other.
 */
export async function savePriceList(
  supabase: Client,
  input: {
    id: string | null;
    name: string;
    groupIds: string[];
    prices: Record<string, number>;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("price_list_save", {
    p_id: input.id,
    p_name: input.name,
    p_group_ids: input.groupIds,
    p_prices: Object.entries(input.prices).map(([product_id, price]) => ({ product_id, price })),
  });
  fail(error);
  return data as string;
}

export async function deletePriceList(supabase: Client, id: string) {
  const { error } = await supabase.rpc("price_list_delete", { p_id: id });
  fail(error);
}

/** "+8.0%", "-2.5%" or "Same": a list price against the product's own. */
export function differenceFromOwn(listPrice: number, ownPrice: number | null): string | null {
  if (ownPrice == null || ownPrice <= 0) return null;
  const pct = ((listPrice - ownPrice) / ownPrice) * 100;
  if (Math.abs(pct) < 0.05) return "Same";
  return `${pct > 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`;
}
