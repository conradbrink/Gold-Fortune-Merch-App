import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import type { DateRange } from "@/lib/date-range";

export type PeriodMetrics = {
  visits_total: number;
  visits_completed: number;
  visits_missed: number;
  visits_unscheduled: number;
  active_reps: number;
  stores_covered: number;
  avg_duration_seconds: number;
  submissions: number;
  /** null when nothing was measured — never conflate that with a real 0%. */
  oos_rate: number | null;
  planogram_rate: number | null;
  avg_facings: number | null;
};

export type DashboardSummary = {
  stores_active: number;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: { day: string; completed: number; total: number }[];
};

export async function fetchDashboardSummary(
  supabase: SupabaseClient,
  range: DateRange
): Promise<DashboardSummary> {
  const { data, error } = await callRpc(supabase, "dashboard_summary", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw new Error(error.message);
  return data as DashboardSummary;
}

/**
 * Percentage change, or null when there's nothing to compare against.
 *
 * Returning null rather than 0 matters: a "0%" delta against an empty previous
 * period claims "no change" when the truth is "no basis for comparison".
 */
export function deltaPct(
  current: number,
  previous: number
): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatPct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
