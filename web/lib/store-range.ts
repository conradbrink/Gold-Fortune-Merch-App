import type { SupabaseClient } from "@supabase/supabase-js";
import { allPages } from "@/lib/all-pages";
import type { RangeShow } from "@/lib/dashboard-links";

/**
 * Range: which products each store should carry, worked out by Tickd from the
 * company's own orders, and where they are missing (owner, 19 Oct 2026: "this
 * plan must be in a way automatic … the system should be able to learn the
 * new product sales and analyse it and then give a result").
 *
 * The rule lives in the database (range_facts, 20261019100000): a store's
 * size inside its group, the similar stores it is compared with, the share of
 * them taking each product, its own repeat orders, the new-product results,
 * and the office's overrides. This file only reads its answer (range_status,
 * range_products) and puts it in words, so the card, the page and the export
 * count the same rows.
 */

export type RangeSize = "big" | "medium" | "small";
/** Why a store has its size: ranked by its orders, its visit frequency (no orders yet), or set by hand. */
export type SizeSource = "sales" | "visits" | "set";
/**
 * One product at one store. In its range: has it (ordered lately), missing
 * (never ordered), stopped (ordered before, not lately), or quiet (the store
 * has ordered nothing lately). Not in its range: ordered anyway (off_range).
 */
export type RangeStatus = "have" | "gap" | "stopped" | "quiet" | "off_range";
/**
 * Why: set by the office (pin), the store's own repeat orders (own), a proven
 * new product going into big stores (launch), the share of similar stores
 * (share). Not in range: the office said never (pin_never), a new product
 * that is not taking off, or "Not for this store" (excluded).
 */
export type RangeReason = "pin" | "own" | "launch" | "share" | "pin_never" | "not_taking" | "excluded";

export type RangeLine = {
  product_id: string;
  status: RangeStatus | null;
  in_range: boolean;
  reason: RangeReason | null;
  /** % of the similar ordering stores that take it; null while learning. */
  share: number | null;
  /** The similar ordering stores compared. */
  cluster_stores: number | null;
  /** Orders this store placed with it in the history window. */
  own_orders: number;
  last_ordered: string | null;
  /** Boxes in the look-back. */
  boxes: number | null;
  /** Their value, excluding VAT; null for someone who may not see money. */
  value: number | null;
  /** Boxes a month similar stores that have it take. */
  est_boxes_month: number | null;
  /** That at this store's case price; null without money. */
  est_value_month: number | null;
  /** "Not for this store", and why. */
  excluded: string | null;
};

export type RangeStoreRow = {
  store_id: string;
  store_name: string;
  city: string | null;
  store_group_id: string | null;
  size: RangeSize;
  size_source: SizeSource;
  /** 1 its group and size, 2 its group, 3 the company's stores of its size, 4 every store; 0 learning. */
  level: number;
  learning: boolean;
  /** Ordered nothing in the look-back: a question for "Stores due for an order", not gaps. */
  quiet: boolean;
  ordering_stores: number;
  min_stores: number;
  lines: RangeLine[];
};

export type ProductStage = "not_ordered" | "new" | "established";
export type ProductResult = "waiting" | "untried" | "trying" | "proven" | "slow" | "not_taking";

export type RangeProductRow = {
  product_id: string;
  stage: ProductStage;
  result: ProductResult;
  added_on: string;
  launch_on: string | null;
  /** Stores that ordered it. */
  tried: number;
  /** Of those, stores that ordered anything on a later day. */
  chances: number;
  /** Of those, stores that ordered it again. */
  repeats: number;
  repeat_pct: number | null;
  /** Boxes per store that tried it, per month. */
  ros: number | null;
  /** The same for similar products (its category, or every product). */
  similar_ros: number | null;
  /** Store group ids (or "none") of the stores that tried it. */
  groups_tried: string[];
  /** Stores that must have had the chance before a result. */
  min_chances: number;
  /** Days after it was added before a product nobody ordered is "not ordered yet" (range_untried_days). */
  untried_days: number;
};

export type RangeProduct = { id: string; name: string; category: string | null; brand: string | null };

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** The look-back the company counts "has it" over (range_lapse_days). */
export const DEFAULT_RANGE_DAYS = 60;

type RpcBuilder = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
  };
};

