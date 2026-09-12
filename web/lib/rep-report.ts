import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import type { DateRange } from "@/lib/date-range";

/**
 * The Rep Performance Report — everything except the pixels.
 *
 * Four fetchers around the `rep_performance_*` functions
 * (`20260912044143_rep_performance_report`), and the arithmetic that turns
 * their aggregates into a score, a shortlist and a paragraph.
 *
 * Every function below the fetchers is **pure**. That is deliberate and it is
 * the same bargain `buildFormResponsesSheet` struck: this report is the one
 * screen whose output a manager will act on without being able to check it, so
 * the rules that decide "87 / 100 — Good" and "these three stores need
 * attention" have to be readable, and checkable against fixtures, without a
 * database or a signed-in session.
 *
 * Nothing here invents a figure. A rate that came back null stays null all the
 * way to the page, which prints "Not tracked" rather than a nought.
 */

/** Postgres returns `numeric` as a string; every rate arrives as one. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number {
  return Math.round(num(v) ?? 0);
}

export type RepSummary = {
  repId: string;
  repName: string | null;
  /** Comma-joined territory names of the stores assigned to the rep. */
  territories: string | null;
  storesAssigned: number;
  plannedVisits: number;
  completedPlanned: number;
  missedVisits: number;
  storesPlanned: number;
  storesVisited: number;
  completedVisits: number;
  unplannedVisits: number;
  /** Excluding VAT, delivered only — the same figure the Sales page shows. */
  salesNet: number;
  salesOrders: number;
  storesWithSales: number;
  visitsWithOrder: number;
  zeroSalesVisits: number;
  daysWorked: number;
  /** Seconds since local midnight, or null when nothing recorded it. */
  avgWorkdayStartSeconds: number | null;
  avgFirstCheckinSeconds: number | null;
  avgLastCheckoutSeconds: number | null;
  avgVisitSeconds: number | null;
  gpsChecked: number;
  /** 0–1. Null when no check-in carried a location fix. */
  gpsVerifiedRate: number | null;
  formComplianceRate: number | null;
  photoVisitRate: number | null;
  audits: number;
  /** 0–100 each, null when the question was never asked. */
  availabilityPct: number | null;
  planogramPct: number | null;
  pricePct: number | null;
  conditionPct: number | null;
  avgFacings: number | null;
  prospectsVisited: number;
  prospectsConverted: number;
};

export type RepDay = {
  day: string;
  planned: number;
  completed: number;
  visits: number;
  salesNet: number;
  salesOrders: number;
  /** A day inside the range that has not happened yet. Not a miss. */
  inFuture: boolean;
};

export type MissedVisit = {
  routeId: string;
  storeId: string;
  storeName: string;
  storeGroup: string | null;
  city: string | null;
  plannedDate: string;
  /** Null means the application recorded no reason — not that there was none. */
  reason: string | null;
  lastVisitAt: string | null;
  previousSales: number | null;
};

export type RepStore = {
  storeId: string;
  storeName: string;
  storeGroup: string | null;
  city: string | null;
  planned: number;
  completed: number;
  missed: number;
  visits: number;
  salesNet: number;
  salesOrders: number;
  /** The same span immediately before the period, for the decline rule. */
  priorSalesNet: number;
  oosChecked: number;
  oosVisits: number;
  merchChecks: number;
  merchOk: number;
  lastVisitAt: string | null;
};

export type RepReport = {
  summary: RepSummary;
  days: RepDay[];
  missed: MissedVisit[];
  stores: RepStore[];
};

function unwrap(res: { data: unknown; error: { message: string } | null }): Record<string, unknown>[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as Record<string, unknown>[];
}

function args(repId: string, range: DateRange, territoryId: string | null) {
  return {
    p_rep_id: repId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_territory_id: territoryId,
  };
}

