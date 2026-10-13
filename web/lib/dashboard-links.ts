import { fromLocalDateInput, toLocalDateInput, type DateRange } from "@/lib/date-range";
import type { ReportId, ViewId } from "@/lib/report-catalogue";
import type { ReportTab } from "@/lib/report-tabs";

/**
 * Where each dashboard number opens, and how the page it opens reads the link.
 *
 * A number on the dashboard is the start of a question ("which 96?"), so every
 * one of them opens the list it counted, already filtered. Both halves live in
 * this file so they cannot drift apart: a card builds its link with a function
 * below, the page it opens reads the link with the matching parser, and
 * tests/dashboard-links.test.ts sends every link through its parser.
 *
 * Dates travel the way Reports and the off-site list already read them: `from`
 * is the first day and `to` the day after the last (the range's exclusive end),
 * both YYYY-MM-DD in the viewer's own calendar.
 */

/** A range as it travels in a link: first day, and the day after the last. */
export type DayRange = { from: string; to: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function rangeQuery(range: DateRange): DayRange {
  return { from: toLocalDateInput(range.from), to: toLocalDateInput(range.to) };
}

/** The range a link carried, or null when it carried none or a malformed one. */
export function rangeFromQuery(q: URLSearchParams): DateRange | null {
  const from = q.get("from");
  const to = q.get("to");
  if (!from || !to || !DAY.test(from) || !DAY.test(to)) return null;
  const range = { from: fromLocalDateInput(from), to: fromLocalDateInput(to) };
  // An Invalid Date would reach every query below as a 400, and an empty or
  // backwards range would show "nothing" for a question that has an answer.
  if (Number.isNaN(+range.from) || Number.isNaN(+range.to) || +range.to <= +range.from) return null;
  return range;
}

/** The last day a range covers, for the pages whose date boxes include their end. */
export function lastDayOf(range: DateRange): string {
  const d = new Date(range.to);
  d.setDate(d.getDate() - 1);
  return toLocalDateInput(d);
}

/** The day after a YYYY-MM-DD day, for turning a last day into an exclusive end. */
export function dayAfter(day: string): string {
  const d = fromLocalDateInput(day);
  d.setDate(d.getDate() + 1);
  return toLocalDateInput(d);
}

/** The first day of the month after the one `monthStart` begins. */
export function nextMonth(monthStart: string): string {
  const d = fromLocalDateInput(monthStart);
  return toLocalDateInput(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

function href(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

// ------------------------------------------------------------------ reports

/** A report and view over the dashboard's dates. Reports opens the nearest view the company has. */
export function reportHref(tab: ReportId | ReportTab, range: DateRange, view?: ViewId): string {
  return href("/reports", { tab, view, ...rangeQuery(range) });
}

// ------------------------------------------------------------- store health

/**
 * The Store health card's groups. The first three split the active stores with
 * nothing left over; `lapsed` cuts across them (ordered before, nothing in 60
 * days). `visited` is the first two together, for a company that takes no
 * orders. The rules live in the database function `store_health`.
 */
export const HEALTH_GROUPS = ["ordering", "no_order", "not_visited", "lapsed", "visited"] as const;
export type HealthGroup = (typeof HEALTH_GROUPS)[number];

export function storeHealthHref(show: HealthGroup): string {
  return href("/stores/health", { show });
}

/** How far back a page looks: a number of days ending now, or since a date (YYYY-MM-DD). */
export type LookBack = { days: number } | { since: string };

/**
 * The look-back a Store health link carried (`?days=14` or `?since=2026-09-01`),
 * if it is one the page offers and not in the future; null for the card's own.
 */
export function lookBackFromQuery(q: URLSearchParams, allowedDays: readonly number[], today: string): LookBack | null {
  const days = q.get("days");
  if (days !== null && allowedDays.includes(Number(days))) return { days: Number(days) };
  const since = q.get("since");
  if (since !== null && DAY.test(since) && since <= today && !Number.isNaN(Date.parse(`${since}T00:00:00Z`))) return { since };
  return null;
}

export function healthGroupFromQuery(q: URLSearchParams): HealthGroup | null {
  const v = q.get("show");
  return v !== null && (HEALTH_GROUPS as readonly string[]).includes(v) ? (v as HealthGroup) : null;
}

/** One store on the stores list, by its id: a name search could also match its neighbours. */
export function storeHref(storeId: string): string {
  return href("/stores", { id: storeId });
}

/** The store a link asked for, if it carried one. */
export function storeIdFromQuery(q: URLSearchParams): string | null {
  const v = q.get("id");
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

// ------------------------------------------------------------------- orders

/** Every status an order passes through before it is delivered: the pipeline's "needs action". */
export const OPEN_ORDER_STATUSES = ["new", "confirmed", "picking", "packed", "dispatched"] as const;

/**
 * The orders list, filtered. `status` is "open" (everything not yet delivered)
 * or a list of statuses, which travels joined by commas.
 */
export function ordersHref(opts: { status?: "open" | readonly string[]; pod?: "outstanding" }): string {
  const status = opts.status === undefined ? undefined : opts.status === "open" ? "open" : opts.status.join(",");
  return href("/orders", { status, pod: opts.pod });
}

/**
 * The Orders pipeline card's own page, on one stage or (none) everything not
 * yet delivered, over the dashboard's dates (its "Invoiced" is for a period).
 */
export function pipelineHref(stage?: string, range?: DayRange): string {
  return href("/orders/pipeline", { stage, from: range?.from, to: range?.to });
}

/**
 * The statuses an orders link asked for, in the lifecycle's own order, or null
 * for every status. Unknown names are dropped rather than trusted: a stale or
 * hand-edited link must not leave the list empty with no clue why.
 */
export function orderStatusesFromQuery(value: string | null, known: readonly string[]): string[] | null {
  if (!value || value === "all") return null;
  if (value === "open") return known.filter((s) => (OPEN_ORDER_STATUSES as readonly string[]).includes(s));
  const asked = new Set(value.split(",").map((s) => s.trim()));
  const out = known.filter((s) => asked.has(s));
  return out.length > 0 ? out : null;
}

// -------------------------------------------------------------------- sales

/** Deliveries over a range, and optionally one person's. */
export function salesHref(range: DayRange, repId?: string): string {
  return href("/sales", { from: range.from, to: range.to, rep: repId });
}

// ------------------------------------------------------------------- quotes

export function quotesHref(status: string): string {
  return href("/quotes", { status });
}

/** A quote status a link asked for, if the page offers it. */
export function quoteStatusFromQuery(value: string | null, known: readonly string[]): string | null {
  return value !== null && (value === "open" || value === "all" || known.includes(value)) ? value : null;
}

// --------------------------------------------------------- recurring orders

/** The pipeline's "placing this week": active, next run within this many days. */
export const RECURRING_DUE_DAYS = 7;

export function recurringDueHref(): string {
  return href("/recurring-orders", { due: String(RECURRING_DUE_DAYS) });
}

export function dueDaysFromQuery(q: URLSearchParams): number | null {
  const v = q.get("due");
  if (v === null || !/^\d{1,3}$/.test(v)) return null;
  return Number(v);
}

/** Whether a standing order is placed within `days` of `today` (both YYYY-MM-DD), as the pipeline counts it. */
export function recurringDueWithin(r: { status: string; next_run: string | null }, today: string, days: number): boolean {
  if (r.status !== "active" || !r.next_run) return false;
  const limit = fromLocalDateInput(today);
  limit.setDate(limit.getDate() + days);
  return r.next_run <= toLocalDateInput(limit);
}

// ---------------------------------------------------------------- inventory

export function lowStockHref(): string {
  return href("/inventory", { low: "1" });
}

// ------------------------------------------------------------------- money

/** Invoices issued over a range, optionally by payment state. */
export function invoicesHref(range: DayRange, pay?: string): string {
  return href("/invoices", { from: range.from, to: range.to, pay });
}

/** Commissions in a state, over every date ("all") or a range. */
export function commissionsHref(status: string, range: DayRange | "all"): string {
  return range === "all"
    ? href("/commissions", { status, period: "all" })
    : href("/commissions", { status, from: range.from, to: range.to });
}

// ------------------------------------------------------------------- people

/** The Field team card's own page, over the dashboard's dates. */
export function fieldTeamHref(range?: DayRange): string {
  return href("/tracking/team", { from: range?.from, to: range?.to });
}

/** One person's day: where they were and what they did. */
export function trackingHref(repId: string): string {
  return `/tracking/${repId}`;
}
