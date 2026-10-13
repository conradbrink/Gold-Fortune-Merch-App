import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import { lower, type Terms } from "@/lib/terms";
import type { HealthGroup } from "@/lib/dashboard-links";

/**
 * The stores behind the dashboard's Store health card.
 *
 * One row per active store from `store_health`, the same function the card
 * counts, so the list under "Not visited in 30 days" is exactly the card's 96
 * and its first five are the card's "go here first" five (the function returns
 * them in that order).
 */
export type StoreHealthRow = {
  store_id: string;
  store_name: string;
  city: string | null;
  last_visit_at: string | null;
  last_order_at: string | null;
  orders_ever: number;
  /** Calendar days in the company's time; null when there has never been one. */
  days_since_visit: number | null;
  days_since_order: number | null;
  status: "ordering" | "no_order" | "not_visited";
  lapsed: boolean;
};

export async function fetchStoreHealth(supabase: SupabaseClient): Promise<StoreHealthRow[]> {
  const { data, error } = await callRpc(supabase, "store_health", {});
  if (error) throw new Error(error.message);
  return ((data ?? []) as StoreHealthRow[]).map((r) => ({
    ...r,
    orders_ever: Number(r.orders_ever ?? 0),
  }));
}

/**
 * The groups a company is shown. A company that sells (Distribution) gets the
 * card's four; any other has no orders to split by, so visited or not is the
 * whole question.
 */
export function groupsFor(sells: boolean): HealthGroup[] {
  return sells ? ["ordering", "no_order", "not_visited", "lapsed"] : ["visited", "not_visited"];
}

export function inGroup(row: StoreHealthRow, group: HealthGroup): boolean {
  switch (group) {
    case "lapsed":
      return row.lapsed;
    case "visited":
      return row.status !== "not_visited";
    default:
      return row.status === group;
  }
}

/** The card's own words, so the list reads as the card opened up. */
export function groupLabel(group: HealthGroup): string {
  switch (group) {
    case "ordering":
      return "Visited and ordering";
    case "no_order":
      return "Visited, no order in 30 days";
    case "not_visited":
      return "Not visited in 30 days";
    case "lapsed":
      return "Stopped ordering";
    case "visited":
      return "Visited in the last 30 days";
  }
}

/** One sentence under the tabs: what the group is, and what to do about it. */
export function groupMeaning(group: HealthGroup, t: Terms): string {
  const sites = lower(t.site.many);
  const staff = lower(t.staff.one);
  const job = lower(t.job.one);
  switch (group) {
    case "ordering":
      return `These ${sites} had a ${job} and placed an order in the last 30 days.`;
    case "no_order":
      return `These ${sites} had a ${job} in the last 30 days but placed no order. Ask the ${staff} who goes there why.`;
    case "not_visited":
      return `Nobody has checked in at these ${sites} in the last 30 days. The ones never visited come first, then the longest gaps.`;
    case "lapsed":
      return `These ${sites} used to order but have placed nothing in 60 days. The ones that ordered most are worth a call first.`;
    case "visited":
      return `These ${sites} had a ${job} in the last 30 days.`;
  }
}

export type SortKey = "name" | "visit" | "order" | "orders";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

/**
 * How each group opens: by the thing it is about, the longest gap first.
 * "Never" counts as the longest gap of all. Stopped-ordering stores open by how
 * much they used to order, the biggest first.
 */
export function defaultSort(group: HealthGroup): Sort {
  switch (group) {
    case "not_visited":
    case "visited":
      return { key: "visit", dir: "desc" };
    case "no_order":
      return { key: "order", dir: "desc" };
    case "ordering":
      return { key: "order", dir: "asc" };
    case "lapsed":
      return { key: "orders", dir: "desc" };
  }
}

/** Days since, with "never" as more days than any real gap. */
function gap(days: number | null): number {
  return days === null ? Number.POSITIVE_INFINITY : days;
}

/**
 * Sorted copy. Ties keep the database's order (never visited first, then the
 * longest since a visit, then name), so the first rows of "Not visited" are the
 * card's five whatever the browser's collation does with names.
 */
export function sortRows(rows: StoreHealthRow[], sort: Sort): StoreHealthRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (r: StoreHealthRow): number | string => {
    switch (sort.key) {
      case "visit":
        return gap(r.days_since_visit);
      case "order":
        return gap(r.days_since_order);
      case "orders":
        return r.orders_ever;
      case "name":
        return r.store_name.toLocaleLowerCase();
    }
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = value(a.r);
      const y = value(b.r);
      if (x === y) return a.i - b.i;
      if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y);
      return sign * ((x as number) < (y as number) ? -1 : 1);
    })
    .map(({ r }) => r);
}

/** "Never", "Today", "Yesterday", "12 days ago". */
export function describeDays(days: number | null): string {
  if (days === null) return "Never";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
