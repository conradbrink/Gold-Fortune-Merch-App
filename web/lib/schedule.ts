import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import { toLocalDateInput } from "@/lib/date-range";

/**
 * Call cycle (journey plan) — the recurring pattern the schedule is generated
 * from.
 *
 * Assigning a store to a rep says *who* is responsible; the call cycle says
 * *when*. Frequency lives on the **store** because it is intrinsic to the store
 * (a high-volume branch needs weekly attention no matter who covers it, and
 * reassigning it must not lose that). The day lives on the **assignment**,
 * because a weekday only means something inside one rep's week.
 *
 * The weekday maths below deliberately mirrors `generate_routes` statement for
 * statement. The planner previews what the generator will produce, so if the two
 * disagree the preview is a lie — see `occursOn`.
 */

export type VisitFrequency = "weekly" | "biweekly" | "monthly";

export const FREQUENCIES: { value: VisitFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

/** ISO weekdays: 1 = Monday … 7 = Sunday, matching `extract(isodow)`. */
export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
];

/**
 * How much a rep-day holds, and which days exist.
 *
 * Passed in rather than imported so this module stays free of any dependency
 * on org settings — and structural, so callers can supply a literal in tests.
 * Both values come from `organizations` (see `lib/org-settings.ts`): they were
 * constants, which fitted exactly one customer.
 *
 * There is deliberately no average-minutes figure here any more. The old
 * `AVG_VISIT_MINUTES = 49` was measured from seeded demo visits that have been
 * deleted, so it asserted a duration nothing in the database supported.
 */
export type DayCapacity = {
  storesPerDay: number;
  /** ISO weekdays the team works: 1 = Monday … 7 = Sunday. */
  workingDays: number[];
};

export type PlannedStore = {
  /** `store_assignments.id` — the row the day/week is written to. */
  assignment_id: string;
  store_id: string;
  store_name: string;
  city: string | null;
  state: string | null;
  active: boolean;
  is_primary: boolean;
  /** Null means unplanned: the generator will never schedule this store. */
  day_of_week: number | null;
  week_of_cycle: number | null;
  visit_frequency: VisitFrequency;
};

export type GenerateResult = {
  created: number;
  first_date: string | null;
  last_date: string | null;
  reps_covered: number;
};

/** One (rep, weekday) that carries stores. Figures are the busiest occurrence. */
export type CallCycleDay = {
  rep_id: string;
  rep_name: string | null;
  day_of_week: number;
  peak_stores: number;
  avg_stores: number;
  occurrences: number;
  cities: string[];
  stores_without_city: number;
  /** Widest straight-line gap between two stops. Null when any stop has no coordinates. */
  span_km: number | null;
  frequency_mix: Partial<Record<VisitFrequency, number>>;
};

/** What the plan is missing — the things a per-day view cannot show. */
export type CallCycleGaps = {
  stores_active: number;
  stores_unassigned: number;
  unassigned_store_names: string[];
  stores_without_city: number;
  stores_without_coords: number;
  unplanned_assignments: number;
  unplanned_by_rep: Record<string, number>;
  reps_active: number;
  reps_without_stores: number;
  reps_without_stores_names: string[];
};

/* ------------------------------------------------------------------ *
 * Weekday arithmetic
 *
 * There is no date library in this tree and `lib/date-range.ts` has no weekday
 * helpers, so these are hand-rolled. All of them work in *local* time — a
 * `getUTCDay()` here would drift the whole plan by a day for half of each day
 * in CAT, exactly the class of bug `toLocalDateInput` exists to prevent.
 * ------------------------------------------------------------------ */

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 1 = Monday … 7 = Sunday. `getDay()` is 0 = Sunday, hence the fold. */
export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/**
 * ISO-8601 week number, matching Postgres's `extract(week from …)`.
 *
 * Only the *parity* is used (week A / week B), but it still has to agree with
 * Postgres or bi-weekly stores would alternate on the opposite weeks in the
 * preview to the ones the generator actually writes.
 */
