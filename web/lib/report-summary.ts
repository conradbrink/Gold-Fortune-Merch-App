import type { Adherence, CoverageGap, OosHotspot, PerfectStore, TrendPointRow } from "@/lib/reports";
import type { ServiceLogRow } from "@/lib/service-log";
import type { HoursDay } from "@/lib/staff-hours";

/**
 * The figures behind the new report views, from data the Reports page already
 * loads. No new database call: the summary, the completed and missed lists and
 * the team breakdown are the existing reports, added up or laid out
 * differently. Kept here, away from the page, so they can be checked without a
 * session.
 *
 * A figure is null when the company does not have the report it comes from,
 * and the page leaves its tile out rather than showing a nought.
 */

export type ServiceSummary = {
  planned: number | null;
  completed: number | null;
  missed: number | null;
  /** Completed over planned, 0 to 1. */
  completionRate: number | null;
  /** Distinct sites with a finished job in the period. */
  sitesServiced: number | null;
  /** Share of active sites with at least one job in the period, 0 to 1. */
  coverage: number | null;
  /** Workday hours. */
  hours: number | null;
};

export function serviceSummary(input: {
  adherence: Adherence[] | null;
  serviceLog: ServiceLogRow[] | null;
  hours: HoursDay[] | null;
  gaps: CoverageGap[] | null;
}): ServiceSummary {
  const a = input.adherence;
  const planned = a ? a.reduce((n, r) => n + r.planned, 0) : null;
  const completedPlanned = a ? a.reduce((n, r) => n + r.completed, 0) : null;
  const missed = a ? a.reduce((n, r) => n + r.missed, 0) : null;
  return {
    planned,
    // Every finished job when the log is there (planned or not); otherwise
    // the planned ones done.
    completed: input.serviceLog ? input.serviceLog.length : completedPlanned,
    missed,
    completionRate: planned ? (completedPlanned ?? 0) / planned : null,
    sitesServiced: input.serviceLog ? new Set(input.serviceLog.map((r) => r.store_id)).size : null,
    coverage: coverageShare(input.gaps),
    hours: input.hours ? input.hours.reduce((n, d) => n + d.workday_seconds, 0) / 3600 : null,
  };
}

export type SalesSummary = {
  perfectStore: number | null;
  /** Out-of-stock checks over all checks, 0 to 1. */
  oosRate: number | null;
  coverage: number | null;
  adherence: number | null;
  audits: number | null;
};

export function salesSummary(input: {
  perfect: PerfectStore[] | null;
  hotspots: OosHotspot[] | null;
  gaps: CoverageGap[] | null;
  adherence: Adherence[] | null;
  trends: TrendPointRow[] | null;
}): SalesSummary {
  const scored = (input.perfect ?? []).filter((r) => r.score !== null);
  const checks = input.hotspots ? input.hotspots.reduce((n, r) => n + r.checks, 0) : 0;
  const planned = input.adherence ? input.adherence.reduce((n, r) => n + r.planned, 0) : 0;
  return {
    perfectStore: input.perfect && scored.length > 0
      ? Math.round(scored.reduce((n, r) => n + Number(r.score), 0) / scored.length)
      : null,
    oosRate: input.hotspots && checks > 0 ? input.hotspots.reduce((n, r) => n + r.oos_count, 0) / checks : null,
    coverage: coverageShare(input.gaps),
    adherence: input.adherence && planned > 0 ? input.adherence.reduce((n, r) => n + r.completed, 0) / planned : null,
    audits: input.trends ? input.trends.reduce((n, r) => n + Number(r.submissions ?? 0), 0) : null,
  };
}

function coverageShare(gaps: CoverageGap[] | null): number | null {
  if (!gaps || gaps.length === 0) return null;
  return gaps.filter((g) => g.visits_in_period > 0).length / gaps.length;
}

/** Finished jobs per day, every day of the period present (a quiet day is a 0, not a gap). */
export function jobsPerDay(rows: ServiceLogRow[], days: string[]): { day: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.day, (counts.get(r.day) ?? 0) + 1);
  return days.map((day) => ({ day, value: counts.get(day) ?? 0 }));
}

/** The calendar days from `from` to `to` inclusive, as YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // A guard against a reversed or huge range drawing a year of bars.
  for (let i = 0; d <= end && i < 400; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export type TeamRow = {
  staffId: string;
  name: string;
  planned: number | null;
  completed: number | null;
  missed: number | null;
  adherence: number | null;
  hours: number | null;
};

/**
 * One row per person: what was planned, done and missed (adherence) and the
 * hours they worked (hours), joined on the person. Someone with hours and no
 * plan, or a plan and no hours, still gets a row.
 */
export function teamBreakdown(adherence: Adherence[] | null, hours: HoursDay[] | null): TeamRow[] {
  const rows = new Map<string, TeamRow>();
  const blank = (staffId: string, name: string): TeamRow => ({
    staffId,
    name,
    planned: null,
    completed: null,
    missed: null,
    adherence: null,
    hours: null,
  });
  for (const a of adherence ?? []) {
    rows.set(a.rep_id, {
      ...blank(a.rep_id, a.rep_name ?? ""),
      planned: a.planned,
      completed: a.completed,
      missed: a.missed,
      adherence: a.adherence_rate,
    });
  }
  for (const d of hours ?? []) {
    const row = rows.get(d.staff_id) ?? blank(d.staff_id, d.staff_name ?? "");
    row.hours = (row.hours ?? 0) + d.workday_seconds / 3600;
    rows.set(d.staff_id, row);
  }
  return [...rows.values()].sort((x, y) => (y.completed ?? -1) - (x.completed ?? -1) || x.name.localeCompare(y.name));
}

export type MissedRow = { date: string; site: string; staff: string };

/** Every missed job in the period, newest first. */
export function missedRows(adherence: Adherence[]): MissedRow[] {
  return adherence
    .flatMap((a) => a.missed_detail.map((m) => ({ date: m.date.slice(0, 10), site: m.store, staff: a.rep_name ?? "" })))
    .sort((x, y) => y.date.localeCompare(x.date) || x.site.localeCompare(y.site));
}

/** A rate as a whole percentage, or an em dash. */
export function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Hours with one decimal place, grouped by thousands. */
export function hoursText(hours: number | null): string {
  return hours === null ? "—" : hours.toLocaleString("en-ZA", { maximumFractionDigits: 1 });
}
