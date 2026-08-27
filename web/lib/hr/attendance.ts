import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Attendance, read from the merchandising system rather than from a clock of
 * its own.
 *
 * Everything here is one call to `hr_attendance_report`, which derives each day
 * from `workday_sessions`, `visits`, `leads`, approved leave and the org's
 * working-hours settings. There is no attendance table and nothing is written.
 *
 * 🔴 **`incomplete` is not `absent`, and the difference is the point.** A rep
 * who visited twelve stores and never pressed *Start workday* comes back as
 * `incomplete` with a `no_start` exception. Calling that an absence would turn
 * a habit into an accusation — and on the live data it is a very common habit:
 * over August, Jerry recorded a session on 8 of 19 working days and Tshepo on
 * 7 of 15, while visiting stores throughout. Any UI built on this must keep the
 * two apart.
 */

export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "on_leave"
  | "incomplete"
  /** A day outside the org's working week. Not in the brief's list because it
   *  is not a verdict — it is the absence of one. */
  | "off";

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  on_leave: "On leave",
  incomplete: "Incomplete",
  off: "Non-working day",
};

export const ATTENDANCE_STATUS_TONE: Record<
  AttendanceStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  present: "default",
  late: "secondary",
  absent: "destructive",
  on_leave: "outline",
  incomplete: "secondary",
  off: "outline",
};

export type AttendanceException =
  | "no_start"
  | "no_end"
  | "late_start"
  | "short_day";

export const EXCEPTION_LABELS: Record<AttendanceException, string> = {
  no_start: "No Start Workday",
  no_end: "No End Workday",
  late_start: "Late start",
  short_day: "Very short day",
};

export type AttendanceDay = {
  employee_id: string;
  employee_name: string | null;
  employee_number: string | null;
  department_id: string | null;
  department_name: string | null;
  territory_id: string | null;
  territory_name: string | null;
  work_date: string;
  is_working_day: boolean;
  started_at: string | null;
  ended_at: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  worked_seconds: number | null;
  activity_events: number;
  status: AttendanceStatus;
  exceptions: AttendanceException[];
  leave_type: string | null;
};

export type AttendanceFilters = {
  from: string;
  to: string;
  employeeId?: string | null;
  departmentId?: string | null;
  territoryId?: string | null;
  status?: AttendanceStatus | null;
};

export async function fetchAttendance(
  supabase: SupabaseClient,
  filters: AttendanceFilters
): Promise<AttendanceDay[]> {
  const { data, error } = await supabase.rpc("hr_attendance_report", {
    p_from: filters.from,
    p_to: filters.to,
    p_employee: filters.employeeId ?? undefined,
    p_department: filters.departmentId ?? undefined,
    p_territory: filters.territoryId ?? undefined,
    p_status: filters.status ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AttendanceDay[];
}

/** Totals for the filtered range, for the summary strip above the table. */
export type AttendanceTotals = {
  days: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  incomplete: number;
  workedSeconds: number;
  exceptions: number;
};

/**
 * Counts only working days.
 *
 * A weekend row exists so the calendar is complete, and including it would put
 * "84 days" against a month with 21 in it and make every rate meaningless.
 */
export function summarise(rows: AttendanceDay[]): AttendanceTotals {
  const working = rows.filter((r) => r.is_working_day);
  return {
    days: working.length,
    present: working.filter((r) => r.status === "present").length,
    late: working.filter((r) => r.status === "late").length,
    absent: working.filter((r) => r.status === "absent").length,
    onLeave: working.filter((r) => r.status === "on_leave").length,
    incomplete: working.filter((r) => r.status === "incomplete").length,
    workedSeconds: working.reduce((sum, r) => sum + (r.worked_seconds ?? 0), 0),
    exceptions: working.reduce((sum, r) => sum + r.exceptions.length, 0),
  };
}

/**
 * A Google Maps link for a recorded position, or null.
 *
 * The coordinates come from the rep's handset at the moment they pressed the
 * button; this is the same trail the Activities page shows, surfaced where an
 * HR question about a start time can reach it.
 */
export function mapLink(
  lat: number | null,
  lng: number | null
): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