/** Every active store and its range over `days` (the company's own look-back when null). Paged. */
export async function fetchRangeStatus(supabase: SupabaseClient, days: number | null): Promise<RangeStoreRow[]> {
  const client = supabase as unknown as RpcBuilder;
  const rows = await allPages<Record<string, unknown>>(
    (from, to) =>
      client.rpc("range_status", { p_days: days }).range(from, to) as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>,
  );
  return rows.map((r) => ({
    store_id: String(r.store_id),
    store_name: String(r.store_name ?? ""),
    city: (r.city as string | null) ?? null,
    store_group_id: (r.store_group_id as string | null) ?? null,
    size: r.size as RangeSize,
    size_source: r.size_source as SizeSource,
    level: Number(r.level ?? 0),
    learning: Boolean(r.learning),
    quiet: Boolean(r.quiet),
    ordering_stores: Number(r.ordering_stores ?? 0),
    min_stores: Number(r.min_stores ?? 5),
    lines: ((r.lines ?? []) as Record<string, unknown>[]).map((l) => ({
      product_id: String(l.product_id),
      status: (l.status as RangeStatus | null) ?? null,
      in_range: Boolean(l.in_range),
      reason: (l.reason as RangeReason | null) ?? null,
      share: num(l.share),
      cluster_stores: num(l.cluster_stores),
      own_orders: Number(l.own_orders ?? 0),
      last_ordered: (l.last_ordered as string | null) ?? null,
      boxes: num(l.boxes),
      value: num(l.value),
      est_boxes_month: num(l.est_boxes_month),
      est_value_month: num(l.est_value_month),
      excluded: (l.excluded as string | null) ?? null,
    })),
  }));
}

/** Every orderable product's new-product result (the spread across stores is range_status's). */
export async function fetchRangeProducts(supabase: SupabaseClient): Promise<RangeProductRow[]> {
  const client = supabase as unknown as RpcBuilder;
  const rows = await allPages<Record<string, unknown>>(
    (from, to) =>
      client.rpc("range_products", {}).range(from, to) as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>,
  );
  return rows.map((r) => ({
    product_id: String(r.product_id),
    stage: r.stage as ProductStage,
    result: r.result as ProductResult,
    added_on: String(r.added_on),
    launch_on: (r.launch_on as string | null) ?? null,
    tried: Number(r.tried ?? 0),
    chances: Number(r.chances ?? 0),
    repeats: Number(r.repeats ?? 0),
    repeat_pct: num(r.repeat_pct),
    ros: num(r.ros),
    similar_ros: num(r.similar_ros),
    groups_tried: (r.groups_tried as string[] | null) ?? [],
    min_chances: Number(r.min_chances ?? 5),
    untried_days: Number(r.untried_days ?? 30),
  }));
}

/** The company's products (active or not: an old order can name one). Paged. */
export async function fetchRangeCatalogue(supabase: SupabaseClient): Promise<RangeProduct[]> {
  return allPages<RangeProduct>(
    (from, to) =>
      supabase
        .from("products")
        .select("id, name, category, brand")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: RangeProduct[] | null; error: { message: string } | null }>,
  );
}

// ------------------------------------------------------------ short names

/**
 * Names short enough for a chip, still telling two flavours apart:
 * "OKSO 12000 Puff (5%) Disposable - Grape Ice" and "OKSO Crystal Bar 800
 * Puff (5%) Disposable - Grape Ice" become "12000 Grape Ice" and "Crystal Bar
 * 800 Grape Ice". The part after the last " - " is the product; when two
 * products share it, the words their first parts do not share go in front.
 * A name with no " - " is kept whole.
 */
