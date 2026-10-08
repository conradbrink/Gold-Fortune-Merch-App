import { lower, type Terms } from "@/lib/terms";
import { toLocalDateInput, type DateRange } from "@/lib/date-range";
import type { ReportTab } from "@/lib/report-tabs";

/**
 * The numbers a dashboard can show (Stage 7 Part 3): the catalogue in code,
 * as the industry research recommends, and which ones each trade shows as
 * data (the company setting `dashboard_cards`, seeded per trade).
 *
 * The database computes them (`dashboard_kpis`); this says what each one is
 * called in the company's words, how it reads, whether up is good, how much
 * data it needs before it means anything, and where it can be taken apart.
 */

export type KpiFormat = "percent" | "count" | "money" | "minutes" | "hours" | "km" | "decimal";

/** One number as `dashboard_kpis` returns it. */
export type Kpi = {
  value: number | null;
  /** The previous window's value; absent for numbers about now. */
  previous?: number | null;
  /** How many events it rests on. */
  events: number;
  /** A second figure some numbers carry (overdue part, in progress, oldest days, long shifts). */
  extra?: number | null;
};

export type KpiDef = {
  code: string;
  label: (t: Terms) => string;
  /** One line on what it counts, for the settings list and the tile's tooltip. */
  hint: (t: Terms) => string;
  format: KpiFormat;
  /** Which way is good, for the colour of the change. */
  better: "up" | "down" | "none";
  /** "window" numbers follow the dashboard's dates; "now" numbers are about today. */
  scope: "window" | "now";
  /** Needs the invoicing module and permission (the database leaves it out otherwise). */
  money?: true;
  /** Under this many events the number says "Not enough data". */
  minEvents: number;
  href: (range: DateRange) => string;
};

function report(tab: ReportTab) {
  return (range: DateRange) =>
    `/reports?${new URLSearchParams({ tab, from: toLocalDateInput(range.from), to: toLocalDateInput(range.to) }).toString()}`;
}
const page = (path: string) => () => path;

