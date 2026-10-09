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
 * between {jobs}, {jobs} per hour, the short and long day marks the
 * company's trade sets (`report_short_day_hours`, `report_long_day_hours`),
 * and the split into normal hours and overtime (`report_day_normal_hours`,
 * `report_week_normal_hours`, `report_sunday_is_overtime`).
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
  /** Workday hours inside the normal day and week. Null without a finished workday. */
  normalSeconds: number | null;
  /** Workday hours past them, or on a Sunday that is all overtime. Null without a finished workday. */
  overtimeSeconds: number | null;
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
    // All normal until `overtimeSplit` has seen the person's whole week.
    normalSeconds: finished ? row.workday_seconds : null,
    overtimeSeconds: finished ? 0 : null,
  };
}

export type OvertimeLimits = { dayHours: number; weekHours: number; sundayOvertime: boolean };

/** Whether any overtime rule is on; with none, the report shows no overtime at all. */
export const overtimeOn = (limits: OvertimeLimits) => limits.dayHours > 0 || limits.weekHours > 0 || limits.sundayOvertime;

/** Monday of the ISO week a "YYYY-MM-DD" day falls in. The day is a calendar day, so no timezone. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

const isSunday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
};

/**
 * Normal hours and overtime, per person. A day's hours past `dayHours` are
 * overtime; then, through each ISO week in day order, normal hours past
 * `weekHours` become overtime too (the day's overtime is not counted again).
 * With `sundayOvertime` every Sunday hour is overtime and none of it counts
 * towards the week. A limit of 0 turns its rule off.
 *
 * The days are the company's (`staff_hours` groups by them). A week counts
 * only the days it is given, so the page asks for the hours from the Monday
 * before the period and leaves those extra days off the screen.
 */
export function overtimeSplit(days: readonly HoursDay[], limits: OvertimeLimits): HoursDay[] {
  const dayLimit = limits.dayHours * 3600;
  const weekLimit = limits.weekHours * 3600;
  const out = new Map<HoursDay, HoursDay>();
  // Normal hours so far, per person and week.
  const week = new Map<string, number>();
  const ordered = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const d of ordered) {
    if (d.workday_seconds <= 0) {
      out.set(d, d);
      continue;
    }
    const worked = d.workday_seconds;
    let normal = limits.sundayOvertime && isSunday(d.day) ? 0 : dayLimit > 0 ? Math.min(worked, dayLimit) : worked;
    if (weekLimit > 0) {
      const key = `${d.staff_id}|${weekStart(d.day)}`;
      const before = week.get(key) ?? 0;
      normal = Math.min(normal, Math.max(0, weekLimit - before));
      week.set(key, before + normal);
    }
    out.set(d, { ...d, normalSeconds: normal, overtimeSeconds: worked - normal });
  }
  return days.map((d) => out.get(d)!);
}

export type HoursTotals = {
  people: number;
  days: number;
  workdaySeconds: number;
  onsiteSeconds: number;
  overtimeSeconds: number;
  jobs: number;
  km: number;
  short: number;
  long: number;
};

export function hoursTotals(days: readonly HoursDay[]): HoursTotals {
  const people = new Set<string>();
  const t: HoursTotals = { people: 0, days: 0, workdaySeconds: 0, onsiteSeconds: 0, overtimeSeconds: 0, jobs: 0, km: 0, short: 0, long: 0 };
  for (const d of days) {
    people.add(d.staff_id);
    t.days += 1;
    t.workdaySeconds += d.workday_seconds;
    t.onsiteSeconds += d.onsite_seconds;
    t.overtimeSeconds += d.overtimeSeconds ?? 0;
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

/**
 * First in and last out are the company's clock, like the dates beside them.
 * Normal and overtime hours are columns only when an overtime rule is on.
 */
export function hoursSheet(days: readonly HoursDay[], t: Terms, context: string[], timeZone: string, overtime = false): ExportSheet {
  const time = (iso: string | null) => companyTime(iso, timeZone);
  const split = overtime
    ? [
        { header: "Normal hours", key: "normal", numeric: true },
        { header: "Overtime hours", key: "overtime", numeric: true },
      ]
    : [];
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
      ...split,
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
      ...(overtime ? { normal: decimalHours(d.normalSeconds), overtime: decimalHours(d.overtimeSeconds) } : {}),
      onsite: decimalHours(d.onsite_seconds),
      between: decimalHours(d.betweenSeconds),
      jobs: d.jobs,
      km: d.km ?? "",
      note: d.open_now ? "Workday still open" : d.mark === "short" ? "Short day" : d.mark === "long" ? "Long day" : !d.first_in ? "No workday started" : "",
    })),
  };
}
