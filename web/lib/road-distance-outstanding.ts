import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How many finished days are waiting to be settled.
 *
 * Its own module, and that is the whole reason it exists separately from
 * `road-distance-settle.ts`. The button that calls it is a client component,
 * and importing the settlement module to reach one counting query would pull
 * the whole settling path — the Routes batching, the claim protocol — into the
 * browser bundle for code the browser must never run.
 *
 * Counted through the caller's own client: a manager has SELECT on
 * `workday_sessions`, RLS confines it to their organisation, and this is not a
 * privileged question.
 */
export async function countOutstanding(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("workday_sessions")
    .select("id", { count: "exact", head: true })
    .not("ended_at", "is", null)
    .is("road_distance_at", null)
    .is("road_distance_error", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
