import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";

/**
 * Promotions: deals running on named lines at named outlets, confirmed by the
 * rep standing in the shop.
 *
 * As with files, the UI reflects the RLS policy rather than reimplementing it —
 * managers write, everyone in the org reads, and reps insert their own answers.
 */

export type PromotionRow = Tables<"promotions">;

export type PromotionSummary = {
  promotion_id: string;
  name: string;
  brief: string | null;
  starts_on: string;
  ends_on: string;
  active: boolean;
  products: number;
  stores: number;
  stores_checked: number;
  stores_running: number;
  stores_not_stocked: number;
  last_checked_at: string | null;
};

export type PromotionStoreStatus = {
  store_id: string;
  store_name: string;
  city: string | null;
  answered: number;
  running: number;
  not_running: number;
  not_stocked: number;
  last_checked_at: string | null;
  rep_name: string | null;
};

/** A promotion with the ids it covers, for the edit form. */
export type PromotionDetail = PromotionRow & {
  product_ids: string[];
  store_ids: string[];
};

export async function fetchPromotionSummaries(
  supabase: SupabaseClient
): Promise<PromotionSummary[]> {
  const { data, error } = await supabase.rpc("promotion_summaries");
  if (error) throw new Error(error.message);
  return (data ?? []) as PromotionSummary[];
}

export async function fetchPromotionDetail(
  supabase: SupabaseClient,
  id: string
): Promise<PromotionDetail | null> {
  // Single string literal — a concatenated .select() degrades to
  // GenericStringError in postgrest-js.
  const { data, error } = await supabase
    .from("promotions")
    .select("*, promotion_products(product_id), promotion_stores(store_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as PromotionRow & {
    promotion_products: { product_id: string }[];
    promotion_stores: { store_id: string }[];
  };
  return {
    ...row,
    product_ids: row.promotion_products.map((r) => r.product_id),
    store_ids: row.promotion_stores.map((r) => r.store_id),
  };
}

export async function fetchStoreStatus(
  supabase: SupabaseClient,
  promotionId: string
): Promise<PromotionStoreStatus[]> {
  const { data, error } = await supabase.rpc("promotion_store_status", {
    p_promotion_id: promotionId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PromotionStoreStatus[];
}

/**
 * Adds and removes only what changed.
 *
 * `files.ts setAudience` deletes every join row and re-inserts, which is fine
 * there because a file with nobody attached is merely invisible. A promotion
 * covering zero outlets during that window is *gone from every rep's phone*,
 * and there is no transaction around it — so a failed re-insert would silently
 * cancel a live promotion. Diffing removes the window entirely.
 */
async function syncLinks(
  supabase: SupabaseClient,
  table: "promotion_products" | "promotion_stores",
  column: "product_id" | "store_id",
  promotionId: string,
  next: string[]
): Promise<void> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq("promotion_id", promotionId);
  if (error) throw new Error(error.message);

  const current = new Set(
    ((data ?? []) as Record<string, string>[]).map((r) => r[column])
  );
  const wanted = new Set(next);

  const toAdd = next.filter((id) => !current.has(id));
  const toRemove = Array.from(current).filter((id) => !wanted.has(id));

  if (toRemove.length > 0) {
    const { error: e } = await supabase
      .from(table)
      .delete()
      .eq("promotion_id", promotionId)
      .in(column, toRemove);
    if (e) throw new Error(e.message);
  }
  if (toAdd.length > 0) {
    const { error: e } = await supabase
      .from(table)
      .insert(toAdd.map((id) => ({ promotion_id: promotionId, [column]: id })));
    if (e) throw new Error(e.message);
  }
}

export type PromotionInput = {
  name: string;
  brief: string | null;
  starts_on: string;
  ends_on: string;
  productIds: string[];
  storeIds: string[];
};

export async function createPromotion(
  supabase: SupabaseClient,
  orgId: string,
  input: PromotionInput
): Promise<string> {
  const { data, error } = await supabase
    .from("promotions")
    .insert({
      org_id: orgId,
      name: input.name,
      brief: input.brief,
      starts_on: input.starts_on,
      ends_on: input.ends_on,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const id = (data as { id: string }).id;
  await syncLinks(supabase, "promotion_products", "product_id", id, input.productIds);
  await syncLinks(supabase, "promotion_stores", "store_id", id, input.storeIds);
  return id;
}

export async function updatePromotion(
  supabase: SupabaseClient,
  id: string,
  input: PromotionInput
): Promise<void> {
  const { data, error } = await supabase
    .from("promotions")
    .update({
      name: input.name,
      brief: input.brief,
      starts_on: input.starts_on,
      ends_on: input.ends_on,
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  // A PostgREST update that matches nothing succeeds silently.
  if ((data?.length ?? 0) === 0) {
    throw new Error("That promotion could not be updated — reload and try again.");
  }

  await syncLinks(supabase, "promotion_products", "product_id", id, input.productIds);
  await syncLinks(supabase, "promotion_stores", "store_id", id, input.storeIds);
}

export async function setPromotionActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean
): Promise<void> {
  const { error } = await supabase.from("promotions").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePromotion(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Outlets that already hold answers, so the edit form can warn before removing
 * them.
 *
 * `promotion_store_status` reads *from* `promotion_stores`, so an outlet
 * dropped from the coverage list takes its answers out of every figure while
 * the rows themselves sit orphaned in the table. That looks exactly like data
 * loss and is worth a sentence before it happens.
 */
export async function answeredStoreIds(
  supabase: SupabaseClient,
  promotionId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("promotion_checks")
    .select("store_id")
    .eq("promotion_id", promotionId);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { store_id: string }[]).map((r) => r.store_id));
}

/** One word for how an outlet is doing, rather than four numbers to decode. */
export type Verdict =
  | "not_checked"
  | "partly"
  | "running"
  | "not_running"
  | "not_stocked";

export function verdictFor(row: PromotionStoreStatus, lines: number): Verdict {
  if (row.answered === 0) return "not_checked";
  if (row.answered < lines) return "partly";
  if (row.running > 0) return "running";
  // Nothing up and nothing failing means the outlet simply does not carry any
  // of it — a ranging question for a buyer, not a compliance failure for a rep.
  if (row.not_running === 0 && row.not_stocked > 0) return "not_stocked";
  return "not_running";
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  not_checked: "Not checked",
  partly: "Partly checked",
  running: "Running",
  not_running: "Not running",
  not_stocked: "Doesn't stock these",
};

/**
 * Red means the reps failed; neutral means the target list was wrong. Keeping
 * those apart is the whole reason the third answer exists.
 */
export const VERDICT_STYLES: Record<Verdict, string> = {
  not_checked: "bg-secondary text-muted-foreground",
  partly: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  running: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  not_running: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  not_stocked: "bg-secondary text-muted-foreground",
};

/** Inclusive, in the viewer's own timezone — these are dates, not instants. */
export function isLive(p: { starts_on: string; ends_on: string; active: boolean }): boolean {
  if (!p.active) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return p.starts_on <= today && today <= p.ends_on;
}
