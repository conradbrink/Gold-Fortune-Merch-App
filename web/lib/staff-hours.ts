import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { DateRange } from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import type { Terms } from "@/lib/terms";
import { companyTime } from "@/lib/company-time";
import { allPages } from "@/lib/all-pages";

/**
 * Hours: one row per person per day, from the workday they started and the
 * {jobs} they finished. `staff_hours()`. The page adds the arithmetic: time
 * between {jobs}, {jobs} per hour, and the short and long day marks the
 * company's trade sets (`report_short_day_hours`, `report_long_day_hours`).
 */
export type StaffHoursRow = Database["public"]["Functions"]["staff_hours"]["Returns"][number];

export async function fetchStaffHours(supabase: SupabaseClient<Database>, range: DateRange): Promise<StaffHoursRow[]> {
  // Every row, in pages: newest day first, a person and a day being unique.
  return allPages((from, to) =>
    supabase
      .rpc("staff_hours", { p_from: range.from.toISOString(), p_to: range.to.toISOString() })
      .order("day", { ascending: false })
      .order("staff_name")
      .order("staff_id")
      .range(from, to)
  );
}

export type DayMark = "short" | "long" | null;

export type HoursDay = StaffHoursRow & {
  /** Workday time not on a {job}: travel and waiting. Null without a finished workday. */
  betweenSeconds: number | null;
  /** {Jobs} per workday hour. Null without a finished workday. */
  jobsPerHour: number | null;
  mark: DayMark;
};

/**
 * A finished workday is marked short under `shortHours` and long over
 * `longHours` (0 turns a mark off). A day still open, or with no workday, is
 * never marked: there is nothing finished to judge.
 */
export function hoursDay(row: StaffHoursRow, limits: { shortHours: number; longHours: number }): HoursDay {
  const finished = row.workday_seconds > 0;
  const hours = row.workday_seconds / 3600;
  let mark: DayMark = null;
  if (finished && limits.shortHours > 0 && hours < limits.shortHours) mark = "short";
  if (finished && limits.longHours > 0 && hours > limits.longHours) mark = "long";
  return {
    ...row,
    betweenSeconds: finished ? Math.max(0, row.workday_seconds - row.onsite_seconds) : null,
    jobsPerHour: finished ? Math.round((row.jobs / hours) * 100) / 100 : null,
    mark,
  };
}

export type HoursTotals = { people: number; days: number; workdaySeconds: number; onsiteSeconds: number; jobs: number; km: number; short: number; long: number };

export function hoursTotals(days: readonly HoursDay[]): HoursTotals {
  const people = new Set<string>();
  const t: HoursTotals = { people: 0, days: 0, workdaySeconds: 0, onsiteSeconds: 0, jobs: 0, km: 0, short: 0, long: 0 };
  for (const d of days) {
    people.add(d.staff_id);
    t.days += 1;
    t.workdaySeconds += d.workday_seconds;
    t.onsiteSeconds += d.onsite_seconds;
    t.jobs += d.jobs;
    t.km += d.km ?? 0;
    if (d.mark === "short") t.short += 1;
    if (d.mark === "long") t.long += 1;
  }
  t.people = people.size;
  t.km = Math.round(t.km * 10) / 10;
  return t;
}

/** "7:45" for a duration in seconds; "-" for none. Hours and minutes, as a timesheet reads. */
export function clockDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** For payroll: decimal hours, which a spreadsheet adds up. */
const decimalHours = (seconds: number | null) => (seconds === null ? "" : Math.round((seconds / 3600) * 100) / 100);

/** First in and last out are the company's clock, like the dates beside them. */
export function hoursSheet(days: readonly HoursDay[], t: Terms, context: string[], timeZone: string): ExportSheet {
  const time = (iso: string | null) => companyTime(iso, timeZone);
  return {
    title: "Hours",
    filename: "hours",
    context,
    columns: [
      { header: t.staff.one, key: "staff" },
      { header: "Date", key: "day" },
      { header: "First in", key: "in" },
      { header: "Last out", key: "out" },
      { header: "Workday hours", key: "workday", numeric: true },
      { header: "On site hours", key: "onsite", numeric: true },
      { header: "Between hours", key: "between", numeric: true },
      { header: t.job.many, key: "jobs", numeric: true },
      { header: "Km", key: "km", numeric: true },
      { header: "Note", key: "note" },
    ],
    rows: days.map((d) => ({
      staff: d.staff_name ?? "",
      day: d.day,
      in: time(d.first_in),
      out: time(d.last_out),
      workday: d.workday_seconds > 0 ? decimalHours(d.workday_seconds) : "",
      onsite: decimalHours(d.onsite_seconds),
      between: decimalHours(d.betweenSeconds),
      jobs: d.jobs,
      km: d.km ?? "",
      note: d.open_now ? "Workday still open" : d.mark === "short" ? "Short day" : d.mark === "long" ? "Long day" : !d.first_in ? "No workday started" : "",
    })),
  };
}
