import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import { lower, type Terms } from "@/lib/terms";
import type { ReorderGroup } from "@/lib/dashboard-links";

/**
 * Stores due for an order (owner, 15 Oct 2026: "prompts the manager with this
 * list of stores that need orders again - to improve sales").
 *
 * One row per active store from `store_reorder`, the function the reps' phones
 * read too: the last order (Tickd orders and the QuickBooks history), how often
 * the store usually orders, and how long after its last order it is due (its
 * usual gap or the company's rule, 30 days unless changed, whichever is sooner).
 *
 * Whether a store is due today is worked out here from those dates, by the
 * same rule as the phone (`reorderStateOn` in mobile/lib/data/models/
 * store_reorder.dart), so the dashboard and the rep at the door agree.
 */
export type StoreReorderRow = {
  store_id: string;
  store_name: string;
  city: string | null;
  /** YYYY-MM-DD, company time; null when the store never ordered. */
  last_order_on: string | null;
  /** "SO-000150", or a QuickBooks invoice number. */
  last_order_ref: string | null;
  /** The order's status, or "invoiced" for a QuickBooks invoice. */
  last_order_status: string | null;
  /** Days with an order in the last year. */
  order_days_year: number;
  /** The usual days between orders; null with fewer than three order days in a year. */
  usual_days: number | null;
  due_after_days: number;
  /** YYYY-MM-DD; null when the store never ordered. */
  due_on: string | null;
};

export type ReorderState = "never" | "not_due" | "soon" | "due" | "stopped";

/** How far ahead "due soon" looks, as on the phone. */
export const DUE_SOON_DAYS = 7;

/** The rule a company starts with (`reorder_after_days`). */
export const DEFAULT_REORDER_DAYS = 30;

