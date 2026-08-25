import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import { toLocalDateInput } from "@/lib/date-range";
import { clusterByProximity, shortestPathKm, toPoint } from "@/lib/geo";

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
  /** Null when the store has never been geocoded — 24 of them have not been. */
  lat: number | null;
  lng: number | null;
};

export type GenerateResult = {
  created: number;
  /** Future cycle-built routes the plan no longer calls for. */
  removed: number;
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
 * Cycle calendar
 *
 * `computeWeekLoad` answers "how heavy is a Tuesday", which is the right question
 * when you are deciding a store's frequency. It cannot answer "what does Tuesday
 * of week three look like", because it collapses every occurrence of a weekday
 * into one figure. With three frequencies and a week-of-cycle field, working that
 * out by hand means simulating the calendar in your head — so this expands it
 * instead, into the actual dates the generator will write.
 * ------------------------------------------------------------------ */

/** One dated day in the grid — a real date, not a weekday. */
export type CycleDay = {
  date: Date;
  weekday: number;
  /**
   * Inside the window `generate_routes` will write. Days before it are shown so
   * the first row is a whole week rather than a ragged stub, but nothing will be
   * scheduled on them — the generator never looks at a date before tomorrow.
   */
  inHorizon: boolean;
  stores: PlannedStore[];
  /** Distinct towns landing on this date, sorted. */
  towns: string[];
  /** Shortest straight-line path through the stops. Null when a stop has no coordinates. */
  driveKm: number | null;
};

export type CycleWeek = {
  /** Monday of this row. */
  weekStart: Date;
  /**
   * ISO week number. Carried because bi-weekly stores alternate on its *parity* —
   * a manager looking at two adjacent rows needs to know which is week A.
   */
  isoWeek: number;
  /** One per column, in `columns` order. */
  days: CycleDay[];
};

export type CycleCalendar = {
  /** ISO weekdays forming the columns, ascending. */
  columns: number[];
  weeks: CycleWeek[];
  /**
   * Columns present only because stores are planned on them — days the org does
   * not work. Rendering the working days alone would make those stores vanish
   * from the one view that exists to show where every store landed.
   */
  offDayColumns: number[];
};

/** Local date-only comparison. A timestamp comparison would flip at midnight UTC. */
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Expands the call cycle into the dated days it produces.
 *
 * The horizon deliberately matches `generate_routes` — starts tomorrow, runs
 * `weeks * 7` days — because this view's whole claim is that it shows what will
 * actually be written. Rows are real calendar weeks starting on Monday, so the
 * first row usually begins before the horizon does; those cells are marked rather
 * than dropped.
 */
export function buildCycleCalendar(
  stores: PlannedStore[],
  weeks: number,
  workingDays: number[],
  from = new Date()
): CycleCalendar {
  const start = dayStart(addDays(from, 1));
  const end = dayStart(addDays(from, weeks * 7));

  const planned = stores.filter((s) => s.active && s.day_of_week !== null);

  // A store planned on a day the org does not work still has to be visible: the
  // generator will schedule it regardless, and a grid that hid it would be the
  // second blind spot this view exists to remove.
  const plannedDays = new Set(planned.map((s) => s.day_of_week as number));
  const offDayColumns = [...plannedDays]
    .filter((d) => !workingDays.includes(d))
    .sort((a, b) => a - b);
  const columns = [...new Set([...workingDays, ...offDayColumns])].sort(
    (a, b) => a - b
  );

  // Back up to the Monday of the week the horizon opens in.
  const firstMonday = addDays(start, -(isoWeekday(start) - 1));

  const weekRows: CycleWeek[] = [];
  for (
    let monday = firstMonday;
    monday.getTime() <= end.getTime();
    monday = addDays(monday, 7)
  ) {
    const days: CycleDay[] = columns.map((weekday) => {
      const date = addDays(monday, weekday - 1);
      const landing = planned.filter(
        (s) =>
          s.day_of_week === weekday &&
          occursOn(date, s.visit_frequency, s.week_of_cycle)
      );
      return {
        date,
        weekday,
        inHorizon: date.getTime() >= start.getTime() && date.getTime() <= end.getTime(),
        stores: landing,
        towns: [...new Set(landing.map((s) => s.city ?? "No town"))].sort(),
        driveKm:
          landing.length === 0
            ? null
            : shortestPathKm(landing.map((s) => toPoint(s.lat, s.lng))),
      };
    });

    weekRows.push({ weekStart: monday, isoWeek: isoWeekNumber(monday), days });
  }

  return { columns, weeks: weekRows, offDayColumns };
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
   * Days that came out below `storesPerDay`.
   *
   * A half-empty day is not a lighter day — the rep drives out and back either
   * way — so falling short is a finding, not a success. Reported rather than
   * prevented: sometimes the estate genuinely does not fill the week.
   */
  underTarget: { day: number; stores: number }[];
  /** Weekdays the plan actually occupies, against the number the team works. */
  daysUsed: number;
  /** Weekdays the grouping wanted. Above `daysAvailable` means work overflowed. */
  daysWanted: number;
  daysAvailable: number;
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
 * Proposes a day and a cycle week for every one of a rep's stores.
 *
 * Deterministic and pure: no AI, no network, same input to same output. That
 * matters because a manager reviews this before it is written — a proposal they
 * cannot predict or re-derive is one they cannot trust.
 *
 * ## The rules, and why each one is here
 *
 * **Days are filled to `storesPerDay`, not capped at it.** This used to treat
 * that number as a ceiling and happily produce a Tuesday with two stops. A
 * half-empty day is not a lighter day — the rep still drives out and back — so
 * `storesPerDay` is now the *target* and a day that lands short is reported.
 *
 * **Grouping is by position, not by town name.** Towns were the old proxy and a
 * bad one: Gaborone and Mogoditshane are five kilometres apart and were treated
 * as a reason to split a day. `clusterByProximity` seeds each group from the
 * furthest outlying stop, which is what makes a far cluster — Mochudi, Pilane,
 * Morwa and Oodi, say — come out as one trip instead of being smeared across
 * several days.
 *
 * **Weekly and less-often stores are planned separately.** A weekly store
 * occupies its weekday every week, so its day is spent. Anything less frequent
 * only lands every other week, so two such groups **share one weekday** as week
 * A and week B — which is how a day carrying nine stores every fortnight still
 * reads as a full day rather than a half-empty one. This is the change that
 * makes the minimum reachable at all.
 *
 * Stores with no coordinates cannot be clustered. They ride with the group that
 * already holds most of their town, and are counted separately when no such
 * group exists, rather than being dropped or guessed at.
 */
export function autoSpreadDays(
  stores: PlannedStore[],
  capacity: DayCapacity
): SpreadResult {
  const days =
    capacity.workingDays.length > 0
      ? [...capacity.workingDays].sort((a, b) => a - b)
      : [1];
  const target = Math.max(1, capacity.storesPerDay);

  const active = stores.filter((s) => s.active);
  const placed = active.filter((s) => s.lat !== null && s.lng !== null);
  const unplaceable = active.filter((s) => s.lat === null || s.lng === null);

  const weekly = placed.filter((s) => s.visit_frequency === "weekly");
  const periodic = placed.filter((s) => s.visit_frequency !== "weekly");

  // `target` is a floor, so divide *down*: 26 stores at 8 a day is three days of
  // nine, not four days one of which holds two. Rounding up is what produced a
  // Thursday with 2 stops on it.
  const groupsFor = (n: number) => Math.max(1, Math.floor(n / target));

  const weeklyGroups = weekly.length
    ? clusterByProximity(weekly, (s) => ({ lat: s.lat!, lng: s.lng! }), groupsFor(weekly.length))
    : [];
  const periodicGroups = periodic.length
    ? clusterByProximity(periodic, (s) => ({ lat: s.lat!, lng: s.lng! }), groupsFor(periodic.length))
    : [];

  // A weekly group needs a weekday to itself. Two periodic groups share one.
  const daysForWeekly = weeklyGroups.length;
  const daysForPeriodic = Math.ceil(periodicGroups.length / 2);

  const assignments: SpreadAssignment[] = [];
  const overflow: PlannedStore[] = [];
  const dayTowns: Record<number, Set<string>> = {};
  const occupancy: Record<number, number[]> = {};
  for (const d of days) {
    dayTowns[d] = new Set();
    occupancy[d] = [0, 0, 0, 0];
  }

  const place = (
    store: PlannedStore,
    day: number,
    slot: number | null
  ) => {
    assignments.push({
      assignmentId: store.assignment_id,
      storeId: store.store_id,
      storeName: store.store_name,
      city: store.city,
      dayOfWeek: day,
      // Weekly ignores the week entirely; storing one would be noise.
      weekOfCycle: store.visit_frequency === "weekly" ? null : slot,
    });
    dayTowns[day].add(store.city ?? "No town");
    const weeks =
      store.visit_frequency === "weekly"
        ? [1, 2, 3, 4]
        : slot === 2
          ? [2, 4]
          : [1, 3];
    for (const w of weeks) occupancy[day][w - 1] += 1;
  };

  // Weekly first: they are the inflexible ones, so they choose their days.
  let cursor = 0;
  for (const group of weeklyGroups) {
    if (cursor >= days.length) {
      overflow.push(...group);
      continue;
    }
    const day = days[cursor++];
    for (const store of group) place(store, day, null);
  }

  // Then the periodic groups, two to a day, alternating weeks.
  for (let i = 0; i < periodicGroups.length; i += 2) {
    if (cursor >= days.length) {
      overflow.push(...periodicGroups.slice(i).flat());
      break;
    }
    const day = days[cursor++];
    for (const store of periodicGroups[i]) place(store, day, 1);
    if (periodicGroups[i + 1]) {
      for (const store of periodicGroups[i + 1]) place(store, day, 2);
    }
  }

  // Stores with no position ride with their own town where one is already
  // placed. Guessing a day for a shop nobody can find is worse than saying so.
  const townDay = new Map<string, { day: number; slot: number | null }>();
  for (const a of assignments) {
    const key = a.city ?? "No town";
    if (!townDay.has(key)) townDay.set(key, { day: a.dayOfWeek, slot: a.weekOfCycle });
  }
  const stranded: PlannedStore[] = [];
  for (const store of unplaceable) {
    const home = townDay.get(store.city ?? "No town");
    if (home) place(store, home.day, home.slot ?? 1);
    else stranded.push(store);
  }
  overflow.push(...stranded);

  const townsByDay = new Map<string, Set<number>>();
  for (const a of assignments) {
    const key = a.city ?? "No town";
    const seen = townsByDay.get(key);
    if (seen) seen.add(a.dayOfWeek);
    else townsByDay.set(key, new Set([a.dayOfWeek]));
  }

  const peakByDay: Record<number, number> = {};
  for (const d of days) peakByDay[d] = Math.max(...occupancy[d]);

  return {
    assignments,
    overflow,
    // Which days come out under the target, and by how much — the figure the
    // old version could not report because it was aiming at a ceiling.
    underTarget: days
      .filter((d) => peakByDay[d] > 0 && peakByDay[d] < target)
      .map((d) => ({ day: d, stores: peakByDay[d] })),
    // What the plan actually occupies, not what it wanted. Reporting demand here
    // produced "7 of 6 working days", which is a sentence that cannot be true.
    daysUsed: days.filter((d) => peakByDay[d] > 0).length,
    daysWanted: daysForWeekly + daysForPeriodic,
    daysAvailable: days.length,
    // A town on more than one day. Sometimes unavoidable — Gaborone cannot fit
    // in a single day — so this is reported rather than prevented.
    splitTowns: [...townsByDay.entries()]
      .filter(([, ds]) => ds.size > 1)
      .map(([town]) => town)
      .sort(),
    sharedDays: days
      .filter((d) => dayTowns[d].size > 1)
      .map((d) => ({ day: d, towns: [...dayTowns[d]].sort() })),
    peakByDay,
    visitsPerCycle: active.reduce((n, s) => n + cycleVisits(s.visit_frequency), 0),
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
      // `stores!visits_store_id_fkey` names which of the two foreign keys
      // between these tables to follow. There are two now: visits.store_id
      // points at the store, and stores.geocode_visit_id points back at the
      // visit a rep captured the location during. Without the constraint name
      // PostgREST refuses the embed outright — "more than one relationship was
      // found" — and the page dies rather than degrading.
      .select(
        "id, rep_id, store_id, status, checkin_at, checkout_at, duration_seconds, stores!visits_store_id_fkey(name, city)"
      )
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
    // 'manual' keeps this stop out of the generator's cleanup. A stop added by
    // hand does not match the call cycle by definition, so without this the
    // next generate would quietly delete it.
    source: "manual",
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
      "id, store_id, is_primary, day_of_week, week_of_cycle, stores(name, city, state, active, visit_frequency, lat, lng)"
    )
    .eq("rep_id", repId);
  if (error) throw new Error(error.message);

  type StoreRow = {
    name: string;
    city: string | null;
    state: string | null;
    active: boolean;
    visit_frequency: VisitFrequency;
    lat: number | null;
    lng: number | null;
  };

  const rows = (data ?? []) as unknown as {
    id: string;
    store_id: string;
    is_primary: boolean;
    day_of_week: number | null;
    week_of_cycle: number | null;
    stores: StoreRow | StoreRow[] | null;
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
        lat: store?.lat ?? null,
        lng: store?.lng ?? null,
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
  return (
    rows[0] ?? {
      created: 0,
      removed: 0,
      first_date: null,
      last_date: null,
      reps_covered: 0,
    }
  );
}
