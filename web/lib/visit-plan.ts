import { distanceKm, orderStops, type Point } from "@/lib/geo";

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
 *   wants a visit: weekly every week, every second week on alternate weeks,
 *   monthly once, in the quietest week. A visit already planned for that site
 *   in the month counts.
 * - Each town's sites are split once into areas by where they are, one area a
 *   day, so a day is neighbours and the same part of town falls on the same
 *   day each week. The day's sites go in driving order.
 * - A full day keeps its nearest sites and moves the rest to the nearest day
 *   that week with room. What still does not fit is reported, not squeezed
 *   in; in a week the month shares with the next or last month, it is left
 *   for that month's days instead.
 */

export type PlanFrequency = "weekly" | "biweekly" | "monthly";

export type PlanSite = {
  id: string;
  name: string;
  town: string | null;
  frequency: PlanFrequency;
  lat: number | null;
  lng: number | null;
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
  existing: readonly { siteId: string; date: string }[];
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
};

/** How far from the middle of its town a site may be before its location is doubted. */
export const TOWN_RADIUS_KM = 30;

/**
 * Sites whose location is more than `TOWN_RADIUS_KM` from the middle of their
 * town's other sites. Judged only where a town has three or more located
 * sites; with fewer there is no "rest of the town" to compare against. The
 * middle is the median, so one wrong location cannot drag it.
 */
