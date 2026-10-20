import { centreOf, distanceKm, medianPoint, orderStops, toPoint, type Point } from "@/lib/geo";

/**
 * A month of visits for one person, built from the towns and days the manager
 * chose. Plain rules, no AI: the assistant asks the questions, this does the
 * arithmetic, so the same answers always give the same plan.
 *
 * The rules:
 * - The working days of the month (company working days, from tomorrow, less
 *   the days off) go to the towns in the order given, each town a run of
 *   consecutive days.
 * - In each week a town has days, its sites are visited by how often each one
 *   wants a visit: weekly every week, every second week on alternate weeks
 *   (whichever set is lighter), monthly once (in the week with most room). A
 *   visit already planned for that site counts.
 * - Each town's sites are split once into areas by where they are, one area a
 *   weekday, evened out by how much visiting each needs, so a day is
 *   neighbours and the same part of town falls on the same weekday in a full
 *   week. A short week shares the areas out over its own days, neighbours
 *   together.
 * - A full day keeps its nearest sites (a site with no location gives way
 *   first) and moves the rest to the nearest day that week with room. What
 *   still does not fit is reported, not squeezed in; in a week the month
 *   shares with the next or last month, it is left for that month's days.
 * - Each day's new visits are in driving order, carrying on from the last stop
 *   already on that day, or else from where the person usually starts.
 */

export type PlanFrequency = "weekly" | "biweekly" | "monthly";

export type PlanSite = {
  id: string;
  name: string;
  town: string | null;
  frequency: PlanFrequency;
  lat: number | null;
  lng: number | null;
  /**
   * The location was set or confirmed by a person (a rep on site, a manager),
   * so it is believed over the town's name.
   */
  trusted?: boolean;
};

/** A visit already on the schedule. */
export type ExistingVisit = {
  siteId: string;
  date: string;
  /** Where it is and its place in the day, so the day's new visits carry on from it. */
  lat?: number | null;
  lng?: number | null;
  sequence?: number | null;
};

export type TownDays = { town: string; days: number };

export type PlanInput = {
  sites: readonly PlanSite[];
  towns: readonly TownDays[];
  /** ISO weekdays, 1 = Monday. */
  workingDays: readonly number[];
  sitesPerDay: number;
  /** First and last day that may be planned, YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  daysOff: readonly string[];
  /**
   * Visits already on the schedule, from the Monday of the first week to the
   * Sunday of the last: a week is judged whole, so a visit in its other-month
   * days still counts for that week.
   */
  existing: readonly ExistingVisit[];
  /**
   * Other located sites of the company, whoever they belong to: where a town
   * really is is judged from all of them, not from this person's few.
   */
  reference?: readonly PlanSite[];
  /** Where this person usually starts the day, when known. */
  start?: Point | null;
};

export type PlanDay = {
  date: string;
  town: string;
  siteIds: string[];
  /** Stops already on this day before the plan. */
  alreadyPlanned: number;
};

export type VisitPlan = {
  days: PlanDay[];
  /** Visits the plan wanted but no day had room for. */
  didNotFit: { siteId: string; name: string; town: string; visits: number }[];
  /**
   * Visits that did not fit in a week the month shares with the month before
   * or after. Not missed: the rest of that week is in the other month's plan.
   */
  leftForOtherMonth: number;
  /** Towns with sites that were given no days. */
  townsLeftOut: { town: string; sites: number }[];
  /** Towns asked for that have no sites, by the name given. */
  unknownTowns: string[];
  /** Towns that asked for more days than were left. */
  short: { town: string; asked: number; got: number }[];
  /** Working days nobody was given. */
  spareDays: string[];
  /** Sites with no map location: placed where there was room, not by area. */
  noLocation: { siteId: string; name: string; town: string }[];
  /**
   * Sites whose map location is far from the rest of their town, most likely
   * set wrong: placed as if they had none, so they don't pull a day across
   * the country.
   */
  farFromTown: { siteId: string; name: string; town: string; km: number }[];
  /**
   * Towns whose days fall in fewer of the plan's whole weeks than it has:
   * their weekly sites are visited only in those weeks.
   */
  fewerWeeks: { town: string; weeks: number; of: number }[];
};