export const KPIS: KpiDef[] = [
  {
    code: "jobs_done_pct",
    label: (t) => `${t.job.many} done as planned`,
    hint: (t) => `Planned ${lower(t.job.many)} done on the day, or caught up later.`,
    format: "percent", better: "up", scope: "window", minEvents: 5, href: report("adherence"),
  },
  {
    code: "missed",
    label: (t) => `Missed ${lower(t.job.many)}`,
    hint: (t) => `Planned ${lower(t.job.many)} on days gone by that nobody did.`,
    format: "count", better: "down", scope: "window", minEvents: 1, href: report("adherence"),
  },
  {
    code: "jobs_done",
    label: (t) => `${t.job.many} done`,
    hint: (t) => `Finished ${lower(t.job.many)}, planned or not.`,
    format: "count", better: "up", scope: "window", minEvents: 0, href: page("/visits"),
  },
  {
    code: "jobs_today",
    label: (t) => `${t.job.many} done today`,
    hint: () => `Finished today, and how many are under way.`,
    format: "count", better: "none", scope: "now", minEvents: 0, href: page("/visits"),
  },
  {
    code: "upcoming_7d",
    label: (t) => `${t.job.many} due this week`,
    hint: () => `Planned for today and the next six days, not yet done.`,
    format: "count", better: "none", scope: "now", minEvents: 0, href: page("/schedule"),
  },
  {
    code: "proof_pct",
    label: () => "Proof captured",
    hint: (t) => `Finished ${lower(t.job.many)} with a photo and, where you use them, a checklist.`,
    format: "percent", better: "up", scope: "window", minEvents: 5, href: report("photos"),
  },
  {
    code: "gps_verified_pct",
    label: () => "Checked in on site",
    hint: (t) => `Check-ins inside the ${lower(t.site.one)}'s radius, of those with a GPS fix.`,
    format: "percent", better: "up", scope: "window", minEvents: 5, href: report("reps"),
  },
  {
    code: "rounds_proven_pct",
    label: (t) => `${t.job.many} proven`,
    hint: () => "Checked in on site and with a photo.",
    format: "percent", better: "up", scope: "window", minEvents: 5, href: report("reps"),
  },
  {
    code: "planned_share",
    label: () => "Planned work",
    hint: (t) => `Finished ${lower(t.job.many)} that were on the plan, not added on the day.`,
    format: "percent", better: "up", scope: "window", minEvents: 5, href: report("adherence"),
  },
  {
    code: "time_on_site",
    label: (t) => `Time per ${lower(t.job.one)}`,
    hint: (t) => `Average time on site per finished ${lower(t.job.one)}.`,
    format: "minutes", better: "none", scope: "window", minEvents: 5, href: report("reps"),
  },
  {
    code: "onsite_share",
    label: () => "Share of the day on site",
    hint: () => "Time on site, out of finished workday hours.",
    format: "percent", better: "up", scope: "window", minEvents: 5, href: page("/tracking"),
  },
  {
    code: "jobs_per_staff_day",
    label: (t) => `${t.job.many} per ${lower(t.staff.one)} a day`,
    hint: (t) => `Finished ${lower(t.job.many)} per person per working day.`,
    format: "decimal", better: "up", scope: "window", minEvents: 5, href: report("reps"),
  },
  {
    code: "jobs_per_hour",
    label: (t) => `${t.job.many} per hour`,
    hint: () => "Finished, per hour of workday.",
    format: "decimal", better: "up", scope: "window", minEvents: 5, href: page("/tracking"),
  },
  {
    code: "hours_worked",
    label: () => "Hours worked",
    hint: () => "Finished workdays, and how many ran over 12 hours.",
    format: "hours", better: "none", scope: "window", minEvents: 0, href: page("/tracking"),
  },
  {
    code: "km",
    label: () => "Kilometres driven",
    hint: () => "Road distance of the workdays measured so far.",
    format: "km", better: "none", scope: "window", minEvents: 1, href: page("/tracking"),
  },
  {
    code: "km_per_job",
    label: (t) => `Km per ${lower(t.job.one)}`,
    hint: (t) => `Road distance per finished ${lower(t.job.one)}.`,
    format: "km", better: "down", scope: "window", minEvents: 5, href: page("/tracking"),
  },
  {
    code: "longest_gap",
    label: (t) => `Longest gap between ${lower(t.job.many)}`,
    hint: (t) => `The longest time between two check-ins at one ${lower(t.site.one)} on one day.`,
    format: "minutes", better: "down", scope: "window", minEvents: 1, href: page("/visits"),
  },
  {
    code: "response_hours",
    label: () => "Logged to on site",
    hint: (t) => `Hours from logging a ${lower(t.job.one)} to the check-in, for those logged in the week before.`,
    format: "hours", better: "down", scope: "window", minEvents: 3, href: page("/visits"),
  },
  {
    code: "photos_taken",
    label: () => "Photos",
    hint: (t) => `Photos taken on finished ${lower(t.job.many)}.`,
    format: "count", better: "up", scope: "window", minEvents: 0, href: report("photos"),
  },
  {
    code: "forms_done",
    label: () => "Checklists",
    hint: (t) => `Checklists and forms filled in on finished ${lower(t.job.many)}.`,
    format: "count", better: "up", scope: "window", minEvents: 0, href: report("form"),
  },
  {
    code: "owed",
    label: () => "Owed to you",
    hint: () => "Everything invoiced and not yet paid, and the overdue part.",
    format: "money", better: "down", scope: "now", money: true, minEvents: 0, href: page("/owed"),
  },
  {
    code: "overdue",
    label: () => "Overdue",
    hint: () => "Unpaid invoices past their due date.",
    format: "money", better: "down", scope: "now", money: true, minEvents: 0, href: page("/owed"),
  },
  {
    code: "unbilled_jobs",
    label: () => "Done but not invoiced",
    hint: (t) => `Finished ${lower(t.job.many)} on no invoice yet. Work a contract covers is billed by the contract.`,
    format: "count", better: "down", scope: "now", money: true, minEvents: 0, href: page("/invoices/unbilled"),
  },
  {
    code: "invoiced",
    label: () => "Invoiced",
    hint: () => "Invoices issued, VAT included.",
    format: "money", better: "up", scope: "window", money: true, minEvents: 0, href: page("/invoices"),
  },
  {
    code: "avg_invoice",
    label: () => "Average invoice",
    hint: () => "Invoiced, divided by the number of invoices.",
    format: "money", better: "up", scope: "window", money: true, minEvents: 3, href: page("/invoices"),
  },
  {
    code: "received",
    label: () => "Paid to you",
    hint: () => "Payments recorded against invoices.",
    format: "money", better: "up", scope: "window", money: true, minEvents: 0, href: page("/invoices"),
  },
  {
    code: "quote_win_rate",
    label: () => "Quotes won",
    hint: () => "Accepted, of the quotes decided.",
    format: "percent", better: "up", scope: "window", money: true, minEvents: 3, href: page("/quotes"),
  },
  {
    code: "quote_win_value",
    label: () => "Quotes won by value",
    hint: () => "The value accepted, of the value decided.",
    format: "percent", better: "up", scope: "window", money: true, minEvents: 3, href: page("/quotes"),
  },
  {
    code: "quotes_waiting_value",
    label: () => "Quotes waiting",
    hint: () => "Sent and not yet decided, and the oldest one's age.",
    format: "money", better: "none", scope: "now", money: true, minEvents: 0, href: page("/quotes"),
  },
  {
    code: "accepted_not_invoiced",
    label: () => "Accepted, not yet invoiced",
    hint: () => "Accepted quotes with no invoice yet.",
    format: "money", better: "down", scope: "now", money: true, minEvents: 0, href: page("/quotes"),
  },
];

