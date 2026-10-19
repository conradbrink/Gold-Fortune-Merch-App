import { clusterByProximity, type Point } from "@/lib/geo";

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
 * - Within the week, sites near each other share a day, up to the sites-a-day
 *   limit less what is already on that day. What does not fit is reported,
 *   not squeezed in; in a week the month shares with the next or last month,
 *   it is left for that month's days instead.
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
  /** Visits already on the schedule in the range. */
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
};

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

export function buildVisitPlan(input: PlanInput): VisitPlan {
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
  const existingOn = new Map<string, number>();
  const existingFor = new Map<string, string[]>();
  for (const e of input.existing) {
    existingOn.set(e.date, (existingOn.get(e.date) ?? 0) + 1);
    existingFor.set(e.siteId, [...(existingFor.get(e.siteId) ?? []), e.date]);
  }

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
    const weeks: { week: string; dates: string[]; sites: PlanSite[] }[] = [];
    for (const d of townDates) {
      const w = weekOf(d);
      const last = weeks[weeks.length - 1];
      if (last && last.week === w) last.dates.push(d);
      else weeks.push({ week: w, dates: [d], sites: [] });
    }
    const load = () => weeks.map((w) => w.sites.length);
    const hasVisitIn = (s: PlanSite, w: (typeof weeks)[number]) =>
      (existingFor.get(s.id) ?? []).some((d) => weekOf(d) === w.week);

    // Weekly first (fixed), then fortnightly on the lighter alternate weeks,
    // then monthly into whichever week is lightest at the time.
    const byFrequency = (f: PlanFrequency) => sites.filter((s) => s.frequency === f);
    for (const s of byFrequency("weekly")) for (const w of weeks) if (!hasVisitIn(s, w)) w.sites.push(s);
    for (const s of byFrequency("biweekly")) {
      const l = load();
      const even = l.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
      const odd = l.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
      // A visit already planned sets the rhythm: every second week from it,
      // so the new one never lands in the week beside it.
      const planned = weeks.findIndex((w) => hasVisitIn(s, w));
      const parity = planned >= 0 ? planned % 2 : weeks.length > 1 && odd < even ? 1 : 0;
      const already = (existingFor.get(s.id) ?? []).length;
      let wanted = visitsWanted("biweekly", weeks.length) - already;
      for (let i = parity; i < weeks.length && wanted > 0; i += 2) {
        if (!hasVisitIn(s, weeks[i])) {
          weeks[i].sites.push(s);
          wanted--;
        }
      }
    }
    for (const s of byFrequency("monthly")) {
      if ((existingFor.get(s.id) ?? []).length > 0) continue;
      const l = load();
      let best = 0;
      for (let i = 1; i < l.length; i++) {
        // Spare room counts, not just the count: a week of two days fills sooner.
        const room = (j: number) => weeks[j].dates.length * perDay - l[j];
        if (room(i) > room(best)) best = i;
      }
      weeks[best].sites.push(s);
    }

    // Within each week: near sites together, one group a day, within room.
    for (const w of weeks) {
      // A week cut by the start or end of the plan (Mon 30 Nov is a week of one
      // day in November): what does not fit belongs to the other month's days.
      const cut = w.week < input.from || addDays(w.week, 6) > input.to;
      const room = new Map(w.dates.map((d) => [d, Math.max(0, perDay - (existingOn.get(d) ?? 0))]));
      const located = w.sites.filter((s) => s.lat !== null && s.lng !== null);
      const unlocated = w.sites.filter((s) => s.lat === null || s.lng === null);
      const groups = located.length
        ? clusterByProximity(located, (s) => ({ lat: s.lat, lng: s.lng }) as Point, w.dates.length)
        : [];
      while (groups.length < w.dates.length) groups.push([]);
      // Sites with no location go to the lightest days.
      for (const s of unlocated) {
        let j = 0;
        for (let i = 1; i < groups.length; i++) if (groups[i].length < groups[j].length) j = i;
        groups[j].push(s);
      }

      const placed = new Map<string, PlanSite[]>(w.dates.map((d) => [d, []]));
      const overflow: PlanSite[] = [];
      w.dates.forEach((d, i) => {
        for (const s of groups[i] ?? []) {
          if (placed.get(d)!.length < room.get(d)!) placed.get(d)!.push(s);
          else overflow.push(s);
        }
      });
      // A full day's extras go to another day that week with room, else they did not fit.
      for (const s of overflow) {
        const d = w.dates.find((x) => placed.get(x)!.length < room.get(x)!);
        if (d) placed.get(d)!.push(s);
        else if (cut) leftForOtherMonth++;
        else missed(s);
      }
      for (const d of w.dates) {
        days.push({ date: d, town: label, siteIds: placed.get(d)!.map((s) => s.id), alreadyPlanned: existingOn.get(d) ?? 0 });
      }
    }
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  const asked = new Set(labelOf.keys());
  const townsLeftOut = [...sitesByTown.entries()]
    .filter(([key]) => !asked.has(key))
    .map(([key, sites]) => ({ town: townLabel(sites[0]?.town ?? key), sites: sites.length }))
    .sort((a, b) => b.sites - a.sites);
  const unknownTowns = [...labelOf.entries()].filter(([key]) => !sitesByTown.has(key)).map(([, label]) => label);

  return { days, didNotFit, leftForOtherMonth, townsLeftOut, unknownTowns, short, spareDays };
}