/**
 * How far from the middle of its town a site may be before its location is
 * doubted. Wide on purpose: the aim is to catch a pin in another town (a
 * Mochudi store pinned in Maun, 564 km away), not the edge of a big one
 * (Atlantis is 40 km from the middle of Cape Town).
 */
export const TOWN_RADIUS_KM = 75;

/**
 * Sites whose location is more than `TOWN_RADIUS_KM` from the middle of their
 * town. Planned as if they had no location, so one wrong pin cannot pull a day
 * across the country.
 *
 * The middle is the median of every located site known in that town (this
 * person's and, through `reference`, the rest of the company's), counting a
 * shared pin once, so a pair of stores pinned to the same wrong spot cannot
 * outvote the right one. Locations a person set or confirmed are trusted: they
 * are never doubted, and when a town has any they alone set its middle.
 * A town is judged only when it has three distinct places (or a trusted one),
 * and only when most of them agree on where it is; an even split has no
 * middle worth trusting. Sites with no town have no town to be far from.
 */
export function sitesFarFromTown(
  sites: readonly PlanSite[],
  reference: readonly PlanSite[] = []
): Map<string, number> {
  const far = new Map<string, number>();
  const known = new Map<string, Map<string, PlanSite>>();
  for (const s of [...reference, ...sites]) {
    const key = townKey(s.town);
    if (key === "" || !hasPoint(s)) continue;
    let town = known.get(key);
    if (!town) known.set(key, (town = new Map()));
    town.set(s.id, s);
  }
  for (const [key, town] of known) {
    const all = [...town.values()];
    const vouched = all.filter((s) => s.trusted);
    const places = distinctPoints((vouched.length > 0 ? vouched : all).map(pointOf));
    if (vouched.length === 0 && places.length < 3) continue;
    const middle = medianPoint(places)!;
    const agree = places.filter((p) => distanceKm(p, middle) <= TOWN_RADIUS_KM).length;
    if (agree * 2 <= places.length) continue;
    for (const s of sites) {
      if (s.trusted || !hasPoint(s) || townKey(s.town) !== key) continue;
      const km = distanceKm(pointOf(s), middle);
      if (km > TOWN_RADIUS_KM) far.set(s.id, Math.round(km));
    }
  }
  return far;
}

/** One point per place: pins within about a metre of each other count once. */
function distinctPoints(points: readonly Point[]): Point[] {
  const seen = new Map<string, Point>();
  for (const p of points) seen.set(`${p.lat.toFixed(5)},${p.lng.toFixed(5)}`, p);
  return [...seen.values()];
}

/** The name used for sites with no town, in the lookups and the answers. */
export const NO_TOWN = "No town set";

export function townKey(town: string | null | undefined): string {
  const t = (town ?? "").trim().toLowerCase();
  return t === "" || t === NO_TOWN.toLowerCase() ? "" : t;
}

export function townLabel(town: string | null | undefined): string {
  return (town ?? "").trim() || NO_TOWN;
}

/** A YYYY-MM-DD day moved by whole days, in plain calendar arithmetic. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The Monday of the day's week, as the week's name. */
function weekOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** The Monday of a day's week and the Sunday after it: the span a week is judged over. */
export function wholeWeeks(from: string, to: string): { from: string; to: string } {
  return { from: weekOf(from), to: addDays(weekOf(to), 6) };
}

/**
 * The month to plan: its first plannable day (tomorrow, or the 1st) to its last.
 * Throws with a plain message for a month that is over or more than two
 * months after this one.
 */
export function planMonth(value: unknown, today: string): { month: string; from: string; to: string; label: string } {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("month must be written as YYYY-MM.");
  }
  const first = `${value}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  const tomorrow = addDays(today, 1);
  if (last < tomorrow) throw new Error("That month is over. Plan this month or a later one.");
  const limit = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  limit.setUTCMonth(limit.getUTCMonth() + 3);
  if (first >= limit.toISOString().slice(0, 10)) throw new Error("Plan up to three months ahead.");
  return {
    month: value,
    from: first < tomorrow ? tomorrow : first,
    to: last,
    label: new Date(`${first}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

/** Working days from `from` to `to`, less days off. */
export function workingDates(from: string, to: string, workingDays: readonly number[], daysOff: readonly string[]): string[] {
  const off = new Set(daysOff);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (workingDays.includes(isoWeekday(d)) && !off.has(d)) out.push(d);
  }
  return out;
}