export function isoWeekNumber(d: Date): number {
  // Thursday of the same ISO week decides which year and week the week belongs
  // to — that is the whole trick of ISO-8601 week numbering.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Which occurrence of its weekday this date is: the 2nd Tuesday returns 2. */
export function nthWeekdayOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/**
 * Does a store on this cycle fall on this date?
 *
 * Mirrors the `case c.visit_frequency` block in `generate_routes`. The caller
 * has already matched the weekday.
 */
export function occursOn(
  date: Date,
  frequency: VisitFrequency,
  weekOfCycle: number | null
): boolean {
  const week = weekOfCycle ?? 1;
  switch (frequency) {
    case "weekly":
      return true;
    case "biweekly":
      // Week A / week B by ISO week parity: cycle 1 = odd weeks.
      return isoWeekNumber(date) % 2 === week % 2;
    case "monthly":
      return nthWeekdayOfMonth(date) === week;
    default:
      return false;
  }
}

const ORDINALS = ["", "1st", "2nd", "3rd", "4th"];

/** Plain-English cycle, e.g. "2nd Tuesday of the month". */
export function describeCycle(store: PlannedStore): string {
  if (store.day_of_week === null) return "Not planned";
  const day = WEEKDAYS.find((w) => w.value === store.day_of_week)?.long ?? "—";
  const week = store.week_of_cycle ?? 1;
  switch (store.visit_frequency) {
    case "weekly":
      return `Every ${day}`;
    case "biweekly":
      return `Every other ${day} (week ${week === 1 ? "A" : "B"})`;
    case "monthly":
      return `${ORDINALS[week] ?? `${week}th`} ${day} of the month`;
  }
}

/* ------------------------------------------------------------------ *
 * Week load
 * ------------------------------------------------------------------ */

export type DayLoad = {
  weekday: number;
  /** Stores set to this weekday, on any frequency. */
  assigned: number;
  /** Most stores landing on a single occurrence of this weekday. */
  peakStores: number;
  /** Mean stores per occurrence, to one decimal. */
  avgStores: number;
  /** Most distinct cities on a single occurrence — the number that matters. */
  peakCities: number;
  /** Every city this weekday touches, for the tooltip/label. */
  cities: string[];
};

/**
 * Simulates the next `weeks` weeks and reports per-weekday load.
 *
 * A plain count of stores per weekday would overstate every day that carries
 * bi-weekly or monthly stores — those never all land in the same week. So the
 * horizon is walked date by date, exactly as the generator does, and the
 * reported figure is the **worst single day** the rep will actually face.
 *
 * The city count is likewise taken per occurrence, not per weekday: three
 * cities spread over three different Tuesdays is a normal patch, three cities
 * on one Tuesday is the mistake this view exists to prevent.
 */
export function computeWeekLoad(
  stores: PlannedStore[],
  weeks = 8,
  from = new Date()
): DayLoad[] {
  // The generator starts tomorrow, so the preview must too.
  const start = addDays(from, 1);
  const days = weeks * 7;

  const byWeekday = new Map<number, { counts: number[]; cityCounts: number[]; cities: Set<string> }>();
  for (const w of WEEKDAYS) {
    byWeekday.set(w.value, { counts: [], cityCounts: [], cities: new Set() });
  }

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const dow = isoWeekday(date);
    const landing = stores.filter(
      (s) =>
        s.active &&
        s.day_of_week === dow &&
        occursOn(date, s.visit_frequency, s.week_of_cycle)
    );
    const bucket = byWeekday.get(dow)!;
    bucket.counts.push(landing.length);
    const cities = new Set(landing.map((s) => s.city ?? "Unknown"));
    bucket.cityCounts.push(cities.size);
    for (const c of cities) bucket.cities.add(c);
  }

  return WEEKDAYS.map((w) => {
    const b = byWeekday.get(w.value)!;
    const total = b.counts.reduce((a, c) => a + c, 0);
    return {
      weekday: w.value,
      assigned: stores.filter((s) => s.active && s.day_of_week === w.value).length,
      peakStores: b.counts.length ? Math.max(...b.counts) : 0,
      avgStores: b.counts.length
        ? Math.round((total / b.counts.length) * 10) / 10
        : 0,
      peakCities: b.cityCounts.length ? Math.max(...b.cityCounts) : 0,
      cities: [...b.cities].sort(),
    };
  });
}

