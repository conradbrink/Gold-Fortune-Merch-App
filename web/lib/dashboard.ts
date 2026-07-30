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

/**
 * The parts of the system that arrived after the original KPIs: the prospect
 * pipeline, the territory structure, and how much of the estate stands on a
 * position a rep actually measured.
 */
export type OperationsSummary = {
  sales_visits: number;
  leads_open: number;
  leads_converted: number;
  /** Not range-scoped — a follow-up owed last month is still owed. */
  follow_ups_due: number;
  follow_ups_overdue: number;
  stores_confirmed: number;
  stores_guessed: number;
  stores_unplaced: number;
  territories_main: number;
  territories_sub: number;
};

export async function fetchOperationsSummary(
  supabase: SupabaseClient,
  range: DateRange
): Promise<OperationsSummary> {
  const { data, error } = await callRpc(supabase, "dashboard_operations", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw new Error(error.message);
  return data as OperationsSummary;
}

/** One rep's working day, averaged over the days they actually worked. */
export type RepDayTimes = {
  rep_id: string;
  rep_name: string | null;
  days_worked: number;
  /** Seconds since local midnight. Null only if a rep has no days in range. */
  avg_start_seconds: number | null;
  avg_end_seconds: number | null;
  avg_length_seconds: number | null;
};

export async function fetchRepDayTimes(
  supabase: SupabaseClient,
  range: DateRange
): Promise<RepDayTimes[]> {
  const { data, error } = await callRpc(supabase, "rep_day_times", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RepDayTimes[];
}

/**
 * The company average, weighted by days worked.
 *
 * A plain mean of the per-rep averages would give a rep who worked one day the
 * same say as one who worked twenty. Weighting by days makes this the average
 * of every rep-day in the period, which is what "the company starts at" means.
 */
export function companyDayTimes(rows: RepDayTimes[]): {
  start: number | null;
  end: number | null;
  length: number | null;
  days: number;
} {
  let days = 0;
  let start = 0;
  let end = 0;
  let length = 0;

  for (const r of rows) {
    if (r.avg_start_seconds === null || r.avg_end_seconds === null) continue;
    days += r.days_worked;
    start += Number(r.avg_start_seconds) * r.days_worked;
    end += Number(r.avg_end_seconds) * r.days_worked;
    length += Number(r.avg_length_seconds ?? 0) * r.days_worked;
  }

  if (days === 0) return { start: null, end: null, length: null, days: 0 };
  return {
    start: start / days,
    end: end / days,
    length: length / days,
    days,
  };
}

/** Seconds since midnight as a clock time. Never rendered as "00:00" for null. */
export function formatTimeOfDay(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