/** Visits a site wants in a month, by its frequency. */
export function visitsWanted(frequency: PlanFrequency, weeks: number): number {
  if (weeks <= 0) return 0;
  if (frequency === "weekly") return weeks;
  if (frequency === "biweekly") return Math.ceil(weeks / 2);
  return 1;
}

const hasPoint = (s: PlanSite) => toPoint(s.lat, s.lng) !== null;
/** Only for sites already known to have a location (`hasPoint`). */
const pointOf = (s: PlanSite): Point => toPoint(s.lat, s.lng)!;

/** The first item with the lowest score, each item scored once. */
function minBy<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const item of items) {
    const value = score(item);
    if (best === undefined || value < bestScore) {
      best = item;
      bestScore = value;
    }
  }
  return best;
}

/** The first item with the highest score, each item scored once. */
function maxBy<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  return minBy(items, (item) => -score(item));
}

/** The first item whose scores are highest, compared in order (the first score decides, then the next). */
function bestBy<T>(items: readonly T[], scores: (item: T) => number[]): T | undefined {
  let best: T | undefined;
  let bestScores: number[] = [];
  for (const item of items) {
    const value = scores(item);
    const i = value.findIndex((v, j) => v !== bestScores[j]);
    if (best === undefined || (i >= 0 && value[i] > bestScores[i])) {
      best = item;
      bestScores = value;
    }
  }
  return best;
}

/** How much of a week a site takes: a weekly visit is 1, every second week a half, monthly a share of the month. */
function weekShare(s: PlanSite, weeks: number): number {
  return s.frequency === "weekly" ? 1 : s.frequency === "biweekly" ? 0.5 : 1 / Math.max(1, weeks);
}

/**
 * Groups sites by where they are: each site joins the nearest of `count`
 * centres, and the centres settle on their groups (k-means). Seeds are spread
 * from the edges (each the site furthest from those chosen so far), so the
 * result is the same every time. Always `min(count, sites)` groups, none empty.
 */
function nearestGroups(sites: readonly PlanSite[], count: number): PlanSite[][] {
  const k = Math.min(count, sites.length);
  if (k === 0) return [];
  const points = sites.map(pointOf);
  const middle = centreOf(points)!;
  const seeds: Point[] = [maxBy(points, (p) => distanceKm(p, middle))!];
  while (seeds.length < k) {
    seeds.push(maxBy(points, (p) => Math.min(...seeds.map((c) => distanceKm(p, c))))!);
  }

  let assign = sites.map(() => -1);
  for (let round = 0; round < 25; round++) {
    const next = points.map((p) => minBy(seeds.map((_, i) => i), (i) => distanceKm(p, seeds[i]))!);
    // An empty group takes the site furthest from its own centre in a group
    // that has more than one, so there are as many areas as days.
    const members = seeds.map(() => 0);
    for (const g of next) members[g]++;
    for (let i = 0; i < seeds.length; i++) {
      if (members[i] > 0) continue;
      const pick = maxBy(
        points.map((_, j) => j).filter((j) => members[next[j]] > 1),
        (j) => distanceKm(points[j], seeds[next[j]])
      );
      if (pick === undefined) continue;
      members[next[pick]]--;
      members[i]++;
      next[pick] = i;
      seeds[i] = points[pick];
    }
    if (next.every((g, i) => g === assign[i])) break;
    assign = next;
    for (let i = 0; i < seeds.length; i++) {
      const own = points.filter((_, j) => assign[j] === i);
      if (own.length) seeds[i] = centreOf(own)!;
    }
  }
  return seeds.map((_, i) => sites.filter((_, j) => assign[j] === i));
}

/**
 * Evens out the groups by how much visiting they need each week. k-means alone
 * gives one outlying store a group, and so a weekday, of its own while the day
 * beside it is full. Moves the sites that cost least to move (nearest another
 * group's middle) from a group well over its share (a quarter over the
 * average, or over `cap`, a day's limit) to one with room for them.
 */
