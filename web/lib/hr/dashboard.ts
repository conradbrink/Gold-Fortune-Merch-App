import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The three HR dashboards.
 *
 * Every number comes back from one RPC, and each of those RPCs is `security
 * invoker` — so a line manager's counts are their own team's because RLS
 * filtered the rows before they were counted, not because the function was told
 * who was asking. Counting in the browser instead would mean fetching every
 * row to count it, which is both slower and a wider grant.
 */

export type HrSummary = {
  as_of: string;
  workforce: {
    total: number;
    active: number;
    on_leave: number;
    suspended: number;
    recently_joined: number;
    recently_terminated: number;
  };
  attendance_today: {
    working: number;
    late: number;
    absent: number;
    incomplete: number;
    on_leave: number;
    expected: number;
  };
  leave: { pending_requests: number; on_leave_today: number };
  documents: {
    expired: number;
    expiring_7: number;
    expiring_30: number;
    valid: number;
  };
  contracts: { expiring_soon: number; expired: number };
  performance: {
    reviews_due: number;
    reviews_completed: number;
    average_score: number | null;
    below_expectations: number;
    threshold: number;
    period: { type: string; year: number; index: number };
  };
  disciplinary: {
    open_cases: number;
    under_investigation: number;
    hearings_pending: number;
    awaiting_response: number;
    active_warnings: number;
  };
};

export type PerformanceDashboard = {
  as_of: string;
  threshold: number;
  period: { type: string; year: number; index: number };
  headcount: number;
  reviews_due: number;
  reviews_completed: number;
  reviews_in_draft: number;
  average_score: number | null;
  below_expectations: {
    employee_id: string;
    name: string | null;
    position: string | null;
    score: number;
  }[];
  due_list: {
    employee_id: string;
    name: string | null;
    employee_number: string;
    position: string | null;
  }[];
  outstanding_by_manager: {
    manager_id: string;
    name: string | null;
    outstanding: number;
  }[];
  trend: {
    year: number;
    index: number;
    type: string;
    average: number;
    reviews: number;
  }[];
};

export type DisciplinaryDashboard = {
  as_of: string;
  open_cases: number;
  total_cases: number;
  awaiting_response: number;
  awaiting_hearing: number;
  by_status: { code: string; label: string; count: number }[];
  by_type: { code: string; label: string; count: number }[];
  by_severity: { code: string; label: string; rank: number; count: number }[];
  by_department: { id: string | null; label: string; count: number }[];
  by_territory: { id: string | null; label: string; count: number }[];
  active_warnings: number;
  expiring_warnings: number;
  unacknowledged_warnings: number;
};

export async function fetchHrSummary(
  supabase: SupabaseClient
): Promise<HrSummary> {
  const { data, error } = await supabase.rpc("hr_dashboard_summary");
  if (error) throw new Error(error.message);
  return data as unknown as HrSummary;
}

export type PerformanceFilters = {
  departmentId?: string | null;
  managerId?: string | null;
  territoryId?: string | null;
  position?: string | null;
};

export async function fetchPerformanceDashboard(
  supabase: SupabaseClient,
  filters: PerformanceFilters = {}
): Promise<PerformanceDashboard> {
  const { data, error } = await supabase.rpc("hr_performance_dashboard", {
    p_department: filters.departmentId ?? undefined,
    p_manager: filters.managerId ?? undefined,
    p_territory: filters.territoryId ?? undefined,
    p_position: filters.position ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PerformanceDashboard;
}

export async function fetchDisciplinaryDashboard(
  supabase: SupabaseClient
): Promise<DisciplinaryDashboard> {
  const { data, error } = await supabase.rpc("hr_disciplinary_dashboard");
  if (error) throw new Error(error.message);
  return data as unknown as DisciplinaryDashboard;
}

/**
 * Turn today's expiries into notifications.
 *
 * ⚠️ This is a page load standing in for a scheduler, and it is worth being
 * honest about the limit: `pg_cron` is not enabled on this project, so if
 * nobody opens the HR dashboard, nobody is notified. The same figures are on
 * the dashboard itself, so the notice is a convenience rather than the only
 * route to the fact — but it is not an alerting system and must not be sold as
 * one. When a scheduler exists, point it at `hr_sweep_expiry_notifications` and
 * delete this call.
 *
 * The RPC is idempotent per day, so a dozen page loads produce one notice.
 * Failure is swallowed on purpose: a sweep that errors must not take the
 * dashboard down with it.
 */
export async function sweepExpiryNotifications(
  supabase: SupabaseClient
): Promise<void> {
  const { error } = await supabase.rpc("hr_sweep_expiry_notifications");
  if (error) {
    console.warn("HR expiry sweep did not run:", error.message);
  }
}
