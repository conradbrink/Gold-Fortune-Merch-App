import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import { toLocalDateInput, type DateRange } from "@/lib/date-range";

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

/** One rep on one working day — the detail the averages are taken over. */
export type RepDayDetail = {
  rep_id: string;
  rep_name: string | null;
  /** Local date, `YYYY-MM-DD`. Already converted to Africa/Gaborone by the RPC. */
  local_day: string;
  /** Seconds since local midnight, the same convention as `RepDayTimes`. */
  start_seconds: number | null;
  end_seconds: number | null;
  length_seconds: number | null;
};

/**
 * Every rep-day in the range, rather than a mean per rep.
 *
 * Fetched for the whole range in one call and grouped in the browser, so moving
 * between days in the picker costs nothing — there are at most a few dozen rows,
 * and a round trip per selection would make the control feel broken on a slow
 * connection.
 */
export async function fetchRepDayDetail(
  supabase: SupabaseClient,
  range: DateRange
): Promise<RepDayDetail[]> {
  const { data, error } = await callRpc(supabase, "rep_day_times_per_day", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RepDayDetail[];
}

/** One rep-day's driving, keyed the same way as `RepDayDetail`. */
export type RepDayDistance = {
  rep_id: string;
  /** Local date, `YYYY-MM-DD`, to match `RepDayDetail.local_day`. */
  local_day: string;
  /**
   * Metres along roads, from the Routes API. **Null until the day is settled**,
   * and never filled in from the phone's own figure.
   *
   * That substitution would be tempting and wrong. The phone accumulates
   * straight-line legs between pings, and measured across 33 settled days it
   * captured **23 km against 1,953 km actually driven** — about one per cent,
   * because the sampling timer it depended on barely ran. A blank is honest; that
   * number dressed up as mileage is not.
   */
  road_metres: number | null;
};

/**
 * Driving per rep-day, for the range on screen.
 *
 * Read from `workday_sessions` rather than folded into `rep_day_times_per_day`:
 * a working day is a union of sessions, visits and sales calls, but a *distance*
 * only ever comes from a session, and widening that RPC would have it return a
 * column that is null for two thirds of what it counts.
 *
 * The day is derived from `started_at` in local time, matching how the RPC keys
 * its rows — a session opened at seven in the morning in CAT is that date, and
 * comparing UTC dates would misfile every early start.
 */
export async function fetchRepDayDistance(
  supabase: SupabaseClient,
  range: DateRange
): Promise<RepDayDistance[]> {
  const { data, error } = await supabase
    .from("workday_sessions")
    .select("rep_id, started_at, road_distance_meters")
    .gte("started_at", range.from.toISOString())
    .lte("started_at", range.to.toISOString())
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as {
    rep_id: string;
    started_at: string;
    road_distance_meters: number | null;
  }[]).map((r) => ({
    rep_id: r.rep_id,
    local_day: toLocalDateInput(new Date(r.started_at)),
    road_metres: r.road_distance_meters,
  }));
}

/** Metres as kilometres for display. Null stays null — it is not zero. */
export function formatKm(metres: number | null): string {
  if (metres === null) return "—";
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-GB")} km`;
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