function balanceGroups(groups: PlanSite[][], share: (s: PlanSite) => number, cap: number): void {
  if (groups.length < 2) return;
  const middles = groups.map((g) => centreOf(g.map(pointOf))!);
  const load = groups.map((g) => g.reduce((n, s) => n + share(s), 0));
  // Some slack over the average, so a natural group of neighbours is not
  // broken up to make the days exactly equal, but never over a day's limit.
  const limit = Math.min(cap, (load.reduce((a, b) => a + b, 0) / groups.length) * 1.25 + 0.5);
  for (;;) {
    let best: { site: PlanSite; from: number; to: number; cost: number } | null = null;
    groups.forEach((group, from) => {
      if (load[from] <= limit) return;
      for (const site of group) {
        groups.forEach((_, to) => {
          if (to === from || load[to] + share(site) > limit) return;
          const cost = distanceKm(pointOf(site), middles[to]) - distanceKm(pointOf(site), middles[from]);
          if (!best || cost < best.cost) best = { site, from, to, cost };
        });
      }
    });
    if (!best) return;
    const { site, from, to } = best;
    groups[from] = groups[from].filter((s) => s !== site);
    groups[to].push(site);
    load[from] -= share(site);
    load[to] += share(site);
  }
}

type Areas = {
  /** Site id to area number. */
  areaOf: Map<string, number>;
  /** Where each area is; null for an area with no located site. */
  middles: (Point | null)[];
};

/**
 * Splits a town's sites into `count` areas by where they are, evened out by
 * how much visiting each needs over `weeks`, and numbered so that areas next
 * to each other in number are next to each other on the ground (the shortest
 * chain through their middles, from the area furthest out): a short week
 * folds area 1 in with area 2, not with area 5.
 *
 * Sites with no location cannot be placed by distance; each goes to the area
 * with least to do so far.
 */
function areasOf(
  sites: readonly PlanSite[],
  count: number,
  share: (s: PlanSite) => number,
  /** Where the stops already on area i's weekday are, if any: the chain runs the way that matches them. */
  existingNear: (area: number) => Point | null = () => null,
  /** A day's limit, which no area's usual load should pass. */
  cap = Infinity
): Areas {
  const located = sites.filter(hasPoint);
  const groups = nearestGroups(located, count);
  balanceGroups(groups, share, cap);

  const middles = groups.map((g) => centreOf(g.map(pointOf))!);
  const ids = groups.map((_, i) => i);
  let order: number[] = [];
  if (groups.length) {
    const all = centreOf(located.map(pointOf))!;
    const first = maxBy(ids, (i) => distanceKm(middles[i], all))!;
    order = orderStops([first, ...ids.filter((i) => i !== first)], (i) => middles[i]);
    // The chain can run either way along the week. Run it the way that puts
    // each area on the weekday whose existing stops are nearest it.
    const mismatch = (o: number[]) =>
      o.reduce((n, g, area) => {
        const near = existingNear(area);
        return near ? n + distanceKm(middles[g], near) : n;
      }, 0);
    const reversed = [...order].reverse();
    if (mismatch(reversed) < mismatch(order)) order = reversed;
  }

  const areaOf = new Map<string, number>();
  const load = Array.from({ length: count }, () => 0);
  const areaMiddles: (Point | null)[] = Array.from({ length: count }, () => null);
  order.forEach((g, area) => {
    for (const s of groups[g]) areaOf.set(s.id, area);
    load[area] = groups[g].reduce((n, s) => n + share(s), 0);
    areaMiddles[area] = middles[g];
  });
  for (const s of sites) {
    if (areaOf.has(s.id)) continue;
    const area = minBy(load.map((_, i) => i), (i) => load[i])!;
    areaOf.set(s.id, area);
    load[area] += share(s);
  }
  return { areaOf, middles: areaMiddles };
}

/** Site id to area number, as the planner splits a town (see `areasOf`). */
export function townAreas(sites: readonly PlanSite[], count: number, weeks = 4): Map<string, number> {
  return areasOf(sites, Math.max(1, count), (s) => weekShare(s, weeks)).areaOf;
}

/**
 * Areas on their own weekdays (area i on the template's i-th weekday). An
 * area whose weekday is missing this week (a day off, a run that starts or
 * ends mid-week) joins the nearer day that is there, the lighter one when
 * both are as near. Null when the week has a day the template does not.
 */
