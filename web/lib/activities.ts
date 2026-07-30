import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";

export type Verdict =
  | "at_store"
  | "nearby"
  | "off_site"
  | "invalid_gps"
  | "unknown"
  /** A sales call on a prospect: there is a position, but no geofence to
      measure it against, because the shop is not on the estate. Distinct from
      `unknown`, which means a position was expected and never arrived. */
  | "prospect";

export type ActivityEvent = {
  event_id: string;
  kind: "check_in" | "check_out" | "sales_visit";
  occurred_at: string;
  /** Null for a sales visit — a prospect has no visit row. */
  visit_id: string | null;
  rep_id: string | null;
  rep_name: string | null;
  /** Null for a sales visit; `store_name` then carries the company called on. */
  store_id: string | null;
  store_name: string;
  distance_m: number | null;
  accuracy_m: number | null;
  /** Null for a sales visit — nothing to fence. */
  geofence_radius_m: number | null;
  verdict: Verdict;
  submission_id: string | null;
  /** Total matching rows before pagination — same on every row. */
  total_count: number;
};

export type ActivitySummary = Partial<Record<Verdict, number>> & {
  total: number;
};

export type FeedFilters = {
  from: Date;
  to: Date;
  repIds?: string[] | null;
  storeIds?: string[] | null;
  onlyFlagged?: boolean;
};

function baseArgs(f: FeedFilters) {
  return {
    p_from: f.from.toISOString(),
    p_to: f.to.toISOString(),
    p_rep_ids: f.repIds?.length ? f.repIds : null,
    p_store_ids: f.storeIds?.length ? f.storeIds : null,
  };
}

export async function fetchActivityFeed(
  supabase: SupabaseClient,
  filters: FeedFilters,
  limit: number,
  offset: number
): Promise<ActivityEvent[]> {
  const { data, error } = await callRpc(supabase, "activity_feed", {
    ...baseArgs(filters),
    p_only_flagged: filters.onlyFlagged ?? false,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityEvent[];
}

export async function fetchActivitySummary(
  supabase: SupabaseClient,
  filters: FeedFilters
): Promise<ActivitySummary> {
  const { data, error } = await callRpc(supabase, "activity_feed_summary", {
    ...baseArgs(filters),
  });
  if (error) throw new Error(error.message);
  return (data ?? { total: 0 }) as ActivitySummary;
}

/** Metres rendered the way a person would say them. */
export function formatDistance(m: number | null): string {
  if (m === null) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