const BY_CODE = new Map(KPIS.map((k) => [k.code, k]));

export function findKpi(code: string): KpiDef | undefined {
  return BY_CODE.get(code);
}

/** A comma list setting ("a,b,c") as its known codes, in order, once each. */
export function codesFromSetting(raw: unknown, known: (code: string) => boolean): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  for (const c of raw.split(",").map((s) => s.trim())) {
    if (c && known(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** `dashboard_kpis()`, checked field by field. Unknown or malformed entries are dropped. */
export function parseKpis(raw: unknown): Record<string, Kpi> {
  const out: Record<string, Kpi> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const num = (x: unknown) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));
    if (!("value" in o)) continue;
    out[code] = {
      value: num(o.value),
      events: Number.isFinite(Number(o.events)) ? Number(o.events) : 0,
      ...("previous" in o ? { previous: num(o.previous) } : {}),
      ...("extra" in o ? { extra: num(o.extra) } : {}),
    };
  }
  return out;
}

/** A new company's first-week milestones from `dashboard_kpis`' `first_week`. */
export type FirstWeek = { sites: boolean; workdays: boolean; proven: boolean; invoices: boolean | null };

export function parseFirstWeek(raw: unknown): FirstWeek | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fw = (raw as Record<string, unknown>).first_week;
  if (fw === null || typeof fw !== "object" || Array.isArray(fw)) return null;
  const o = fw as Record<string, unknown>;
  return {
    sites: Number(o.sites) > 0,
    workdays: Number(o.workdays) > 0,
    proven: Number(o.proven) > 0,
    invoices: o.invoices === null || o.invoices === undefined ? null : Number(o.invoices) > 0,
  };
}

/** Whether there is enough behind a number to show it. */
export function hasEnoughData(def: KpiDef, k: Kpi | undefined): boolean {
  return !!k && k.value !== null && k.events >= def.minEvents;
}

/**
 * The change against the previous window, in whole percent, and whether it
 * is good news. Null when there is nothing to compare: a number about now, no
 * previous value, or a previous of zero (a rise from nothing is not a %).
 */
export function kpiChange(def: KpiDef, k: Kpi): { pct: number; good: boolean | null } | null {
  if (def.scope !== "window" || k.value === null || k.previous === null || k.previous === undefined) return null;
  if (k.previous === 0) return null;
  const pct = Math.round(((k.value - k.previous) / Math.abs(k.previous)) * 100);
  if (pct === 0) return null;
  // A change of a point or two is noise, not news: shown, not coloured.
  const good = def.better === "none" || Math.abs(pct) < 3 ? null : def.better === "up" ? pct > 0 : pct < 0;
  return { pct, good };
}

/** A number as the tile shows it. `money` formats amounts in the company's currency. */
export function formatKpi(def: KpiDef, value: number, money: (n: number) => string): string {
  switch (def.format) {
    case "percent":
      return `${Math.round(value * 100)}%`;
    case "money":
      return money(value);
    case "minutes":
      return value >= 90 ? `${Math.floor(value / 60)} h ${Math.round(value % 60)} min` : `${Math.round(value)} min`;
    case "hours":
      return `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} h`;
    case "km":
      return `${value.toLocaleString("en-GB", { maximumFractionDigits: value >= 100 ? 0 : 1 })} km`;
    case "decimal":
      return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
    case "count":
      return Math.round(value).toLocaleString("en-GB");
  }
}

/** Grid columns for N tiles, so no row is left with a tile on its own. */
export function tileColumns(n: number): 2 | 3 | 4 | 5 {
  if (n === 5) return 5;
  if (n === 6 || n === 3 || n === 9) return 3;
  if (n <= 2) return 2;
  return 4;
}