function keepWeekdays(dates: readonly string[], template: readonly number[], load: readonly number[]): string[] | null {
  const dayOf = new Map(dates.map((d) => [isoWeekday(d), d]));
  if (dates.some((d) => !template.includes(isoWeekday(d)))) return null;
  const present = template.map((wd) => dayOf.get(wd) ?? null);
  const taken = new Map<string, number>();
  const out = template.map((_, area) => {
    const own = present[area];
    if (own) {
      taken.set(own, (taken.get(own) ?? 0) + load[area]);
      return own;
    }
    return "";
  });
  template.forEach((_, area) => {
    if (out[area]) return;
    const near = minBy(
      present.map((d, i) => ({ d, gap: Math.abs(i - area) })).filter((x) => x.d !== null),
      (x) => x.gap * 1000 + (taken.get(x.d!) ?? 0)
    )!.d!;
    out[area] = near;
    taken.set(near, (taken.get(near) ?? 0) + load[area]);
  });
  return out;
}

/**
 * The chain of areas cut into one run of neighbouring areas per day, in
 * order, so that the heaviest day is as light as it can be.
 */
function splitEvenly(dates: readonly string[], load: readonly number[]): string[] {
  const k = load.length;
  const n = Math.min(dates.length, k);
  // best[i][j]: the lightest heaviest-day for the first i areas on j days.
  const best = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => Infinity));
  const cut = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  const sum = (a: number, b: number) => load.slice(a, b).reduce((x, y) => x + y, 0);
  best[0][0] = 0;
  for (let i = 1; i <= k; i++) {
    for (let j = 1; j <= Math.min(i, n); j++) {
      for (let c = j - 1; c < i; c++) {
        const value = Math.max(best[c][j - 1], sum(c, i));
        if (value < best[i][j]) {
          best[i][j] = value;
          cut[i][j] = c;
        }
      }
    }
  }
  const out: string[] = Array.from({ length: k }, () => dates[0]);
  // A week with more days than areas spreads the areas over them evenly.
  const day = (j: number) => dates[n === dates.length ? j : Math.round((j * (dates.length - 1)) / Math.max(1, n - 1))];
  for (let i = k, j = n; j > 0; j--) {
    const c = cut[i][j];
    for (let a = c; a < i; a++) out[a] = day(j - 1);
    i = c;
  }
  return out;
}

/** The load on the heaviest day of a layout. */
function heaviest(dayOfArea: readonly string[], load: readonly number[]): number {
  const per = new Map<string, number>();
  dayOfArea.forEach((d, area) => per.set(d, (per.get(d) ?? 0) + load[area]));
  return Math.max(...per.values());
}

/** The middle of the areas a day takes, as an area number; for a day with none, -1. */
function middleArea(dayOfArea: readonly string[], d: string): number {
  const mine = dayOfArea.map((x, area) => (x === d ? area : -1)).filter((a) => a >= 0);
  return mine.length ? mine.reduce((a, b) => a + b, 0) / mine.length : -1;
}

/** Kilometres from a point; 0 when either side has no location. */
function away(s: PlanSite, p: Point | null): number {
  return p && hasPoint(s) ? distanceKm(pointOf(s), p) : 0;
}

