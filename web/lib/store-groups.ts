import type { SupabaseClient } from "@supabase/supabase-js";
import { allPages } from "@/lib/all-pages";
import { lower, type Terms } from "@/lib/terms";

/**
 * One store group for a whole page ("Choppies Group", "Forecourts"): the
 * dashboard cards' own pages narrow their tiles, panels and list to it (owner,
 * 15 Oct 2026: "add a filter here per group", then "the same group filter to
 * store health").
 */

/** The choice for the stores in no group. */
export const NO_STORE_GROUP = "none";

/** A company's store groups, and the one each store is in. */
export type StoreGroups = {
  groups: { id: string; name: string }[];
  /** Store id to its group's id; null for a store in no group. */
  groupOf: Map<string, string | null>;
};

export type StoreGroupChoice = { id: string; name: string; n: number };

export async function fetchStoreGroups(supabase: SupabaseClient): Promise<StoreGroups> {
  type Store = { id: string; store_group_id: string | null };
  const [groups, stores] = await Promise.all([
    supabase.from("store_groups").select("id, name").order("name").order("id"),
    // Paged: a response stops at 1,000 rows without saying so.
    allPages<Store>((from, to) =>
      supabase
        .from("stores")
        .select("id, store_group_id")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Store[] | null; error: { message: string } | null }>
    ),
  ]);
  if (groups.error) throw new Error(groups.error.message);
  return {
    groups: (groups.data ?? []) as { id: string; name: string }[],
    groupOf: new Map(stores.map((s) => [s.id, s.store_group_id])),
  };
}

/** The group a store is in, as the picker names it: its id, or NO_STORE_GROUP. */
export function storeGroupOf(storeId: string, groupOf: Map<string, string | null>): string {
  return groupOf.get(storeId) ?? NO_STORE_GROUP;
}

/**
 * The groups to choose from: the ones with a store on the page's list, by
 * name, each with how many, and "No group" last when some store is in none. A
 * group with no store on the list would only ever open an empty page.
 */
export function storeGroupChoices(
  rows: { store_id: string }[],
  { groups, groupOf }: StoreGroups,
  t: Terms
): StoreGroupChoice[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const g = storeGroupOf(r.store_id, groupOf);
    n.set(g, (n.get(g) ?? 0) + 1);
  }
  const named = groups.filter((g) => n.has(g.id)).map((g) => ({ id: g.id, name: g.name, n: n.get(g.id)! }));
  const none = n.get(NO_STORE_GROUP);
  return none ? [...named, { id: NO_STORE_GROUP, name: `No ${lower(t.site_group.one)}`, n: none }] : named;
}

/** How a page says which group it is showing; every line is empty for every group. */
export type StoreGroupWords = {
  /** "in Choppies Group", "not in a group". */
  phrase: string;
  /** The chip beside the search that takes the group off. */
  chip: string;
  /** The export's line: "Group: Choppies Group". */
  context: string;
  /** A sentence about the page's stores, said within the group. */
  within: (text: string) => string;
};

export function storeGroupWords(active: string, name: string, t: Terms): StoreGroupWords {
  if (active === "") return { phrase: "", chip: "", context: "", within: (text) => text };
  const group = lower(t.site_group.one);
  const none = active === NO_STORE_GROUP;
  return {
    phrase: none ? `not in a ${group}` : `in ${name}`,
    chip: `${none ? `Not in a ${group}` : `${name} only`} · every ${group}`,
    context: none ? `Not in a ${group}` : `${t.site_group.one}: ${name}`,
    within: (text) => {
      const rest = text.charAt(0).toLowerCase() + text.slice(1);
      return none ? `Of the ${lower(t.site.many)} not in a ${group}, ${rest}` : `In ${name}, ${rest}`;
    },
  };
}
