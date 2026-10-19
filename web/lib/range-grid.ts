import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import type { ProductResult, ProductStage, RangeSize } from "@/lib/store-range";

/**
 * The Ranges tab under Products: one store group's range as Tickd worked it
 * out (range_grid), product by size, with the evidence, and the office's
 * override (range_pin_set / range_pin_clear). Tickd decides unless somebody
 * pins a product; there is nothing to fill in.
 */

/** Why Tickd puts a product in (or keeps it out of) a group's stores of one size. */
export type GridReason = "share" | "launch" | "pin" | "pin_never" | "not_taking";

export type GridCell = {
  product_id: string;
  size: RangeSize;
  /** The group's stores of this size. */
  stores: number;
  /** 1 compared within the group and size, 2 the group, 3 the company's stores of this size, 4 all; 0 learning. */
  level: number;
  cluster_stores: number | null;
  takers: number | null;
  share: number | null;
  cluster_in: boolean;
  cluster_reason: GridReason | null;
  /** More stores of this size that have it in range from their own repeat orders. */
  own_in: number;
  pin_rule: "always" | "never" | null;
  pin_min_size: RangeSize | null;
  stage: ProductStage | null;
  result: ProductResult | null;
};

export const SIZES: readonly RangeSize[] = ["big", "medium", "small"];

/** One group's grid; `groupId` null is the stores with no group. */
export async function fetchRangeGrid(supabase: SupabaseClient, groupId: string | null): Promise<GridCell[]> {
  const { data, error } = await callRpc(supabase, "range_grid", { p_group_id: groupId });
  if (error) throw new Error(error.message);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: String(r.product_id),
    size: r.size as RangeSize,
    stores: Number(r.stores ?? 0),
    level: Number(r.level ?? 0),
    cluster_stores: num(r.cluster_stores),
    takers: num(r.takers),
    share: num(r.share),
    cluster_in: Boolean(r.cluster_in),
    cluster_reason: (r.cluster_reason as GridReason | null) ?? null,
    own_in: Number(r.own_in ?? 0),
    pin_rule: (r.pin_rule as "always" | "never" | null) ?? null,
    pin_min_size: (r.pin_min_size as RangeSize | null) ?? null,
    stage: (r.stage as ProductStage | null) ?? null,
    result: (r.result as ProductResult | null) ?? null,
  }));
}

/** An override, or back to Tickd deciding. `groupId` null is every group. */
export type PinChoice = { rule: "auto" } | { rule: "always"; from: RangeSize } | { rule: "never" };

export async function setPin(
  supabase: SupabaseClient,
  groupId: string | null,
  productId: string,
  choice: PinChoice,
): Promise<void> {
  const { error } =
    choice.rule === "auto"
      ? await callRpc(supabase, "range_pin_clear", { p_group_id: groupId, p_product_id: productId })
      : await callRpc(supabase, "range_pin_set", {
          p_group_id: groupId,
          p_product_id: productId,
          p_rule: choice.rule,
          p_min_size: choice.rule === "always" ? choice.from : null,
        });
  if (error) throw new Error(error.message);
}

/** "Always: big stores", "Always: medium and big stores", "Always: every store", "Never", "Tickd decides". */
export function pinLabel(choice: PinChoice, site: string, sites: string): string {
  const s = sites.toLowerCase();
  switch (choice.rule) {
    case "auto":
      return "Tickd decides";
    case "never":
      return "Never";
    case "always":
      return choice.from === "big"
        ? `Always: big ${s}`
        : choice.from === "medium"
          ? `Always: medium and big ${s}`
          : `Always: every ${site.toLowerCase()}`;
  }
}

/**
 * The evidence under one cell, in a few words, naming the stores compared
 * when they are not this group's own of this size: a small group borrows the
 * company's (range_min_stores).
 */
export function cellWords(c: GridCell, group: string, sites: string): string {
  if (c.cluster_reason === "pin") return "Set by you";
  if (c.cluster_reason === "pin_never") return "Set by you: never";
  if (c.cluster_reason === "launch") return "Proven new product";
  if (c.cluster_reason === "not_taking") return "Not taking off";
  if (c.level === 0) return "Still learning";
  if (c.share === null || c.cluster_stores === null) return "";
  const pct = `${Math.round(c.share)}%`;
  const s = sites.toLowerCase();
  switch (c.level) {
    case 1:
      return `${pct} of ${c.cluster_stores} take it`;
    case 2:
      return `${pct} of the ${group.toLowerCase()}'s ${c.cluster_stores} take it`;
    case 3:
      return `${pct} of your ${c.cluster_stores} ${c.size} ${s} take it`;
    default:
      return `${pct} of all your ${c.cluster_stores} ${s} take it`;
  }
}