/**
 * The whole report in four round trips, fired together.
 *
 * Together rather than in sequence because they share no inputs beyond the
 * three arguments, and a manager pressing Generate should wait for the slowest
 * rather than for the sum. One failure fails the report: a page showing three
 * of four sections with no explanation is worse than an error message.
 */
export async function fetchRepReport(
  supabase: SupabaseClient,
  repId: string,
  range: DateRange,
  territoryId: string | null
): Promise<RepReport> {
  const a = args(repId, range, territoryId);
  const [summaryRows, dayRows, missedRows, storeRows] = await Promise.all([
    callRpc(supabase, "rep_performance_summary", a).then(unwrap),
    callRpc(supabase, "rep_performance_daily", a).then(unwrap),
    callRpc(supabase, "rep_performance_missed", a).then(unwrap),
    callRpc(supabase, "rep_performance_stores", a).then(unwrap),
  ]);

  const s = summaryRows[0];
  if (!s) throw new Error("No performance data was returned for this rep.");

  return {
    summary: {
      repId: String(s.rep_id ?? repId),
      repName: (s.rep_name as string | null) ?? null,
      territories: (s.territories as string | null) ?? null,
      storesAssigned: int(s.stores_assigned),
      plannedVisits: int(s.planned_visits),
      completedPlanned: int(s.completed_planned),
      missedVisits: int(s.missed_visits),
      storesPlanned: int(s.stores_planned),
      storesVisited: int(s.stores_visited),
      completedVisits: int(s.completed_visits),
      unplannedVisits: int(s.unplanned_visits),
      salesNet: num(s.sales_net) ?? 0,
      salesOrders: int(s.sales_orders),
      storesWithSales: int(s.stores_with_sales),
      visitsWithOrder: int(s.visits_with_order),
      zeroSalesVisits: int(s.zero_sales_visits),
      daysWorked: int(s.days_worked),
      avgWorkdayStartSeconds: num(s.avg_workday_start_seconds),
      avgFirstCheckinSeconds: num(s.avg_first_checkin_seconds),
      avgLastCheckoutSeconds: num(s.avg_last_checkout_seconds),
      avgVisitSeconds: num(s.avg_visit_seconds),
      gpsChecked: int(s.gps_checked),
      gpsVerifiedRate: num(s.gps_verified_rate),
      formComplianceRate: num(s.form_compliance_rate),
      photoVisitRate: num(s.photo_visit_rate),
      audits: int(s.audits),
      availabilityPct: num(s.availability_pct),
      planogramPct: num(s.planogram_pct),
      pricePct: num(s.price_pct),
      conditionPct: num(s.condition_pct),
      avgFacings: num(s.avg_facings),
      prospectsVisited: int(s.prospects_visited),
      prospectsConverted: int(s.prospects_converted),
    },
    days: dayRows.map((d) => ({
      day: String(d.day),
      planned: int(d.planned),
      completed: int(d.completed),
      visits: int(d.visits),
      salesNet: num(d.sales_net) ?? 0,
      salesOrders: int(d.sales_orders),
      inFuture: Boolean(d.in_future),
    })),
    missed: missedRows.map((m) => ({
      routeId: String(m.route_id),
      storeId: String(m.store_id),
      storeName: String(m.store_name ?? ""),
      storeGroup: (m.store_group as string | null) ?? null,
      city: (m.city as string | null) ?? null,
      plannedDate: String(m.planned_date),
      reason: (m.reason as string | null) ?? null,
      lastVisitAt: (m.last_visit_at as string | null) ?? null,
      previousSales: num(m.previous_sales),
    })),
    stores: storeRows.map((r) => ({
      storeId: String(r.store_id),
      storeName: String(r.store_name ?? ""),
      storeGroup: (r.store_group as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      planned: int(r.planned),
      completed: int(r.completed),
      missed: int(r.missed),
      visits: int(r.visits),
      salesNet: num(r.sales_net) ?? 0,
      salesOrders: int(r.sales_orders),
      priorSalesNet: num(r.prior_sales_net) ?? 0,
      oosChecked: int(r.oos_checked),
      oosVisits: int(r.oos_visits),
      merchChecks: int(r.merch_checks),
      merchOk: int(r.merch_ok),
      lastVisitAt: (r.last_visit_at as string | null) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

export type ScoreKey =
  | "sales"
  | "visits"
  | "coverage"
  | "merchandising"
  | "compliance";

export type ScoreComponent = {
  key: ScoreKey;
  label: string;
  /** The published weight, as a percentage. Always shown, even when excluded. */
  weight: number;
  /** The weight after the excluded components' share is redistributed. */
  effectiveWeight: number;
  /** 0–100, or null when nothing in the database can measure it. */
  value: number | null;
  /** How the value was arrived at, in the manager's words. */
  basis: string;
};

export type RepScoreResult = {
  /** 0–100, or null when not one component could be measured. */
  score: number | null;
  band: "Excellent" | "Good" | "Needs Improvement" | "Poor" | "Not scored";
  components: ScoreComponent[];
  /** True when at least one component was dropped and the rest re-weighted. */
  reweighted: boolean;
};

/**
 * The published weights. They are the report's contract with the reader, so
 * they are shown whether or not the data can fill them.
 */
const WEIGHTS: { key: ScoreKey; label: string; weight: number }[] = [
  { key: "sales", label: "Sales performance", weight: 35 },
  { key: "visits", label: "Visit completion", weight: 25 },
  { key: "coverage", label: "Store coverage", weight: 15 },
  { key: "merchandising", label: "Merchandising execution", weight: 15 },
  { key: "compliance", label: "App / data compliance", weight: 10 },
];

/** Mean of the values that are not null, or null when none are. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/**
 * Merchandising compliance: the mean of the pillars that were measured.
 *
 * The same rule `perfect_store_score` uses, and for the same reason — a store
 * nobody price-checked has not failed price compliance, and neither has the rep
 * who visited it.
 */
export function merchandisingCompliance(s: RepSummary): number | null {
  return meanOf([s.availabilityPct, s.planogramPct, s.pricePct, s.conditionPct]);
}

/**
 * The overall score, and every number behind it.
 *
 * **Re-weighting is the whole design.** Sales performance is 35% of the score
 * and there is no target table in this database, so on today's schema it can
 * never be measured — scoring it as zero would mark every rep in the company
 * down by 35 points for something nobody has entered. A component with no
 * data is therefore dropped and its share spread across the rest in
 * proportion, which is what `rep_scorecard` and `perfect_store_score` already
 * do with their own pillars.
 *
 * The consequence to be honest about: a 100-point score built from four
 * components is not the same measurement as one built from five, and the page
 * says so next to the number.
 *
 * Store coverage is counted from the store rows rather than the summary
 * because "planned stores reached" is not "distinct stores visited" — a rep
 * who called on six shops nobody planned would otherwise score coverage above
 * 100%.
 */
export function computeScore(
  summary: RepSummary,
  stores: RepStore[]
): RepScoreResult {
  const plannedStores = stores.filter((s) => s.planned > 0);
  const coveredStores = plannedStores.filter((s) => s.completed > 0);

  const merch = merchandisingCompliance(summary);
  const compliance = meanOf([
    summary.formComplianceRate === null ? null : summary.formComplianceRate * 100,
    summary.gpsVerifiedRate === null ? null : summary.gpsVerifiedRate * 100,
  ]);

  const measured: Record<ScoreKey, { value: number | null; basis: string }> = {
    sales: {
      // No target table exists, so there is no denominator. Stated rather than
      // approximated: scoring sales against last period, or against the team,
      // would be a different measurement wearing this one's name.
      value: null,
      basis: "No sales target is recorded for this rep",
    },
    visits: {
      value: pct(summary.completedPlanned, summary.plannedVisits),
      basis: `${summary.completedPlanned} of ${summary.plannedVisits} planned visits completed`,
    },
    coverage: {
      value: pct(coveredStores.length, plannedStores.length),
      basis: `${coveredStores.length} of ${plannedStores.length} planned stores reached at least once`,
    },
    merchandising: {
      value: merch,
      basis:
        merch === null
          ? "No merchandising audit was completed in the period"
          : `Mean of the pillars measured across ${summary.audits} audits`,
    },
    compliance: {
      value: compliance,
      basis:
        compliance === null
          ? "No form submission or location fix to measure"
          : "Mean of form completion per visit and GPS-verified check-ins",
    },
  };

  const available = WEIGHTS.filter((w) => measured[w.key].value !== null);
  const availableWeight = available.reduce((a, w) => a + w.weight, 0);

  const components: ScoreComponent[] = WEIGHTS.map((w) => ({
    key: w.key,
    label: w.label,
    weight: w.weight,
    effectiveWeight:
      measured[w.key].value === null || availableWeight === 0
        ? 0
        : (w.weight / availableWeight) * 100,
    value: measured[w.key].value,
    basis: measured[w.key].basis,
  }));

  const score =
    availableWeight === 0
      ? null
      : components.reduce(
          (total, c) => total + (c.value ?? 0) * (c.effectiveWeight / 100),
          0
        );

  return {
    score: score === null ? null : Math.round(score),
    band: classifyScore(score === null ? null : Math.round(score)),
    components,
    reweighted: available.length > 0 && available.length < WEIGHTS.length,
  };
}

export function classifyScore(score: number | null): RepScoreResult["band"] {
  if (score === null) return "Not scored";
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Needs Improvement";
  return "Poor";
}

// ---------------------------------------------------------------------------
// Stores requiring attention
// ---------------------------------------------------------------------------

export type AttentionStore = {
  storeId: string;
  storeName: string;
  reason: string;
  /** Lower is more urgent. Only used to order the shortlist. */
  priority: number;
};

/** Below this a period's sales count as a significant fall. */
const DECLINE_THRESHOLD = 0.6;
/** Fewer checks than this and a low pass rate is noise, not a finding. */
const MIN_MERCH_CHECKS = 4;
/** Same, for stock: one out-of-stock audit is a day, not a pattern. */
const MIN_OOS_CHECKS = 2;

/**
 * Up to three stores a manager should do something about, and why.
 *
 * Every rule is a comparison between two figures that are already printed
 * somewhere on the report — there is no model here and no judgement, which is
 * the point: a manager has to be able to disagree with the shortlist by
 * checking the arithmetic. Thresholds are the named constants above rather
 * than numbers buried in the branches, because they are the part somebody
 * will want to argue about.
 *
 * **One store per rule first, then the runners-up.** Taking the three highest
 * priority matches outright filled all three rows from rule one — "missed a
 * visit at a shop with money behind it", three times, on the live data — and
 * buried a store that had been out of stock on seven audits out of seven. The
 * section exists to show a manager the *kinds* of problem in their territory,
 * so each rule gets a seat before any rule gets a second one. Priority still
 * decides the order, and still decides who fills the seats nobody claimed.
 */
export function storesNeedingAttention(
  stores: RepStore[],
  missed: MissedVisit[],
  limit = 3
): AttentionStore[] {
  /** The best previous-sales figure the missed list knows for each store. */
  const previousByStore = new Map<string, number>();
  for (const m of missed) {
    if (m.previousSales === null) continue;
    const seen = previousByStore.get(m.storeId);
    if (seen === undefined || m.previousSales > seen) {
      previousByStore.set(m.storeId, m.previousSales);
    }
  }

  /**
   * Candidates per rule, in the order they were offered.
   *
   * Rule one offers its stores by the money at stake; the rest walk `stores`,
   * which the RPC returns highest-selling first — so within a rule the store
   * that matters most to the business comes first, which is the tiebreak a
   * manager would make anyway.
   */
  const byRule = new Map<number, AttentionStore[]>();
  const claimed = new Set<string>();

  function add(store: RepStore, priority: number, reason: string) {
    // A store is listed once, under the most urgent rule that matched it.
    if (claimed.has(store.storeId)) return;
    claimed.add(store.storeId);
    const bucket = byRule.get(priority) ?? [];
    bucket.push({ storeId: store.storeId, storeName: store.storeName, reason, priority });
    byRule.set(priority, bucket);
  }

  // 1. Missed a visit at a shop with money behind it. Value is this period's
  //    sales where there are any, and otherwise the last order before the miss.
  const valued = stores
    .filter((s) => s.missed > 0)
    .map((s) => ({ store: s, value: Math.max(s.salesNet, previousByStore.get(s.storeId) ?? 0) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  for (const { store, value } of valued) {
    add(
      store,
      1,
      `Missed ${store.missed} planned visit${store.missed === 1 ? "" : "s"} — ${money(value)} in recent sales`
    );
  }

  // 2. Out of stock on most of the audits that looked.
  for (const s of stores) {
    if (s.oosChecked < MIN_OOS_CHECKS) continue;
    if (s.oosVisits * 2 < s.oosChecked) continue;
    add(s, 2, `Out of stock on ${s.oosVisits} of ${s.oosChecked} stock checks`);
  }

  // 3. Sales well down on the same span before this one.
  for (const s of stores) {
    if (s.priorSalesNet <= 0) continue;
    if (s.salesNet >= s.priorSalesNet * DECLINE_THRESHOLD) continue;
    const drop = Math.round((1 - s.salesNet / s.priorSalesNet) * 100);
    add(s, 3, `Sales down ${drop}% on the previous period (${money(s.priorSalesNet)} → ${money(s.salesNet)})`);
  }

  // 4. Visited, bought nothing, and used to buy.
  for (const s of stores) {
    if (s.visits === 0 || s.salesNet > 0) continue;
    if (s.priorSalesNet <= 0) continue;
    add(s, 4, `Visited ${s.visits} time${s.visits === 1 ? "" : "s"}, no sales — ${money(s.priorSalesNet)} the period before`);
  }

  // 5. Merchandising checks mostly failing.
  for (const s of stores) {
    if (s.merchChecks < MIN_MERCH_CHECKS) continue;
    const rate = s.merchOk / s.merchChecks;
    if (rate >= 0.6) continue;
    add(s, 5, `Merchandising checks passed ${s.merchOk} of ${s.merchChecks}`);
  }

  const rules = [...byRule.keys()].sort((a, b) => a - b);
  const chosen: AttentionStore[] = [];
  // One from each rule, most urgent rule first…
  for (const rule of rules) {
    const first = byRule.get(rule)?.[0];
    if (first && chosen.length < limit) chosen.push(first);
  }
  // …then the runners-up, still in priority order, for any seat left over.
  for (const rule of rules) {
    for (const candidate of (byRule.get(rule) ?? []).slice(1)) {
      if (chosen.length >= limit) return chosen;
      chosen.push(candidate);
    }
  }
  return chosen;
}

/** The three best-selling stores of the period. Stores with no sales are not "top". */
export function topStores(stores: RepStore[], limit = 3): RepStore[] {
  return stores
    .filter((s) => s.salesNet > 0)
    .sort((a, b) => b.salesNet - a.salesNet)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// The paragraph
// ---------------------------------------------------------------------------

/** A missed visit at a store worth more than this is called out by name. */
const HIGH_VALUE_MISS = 5000;

/**
 * Two or three sentences, assembled from the figures above it on the page.
 *
 * Written as clauses that are dropped when their figure is missing, rather
 * than as a template with blanks — a sentence reading "achieved % of target"
 * is worse than no sentence. Nothing here is generated: every number in the
 * output appears in a table or a card on one of the two pages.
 */
export function managementSummary(
  summary: RepSummary,
  score: RepScoreResult,
  missed: MissedVisit[]
): string {
  const s = summary;
  const sentences: string[] = [];

  const first: string[] = [];
  first.push(
    s.salesNet > 0
      ? `${s.repName ?? "The rep"} generated ${money(s.salesNet)} from ${s.salesOrders} delivered order${s.salesOrders === 1 ? "" : "s"}`
      : `${s.repName ?? "The rep"} recorded no delivered sales in this period`
  );
  if (s.plannedVisits > 0) {
    first.push(
      `completed ${s.completedPlanned} of ${s.plannedVisits} planned visits (${Math.round((s.completedPlanned / s.plannedVisits) * 100)}%)`
    );
  } else {
    first.push("had no visits planned in this period");
  }
  sentences.push(`${first.join(" and ")}.`);

  const second: string[] = [];
  const merch = merchandisingCompliance(s);
  if (merch !== null) {
    second.push(
      `Merchandising compliance was ${merch.toFixed(0)}% across ${s.audits} audit${s.audits === 1 ? "" : "s"}`
    );
  }
  if (s.missedVisits > 0) {
    const highValue = new Set(
      missed
        .filter((m) => (m.previousSales ?? 0) >= HIGH_VALUE_MISS)
        .map((m) => m.storeId)
    ).size;
    const clause =
      highValue > 0
        ? `${s.missedVisits} planned visit${s.missedVisits === 1 ? " was" : "s were"} missed, including ${highValue} store${highValue === 1 ? "" : "s"} with more than ${moneyShort(HIGH_VALUE_MISS)} in previous sales`
        : `${s.missedVisits} planned visit${s.missedVisits === 1 ? " was" : "s were"} missed`;
    second.push(second.length > 0 ? `but ${clause}` : capitalise(clause));
  }
  if (second.length > 0) sentences.push(`${second.join(", ")}.`);

  const third: string[] = [];
  // The absent target is the most consequential thing about this score, so it
  // is said in the summary rather than left in the breakdown table.
  if (score.reweighted) {
    const dropped = score.components.filter((c) => c.value === null).map((c) => c.label.toLowerCase());
    third.push(
      `The score of ${score.score} out of 100 excludes ${listOf(dropped)}, which this database cannot measure, and re-weights the rest`
    );
  }
  if (third.length > 0) sentences.push(`${third.join(". ")}.`);

  return sentences.join(" ");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Pula, as the business writes it: `P101,223.50`.
 *
 * `Intl.NumberFormat` with `currency: "BWP"` renders "BWP 101,223.50" in most
 * locales and "P101,223.50" in almost none, so the symbol is prepended to a
 * plain grouped number — which is what the Sales page does and what appears on
 * the company's own paperwork.
 */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `P${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The same figure with the thebe dropped, for a dense table cell. */
export function moneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `P${Math.round(n).toLocaleString("en-GB")}`;
}

/** `0.7937` → `79%`. Null is an em dash, never a false 0%. */
export function percent(rate: number | null | undefined, digits = 0): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

/** A value that is already 0–100. */
export function percentOf100(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/**
 * Seconds since local midnight as a clock time: `08:52`.
 *
 * 24-hour, because the report is printed and read alongside a schedule that is
 * written the same way, and because "8:52" and "8:52 pm" differ by one glyph
 * somebody will miss.
 */
export function clockTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 0) return "—";
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `1585` → `26m`; `4200` → `1h 10m`. */
export function durationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s <= 0) return "—";
  if (s < 60) return `${s}s`;
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** `2026-09-11` → `11 Sep`. Compact, for a table that must fit the page. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(+d)) return "—";
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

/** `11 Sep 2026`. For the header, where the year matters. */
export function longDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(+d)) return "—";
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}