export function sitesFarFromTown(sites: readonly PlanSite[]): Map<string, number> {
  const far = new Map<string, number>();
  const byTown = new Map<string, PlanSite[]>();
  for (const s of sites) if (s.lat !== null && s.lng !== null) {
    const key = townKey(s.town);
    byTown.set(key, [...(byTown.get(key) ?? []), s]);
  }
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  for (const town of byTown.values()) {
    if (town.length < 3) continue;
    const middle = { lat: median(town.map((s) => s.lat!)), lng: median(town.map((s) => s.lng!)) };
    for (const s of town) {
      const km = distanceKm({ lat: s.lat!, lng: s.lng! }, middle);
      if (km > TOWN_RADIUS_KM) far.set(s.id, Math.round(km));
    }
  }
  return far;
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

const hasPoint = (s: PlanSite) => s.lat !== null && s.lng !== null;
const pointOf = (s: PlanSite): Point => ({ lat: s.lat!, lng: s.lng! });

/** The middle of the sites with a location, or null when none has one. */
function centre(sites: readonly PlanSite[]): Point | null {
  const located = sites.filter(hasPoint);
  if (located.length === 0) return null;
  return {
    lat: located.reduce((n, s) => n + s.lat!, 0) / located.length,
    lng: located.reduce((n, s) => n + s.lng!, 0) / located.length,
  };
}

/** Kilometres from a point; 0 when either side has no location, so those stay put. */
function away(s: PlanSite, p: Point | null): number {
  return p && hasPoint(s) ? distanceKm(pointOf(s), p) : 0;
}

/**
 * Groups sites purely by where they are: each site joins the nearest of
 * `count` centres, and the centres settle on their groups (k-means).
 *
 * Not `clusterByProximity`, which evens the group sizes for a call cycle and
 * so pushes a site into a far group just to balance the count. Here the day's
 * limit is handled afterwards, by moving a full day's furthest sites to the
 * nearest day with room. Seeds are spread from the edges (each the site
 * furthest from those chosen so far), so the result is the same every time.
 */
function nearestGroups(sites: readonly PlanSite[], count: number): PlanSite[][] {
  const k = Math.min(count, sites.length);
  if (k === 0) return [];
  const middle = centre(sites)!;
  const seeds: Point[] = [];
  let first = sites[0];
  for (const s of sites) if (distanceKm(pointOf(s), middle) > distanceKm(pointOf(first), middle)) first = s;
  seeds.push(pointOf(first));
  while (seeds.length < k) {
    let pick = sites[0];
    let far = -1;
    for (const s of sites) {
      const near = Math.min(...seeds.map((c) => distanceKm(pointOf(s), c)));
      if (near > far) {
        far = near;
        pick = s;
      }
    }
    seeds.push(pointOf(pick));
  }

  let assign = sites.map(() => -1);
  for (let round = 0; round < 25; round++) {
    const next = sites.map((s) => {
      let best = 0;
      for (let i = 1; i < seeds.length; i++) {
        if (distanceKm(pointOf(s), seeds[i]) < distanceKm(pointOf(s), seeds[best])) best = i;
      }
      return best;
    });
    // An empty group takes the site furthest from its own centre, so there
    // are as many areas as days and no weekday is left without one.
    for (let i = 0; i < seeds.length; i++) {
      if (next.includes(i)) continue;
      let pick = -1;
      let far = -1;
      next.forEach((g, j) => {
        const d = distanceKm(pointOf(sites[j]), seeds[g]);
        if (next.filter((x) => x === g).length > 1 && d > far) {
          far = d;
          pick = j;
        }
      });
      if (pick >= 0) {
        next[pick] = i;
        seeds[i] = pointOf(sites[pick]);
      }
    }
    if (next.every((g, i) => g === assign[i])) break;
    assign = next;
    for (let i = 0; i < seeds.length; i++) {
      const members = sites.filter((_, j) => assign[j] === i);
      if (members.length) seeds[i] = centre(members)!;
    }
  }
  return seeds.map((_, i) => sites.filter((_, j) => assign[j] === i)).filter((g) => g.length > 0);
}

/**
 * Splits a town's sites into `count` areas by where they are, numbered so
 * that areas next to each other in number are next to each other on the
 * ground: a short week folds area 1 into area 2, not into area 5.
 *
 * Sites with no location cannot be placed by distance; each goes to the
 * area with the fewest sites so far. Returns site id to area number.
 */
export function townAreas(sites: readonly PlanSite[], count: number): Map<string, number> {
  const located = sites.filter(hasPoint);
  const groups = nearestGroups(located, Math.max(1, count));

  // Chain the areas: start at the one furthest from the middle of town, then
  // always step to the nearest area not yet numbered.
  const middles = groups.map((g) => centre(g)!);
  const all = centre(located);
  const order: number[] = [];
  if (groups.length) {
    let at = middles.reduce((best, m, i) => (distanceKm(m, all!) > distanceKm(middles[best], all!) ? i : best), 0);
    while (order.length < groups.length) {
      order.push(at);
      let next = -1;
      for (let i = 0; i < groups.length; i++) {
        if (order.includes(i)) continue;
        if (next === -1 || distanceKm(middles[at], middles[i]) < distanceKm(middles[at], middles[next])) next = i;
      }
      if (next === -1) break;
      at = next;
    }
  }

  const areaOf = new Map<string, number>();
  const size = Array.from({ length: Math.max(1, count) }, () => 0);
  order.forEach((g, area) => {
    for (const s of groups[g]) areaOf.set(s.id, area);
    size[area] = groups[g].length;
  });
  for (const s of sites) {
    if (areaOf.has(s.id)) continue;
    const area = size.indexOf(Math.min(...size));
    areaOf.set(s.id, area);
    size[area]++;
  }
  return areaOf;
}

export function buildVisitPlan(raw: PlanInput): VisitPlan {
  // A location far from its town is treated as no location at all.
  const far = sitesFarFromTown(raw.sites);
  const input: PlanInput = {
    ...raw,
    sites: raw.sites.map((s) => (far.has(s.id) ? { ...s, lat: null, lng: null } : s)),
  };
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

  // What is already on each day, and which sites already have a visit when.
  // `existingFor` spans whole weeks; what counts towards the month is only
  // what falls inside it (`inMonth`).
  const existingOn = new Map<string, number>();
  const existingFor = new Map<string, string[]>();
  for (const e of input.existing) {
    existingOn.set(e.date, (existingOn.get(e.date) ?? 0) + 1);
    existingFor.set(e.siteId, [...(existingFor.get(e.siteId) ?? []), e.date]);
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

  const sitesByTown = new Map<string, PlanSite[]>();
  for (const s of input.sites) {
    const key = townKey(s.town);
    sitesByTown.set(key, [...(sitesByTown.get(key) ?? []), s]);
  }

  const days: PlanDay[] = [];
  const didNotFit: VisitPlan["didNotFit"] = [];
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
    const weeks: { week: string; dates: string[] }[] = [];
    for (const d of townDates) {
      const w = weekOf(d);
      const last = weeks[weeks.length - 1];
      if (last && last.week === w) last.dates.push(d);
      else weeks.push({ week: w, dates: [d] });
    }
    const hasVisitIn = (s: PlanSite, w: (typeof weeks)[number]) =>
      (existingFor.get(s.id) ?? []).some((d) => weekOf(d) === w.week);

    // Areas: the town's sites split once, by where they are, into one group
    // for each day of its fullest week. The same part of town then falls on
    // the same day every week, and a day's sites are neighbours, not a drive
    // across town. A shorter week folds neighbouring areas together.
    // Area i belongs to the i-th weekday of the town's fullest week. A week
    // without that weekday (a day off, a block starting mid-week) uses its
    // nearest weekday, so an area only ever moves to the day beside it.
    const fullest = weeks.reduce((a, b) => (b.dates.length > a.dates.length ? b : a));
    const template = fullest.dates.map(isoWeekday);
    const perWeek = template.length;
    const areaOf = townAreas(sites, perWeek);
    const slot = (d: string) => {
      const wd = isoWeekday(d);
      const exact = template.indexOf(wd);
      if (exact >= 0) return exact;
      let best = 0;
      template.forEach((t, i) => {
        if (Math.abs(t - wd) < Math.abs(template[best] - wd)) best = i;
      });
      return best;
    };
    const dateFor = (w: (typeof weeks)[number], s: PlanSite) => {
      const area = areaOf.get(s.id)!;
      return w.dates.reduce((best, d) => (Math.abs(slot(d) - area) < Math.abs(slot(best) - area) ? d : best));
    };
    // Where each area is, for a day that has no sites yet.
    const areaMiddle = new Map<number, Point | null>();
    for (let i = 0; i < perWeek; i++) areaMiddle.set(i, centre(sites.filter((s) => areaOf.get(s.id) === i)));

    const planned = new Map<string, PlanSite[]>(townDates.map((d) => [d, []]));
    const roomOn = (d: string) => Math.max(0, perDay - (existingOn.get(d) ?? 0));
    const weekLoad = (w: (typeof weeks)[number]) => w.dates.reduce((n, d) => n + planned.get(d)!.length, 0);
    const put = (w: (typeof weeks)[number], s: PlanSite) => planned.get(dateFor(w, s))!.push(s);

    // Weekly first (fixed), then every second week on the lighter alternate
    // weeks for that site's day, then monthly into the week its day has most
    // room, spreading ties across the month.
    const byFrequency = (f: PlanFrequency) => sites.filter((s) => s.frequency === f);
    for (const s of byFrequency("weekly")) for (const w of weeks) if (!hasVisitIn(s, w)) put(w, s);
    for (const s of byFrequency("biweekly")) {
      const loadOn = (parity: number) =>
        weeks.reduce((n, w, i) => (i % 2 === parity ? n + planned.get(dateFor(w, s))!.length : n), 0);
      // A visit already planned sets the rhythm: every second week from it,
      // so the new one never lands in the week beside it.
      const already = weeks.findIndex((w) => hasVisitIn(s, w));
      const parity = already >= 0 ? already % 2 : weeks.length > 1 && loadOn(1) < loadOn(0) ? 1 : 0;
      let wanted = visitsWanted("biweekly", weeks.length) - inMonth(s.id);
      for (let i = parity; i < weeks.length && wanted > 0; i += 2) {
        if (!hasVisitIn(s, weeks[i])) {
          put(weeks[i], s);
          wanted--;
        }
      }
    }
    // A monthly visit belongs to this month alone, so never to a shared week
    // while the town has a whole one: what spills from a shared week is left
    // to the other month, and the other month plans its own monthly visit.
    const whole = weeks.filter((w) => !sharedWeek(w.week));
    const monthlyWeeks = whole.length > 0 ? whole : weeks;
    for (const s of byFrequency("monthly")) {
      if (inMonth(s.id) > 0) continue;
      const room = (w: (typeof weeks)[number]) => roomOn(dateFor(w, s)) - planned.get(dateFor(w, s))!.length;
      let best = monthlyWeeks[0];
      for (const w of monthlyWeeks) {
        if (room(w) > room(best) || (room(w) === room(best) && weekLoad(w) < weekLoad(best))) best = w;
      }
      put(best, s);
    }

    // A full day keeps its nearest sites; the rest move to the nearest day
    // that week with room, else they did not fit.
    for (const w of weeks) {
      // A week cut by the start or end of the plan (Mon 30 Nov is a week of one
      // day in November): what does not fit belongs to the other month's days.
      const cut = sharedWeek(w.week);
      const extras: PlanSite[] = [];
      for (const d of w.dates) {
        const list = planned.get(d)!;
        const room = roomOn(d);
        if (list.length <= room) continue;
        const middle = centre(list);
        const nearestFirst = [...list].sort((a, b) => away(a, middle) - away(b, middle));
        planned.set(d, nearestFirst.slice(0, room));
        extras.push(...nearestFirst.slice(room));
      }
      // A day's position: its sites, or for an empty day its area's.
      const placeOf = (d: string) => centre(planned.get(d)!) ?? areaMiddle.get(slot(d)) ?? null;
      for (const s of extras) {
        const open = w.dates.filter((d) => planned.get(d)!.length < roomOn(d));
        if (open.length === 0) {
          if (cut && s.frequency !== "monthly") leftForOtherMonth++;
          else missed(s);
          continue;
        }
        // Nearest by distance; a site with no location goes to the day with
        // most room, rather than always the first.
        const target = hasPoint(s)
          ? open.reduce((best, d) => {
              const pd = placeOf(d);
              const pb = placeOf(best);
              const dd = pd ? distanceKm(pointOf(s), pd) : Infinity;
              const db = pb ? distanceKm(pointOf(s), pb) : Infinity;
              return dd < db ? d : best;
            })
          : open.reduce((best, d) =>
              roomOn(d) - planned.get(d)!.length > roomOn(best) - planned.get(best)!.length ? d : best
            );
        planned.get(target)!.push(s);
      }
    }

    // Each day in driving order: shortest route through the sites with a
    // location, then those without one.
    for (const d of townDates) {
      const list = planned.get(d)!;
      const located = list.filter(hasPoint);
      const ordered = [...orderStops(located, pointOf), ...list.filter((s) => !hasPoint(s))];
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

  const planned = new Set(days.flatMap((d) => d.siteIds));
  const noLocation = raw.sites
    .filter((s) => (s.lat === null || s.lng === null) && planned.has(s.id))
    .map((s) => ({ siteId: s.id, name: s.name, town: townLabel(s.town) }));
  const farFromTown = raw.sites
    .filter((s) => far.has(s.id) && planned.has(s.id))
    .map((s) => ({ siteId: s.id, name: s.name, town: townLabel(s.town), km: far.get(s.id)! }));

  return { days, didNotFit, leftForOtherMonth, townsLeftOut, unknownTowns, short, spareDays, noLocation, farFromTown };
}