export function buildVisitPlan(input: PlanInput): VisitPlan {
  // A location far from its town is planned as if there were none.
  const far = sitesFarFromTown(input.sites, input.reference);
  const usable = input.sites.map((s) => (far.has(s.id) ? { ...s, lat: null, lng: null } : s));
  const perDay = Math.max(1, Math.floor(input.sitesPerDay));
  const dates = workingDates(input.from, input.to, input.workingDays, input.daysOff);

  // Days to towns, in the order asked.
  const townOf = new Map<string, string>(); // date -> town key
  const labelOf = new Map<string, string>(); // town key -> name as asked
  const short: VisitPlan["short"] = [];
  let next = 0;
  for (const { town, days } of input.towns) {
    const want = Math.max(0, Math.floor(days));
    // A town given no days is left out, and said so below, not quietly dropped.
    if (want === 0) continue;
    const key = townKey(town);
    if (!labelOf.has(key)) labelOf.set(key, townLabel(town));
    const got = Math.min(want, dates.length - next);
    for (let i = 0; i < got; i++) townOf.set(dates[next + i], key);
    next += got;
    if (got < want) short.push({ town: townLabel(town), asked: want, got });
  }
  const spareDays = dates.slice(next);

  // What is already on each day, which sites already have a visit when, and
  // each day's last stop (to carry its route on from). `existingFor` spans
  // whole weeks; what counts towards the month is only what falls inside it.
  const existingOn = new Map<string, number>();
  const existingFor = new Map<string, string[]>();
  const lastStop = new Map<string, { sequence: number; point: Point }>();
  for (const e of input.existing) {
    existingOn.set(e.date, (existingOn.get(e.date) ?? 0) + 1);
    const seen = existingFor.get(e.siteId);
    if (seen) seen.push(e.date);
    else existingFor.set(e.siteId, [e.date]);
    const point = toPoint(e.lat, e.lng);
    const sequence = e.sequence ?? 0;
    if (point && sequence >= (lastStop.get(e.date)?.sequence ?? -Infinity)) lastStop.set(e.date, { sequence, point });
  }
  const inMonth = (siteId: string) =>
    (existingFor.get(siteId) ?? []).filter((d) => d >= input.from && d <= input.to).length;

  // A week the plan shares with the month before or after: some of its
  // working days are outside the plan. Days that are not worked don't count,
  // so a plan ending on a Friday has no shared week.
  const sharedWeek = (monday: string) => {
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      if ((d < input.from || d > input.to) && input.workingDays.includes(isoWeekday(d))) return true;
    }
    return false;
  };

  const planWholeWeeks = [...new Set(dates.map(weekOf))].filter((w) => !sharedWeek(w)).length;

  const sitesByTown = new Map<string, PlanSite[]>();
  for (const s of usable) {
    const key = townKey(s.town);
    const list = sitesByTown.get(key);
    if (list) list.push(s);
    else sitesByTown.set(key, [s]);
  }

  const days: PlanDay[] = [];
  const didNotFit: VisitPlan["didNotFit"] = [];
  const fewerWeeks: VisitPlan["fewerWeeks"] = [];
  let leftForOtherMonth = 0;
  const missed = (s: PlanSite) => {
    const row = didNotFit.find((d) => d.siteId === s.id);
    if (row) row.visits++;
    else didNotFit.push({ siteId: s.id, name: s.name, town: townLabel(s.town), visits: 1 });
  };

  for (const [key, label] of labelOf) {
    const townDates = dates.filter((d) => townOf.get(d) === key);
    if (townDates.length === 0) continue;
    const sites = [...(sitesByTown.get(key) ?? [])].sort((a, b) => a.name.localeCompare(b.name));

    // The town's weeks, in order, with their days.
    type Week = { week: string; dates: string[]; place: Map<string, number>; dayOfArea: string[] };
    const weeks: Week[] = [];
    for (const d of townDates) {
      const w = weekOf(d);
      const last = weeks[weeks.length - 1];
      if (last && last.week === w) last.dates.push(d);
      else weeks.push({ week: w, dates: [d], place: new Map(), dayOfArea: [] });
    }
    // Only whole weeks: a week shared with the next month is part of that month's plan too.
    const wholeWeeks = weeks.filter((w) => !sharedWeek(w.week)).length;
    if (wholeWeeks < planWholeWeeks) fewerWeeks.push({ town: label, weeks: wholeWeeks, of: planWholeWeeks });
    const hasVisitIn = (s: PlanSite, w: Week) => (existingFor.get(s.id) ?? []).some((d) => weekOf(d) === w.week);

    // What each site still needs this month: weekly, the weeks with no visit
    // yet; every second week, what is wanted less what is planned; monthly,
    // one unless it already has one. A site needing nothing takes no area.
    const need = new Map<string, number>(
      sites.map((s) => [
        s.id,
        s.frequency === "weekly"
          ? weeks.filter((w) => !hasVisitIn(s, w)).length
          : s.frequency === "biweekly"
            ? Math.max(0, visitsWanted("biweekly", weeks.length) - inMonth(s.id))
            : inMonth(s.id) > 0
              ? 0
              : 1,
      ])
    );
    const toPlan = sites.filter((s) => need.get(s.id)! > 0);

    // Areas: one for each weekday of the town's fullest week, evened out by
    // the visits each still needs, and lined up with any stops already on
    // those weekdays.
    const template = maxBy(weeks, (w) => w.dates.length)!.dates.map(isoWeekday);
    const perWeek = template.length;
    const existingByWeekday = template.map((wd) =>
      centreOf(
        input.existing
          .filter((e) => townDates.includes(e.date) && isoWeekday(e.date) === wd)
          .map((e) => ({ lat: e.lat ?? null, lng: e.lng ?? null }))
      )
    );
    const { areaOf, middles } = areasOf(
      toPlan,
      perWeek,
      (s) => need.get(s.id)! / weeks.length,
      (area) => existingByWeekday[area] ?? null,
      perDay
    );

    // Which day of each week takes which areas. Each area's usual load is
    // what its sites need on average each week.
    const areaLoad = template.map((_, area) =>
      toPlan.reduce((n, s) => (areaOf.get(s.id) === area ? n + need.get(s.id)! / weeks.length : n), 0)
    );
    for (const w of weeks) {
      const byWeekday = keepWeekdays(w.dates, template, areaLoad);
      const balanced = splitEvenly(w.dates, areaLoad);
      // Keep each part of town on its weekday unless that makes one day
      // clearly heavier than sharing the areas out evenly would (a week cut
      // to Mon-Tue would otherwise put four of five areas on Tuesday).
      const chosen = byWeekday && heaviest(byWeekday, areaLoad) <= heaviest(balanced, areaLoad) + 0.5 ? byWeekday : balanced;
      w.dayOfArea = chosen;
      w.place = new Map(w.dates.map((d) => [d, middleArea(chosen, d)]));
    }
    const dateFor = (w: Week, s: PlanSite) => w.dayOfArea[areaOf.get(s.id)!];

    const planned = new Map<string, PlanSite[]>(townDates.map((d) => [d, []]));
    const roomOn = (d: string) => Math.max(0, perDay - (existingOn.get(d) ?? 0));
    const spare = (d: string) => roomOn(d) - planned.get(d)!.length;
    const weekLoad = (w: Week) => w.dates.reduce((n, d) => n + planned.get(d)!.length, 0);
    const weekSpare = (w: Week) => w.dates.reduce((n, d) => n + spare(d), 0);
    const put = (w: Week, s: PlanSite) => planned.get(dateFor(w, s))!.push(s);

    const byFrequency = (f: PlanFrequency) => sites.filter((s) => s.frequency === f);
    // Every site put on a day has an area: `toPlan` holds every site with a visit still to make.
    for (const s of byFrequency("weekly")) for (const w of weeks) if (!hasVisitIn(s, w)) put(w, s);
    for (const s of byFrequency("biweekly")) {
      if (need.get(s.id) === 0) continue;
      // The lighter set of alternate weeks for this site's day, and when that
      // ties, for the whole week, so these sites share the weeks out rather
      // than all taking the first. A visit already planned sets the rhythm.
      const own = (parity: number) =>
        weeks.reduce((n, w, i) => (i % 2 === parity ? n + planned.get(dateFor(w, s))!.length : n), 0);
      const whole = (parity: number) => weeks.reduce((n, w, i) => (i % 2 === parity ? n + weekLoad(w) : n), 0);
      const already = weeks.findIndex((w) => hasVisitIn(s, w));
      const parity =
        already >= 0
          ? already % 2
          : weeks.length > 1 && (own(1) < own(0) || (own(1) === own(0) && whole(1) < whole(0)))
            ? 1
            : 0;
      let wanted = visitsWanted("biweekly", weeks.length) - inMonth(s.id);
      for (let i = parity; i < weeks.length && wanted > 0; i += 2) {
        if (!hasVisitIn(s, weeks[i])) {
          put(weeks[i], s);
          wanted--;
        }
      }
    }
    // Monthly: the week with most room left, preferring one where the site's
    // own day still has room. Never a shared week while the town has a whole
    // one: what spills from a shared week is left to the other month, and the
    // other month plans its own monthly visit.
    const whole = weeks.filter((w) => !sharedWeek(w.week));
    const monthlyWeeks = whole.length > 0 ? whole : weeks;
    for (const s of byFrequency("monthly")) {
      if (inMonth(s.id) > 0) continue;
      const best = bestBy(monthlyWeeks, (w) => {
        const ownSpare = spare(dateFor(w, s));
        return [ownSpare > 0 ? 1 : 0, weekSpare(w), ownSpare];
      })!;
      put(best, s);
    }

    // A full day gives way one site at a time until it fits: first a site
    // with no location (it can go anywhere), then monthly, then every second
    // week, and weekly last, so weekly sites keep their weekday. Of those, the
    // one that adds least driving moves: it goes to the day with room that is
    // nearest it, which makes it the site on the edge facing that day, not
    // the far end of town. With no day left with room, it did not fit.
    const giveWay = (s: PlanSite) =>
      (hasPoint(s) ? 0 : 10) + (s.frequency === "weekly" ? 0 : s.frequency === "biweekly" ? 1 : 2);
    for (const w of weeks) {
      // A week cut by the start or end of the plan (Mon 30 Nov is a week of one
      // day in November): what does not fit belongs to the other month's days.
      const cut = sharedWeek(w.week);
      // A day's position: its sites, or for an empty day its area's.
      const placeOf = (d: string) =>
        centreOf(planned.get(d)!.filter(hasPoint).map(pointOf)) ?? middles[Math.round(w.place.get(d)!)] ?? null;
      // (An area number of -1, a day that takes no area, gives no position: undefined -> null.)
      for (;;) {
        const over = w.dates.find((d) => spare(d) < 0);
        if (over === undefined) break;
        const list = planned.get(over)!;
        const rank = Math.max(...list.map(giveWay));
        const candidates = list.filter((s) => giveWay(s) === rank);
        const open = w.dates.filter((d) => d !== over && spare(d) > 0);
        const home = placeOf(over);
        let site: PlanSite;
        let target: string | null = null;
        if (open.length === 0) {
          site = maxBy(candidates, (s) => away(s, home))!;
        } else if (hasPoint(candidates[0])) {
          let bestCost = Infinity;
          site = candidates[0];
          for (const s of candidates) {
            for (const d of open) {
              const there = placeOf(d);
              const cost = (there ? distanceKm(pointOf(s), there) : Infinity) - away(s, home);
              if (cost < bestCost) {
                bestCost = cost;
                site = s;
                target = d;
              }
            }
          }
          target ??= maxBy(open, spare)!;
        } else {
          site = candidates[0];
          target = maxBy(open, spare)!;
        }
        planned.set(over, list.filter((s) => s !== site));
        if (target !== null) planned.get(target)!.push(site);
        else if (cut && site.frequency !== "monthly") leftForOtherMonth++;
        else missed(site);
      }
    }

    // Each day's new visits in driving order: on from the last stop already on
    // that day, or from where the person usually starts, or else from the
    // stop furthest from the middle (an end, not the middle). Sites with no
    // location go last.
    for (const d of townDates) {
      const list = planned.get(d)!;
      const located = list.filter(hasPoint);
      const from = lastStop.get(d)?.point ?? input.start ?? null;
      let route = located;
      if (from) route = orderStops(located, pointOf, from);
      else if (located.length > 1) {
        const middle = centreOf(located.map(pointOf))!;
        const end = maxBy(located, (s) => distanceKm(pointOf(s), middle))!;
        route = orderStops([end, ...located.filter((s) => s !== end)], pointOf);
      }
      const ordered = [...route, ...list.filter((s) => !hasPoint(s))];
      days.push({ date: d, town: label, siteIds: ordered.map((s) => s.id), alreadyPlanned: existingOn.get(d) ?? 0 });
    }
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  const asked = new Set(labelOf.keys());
  const townsLeftOut = [...sitesByTown.entries()]
    .filter(([key]) => !asked.has(key))
    .map(([key, sites]) => ({ town: townLabel(sites[0]?.town ?? key), sites: sites.length }))
    .sort((a, b) => b.sites - a.sites);
  const unknownTowns = [...labelOf.entries()].filter(([key]) => !sitesByTown.has(key)).map(([, label]) => label);

  // Reported from the sites as given: a far-off location is "far", not "none".
  const inPlan = new Set(days.flatMap((d) => d.siteIds));
  const noLocation = input.sites
    .filter((s) => !hasPoint(s) && inPlan.has(s.id))
    .map((s) => ({ siteId: s.id, name: s.name, town: townLabel(s.town) }));
  const farFromTown = input.sites
    .filter((s) => far.has(s.id) && inPlan.has(s.id))
    .map((s) => ({ siteId: s.id, name: s.name, town: townLabel(s.town), km: far.get(s.id)! }));

  return {
    days,
    didNotFit,
    leftForOtherMonth,
    townsLeftOut,
    unknownTowns,
    short,
    spareDays,
    noLocation,
    farFromTown,
    fewerWeeks,
  };
}
