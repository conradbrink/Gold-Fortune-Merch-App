import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";
import { allPages } from "@/lib/all-pages";
import { isRealDay } from "@/lib/date-range";
import { dbError, refused } from "@/lib/write-refusal";

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
  // Every link, a page at a time: past 1,000 the ones not read would be
  // inserted again and refused as duplicates.
  const rows = await allPages<Record<string, string>>((from, to) =>
    supabase.from(table).select(column).eq("promotion_id", promotionId).order(column).range(from, to)
  );
  const current = new Set(rows.map((r) => r[column]));
  const wanted = new Set(next);

  const toAdd = next.filter((id) => !current.has(id));
  const toRemove = Array.from(current).filter((id) => !wanted.has(id));

  // In batches: a few hundred ids in one URL is more than it carries.
  for (let i = 0; i < toRemove.length; i += LINK_BATCH) {
    const { error: e } = await supabase
      .from(table)
      .delete()
      .eq("promotion_id", promotionId)
      .in(column, toRemove.slice(i, i + LINK_BATCH));
    if (e) throw dbError(e);
  }
  for (let i = 0; i < toAdd.length; i += 500) {
    const { error: e } = await supabase
      .from(table)
      .insert(toAdd.slice(i, i + 500).map((id) => ({ promotion_id: promotionId, [column]: id })));
    if (e) throw dbError(e);
  }
}

/** Ids per `in()` filter: what one request's URL comfortably carries. */
const LINK_BATCH = 100;

export type PromotionInput = {
  name: string;
  brief: string | null;
  starts_on: string;
  ends_on: string;
  productIds: string[];
  storeIds: string[];
};

/** Lengths a rep can read on a phone; the database itself has no limit. */
export const MAX_PROMOTION_NAME = 120;
export const MAX_PROMOTION_BRIEF = 500;

/**
 * What is wrong with a promotion as typed, or null. The dialog and the AI
 * Manager both ask before saving, so a promotion is held to one rule however
 * it was made.
 *
 * `before` is the promotion as it was: a name or brief longer than the limits
 * (written before they existed) is left alone while it is not being changed,
 * so an old promotion can still have its dates moved or be switched off.
 */
export function promotionProblem(
  input: PromotionInput,
  before?: Pick<PromotionInput, "name" | "brief">
): string | null {
  const name = input.name.trim();
  if (!name) return "The promotion needs a name.";
  if (name.length > MAX_PROMOTION_NAME && name !== before?.name.trim()) {
    return `Keep the name under ${MAX_PROMOTION_NAME} characters.`;
  }
  if ((input.brief ?? "").length > MAX_PROMOTION_BRIEF && input.brief !== before?.brief) {
    return `Keep what to look for under ${MAX_PROMOTION_BRIEF} characters.`;
  }
  if (!isRealDay(input.starts_on) || !isRealDay(input.ends_on)) return "Both dates need to be real days.";
  if (input.ends_on < input.starts_on) return "The end date is before the start date.";
  return null;
}

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
  if (error) throw dbError(error);

  const id = (data as { id: string }).id;
  try {
    await syncLinks(supabase, "promotion_products", "product_id", id, input.productIds);
    await syncLinks(supabase, "promotion_stores", "store_id", id, input.storeIds);
  } catch (reason) {
    // A promotion without its lines or outlets is not the one asked for, and
    // one left behind would be joined by another on the retry. Take it back
    // out (its links go with it) before saying so.
    const { data: undone } = await supabase.from("promotions").delete().eq("id", id).select("id");
    if ((undone?.length ?? 0) > 0) throw reason;
    throw refused(
      `The promotion was created, but not everything on it was added. Open it on the Promotions page to finish it: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
      "partial"
    );
  }
  return id;
}

/**
 * Saves a changed promotion. `active`, when given, is saved with the rest.
 *
 * `seenUpdatedAt`, when given, is the version the person was shown: a
 * promotion changed since then is refused rather than overwritten with old
 * information. It is checked before anything is written, and the header,
 * which moves the version, is written last: a failure part-way through the
 * products and outlets then leaves the promotion on the version it was, so
 * saving again finishes the job instead of being refused as changed.
 */
export async function updatePromotion(
  supabase: SupabaseClient,
  id: string,
  input: PromotionInput & { active?: boolean },
  seenUpdatedAt?: string
): Promise<void> {
  if (seenUpdatedAt) await checkVersion(supabase, id, seenUpdatedAt);

  await syncLinks(supabase, "promotion_products", "product_id", id, input.productIds);
  await syncLinks(supabase, "promotion_stores", "store_id", id, input.storeIds);

  let query = supabase
    .from("promotions")
    .update({
      name: input.name,
      brief: input.brief,
      starts_on: input.starts_on,
      ends_on: input.ends_on,
      ...(input.active === undefined ? {} : { active: input.active }),
    })
    .eq("id", id);
  if (seenUpdatedAt) query = query.eq("updated_at", seenUpdatedAt);
  const { data, error } = await query.select("id");
  if (error) throw dbError(error);
  // A PostgREST update that matches nothing succeeds silently.
  if ((data?.length ?? 0) === 0) {
    if (seenUpdatedAt) await checkVersion(supabase, id, seenUpdatedAt);
    throw refused("That promotion could not be updated — reload and try again.", "not_written");
  }
}

/** Refuses a promotion changed since `seen`: somebody saved it after it was shown. */
async function checkVersion(supabase: SupabaseClient, id: string, seen: string): Promise<void> {
  const { data, error } = await supabase.from("promotions").select("updated_at").eq("id", id).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw refused("That promotion is no longer there.", "not_written");
  if ((data as { updated_at: string }).updated_at !== seen) {
    throw refused("This promotion was changed by someone else since it was opened. Reload it and try again.", "stale");
  }
}

export async function setPromotionActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean
): Promise<void> {
  // `select`: a switch RLS refused changes nothing and still reports success.
  const { data, error } = await supabase.from("promotions").update({ active }).eq("id", id).select("id");
  if (error) throw dbError(error);
  if ((data?.length ?? 0) === 0) {
    throw refused("That promotion could not be changed — reload and try again.", "not_written");
  }
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
  promotionId: string,
  /** Only these outlets, when the question is about a few. */
  storeIds?: string[]
): Promise<Set<string>> {
  // One row per line, outlet and visit: a busy promotion passes 1,000 quickly,
  // so every page is read, ordered on the row's own id.
  const read = (ids: string[] | null) =>
    allPages<{ store_id: string }>((from, to) => {
      let q = supabase.from("promotion_checks").select("id, store_id").eq("promotion_id", promotionId);
      if (ids) q = q.in("store_id", ids);
      return q.order("id").range(from, to);
    });
  const rows: { store_id: string }[] = [];
  if (storeIds) {
    for (let i = 0; i < storeIds.length; i += LINK_BATCH) rows.push(...(await read(storeIds.slice(i, i + LINK_BATCH))));
  } else {
    rows.push(...(await read(null)));
  }
  return new Set(rows.map((r) => r.store_id));
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
