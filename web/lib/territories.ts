import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";

/**
 * Territories — a two-level sales geography belonging to one organisation.
 *
 * A main territory is normally a town or region; sub-territories divide one up
 * ("Gaborone" → "Gaborone North"). Every name belongs to an org and RLS keeps
 * it there, so nothing here filters by org: the policy already has.
 *
 * The database enforces the shape (two levels, a sub inside its own main, a
 * store's pair agreeing). These helpers surface the refusals rather than trying
 * to re-check them, because a rule enforced twice eventually disagrees with
 * itself.
 */

export type Territory = Tables<"territories">;

export type TerritoryTree = {
  main: Territory;
  subs: Territory[];
  /** Stores sitting directly in the main, plus every store in its subs. */
  stores: number;
};

/** What a delete would touch. Shown before the button, never after. */
export type TerritoryImpact = {
  name: string;
  stores: number;
  subTerritories: number;
  reps: number;
  /** Routes still to come. Past ones are history and are not at risk. */
  upcomingRoutes: number;
};

function affected(data: unknown[] | null, what: string): void {
  // PostgREST answers a write that matched nothing with success, so a refusal
  // by RLS would otherwise look like it worked until the next reload.
  if (!data || data.length === 0) {
    throw new Error(`${what} — you may not have permission.`);
  }
}

export async function fetchTerritories(
  supabase: SupabaseClient
): Promise<Territory[]> {
  const { data, error } = await supabase
    .from("territories")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Territory[];
}

/**
 * The tree, with a store count on each main.
 *
 * Counts come from one pass over `stores` rather than a query per territory —
 * 47 territories would otherwise be 47 round trips to render one page.
 */
export async function fetchTerritoryTree(
  supabase: SupabaseClient
): Promise<TerritoryTree[]> {
  const [territories, storeRows] = await Promise.all([
    fetchTerritories(supabase),
    supabase.from("stores").select("territory_id, sub_territory_id"),
  ]);
  if (storeRows.error) throw new Error(storeRows.error.message);

  const perMain = new Map<string, number>();
  for (const row of storeRows.data ?? []) {
    const main = (row as { territory_id: string | null }).territory_id;
    if (main) perMain.set(main, (perMain.get(main) ?? 0) + 1);
  }

  const mains = territories.filter((t) => t.parent_id === null);
  const subsByParent = new Map<string, Territory[]>();
  for (const t of territories) {
    if (t.parent_id === null) continue;
    const list = subsByParent.get(t.parent_id) ?? [];
    list.push(t);
    subsByParent.set(t.parent_id, list);
  }

  return mains.map((main) => ({
    main,
    subs: subsByParent.get(main.id) ?? [],
    stores: perMain.get(main.id) ?? 0,
  }));
}

/** Store counts per sub-territory, for the rows under an expanded main. */
export async function fetchSubStoreCounts(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("stores")
    .select("sub_territory_id")
    .not("sub_territory_id", "is", null);
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = (row as { sub_territory_id: string | null }).sub_territory_id;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export async function createTerritory(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  parentId: string | null
): Promise<Territory> {
  const { data, error } = await supabase
    .from("territories")
    .insert({ org_id: orgId, name: name.trim(), parent_id: parentId })
    .select("*")
    .single();
  // The unique index is per level and case-insensitive, so this is a duplicate
  // name in the same place rather than anything the user can fix by retrying.
  if (error) {
    throw new Error(
      error.code === "23505"
        ? `There is already a territory called "${name.trim()}" here.`
        : error.message
    );
  }
  return data as Territory;
}

export async function renameTerritory(
  supabase: SupabaseClient,
  id: string,
  name: string
): Promise<void> {
  const { data, error } = await supabase
    .from("territories")
    .update({ name: name.trim() })
    .eq("id", id)
    .select("id");
  if (error) {
    throw new Error(
      error.code === "23505"
        ? `There is already a territory called "${name.trim()}" here.`
        : error.message
    );
  }
  affected(data, "The name was not changed");
}

/**
 * Deactivating is the safe half of removal: the territory stops being offered
 * for new work, and every store and route already pointing at it is untouched.
 */
export async function setTerritoryActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean
): Promise<void> {
  const { data, error } = await supabase
    .from("territories")
    .update({ active })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  affected(data, "Nothing changed");
}

/**
 * What a delete would take with it.
 *
 * Stores and sub-territories are ON DELETE RESTRICT, so a delete with either
 * still attached is refused by the database — this is what lets the dialog say
 * so first, in numbers, instead of relaying a foreign-key error afterwards.
 */
export async function fetchTerritoryImpact(
  supabase: SupabaseClient,
  territory: Territory
): Promise<TerritoryImpact> {
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [storeRows, subs, reps] = await Promise.all([
    supabase
      .from("stores")
      .select("id")
      .or(`territory_id.eq.${territory.id},sub_territory_id.eq.${territory.id}`),
    supabase.from("territories").select("id").eq("parent_id", territory.id),
    supabase.from("territory_reps").select("id").eq("territory_id", territory.id),
  ]);
  // Every one of the three, not just the stores. A refused query leaves its
  // `data` null, which the counts below would read as zero — and the panel
  // offers "Delete permanently" precisely when the counts are zero. A failure
  // has to look like a failure, never like an unused territory.
  const failure = storeRows.error ?? subs.error ?? reps.error;
  if (failure) throw new Error(failure.message);

  const storeIds = (storeRows.data ?? []).map((s) => (s as { id: string }).id);

  // Routes hang off stores, not off territories, so "schedules linked to this
  // territory" means the routes of the stores inside it. Only future ones are
  // at risk; past routes are history and keep their store either way.
  let upcomingRoutes = 0;
  if (storeIds.length > 0) {
    const { count, error } = await supabase
      .from("routes")
      .select("id", { count: "exact", head: true })
      .in("store_id", storeIds)
      .gte("scheduled_date", localToday);
    if (error) throw new Error(error.message);
    upcomingRoutes = count ?? 0;
  }

  return {
    name: territory.name,
    stores: storeIds.length,
    subTerritories: (subs.data ?? []).length,
    reps: (reps.data ?? []).length,
    upcomingRoutes,
  };
}

/**
 * Places a store in a territory, or moves it to another one.
 *
 * Both columns are written together because the trigger checks them as a pair:
 * setting a main without clearing a sub that belongs elsewhere is exactly the
 * disagreement it exists to refuse.
 */
export async function setStoreTerritory(
  supabase: SupabaseClient,
  storeId: string,
  territoryId: string | null,
  subTerritoryId: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("stores")
    .update({ territory_id: territoryId, sub_territory_id: subTerritoryId })
    .eq("id", storeId)
    .select("id");
  if (error) throw new Error(error.message);
  affected(data, "The store was not moved");
}

export async function deleteTerritory(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("territories")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    // 23503 is the RESTRICT firing — the guard doing its job, not a fault.
    throw new Error(
      error.code === "23503"
        ? "Still in use. Move its stores and sub-territories out first."
        : error.message
    );
  }
  affected(data, "Nothing was deleted");
}