export function shortNames(products: { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const split = (name: string) => {
    const i = name.lastIndexOf(" - ");
    return i < 0 ? null : { head: name.slice(0, i).trim(), tail: name.slice(i + 3).trim() };
  };
  const byTail = new Map<string, { id: string; head: string }[]>();
  for (const p of products) {
    const s = split(p.name);
    if (!s || !s.tail) {
      out.set(p.id, p.name);
      continue;
    }
    const key = s.tail.toLowerCase();
    byTail.set(key, [...(byTail.get(key) ?? []), { id: p.id, head: s.head }]);
  }
  for (const [, same] of byTail) {
    const tail = split(products.find((p) => p.id === same[0].id)!.name)!.tail;
    if (same.length === 1) {
      out.set(same[0].id, tail);
      continue;
    }
    const words = same.map((s) => s.head.split(/\s+/));
    const common = words.slice(1).reduce((acc, w) => acc.filter((x) => w.includes(x)), words[0]);
    for (let i = 0; i < same.length; i++) {
      const own = words[i].filter((w) => !common.includes(w)).join(" ");
      // Nothing of its own (one name is the other's prefix): the whole name.
      out.set(same[i].id, own ? `${own} ${tail}` : products.find((p) => p.id === same[i].id)!.name);
    }
  }
  return out;
}

// ---------------------------------------------------------------- words

export function sizeLabel(size: RangeSize): string {
  return size === "big" ? "Big" : size === "medium" ? "Medium" : "Small";
}

/** Why a store has its size, in a few words. */
export function sizeWhy(source: SizeSource): string {
  switch (source) {
    case "sales":
      return "by its orders";
    case "visits":
      return "from how often your team goes there, until it has more orders";
    case "set":
      return "set by you";
  }
}

export function statusLabel(s: RangeStatus): string {
  switch (s) {
    case "have":
      return "Has it";
    case "gap":
      return "Missing";
    case "stopped":
      return "Stopped buying";
    case "quiet":
      return "Hasn't ordered lately";
    case "off_range":
      return "Orders it outside its range";
  }
}

/**
 * The stores a "share" reason compared with, by level: "Choppies big stores",
 * or for a store in no group "big stores with no chain" (`noGroup`).
 */
export function similarStores(
  level: number,
  groupName: string | null,
  size: RangeSize,
  sites: string,
  noGroup = "with no group",
): string {
  const s = sites.toLowerCase();
  switch (level) {
    case 1:
      return groupName ? `${groupName} ${size} ${s}` : `${size} ${s} ${noGroup}`;
    case 2:
      return groupName ? `${groupName} ${s}` : `${s} ${noGroup}`;
    case 3:
      return `your ${size} ${s}`;
    default:
      return `your ${s}`;
  }
}

/** Why a product is (or is not) in a store's range, in one sentence. */
export function reasonWords(
  line: RangeLine,
  row: Pick<RangeStoreRow, "level" | "size">,
  groupName: string | null,
  site: string,
  sites: string,
  noGroup?: string,
): string {
  const one = site.toLowerCase();
  const s = sites.toLowerCase();
  switch (line.reason) {
    case "pin":
      return "You set it to always be in this group's range.";
    case "own":
      return `They have ordered it on ${line.own_orders} orders.`;
    case "launch":
      return `A proven new product: Tickd added it to big ${s} where it has been tried.`;
    case "share":
      return `${Math.round(line.share ?? 0)}% of ${similarStores(row.level, groupName, row.size, sites, noGroup)} take it${
        line.cluster_stores ? ` (${line.cluster_stores} compared)` : ""
      }.`;
    case "pin_never":
      return "You set it to never be in this group's range.";
    case "not_taking":
      return "A new product that is not taking off, so it is not counted as missing.";
    case "excluded":
      return `Not for this ${one}: ${line.excluded ?? ""}`;
    default:
      return `Not enough of the similar ${s} take it.`;
  }
}

/** A new product's result, as the owner would say it. */
export function resultLabel(r: ProductResult): string {
  switch (r) {
    case "waiting":
      return "Just added";
    case "untried":
      return "Not ordered yet";
    case "trying":
      return "Being tried";
    case "proven":
      return "Proven";
    case "slow":
      return "Selling slowly";
    case "not_taking":
      return "Not taking off";
  }
}

export function resultTone(r: ProductResult): "good" | "warn" | "bad" | undefined {
  return r === "proven" ? "good" : r === "not_taking" || r === "untried" ? "bad" : r === "slow" ? "warn" : undefined;
}

/**
 * A product's result in a sentence, with its proof: "5 of 7 stores ordered
 * it again". `groupNames` turns the group ids that tried it into names.
 */
export function resultWords(
  p: RangeProductRow,
  groupNames: (id: string) => string,
  site: string,
  sites: string,
): string {
  const one = site.toLowerCase();
  const s = sites.toLowerCase();
  const again = `${p.repeats} of ${p.chances} ${s} that could have ordered it again did (${p.repeat_pct ?? 0}%)`;
  switch (p.result) {
    case "waiting":
      return "Added recently. Nobody has ordered it yet.";
    case "untried":
      return `No ${one} has ordered it in the ${p.untried_days} days or more since it was added. Ask your team to show it to their big ${s}.`;
    case "trying": {
      const need = Math.max(1, p.min_chances - p.chances);
      return `${p.tried} ${p.tried === 1 ? one : s} ordered it. Tickd needs ${need} more to order again before it can judge it.`;
    }
    case "proven": {
      const groups = [...new Set(p.groups_tried.map(groupNames))].join(", ");
      return p.stage === "new"
        ? `${again}. Tickd added it to the big ${s} in ${groups || "the groups that tried it"}.`
        : `${again}.`;
    }
    case "slow":
      return `${again}. Check its price, where it sits on the shelf, or the flavour.`;
    case "not_taking":
      return p.stage === "new"
        ? `${again}. Tickd stopped counting it as missing where it was never ordered.`
        : `${again}.`;
  }
}

// ------------------------------------------------------------ the summary

export type RangeSummary = {
  /** Fewer ordering stores than Tickd needs to compare them. */
  learning: boolean;
  orderingStores: number;
  minStores: number;
  /** Lines in range at stores that ordered lately. */
  inRange: number;
  have: number;
  missing: number;
  stopped: number;
  /** have / inRange, rounded; null with nothing in range. */
  filledPct: number | null;
  /** About what the missing and stopped lines sell a month; null without money. */
  missingValue: number | null;
  storesMissing: number;
  storesStopped: number;
  quietStores: number;
  stores: number;
};

/** The card's figures, from the same rows as the page. */
export function summariseRange(rows: RangeStoreRow[]): RangeSummary {
  let inRange = 0;
  let have = 0;
  let missing = 0;
  let stopped = 0;
  let value = 0;
  let storesMissing = 0;
  let storesStopped = 0;
  let quiet = 0;
  for (const r of rows) {
    if (r.quiet) quiet += 1;
    let m = false;
    let st = false;
    for (const l of r.lines) {
      if (!l.in_range || l.status === "quiet") continue;
      inRange += 1;
      if (l.status === "have") have += 1;
      if (l.status === "gap" || l.status === "stopped") {
        if (l.status === "gap") {
          missing += 1;
          m = true;
        } else {
          stopped += 1;
          st = true;
        }
        // A line with no estimate (no price, or no similar store has it) adds nothing.
        value += l.est_value_month ?? 0;
      }
    }
    if (m) storesMissing += 1;
    if (st) storesStopped += 1;
  }
  const first = rows[0];
  // Money is withheld as a whole (no invoicing), never line by line, so one
  // line carrying an estimate says this person sees money.
  const seesMoney = rows.some((r) => r.lines.some((l) => l.est_value_month !== null || l.value !== null));
  return {
    learning: rows.length === 0 || rows.every((r) => r.learning),
    orderingStores: first?.ordering_stores ?? 0,
    minStores: first?.min_stores ?? 5,
    inRange,
    have,
    missing,
    stopped,
    filledPct: inRange > 0 ? Math.round((100 * have) / inRange) : null,
    missingValue: seesMoney ? Math.round(value) : null,
    storesMissing,
    storesStopped,
    quietStores: quiet,
    stores: rows.length,
  };
}

export type NewProductSummary = {
  proven: number;
  slow: number;
  notTaking: number;
  trying: number;
  untried: number;
  waiting: number;
};

/** The card's new-products line: products still on their launch path, and the ones never ordered. */
export function summariseNewProducts(products: RangeProductRow[]): NewProductSummary {
  const out: NewProductSummary = { proven: 0, slow: 0, notTaking: 0, trying: 0, untried: 0, waiting: 0 };
  for (const p of products) {
    if (p.stage === "established") continue;
    if (p.result === "proven") out.proven += 1;
    else if (p.result === "slow") out.slow += 1;
    else if (p.result === "not_taking") out.notTaking += 1;
    else if (p.result === "trying") out.trying += 1;
    else if (p.result === "untried") out.untried += 1;
    else out.waiting += 1;
  }
  return out;
}

/** "3 proven, 1 not taking off, 21 not ordered yet": the parts that are not nought, in that order. */
export function newProductsLine(s: NewProductSummary): string {
  const parts = [
    s.proven > 0 ? `${s.proven} proven` : "",
    s.slow > 0 ? `${s.slow} selling slowly` : "",
    s.notTaking > 0 ? `${s.notTaking} not taking off` : "",
    s.trying > 0 ? `${s.trying} being tried` : "",
    s.untried > 0 ? `${s.untried} not ordered yet` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No new products";
}

/** The products most stores have ordered: the learning card's "best sellers so far". */
export function bestSellers(products: RangeProductRow[], take = 3): RangeProductRow[] {
  return [...products]
    .filter((p) => p.tried > 0)
    .sort((a, b) => b.tried - a.tried || (b.ros ?? 0) - (a.ros ?? 0))
    .slice(0, take);
}

// ------------------------------------------------------- what to do with a product

export type ProductCall = "push" | "protect" | "check" | "big_only" | "none";

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The trade's two numbers for each product, against the company's medians:
 * how fast it sells where it is (boxes per store per month) and how far it
 * has spread (of the stores whose range has it, the share that have it).
 * Sells well in few stores: push it. Sells well everywhere: protect it. In
 * many stores, slow: check it. Few stores, slow: keep it to big stores.
 */
export function productCalls(
  products: RangeProductRow[],
  spreadOf: (productId: string) => { inRange: number; have: number } | undefined,
): Map<string, ProductCall> {
  const sold = products.filter((p) => p.tried > 0 && p.ros !== null);
  const spread = (p: RangeProductRow) => {
    const s = spreadOf(p.product_id);
    return s && s.inRange > 0 ? s.have / s.inRange : 0;
  };
  const rosMid = median(sold.map((p) => p.ros as number));
  const spreadMid = median(sold.map(spread));
  const out = new Map<string, ProductCall>();
  for (const p of products) {
    if (p.tried === 0 || p.ros === null || rosMid === null || spreadMid === null) {
      out.set(p.product_id, "none");
      continue;
    }
    const fast = p.ros >= rosMid;
    const wide = spread(p) >= spreadMid;
    out.set(p.product_id, fast ? (wide ? "protect" : "push") : wide ? "check" : "big_only");
  }
  return out;
}

export function callLabel(c: ProductCall, sites: string): string {
  const s = sites.toLowerCase();
  switch (c) {
    case "push":
      return `Push it into more ${s}`;
    case "protect":
      return "Protect it: never run out";
    case "check":
      return "Check it: price, shelf or flavour";
    case "big_only":
      return `Keep it to big ${s}`;
    case "none":
      return "Not ordered yet";
  }
}

// ------------------------------------------------------------------ tiles

export function showLabel(s: RangeShow, sites: string): string {
  switch (s) {
    case "missing":
      return `Missing from ${sites.toLowerCase()}`;
    case "stopped":
      return "Stopped buying";
    case "products":
      return "Every product";
    case "new":
      return "New products";
  }
}

/** The ready reasons for "Not for this store", so nobody has to type one. */
export const EXCLUDE_REASONS = [
  "Not allowed to sell it",
  "The buyer said no",
  "No shelf space",
  "They buy it elsewhere",
] as const;

// ---------------------------------------------------------------- the card

export type RangeCardData = {
  summary: RangeSummary;
  newProducts: NewProductSummary;
  /** While learning: the products most stores have ordered so far. */
  best: { id: string; name: string; stores: number }[];
  /** The look-back the card counts over (range_lapse_days). */
  days: number;
};

/** What the dashboard card shows: the same two functions the page reads, over the company's look-back. */
export async function fetchRangeCard(supabase: SupabaseClient, days: number): Promise<RangeCardData> {
  const [rows, products, catalogue] = await Promise.all([
    fetchRangeStatus(supabase, null),
    fetchRangeProducts(supabase),
    fetchRangeCatalogue(supabase),
  ]);
  const names = shortNames(catalogue);
  return {
    summary: summariseRange(rows),
    newProducts: summariseNewProducts(products),
    best: bestSellers(products).map((p) => ({
      id: p.product_id,
      name: names.get(p.product_id) ?? "",
      stores: p.tried,
    })),
    days,
  };
}