/**
 * How many routes the generator would create for this rep over the horizon.
 *
 * Purely local, and deliberately *not* the number shown before writing — the
 * RPC's own dry run is the authority there, because it also subtracts dates
 * that already have a route. This is the at-a-glance figure on the planner.
 */
export function countPlannedVisits(
  stores: PlannedStore[],
  weeks = 8,
  from = new Date()
): number {
  const start = addDays(from, 1);
  let n = 0;
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const dow = isoWeekday(date);
    for (const s of stores) {
      if (!s.active || s.day_of_week !== dow) continue;
      if (occursOn(date, s.visit_frequency, s.week_of_cycle)) n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * Auto-spread
 * ------------------------------------------------------------------ */

/** Visits one store generates per four-week cycle. */
export function cycleVisits(frequency: VisitFrequency): number {
  return frequency === "weekly" ? 4 : frequency === "biweekly" ? 2 : 1;
}

/** Which weeks of a four-week cycle a store lands on, given its slot. */
function weeksFor(frequency: VisitFrequency, slot: number): number[] {
  if (frequency === "weekly") return [1, 2, 3, 4];
  // Bi-weekly alternates: cycle 1 = weeks 1 and 3, cycle 2 = weeks 2 and 4.
  if (frequency === "biweekly") return slot === 1 ? [1, 3] : [2, 4];
  return [slot];
}

export type SpreadAssignment = {
  assignmentId: string;
  storeId: string;
  storeName: string;
  city: string | null;
  dayOfWeek: number;
  weekOfCycle: number | null;
};

export type SpreadResult = {
  assignments: SpreadAssignment[];
  /** Stores that could not be placed without exceeding capacity. */
  overflow: PlannedStore[];
  /** Towns that had to be split across more than one day. */
  splitTowns: string[];
  /**
   * Days carrying more than one town — the thing the planner exists to avoid.
   * Only happens when there are more towns than working days.
   */
  sharedDays: { day: number; towns: string[] }[];
  /** Peak stores on a single occurrence, per working day. */
  peakByDay: Record<number, number>;
  visitsPerCycle: number;
};

/**
 * Proposes a day and week for every one of a rep's stores.
 *
 * Deterministic and pure: no AI, no network, same input to same output. That
 * matters because the manager reviews this before it is written — a proposal
 * they cannot predict or re-derive is one they cannot trust.
 *
 * The model is `workingDays × 4 weeks` buckets, each holding `storesPerDay`. A
 * store occupies one **day** and, depending on frequency, some or all of that
 * day's four weeks — so a weekly store costs four times what a monthly one
 * does, and `week_of_cycle` is chosen to level the load rather than defaulting
 * to 1 and piling every monthly store into week one.
 *
 * Town is the only geography available — the estate has no coordinates — and
 * the goal is that no day carries two towns.
 *
 * Days are **reserved per town up front**, largest town first, according to how
 * many that town's load actually needs. Two earlier attempts got this wrong in
 * opposite directions, and both are worth remembering:
 *
 * - Penalising any day a town had not already used packed each town tight, so
 *   75 Gaborone stores filled Monday to Wednesday and left Thursday and Friday
 *   empty.
 * - Penalising only days another town held spread Gaborone across all five
 *   days, which left Francistown nowhere clean to go — it ended up sharing two
 *   of them, which is the very thing this is meant to avoid.
 *
 * Reserving `ceil(load / (storesPerDay × 4))` days per town gets both: Gaborone
 * takes the three days it needs, Francistown takes a fourth, and the fifth
 * stays free. Days are only shared when the towns genuinely outnumber them.
 */
export function autoSpreadDays(
  stores: PlannedStore[],
  capacity: DayCapacity
): SpreadResult {
  const days = capacity.workingDays.length > 0 ? [...capacity.workingDays].sort((a, b) => a - b) : [1];
  const cap = Math.max(1, capacity.storesPerDay);

  // occupancy[day][week] — how many stores already land on that occurrence.
  const occupancy: Record<number, number[]> = {};
  for (const d of days) occupancy[d] = [0, 0, 0, 0];

  const byTown: Record<string, PlannedStore[]> = {};
  for (const s of stores) {
    if (!s.active) continue;
    (byTown[s.city ?? "￿No town"] ??= []).push(s);
  }

  // Largest towns first: they are the hardest to place, and leaving them until
  // the end is what forces a big town to be split across days unnecessarily.
  const towns = Object.entries(byTown).sort((a, b) => b[1].length - a[1].length);

  const assignments: SpreadAssignment[] = [];
  const overflow: PlannedStore[] = [];
  const splitTowns: string[] = [];
  const dayTowns: Record<number, Set<string>> = {};
  for (const d of days) dayTowns[d] = new Set();

  /**
   * Reserve days per town before placing anything.
   *
   * A day holds `storesPerDay` on each of the cycle's four weeks, so one day
   * absorbs `storesPerDay × 4` visits per cycle. A town needing more than that
   * gets more days; one needing less gets exactly one, leaving the rest free
   * for other towns.
   */
  const perDayCycleCapacity = cap * 4;
  const reserved: Record<string, number[]> = {};
  const unclaimed = [...days];

  for (const [town, townStores] of towns) {
    const load = townStores.reduce((n, s) => n + cycleVisits(s.visit_frequency), 0);
    const need = Math.max(1, Math.ceil(load / perDayCycleCapacity));
    // Once the week is fully claimed, later towns have to share. That is a
    // genuine constraint — more towns than working days — and is reported.
    reserved[town] =
      unclaimed.length > 0 ? unclaimed.splice(0, Math.min(need, unclaimed.length)) : [...days];
  }

  for (const [town, townStores] of towns) {
    // Heaviest stores first within a town, so a weekly store gets the roomiest
    // day rather than being wedged into whatever is left.
    const ordered = [...townStores].sort(
      (a, b) =>
        cycleVisits(b.visit_frequency) - cycleVisits(a.visit_frequency) ||
        a.store_name.localeCompare(b.store_name)
    );

    const daysUsed = new Set<number>();

    for (const store of ordered) {
      const freq = store.visit_frequency;
      const slots = freq === "weekly" ? [1] : freq === "biweekly" ? [1, 2] : [1, 2, 3, 4];

      let best: { day: number; slot: number; score: number } | null = null;

      // This town's own days first; only if they are genuinely full does it
      // spill onto anyone else's, and then the least crowded one.
      const ownDays = reserved[town] ?? days;
      const candidates = [...ownDays, ...days.filter((d) => !ownDays.includes(d))];

      for (const day of candidates) {
        for (const slot of slots) {
          const weeks = weeksFor(freq, slot);
          if (weeks.some((w) => occupancy[day][w - 1] >= cap)) continue;

          // Within the town's own days, take the emptiest so the town spreads
          // evenly rather than filling one day at a time. The penalty for
          // someone else's day exceeds any achievable occupancy, so load never
          // outvotes keeping towns apart.
          const peak = Math.max(...weeks.map((w) => occupancy[day][w - 1]));
          const foreign = !ownDays.includes(day);
          const score = peak + (foreign ? 1000 : 0);

          if (best === null || score < best.score) {
            best = { day, slot, score };
          }
        }
      }

      if (!best) {
        overflow.push(store);
        continue;
      }

      for (const w of weeksFor(freq, best.slot)) occupancy[best.day][w - 1] += 1;
      if (daysUsed.size > 0 && !daysUsed.has(best.day) && !splitTowns.includes(town)) {
        splitTowns.push(town);
      }
      daysUsed.add(best.day);
      dayTowns[best.day].add(town);

      assignments.push({
        assignmentId: store.assignment_id,
        storeId: store.store_id,
        storeName: store.store_name,
        city: store.city,
        dayOfWeek: best.day,
        // Weekly ignores the week entirely; storing one would be noise.
        weekOfCycle: freq === "weekly" ? null : best.slot,
      });
    }
  }

  const peakByDay: Record<number, number> = {};
  for (const d of days) peakByDay[d] = Math.max(...occupancy[d]);

  return {
    assignments,
    overflow,
    splitTowns,
    sharedDays: days
      .filter((d) => dayTowns[d].size > 1)
      .map((d) => ({ day: d, towns: [...dayTowns[d]].sort() })),
    peakByDay,
    visitsPerCycle: stores
      .filter((s) => s.active)
      .reduce((n, s) => n + cycleVisits(s.visit_frequency), 0),
  };
}

/**
 * Writes one row of a proposal and reports whether it actually landed.
 *
 * `.select("id")` is what makes that possible: a PostgREST update that matches
 * nothing succeeds silently and returns no error, so without this an
 * assignment can be dropped with nothing to show for it.
 */
async function writeDay(
  supabase: SupabaseClient,
  a: SpreadAssignment
): Promise<boolean> {
  const { data, error } = await supabase
    .from("store_assignments")
    .update({ day_of_week: a.dayOfWeek, week_of_cycle: a.weekOfCycle })
    .eq("id", a.assignmentId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * Writes a proposal, and proves every row landed.
 *
 * Found the hard way: at 25 requests in flight a write was silently lost, and
 * the planner reported "1 store with no day" with no error and no explanation.
 * Modest concurrency plus a verified retry turns that into either a complete
 * write or a clear failure — never a plan that is quietly one store short.
 */
export async function applySpread(
  supabase: SupabaseClient,
  assignments: SpreadAssignment[]
): Promise<void> {
  const BATCH = 8;
  const missed: SpreadAssignment[] = [];

  for (let i = 0; i < assignments.length; i += BATCH) {
    const results = await Promise.all(
      assignments.slice(i, i + BATCH).map(async (a) => ({
        a,
        ok: await writeDay(supabase, a),
      }))
    );
    for (const r of results) if (!r.ok) missed.push(r.a);
  }

  // One retry, serially. A row that still will not take is a real problem —
  // most likely the assignment was deleted while the proposal was on screen —
  // and the manager needs to know rather than discover it later.
  const stillMissing: string[] = [];
  for (const a of missed) {
    if (!(await writeDay(supabase, a))) stillMissing.push(a.storeName);
  }

  if (stillMissing.length > 0) {
    throw new Error(
      `${stillMissing.length} store${stillMissing.length === 1 ? "" : "s"} could not be updated (${stillMissing
        .slice(0, 3)
        .join(", ")}${stillMissing.length > 3 ? "…" : ""}). They may have been unassigned since the plan was proposed — reload and try again.`
    );
  }
}

/* ------------------------------------------------------------------ *
 * One day's work
 * ------------------------------------------------------------------ */

/**
 * A single stop on a rep's day.
 *
 * There is deliberately no planned time here. Reps are given a list and choose
 * their own order, so the only times that exist are the ones a check-in
 * actually produced — anything else would be inventing a schedule the product
 * does not have.
 */
export type DayStop = {
  /** Route id, or the visit id for an ad-hoc stop that had no route. */
  id: string;
  storeId: string;
  storeName: string;
  city: string | null;
  sequence: number | null;
  /** Raw state. "Missed" is derived at render time from the date, not stored. */
  status: "done" | "in_progress" | "not_started";
  checkinAt: string | null;
  checkoutAt: string | null;
  durationSeconds: number | null;
  /** A visit with no route — the rep called on a store that was not planned. */
  adHoc: boolean;
};

export type DayRep = {
  repId: string;
  repName: string;
  stops: DayStop[];
};

function endOfDay(d: Date): Date {
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), 1);
}

/**
 * Everything happening on one date, grouped by rep.
 *
 * Ad-hoc visits are unioned in so the board shows what actually happened, not
 * just what was planned — a rep who called on three unplanned stores has had a
 * working day, and a view that showed an empty column would be lying.
 */
export async function fetchDayBoard(
  supabase: SupabaseClient,
  date: Date
): Promise<DayRep[]> {
  const dateStr = toLocalDateInput(date);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const [{ data: repRows, error: repError }, routeRes, adHocRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "rep")
      .eq("is_active", true)
      .order("full_name"),
    // Single string literal — a concatenated .select() degrades to
    // GenericStringError in postgrest-js.
    supabase
      .from("routes")
      .select(
        "id, rep_id, store_id, sequence_order, stores(name, city), visits(id, status, checkin_at, checkout_at, duration_seconds)"
      )
      .eq("scheduled_date", dateStr),
    supabase
      .from("visits")
      .select("id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds, stores(name, city)")
      .is("route_id", null)
      .gte("checkin_at", dayStart.toISOString())
      .lt("checkin_at", endOfDay(date).toISOString()),
  ]);

  if (repError) throw new Error(repError.message);
  if (routeRes.error) throw new Error(routeRes.error.message);
  if (adHocRes.error) throw new Error(adHocRes.error.message);

  type Embedded = { name: string; city: string | null } | { name: string; city: string | null }[] | null;
  // postgrest returns an embedded relation as an object or array depending on
  // the cardinality it infers; normalise rather than guess.
  const one = (e: Embedded) => (Array.isArray(e) ? e[0] ?? null : e);

  const byRep: Record<string, DayStop[]> = {};

  for (const r of (routeRes.data ?? []) as unknown as {
    id: string;
    rep_id: string;
    store_id: string;
    sequence_order: number | null;
    stores: Embedded;
    visits: { status: string; checkin_at: string | null; checkout_at: string | null; duration_seconds: number | null }[] | null;
  }[]) {
    const store = one(r.stores);
    const visit = r.visits?.[0];
    (byRep[r.rep_id] ??= []).push({
      id: r.id,
      storeId: r.store_id,
      storeName: store?.name ?? "Unknown store",
      city: store?.city ?? null,
      sequence: r.sequence_order,
      status: visit?.checkout_at
        ? "done"
        : visit?.checkin_at
          ? "in_progress"
          : "not_started",
      checkinAt: visit?.checkin_at ?? null,
      checkoutAt: visit?.checkout_at ?? null,
      durationSeconds: visit?.duration_seconds ?? null,
      adHoc: false,
    });
  }

  for (const v of (adHocRes.data ?? []) as unknown as {
    id: string;
    rep_id: string;
    store_id: string;
    status: string;
    checkin_at: string | null;
    checkout_at: string | null;
    duration_seconds: number | null;
    stores: Embedded;
  }[]) {
    const store = one(v.stores);
    (byRep[v.rep_id] ??= []).push({
      id: v.id,
      storeId: v.store_id,
      storeName: store?.name ?? "Unknown store",
      city: store?.city ?? null,
      sequence: null,
      status: v.checkout_at ? "done" : "in_progress",
      checkinAt: v.checkin_at,
      checkoutAt: v.checkout_at,
      durationSeconds: v.duration_seconds,
      adHoc: true,
    });
  }

  return ((repRows ?? []) as { id: string; full_name: string | null }[])
    .map((r) => ({
      repId: r.id,
      repName: r.full_name ?? "Unnamed rep",
      stops: (byRep[r.id] ?? []).sort((a, b) => {
        // Planned stops first, in sequence; ad-hoc appended in check-in order.
        if (a.adHoc !== b.adHoc) return a.adHoc ? 1 : -1;
        if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) {
          return a.sequence - b.sequence;
        }
        return a.storeName.localeCompare(b.storeName);
      }),
    }));
}