export async function fetchStoreReorder(supabase: SupabaseClient): Promise<StoreReorderRow[]> {
  const { data, error } = await callRpc(supabase, "store_reorder", {});
  if (error) throw new Error(error.message);
  return ((data ?? []) as StoreReorderRow[]).map((r) => ({
    ...r,
    order_days_year: Number(r.order_days_year ?? 0),
    usual_days: r.usual_days === null ? null : Number(r.usual_days),
    due_after_days: Number(r.due_after_days),
  }));
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type ReorderStatus = {
  state: ReorderState;
  /** Days since the last order; null when never. */
  daysSince: number | null;
  /** Days until due, negative once overdue; null when never. */
  daysUntilDue: number | null;
};

/** Where a store stands on `today` (YYYY-MM-DD, company time). */
export function reorderStatus(r: StoreReorderRow, today: string): ReorderStatus {
  if (r.last_order_on === null) return { state: "never", daysSince: null, daysUntilDue: null };
  const since = daysBetween(r.last_order_on, today);
  const until = r.due_after_days - since;
  const state: ReorderState =
    since >= 2 * r.due_after_days ? "stopped" : until <= 0 ? "due" : until <= DUE_SOON_DAYS ? "soon" : "not_due";
  return { state, daysSince: since, daysUntilDue: until };
}

/** The tiles, in the order a manager acts on them. */
export const REORDER_TILES: readonly ReorderGroup[] = ["due", "soon", "stopped", "never", "not_due"];

export function groupLabel(g: ReorderGroup): string {
  switch (g) {
    case "due":
      return "Due now";
    case "soon":
      return `Due in the next ${DUE_SOON_DAYS} days`;
    case "stopped":
      return "Stopped ordering";
    case "never":
      return "Never ordered";
    case "not_due":
      return "Not due yet";
  }
}

/** One sentence under the tiles: what the group is and what to do about it. */
export function groupMeaning(g: ReorderGroup, t: Terms, rule: number): string {
  const sites = lower(t.site.many);
  const job = lower(t.job.one);
  switch (g) {
    case "due":
      return `These ${sites} have gone their usual time without an order, or ${rule} days if they don't have a usual time yet. Ask for an order on the next ${job}.`;
    case "soon":
      return `These ${sites} will be due for an order within the next ${DUE_SOON_DAYS} days.`;
    case "stopped":
      return `These ${sites} have gone twice their usual time, or ${rule * 2} days, without an order. Find out why they stopped, and ask for an order.`;
    case "never":
      return `These ${sites} have never placed an order.`;
    case "not_due":
      return `These ${sites} ordered recently and are not due yet.`;
  }
}

/** What an empty group means, said as good news where it is. */
export function emptyGroup(g: ReorderGroup, t: Terms): string {
  const site = lower(t.site.one);
  switch (g) {
    case "due":
      return `No ${site} is due for an order right now.`;
    case "soon":
      return `No ${site} becomes due in the next ${DUE_SOON_DAYS} days.`;
    case "stopped":
      return `No ${site} has stopped ordering.`;
    case "never":
      return `Every ${site} has placed an order.`;
    case "not_due":
      return `Every ${site} is due, or has never ordered.`;
  }
}

/** How often a store orders, said the way a person would. Mirrors `orderRhythm` on the phone. */
export function orderRhythm(usualDays: number): string {
  if (usualDays < 11) return usualDays === 1 ? "every day" : `every ${usualDays} days`;
  if (usualDays < 50) return `every ${Math.round(usualDays / 7)} weeks`;
  const months = Math.round(usualDays / 30.4);
  return months <= 1 ? "once a month" : `every ${months} months`;
}

/** "Due today", "3 days overdue", "Due in 4 days", or "" for a store that never ordered. */
export function describeDue(s: ReorderStatus): string {
  if (s.daysUntilDue === null) return "";
  if (s.daysUntilDue === 0) return "Due today";
  if (s.daysUntilDue < 0) return `${-s.daysUntilDue} ${s.daysUntilDue === -1 ? "day" : "days"} overdue`;
  return `Due in ${s.daysUntilDue} ${s.daysUntilDue === 1 ? "day" : "days"}`;
}

/** The last order's status in a few words, while it is still on its way. */
export function lastOrderProgress(status: string | null): string | null {
  switch (status) {
    case "new":
      return "not confirmed yet";
    case "confirmed":
    case "picking":
      return "being packed";
    case "packed":
      return "packed, not sent yet";
    case "dispatched":
      return "on its way";
    default:
      return null;
  }
}

/** "SO-000150" or "Invoice 1790" (QuickBooks). */
export function orderLabel(r: StoreReorderRow): string {
  if (!r.last_order_ref) return "";
  return r.last_order_status === "invoiced" ? `Invoice ${r.last_order_ref}` : r.last_order_ref;
}

// ------------------------------------------------------------- next visit

/** The first planned visit to a store from today, and who it is with. */
export type NextVisit = { day: string; repId: string | null };

/**
 * The first planned visit to each store over the next `days` days, from
 * `routes`. A visit already finished or missed is behind us, not next: a store
 * checked out this morning without an order must show as not planned, or
 * nobody reschedules it. Paged: two weeks of a busy company's routes is more
 * than one PostgREST page (1000 rows), and a page cut short would drop the
 * later stores without an error.
 */
export async function fetchNextVisits(
  supabase: SupabaseClient,
  today: string,
  lastDay: string
): Promise<Map<string, NextVisit>> {
  const PAGE = 1000;
  const out = new Map<string, NextVisit>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("routes")
      .select("id, store_id, rep_id, scheduled_date, visits(status)")
      .gte("scheduled_date", today)
      .lte("scheduled_date", lastDay)
      .order("scheduled_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as {
      store_id: string;
      rep_id: string | null;
      scheduled_date: string;
      visits: { status: string }[] | null;
    }[];
    for (const r of page) {
      if (out.has(r.store_id)) continue;
      if ((r.visits ?? []).some((v) => v.status === "checked_out" || v.status === "missed")) continue;
      out.set(r.store_id, { day: r.scheduled_date, repId: r.rep_id });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/** How far ahead the page looks for a planned visit. */
export const NEXT_VISIT_DAYS = 14;

// ------------------------------------------------------------------ sorting

export type SortKey = "name" | "last" | "due" | "usual" | "orders" | "visit";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

/**
 * Each group opens in the order a manager would work it. Due and stopped open
 * with the best customers first (the most order days in the last year): a
 * store that orders every month and has gone quiet is worth more than one that
 * ordered once. Due soon opens with the soonest; the rest by name or date.
 */
export function defaultSort(g: ReorderGroup): Sort {
  switch (g) {
    case "due":
    case "stopped":
      return { key: "orders", dir: "desc" };
    case "soon":
    case "not_due":
      return { key: "due", dir: "asc" };
    case "never":
      return { key: "name", dir: "asc" };
  }
}

/** Sorted copy. Ties fall back to the longest since an order, then the name. */
export function sortRows(
  rows: StoreReorderRow[],
  sort: Sort,
  today: string,
  nextVisit: (storeId: string) => string | null = () => null
): StoreReorderRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const far = Number.POSITIVE_INFINITY;
  // Once per row, not once per comparison.
  const statusOf = new Map(rows.map((r) => [r, reorderStatus(r, today)]));
  const value = (r: StoreReorderRow): number | string => {
    const s = statusOf.get(r)!;
    switch (sort.key) {
      case "name":
        return r.store_name.toLocaleLowerCase();
      case "last":
        return s.daysSince ?? far;
      case "due":
        return s.daysUntilDue ?? far;
      case "usual":
        return r.usual_days ?? far;
      case "orders":
        return r.order_days_year;
      case "visit": {
        const d = nextVisit(r.store_id);
        return d === null ? far : daysBetween(today, d);
      }
    }
  };
  const tie = (a: StoreReorderRow, b: StoreReorderRow) => {
    const x = statusOf.get(a)!.daysSince ?? far;
    const y = statusOf.get(b)!.daysSince ?? far;
    if (x !== y) return x > y ? -1 : 1;
    return a.store_name.localeCompare(b.store_name);
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return tie(a, b);
    if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y);
    return sign * ((x as number) < (y as number) ? -1 : 1);
  });
}

// ------------------------------------------------------------- the card

export type ReorderSummary = {
  counts: Record<ReorderGroup, number>;
  /** The card's "ask these first": due now, best customers first. */
  first: { id: string; name: string; city: string | null; status: ReorderStatus; usualDays: number | null }[];
  rule: number;
};

/** What the dashboard card shows, from the same rows and rules as the page. */
export function summarise(rows: StoreReorderRow[], today: string, rule: number, take = 5): ReorderSummary {
  const counts = { due: 0, soon: 0, stopped: 0, never: 0, not_due: 0 } as Record<ReorderGroup, number>;
  for (const r of rows) counts[reorderStatus(r, today).state] += 1;
  const due = sortRows(
    rows.filter((r) => reorderStatus(r, today).state === "due"),
    defaultSort("due"),
    today
  );
  return {
    counts,
    first: due.slice(0, take).map((r) => ({
      id: r.store_id,
      name: r.store_name,
      city: r.city,
      status: reorderStatus(r, today),
      usualDays: r.usual_days,
    })),
    rule,
  };
}

export async function fetchReorderSummary(supabase: SupabaseClient, today: string, rule: number): Promise<ReorderSummary> {
  return summarise(await fetchStoreReorder(supabase), today, rule);
}
