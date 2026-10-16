import type { SupabaseClient } from "@supabase/supabase-js";
import { allPages } from "@/lib/all-pages";
import { article, capital, lower, type Terms } from "@/lib/terms";

/**
 * One store group for a whole page ("Choppies Group", "Forecourts"): the
 * dashboard cards' own pages narrow their tiles, panels and list to it (owner,
 * 15 Oct 2026: "add a filter here per group", then "the same group filter to
 * store health").
 */

/** The choice for the stores in no group. Links carry it as `?group=none`. */
export const NO_STORE_GROUP = "none";

/** A company's store groups, and the one each of its active stores is in. */
export type StoreGroups = {
  /** Every group, by name. Every id in `groupOf` is one of these. */
  groups: { id: string; name: string }[];
  /** Active store id to its group's id; a store not here is in no group. */
  groupOf: Map<string, string>;
};

export type StoreGroupChoice = { id: string; name: string; n: number };

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
type GroupRow = { id: string; name: string };
type GroupedStore = { id: string; store_groups: GroupRow | GroupRow[] | null };

export async function fetchStoreGroups(supabase: SupabaseClient): Promise<StoreGroups> {
  // Paged, both: a response stops at 1,000 rows without saying so.
  const [groups, stores] = await Promise.all([
    allPages<GroupRow>((from, to) => supabase.from("store_groups").select("id, name").order("id", { ascending: true }).range(from, to) as unknown as Page<GroupRow>),
    // Only the active stores in a group, each with its group: the pages list
    // active stores, and a store not read here is in no group. The group comes
    // with the store, so a group made while the two reads run is still known.
    allPages<GroupedStore>((from, to) =>
      supabase
        .from("stores")
        .select("id, store_groups(id, name)")
        .eq("active", true)
        .not("store_group_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to) as unknown as Page<GroupedStore>
    ),
  ]);
  const names = new Map(groups.map((g) => [g.id, g.name]));
  const groupOf = new Map<string, string>();
  for (const s of stores) {
    const g = Array.isArray(s.store_groups) ? s.store_groups[0] : s.store_groups;
    // A group this person cannot see: the store counts as in none.
    if (!g) continue;
    groupOf.set(s.id, g.id);
    if (!names.has(g.id)) names.set(g.id, g.name);
  }
  return {
    groups: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    groupOf,
  };
}

/** The group a store is in, as the picker names it: its id, or NO_STORE_GROUP (also for no store). */
export function storeGroupOf(storeId: string | null, groupOf: Map<string, string>): string {
  return (storeId !== null && groupOf.get(storeId)) || NO_STORE_GROUP;
}

/**
 * The groups to choose from: the ones with a row on the page's list, by name,
 * each with how many, and "No group" last when some row is in none. `keep` is
 * the group already chosen, offered even with nothing on the list, so the
 * picker can show it. Nothing to choose at all when no named group is offered:
 * a company without groups has no filter.
 */
export function storeGroupChoices(
  storeIds: (string | null)[],
  { groups, groupOf }: StoreGroups,
  t: Terms,
  keep = ""
): StoreGroupChoice[] {
  const n = new Map<string, number>();
  for (const id of storeIds) {
    const g = storeGroupOf(id, groupOf);
    n.set(g, (n.get(g) ?? 0) + 1);
  }
  const named = groups.filter((g) => n.has(g.id) || g.id === keep).map((g) => ({ id: g.id, name: g.name, n: n.get(g.id) ?? 0 }));
  if (named.length === 0) return [];
  const none = n.get(NO_STORE_GROUP) ?? 0;
  return none > 0 || keep === NO_STORE_GROUP ? [...named, { id: NO_STORE_GROUP, name: `No ${lower(t.site_group.one)}`, n: none }] : named;
}

/** What a page shows for the group a link or the picker asked for. */
export type StoreGroupView = {
  choices: StoreGroupChoice[];
  /** The group the page shows: an id, NO_STORE_GROUP, or "" for every group. */
  active: string;
  /** A group was asked for that the company does not have (any more). */
  missing: boolean;
};

/**
 * The group asked for (`chosen`), checked against the company's groups. Any
 * group the company has counts, even one with nothing on this list, which then
 * says so in its empty texts. "No group" counts when the company has groups.
 * A company without groups ignores the choice: it has no filter to speak of.
 */
export function resolveStoreGroup(chosen: string, storeIds: (string | null)[], sg: StoreGroups, t: Terms): StoreGroupView {
  const known =
    chosen === "" ? "" : chosen === NO_STORE_GROUP ? (sg.groups.length > 0 ? chosen : "") : sg.groups.some((g) => g.id === chosen) ? chosen : "";
  const choices = storeGroupChoices(storeIds, sg, t, known);
  return {
    choices,
    active: choices.length > 0 ? known : "",
    missing: chosen !== "" && known === "" && sg.groups.length > 0,
  };
}

/** How a page says which group it is showing; all empty for every group. */
export type StoreGroupWords = {
  /** "in Choppies Group", "not in a group". */
  phrase: string;
  /** The chip beside the search that takes the group off. */
  chip: string;
  /** The export's lines: ["Group: Choppies Group"]. */
  context: string[];
  /** A sentence about the page's stores, said within the group. */
  within: (text: string) => string;
};

export function storeGroupWords(active: string, name: string, t: Terms): StoreGroupWords {
  if (active === "") return { phrase: "", chip: "", context: [], within: (text) => text };
  const group = lower(t.site_group.one);
  const notIn = `not in ${article(t.site_group)} ${group}`;
  const none = active === NO_STORE_GROUP;
  return {
    phrase: none ? notIn : `in ${name}`,
    chip: `${none ? capital(notIn) : `${name} only`} · every ${group}`,
    context: [none ? capital(notIn) : `${t.site_group.one}: ${name}`],
    within: (text) => {
      const rest = text.charAt(0).toLowerCase() + text.slice(1);
      return none ? `Of the ${lower(t.site.many)} ${notIn}, ${rest}` : `In ${name}, ${rest}`;
    },
  };
}