/**
 * Adds one stop to a rep's day.
 *
 * Writes a `routes` row and nothing else. The dialog this replaces also
 * inserted a companion `visits` row, which is exactly what produced the
 * fan-out bug fixed in migration 20260727194019 — a visit belongs to a
 * check-in, not to a plan.
 */
export async function addStop(
  supabase: SupabaseClient,
  orgId: string,
  repId: string,
  storeId: string,
  date: Date,
  sequence: number
): Promise<void> {
  const { error } = await supabase.from("routes").insert({
    org_id: orgId,
    rep_id: repId,
    store_id: storeId,
    scheduled_date: toLocalDateInput(date),
    sequence_order: sequence,
  });
  // unique (rep_id, store_id, scheduled_date) — adding the same stop twice is
  // a no-op, not an error worth showing.
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function removeStop(
  supabase: SupabaseClient,
  routeId: string
): Promise<void> {
  const { error } = await supabase.from("routes").delete().eq("id", routeId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

/**
 * One rep's assigned stores, with the cycle fields the planner edits.
 *
 * The `.select()` is a single string literal — a concatenated one degrades to
 * `GenericStringError` in postgrest-js.
 */
export async function fetchPlannedStores(
  supabase: SupabaseClient,
  repId: string
): Promise<PlannedStore[]> {
  const { data, error } = await supabase
    .from("store_assignments")
    .select(
      "id, store_id, is_primary, day_of_week, week_of_cycle, stores(name, city, state, active, visit_frequency)"
    )
    .eq("rep_id", repId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as {
    id: string;
    store_id: string;
    is_primary: boolean;
    day_of_week: number | null;
    week_of_cycle: number | null;
    stores:
      | {
          name: string;
          city: string | null;
          state: string | null;
          active: boolean;
          visit_frequency: VisitFrequency;
        }
      | {
          name: string;
          city: string | null;
          state: string | null;
          active: boolean;
          visit_frequency: VisitFrequency;
        }[]
      | null;
  }[];

  return rows
    .map((r) => {
      // postgrest returns an embedded relation as an object or an array
      // depending on the cardinality it infers; normalise rather than guess.
      const store = Array.isArray(r.stores) ? r.stores[0] ?? null : r.stores;
      return {
        assignment_id: r.id,
        store_id: r.store_id,
        store_name: store?.name ?? "Unknown store",
        city: store?.city ?? null,
        state: store?.state ?? null,
        active: store?.active ?? false,
        is_primary: r.is_primary,
        day_of_week: r.day_of_week,
        week_of_cycle: r.week_of_cycle,
        visit_frequency: (store?.visit_frequency ?? "weekly") as VisitFrequency,
      };
    })
    .sort(
      (a, b) =>
        (a.city ?? "￿").localeCompare(b.city ?? "￿") ||
        a.store_name.localeCompare(b.store_name)
    );
}

/** Sets (or clears) which day of the rep's week covers this store. */
export async function setAssignmentDay(
  supabase: SupabaseClient,
  assignmentId: string,
  dayOfWeek: number | null,
  weekOfCycle: number | null
): Promise<void> {
  const { error } = await supabase
    .from("store_assignments")
    .update({ day_of_week: dayOfWeek, week_of_cycle: weekOfCycle })
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
}

/**
 * Changes a store's visit frequency.
 *
 * This is a property of the *store*, so it changes the cycle for every rep who
 * covers it — the planner says so next to the control rather than letting a
 * manager discover it from someone else's week.
 */
export async function setStoreFrequency(
  supabase: SupabaseClient,
  storeId: string,
  frequency: VisitFrequency
): Promise<void> {
  const { error } = await supabase
    .from("stores")
    .update({ visit_frequency: frequency })
    .eq("id", storeId);
  if (error) throw new Error(error.message);
}

/**
 * The org-wide call cycle, as the AI critic and the generator both see it.
 *
 * Takes the client as its first argument so the insights Route Handler can
 * reuse it unchanged with a cookie-scoped server client — the plan the manager
 * reads and the plan the model reads come from one code path, the same
 * arrangement `lib/reports.ts` uses.
 */
export async function fetchCallCycleReview(
  supabase: SupabaseClient,
  weeks = 8
): Promise<CallCycleDay[]> {
  const res = await callRpc(supabase, "call_cycle_review", { p_weeks: weeks });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as CallCycleDay[];
}

export async function fetchCallCycleGaps(
  supabase: SupabaseClient
): Promise<CallCycleGaps | null> {
  const res = await callRpc(supabase, "call_cycle_gaps", {});
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as CallCycleGaps[];
  return rows[0] ?? null;
}

/**
 * Materialises `routes` from the call cycle for the whole organisation.
 *
 * `p_dry_run` reports what *would* be written without writing it, which is what
 * the confirm step shows. The real run is idempotent — `on conflict do nothing`
 * against `routes_rep_store_date_key` — so a second click creates nothing
 * rather than duplicating every stop.
 */
export async function generateRoutes(
  supabase: SupabaseClient,
  weeks: number,
  dryRun: boolean
): Promise<GenerateResult> {
  const res = await callRpc(supabase, "generate_routes", {
    p_weeks: weeks,
    p_dry_run: dryRun,
  });
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as GenerateResult[];
  return rows[0] ?? { created: 0, first_date: null, last_date: null, reps_covered: 0 };
}
