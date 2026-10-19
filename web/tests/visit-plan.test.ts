// The month plan Ask drafts for one person. Plain rules, no AI, so these pin
// them: days go to towns in the order asked; each site gets the visits its
// frequency wants in the weeks its town has days; a full day spills to another
// day that week or is reported; nothing already planned is planned twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVisitPlan,
  isoWeekday,
  planMonth,
  sitesFarFromTown,
  townAreas,
  visitsWanted,
  wholeWeeks,
  workingDates,
  NO_TOWN,
  type PlanSite,
} from "@/lib/visit-plan";
import { readPlanSave } from "@/lib/plan-save";

const MON_FRI = [1, 2, 3, 4, 5];

function site(id: string, town: string | null, frequency: PlanSite["frequency"], lat: number | null = null): PlanSite {
  return { id, name: `Site ${id}`, town, frequency, lat, lng: lat === null ? null : 25.9 };
}

// November 2026: Sun 1st. Working days Mon 2 to Mon 30 = 21 days.
const NOV = { from: "2026-11-01", to: "2026-11-30" };

test("working days skip weekends and days off", () => {
  const days = workingDates(NOV.from, NOV.to, MON_FRI, ["2026-11-03"]);
  assert.equal(days.length, 20);
  assert.equal(days[0], "2026-11-02");
  assert.ok(!days.includes("2026-11-03"));
  assert.ok(!days.includes("2026-11-07"), "Saturday");
});

test("visits wanted follow the frequency and the weeks a town has", () => {
  assert.equal(visitsWanted("weekly", 3), 3);
  assert.equal(visitsWanted("biweekly", 3), 2);
  assert.equal(visitsWanted("monthly", 3), 1);
  assert.equal(visitsWanted("weekly", 0), 0);
});

test("days go to towns in order, as runs of days", () => {
  const plan = buildVisitPlan({
    sites: [site("g1", "Gaborone", "weekly"), site("f1", "Francistown", "weekly")],
    towns: [
      { town: "Francistown", days: 5 },
      { town: "gaborone", days: 10 },
    ],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  const towns = plan.days.map((d) => d.town);
  assert.deepEqual(towns.slice(0, 5), Array(5).fill("Francistown"));
  assert.deepEqual(towns.slice(5, 15), Array(10).fill("gaborone"));
  assert.equal(plan.spareDays.length, 21 - 15);
  // Francistown has one week (2 to 6 Nov): its weekly site once.
  assert.equal(plan.days.filter((d) => d.siteIds.includes("f1")).length, 1);
  // Gaborone has two weeks (9 to 20 Nov): its weekly site twice.
  assert.equal(plan.days.filter((d) => d.siteIds.includes("g1")).length, 2);
});

test("every second week and monthly sites, spread so weeks stay even", () => {
  const sites = [
    site("w", "Gaborone", "weekly"),
    site("b1", "Gaborone", "biweekly"),
    site("b2", "Gaborone", "biweekly"),
    site("m1", "Gaborone", "monthly"),
    site("m2", "Gaborone", "monthly"),
    site("m3", "Gaborone", "monthly"),
    site("m4", "Gaborone", "monthly"),
  ];
  const plan = buildVisitPlan({
    sites,
    towns: [{ town: "Gaborone", days: 20 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  const visits = (id: string) => plan.days.filter((d) => d.siteIds.includes(id)).length;
  assert.equal(visits("w"), 4);
  assert.equal(visits("b1"), 2);
  assert.equal(visits("m1"), 1);
  // The weeks stay even: monthly visits go where the month is lightest, not
  // all into the first week.
  const perWeek = [0, 0, 0, 0];
  for (const d of plan.days) perWeek[Math.floor((Number(d.date.slice(8)) - 2) / 7)] += d.siteIds.length;
  assert.ok(Math.max(...perWeek) - Math.min(...perWeek) <= 1, perWeek.join(","));
  assert.deepEqual(plan.didNotFit, []);
});

test("a full day spills to another day that week, and what can't fit is reported", () => {
  // One day in Maun, 3 weekly sites, 2 a day: one visit cannot fit.
  const plan = buildVisitPlan({
    sites: [site("a", "Maun", "weekly", -19.98), site("b", "Maun", "weekly", -19.99), site("c", "Maun", "weekly", -20.0)],
    towns: [{ town: "Maun", days: 1 }],
    workingDays: MON_FRI,
    sitesPerDay: 2,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].siteIds.length, 2);
  assert.equal(plan.didNotFit.length, 1);
  assert.equal(plan.didNotFit[0].visits, 1);
});

test("visits already on the schedule count, and fill the day's room", () => {
  const plan = buildVisitPlan({
    sites: [site("w", "Gaborone", "weekly"), site("m", "Gaborone", "monthly"), site("x", "Gaborone", "weekly")],
    towns: [{ town: "Gaborone", days: 5 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [
      { siteId: "w", date: "2026-11-03" }, // already visited that week
      { siteId: "m", date: "2026-11-25" }, // monthly already planned this month
    ],
  });
  const all = plan.days.flatMap((d) => d.siteIds);
  assert.ok(!all.includes("w"), "weekly site already has its visit that week");
  assert.ok(!all.includes("m"), "monthly site already has its visit this month");
  assert.ok(all.includes("x"));
  assert.equal(plan.days.find((d) => d.date === "2026-11-03")!.alreadyPlanned, 1);
});

test("towns given no days, towns with no sites, and towns short of days are all said", () => {
  const plan = buildVisitPlan({
    sites: [site("g", "Gaborone", "weekly"), site("k", "Kanye", "weekly"), site("n", null, "monthly")],
    towns: [
      { town: "Gaborone", days: 18 },
      { town: "Lobatse", days: 2 },
      { town: NO_TOWN, days: 5 },
    ],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  assert.deepEqual(plan.townsLeftOut, [{ town: "Kanye", sites: 1 }]);
  assert.deepEqual(plan.unknownTowns, ["Lobatse"]);
  // 21 working days: 18 + 2 leaves 1 of the 5 asked for sites with no town.
  assert.deepEqual(plan.short, [{ town: NO_TOWN, asked: 5, got: 1 }]);
  assert.ok(plan.days.some((d) => d.siteIds.includes("n")));
});

test("a week the month shares with the next is not counted as missed", () => {
  // Mon 30 Nov is the only November day of its week: 10 weekly sites, 8 a day.
  const sites = Array.from({ length: 10 }, (_, i) => site(`s${i}`, "Gaborone", "weekly"));
  const plan = buildVisitPlan({
    sites,
    towns: [{ town: "Gaborone", days: 21 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  const lastDay = plan.days.find((d) => d.date === "2026-11-30")!;
  assert.equal(lastDay.siteIds.length, 8);
  assert.equal(plan.leftForOtherMonth, 2);
  assert.deepEqual(plan.didNotFit, []);
});

test("a town given no days is reported as left out", () => {
  const plan = buildVisitPlan({
    sites: [site("g", "Gaborone", "weekly"), site("p", "Palapye", "monthly")],
    towns: [
      { town: "Gaborone", days: 10 },
      { town: "Palapye", days: 0 },
    ],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  assert.deepEqual(plan.townsLeftOut, [{ town: "Palapye", sites: 1 }]);
});

test("every second week carries on from a visit already planned", () => {
  const plan = buildVisitPlan({
    sites: [site("b", "Gaborone", "biweekly")],
    towns: [{ town: "Gaborone", days: 20 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [{ siteId: "b", date: "2026-11-10" }], // week 2
  });
  const dates = plan.days.filter((d) => d.siteIds.includes("b")).map((d) => d.date);
  // Week 4 (23 to 27 Nov), not week 1 beside the planned one.
  assert.equal(dates.length, 1);
  assert.ok(dates[0] >= "2026-11-23" && dates[0] <= "2026-11-27", dates[0]);
});

test("a visit in the other month's part of a shared week counts for that week", () => {
  // December's plan: Mon 30 Nov already had the weekly site, so the week of
  // 30 Nov to 4 Dec needs nothing more for it.
  const plan = buildVisitPlan({
    sites: [site("w", "Gaborone", "weekly")],
    towns: [{ town: "Gaborone", days: 22 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    from: "2026-12-01",
    to: "2026-12-31",
    daysOff: [],
    existing: [{ siteId: "w", date: "2026-11-30" }],
  });
  const dates = plan.days.filter((d) => d.siteIds.includes("w")).map((d) => d.date);
  assert.ok(!dates.some((d) => d <= "2026-12-04"), dates.join(","));
  assert.equal(dates.length, 4); // the weeks of 7, 14, 21 and 28 Dec
  assert.deepEqual(wholeWeeks("2026-12-01", "2026-12-31"), { from: "2026-11-30", to: "2027-01-03" });
});

test("a monthly visit is never left in a shared week, and is missed rather than passed on", () => {
  // November, Gaborone all month. The week of Mon 30 Nov is shared with December.
  const plan = buildVisitPlan({
    sites: [site("m", "Gaborone", "monthly")],
    towns: [{ town: "Gaborone", days: 21 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  const date = plan.days.find((d) => d.siteIds.includes("m"))!.date;
  assert.ok(date < "2026-11-30", date);
});

test("a plan that ends on the last worked day of its week shares no week", () => {
  // Mon 27 to Fri 31 Jul 2026: Sat 1 and Sun 2 Aug are outside but not worked.
  const sites = Array.from({ length: 10 }, (_, i) => site(`s${i}`, "Gaborone", "weekly"));
  const plan = buildVisitPlan({
    sites,
    towns: [{ town: "Gaborone", days: 1 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    from: "2026-07-27",
    to: "2026-07-31",
    daysOff: [],
    existing: [],
  });
  assert.equal(plan.leftForOtherMonth, 0, "not a shared week");
  assert.equal(plan.didNotFit.length, 2);
});

test("the month to plan: from tomorrow in this month, never a past month or one too far ahead", () => {
  assert.deepEqual(planMonth("2026-10", "2026-10-19"), { month: "2026-10", from: "2026-10-20", to: "2026-10-31", label: "October 2026" });
  assert.equal(planMonth("2026-11", "2026-10-19").from, "2026-11-01");
  assert.equal(planMonth("2026-12", "2026-10-19").to, "2026-12-31");
  assert.throws(() => planMonth("2026-09", "2026-10-19"), /over/);
  assert.throws(() => planMonth("2026-10", "2026-10-31"), /over/);
  assert.throws(() => planMonth("2027-01", "2026-10-19"), /three months/);
  assert.throws(() => planMonth("2026-13", "2026-10-19"), /YYYY-MM/);
  assert.throws(() => planMonth("November", "2026-10-19"), /YYYY-MM/);
});

const STAFF = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";

test("saving a plan: read as if typed by hand", () => {
  const ok = readPlanSave(
    {
      staffId: STAFF,
      days: [
        { date: "2026-10-19", siteIds: [S1] }, // today: started, skipped
        { date: "2026-10-20", siteIds: [S1, S1] }, // duplicate ids folded
      ],
    },
    "2026-10-19"
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.save.pastDays, 1);
    assert.deepEqual(ok.save.days, [{ date: "2026-10-20", siteIds: [S1] }]);
  }
  const bad = (body: unknown) => readPlanSave(body, "2026-10-19").ok;
  assert.equal(bad(null), false);
  assert.equal(bad({ staffId: "not-an-id", days: [{ date: "2026-10-20", siteIds: [S1] }] }), false);
  assert.equal(bad({ staffId: STAFF, days: [] }), false);
  assert.equal(bad({ staffId: STAFF, days: [{ date: "2026-10-20", siteIds: ["x"] }] }), false);
  assert.equal(bad({ staffId: STAFF, days: [{ date: "2027-03-01", siteIds: [S1] }] }), false, "too far ahead");
  assert.equal(bad({ staffId: STAFF, days: [{ date: "2026-10-20", siteIds: Array(51).fill(S1) }] }), false);
  assert.equal(bad({ staffId: STAFF, days: Array(32).fill({ date: "2026-10-20", siteIds: [S1] }) }), false);
  const allPast = readPlanSave({ staffId: STAFF, days: [{ date: "2026-10-18", siteIds: [S1] }] }, "2026-10-19");
  assert.ok(!allPast.ok && /passed/.test(allPast.error));
});

// Two parts of a town 10 km apart, five stores each, two days a week.
const NORTH = Array.from({ length: 5 }, (_, i) => ({ ...site(`n${i}`, "Gaborone", "weekly"), lat: -24.55 + i * 0.002, lng: 25.92 }));
const SOUTH = Array.from({ length: 5 }, (_, i) => ({ ...site(`s${i}`, "Gaborone", "weekly"), lat: -24.7 + i * 0.002, lng: 25.92 }));

test("a day is one part of town, and the same part falls on the same day each week", () => {
  const plan = buildVisitPlan({
    sites: [...SOUTH, ...NORTH].sort(() => 0),
    towns: [{ town: "Gaborone", days: 21 }],
    workingDays: [1, 3], // Mondays and Wednesdays
    sitesPerDay: 8,
    // Four whole weeks: a week shared with December folds its areas together.
    from: "2026-11-02",
    to: "2026-11-29",
    daysOff: [],
    existing: [],
  });
  for (const d of plan.days) {
    const parts = new Set(d.siteIds.map((id) => id[0]));
    assert.equal(parts.size, 1, `${d.date} mixes both parts of town: ${d.siteIds.join(",")}`);
  }
  const mondays = new Set(plan.days.filter((d) => isoWeekday(d.date) === 1).map((d) => d.siteIds[0][0]));
  assert.equal(mondays.size, 1, "Mondays are always the same part of town");
});

test("a full day keeps its nearest stores and sends the rest to the nearest day with room", () => {
  // One far store in the north crowds a 5-a-day limit; it should join the north day.
  const plan = buildVisitPlan({
    sites: [...NORTH, ...SOUTH, { ...site("n9", "Gaborone", "weekly"), lat: -24.56, lng: 25.93 }],
    towns: [{ town: "Gaborone", days: 3 }],
    workingDays: MON_FRI,
    sitesPerDay: 5,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  for (const d of plan.days) {
    if (d.siteIds.length === 0) continue;
    const parts = new Set(d.siteIds.map((id) => id[0]));
    assert.equal(parts.size, 1, `${d.date}: ${d.siteIds.join(",")}`);
  }
  assert.deepEqual(plan.didNotFit, []);
});

test("a day's stores are in driving order", () => {
  // Five stores in a line, given out of order: the day visits them end to end.
  const line = [3, 0, 4, 1, 2].map((i) => ({ ...site(`l${i}`, "Gaborone", "weekly"), lat: -24.6, lng: 25.9 + i * 0.01 }));
  const plan = buildVisitPlan({
    sites: line,
    towns: [{ town: "Gaborone", days: 1 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  const order = plan.days[0].siteIds.join(",");
  assert.ok(order === "l0,l1,l2,l3,l4" || order === "l4,l3,l2,l1,l0", order);
});

test("areas are numbered so neighbours are next to each other", () => {
  // Three clusters west to east; whichever end it starts from, the middle is area 1.
  const west = Array.from({ length: 3 }, (_, i) => ({ ...site(`w${i}`, "T", "weekly"), lat: -24.6, lng: 25.0 + i * 0.001 }));
  const mid = Array.from({ length: 3 }, (_, i) => ({ ...site(`m${i}`, "T", "weekly"), lat: -24.6, lng: 25.5 + i * 0.001 }));
  const east = Array.from({ length: 3 }, (_, i) => ({ ...site(`e${i}`, "T", "weekly"), lat: -24.6, lng: 26.0 + i * 0.001 }));
  const areas = townAreas([...east, ...west, ...mid], 3);
  assert.equal(areas.get("m0"), 1);
  assert.notEqual(areas.get("w0"), areas.get("e0"));
});

test("a store whose map location is far from its town is planned as if it had none, and named", () => {
  // Real case: a Mochudi store whose location was set in Maun, 564 km away.
  const mochudi = [
    { ...site("a", "Mochudi", "weekly"), lat: -24.394, lng: 26.145 },
    { ...site("b", "Mochudi", "weekly"), lat: -24.399, lng: 26.148 },
    { ...site("c", "Mochudi", "weekly"), lat: -24.409, lng: 26.17 },
    { ...site("wrong", "Mochudi", "weekly"), lat: -19.992, lng: 23.422 },
  ];
  assert.deepEqual([...sitesFarFromTown(mochudi).keys()], ["wrong"]);
  const plan = buildVisitPlan({
    sites: mochudi,
    towns: [{ town: "Mochudi", days: 2 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  assert.equal(plan.farFromTown.length, 1);
  assert.equal(plan.farFromTown[0].name, "Site wrong");
  assert.ok(plan.farFromTown[0].km > 500);
  // It is still visited, just not given a day of its own across the country.
  assert.ok(plan.days.some((d) => d.siteIds.includes("wrong")));
  assert.ok(plan.days.every((d) => d.siteIds.length > 0), "no day spent on it alone");
});

test("stores with no map location are planned and named", () => {
  const plan = buildVisitPlan({
    sites: [site("x", "Gaborone", "weekly"), { ...site("y", "Gaborone", "weekly"), lat: -24.6, lng: 25.9 }],
    towns: [{ town: "Gaborone", days: 5 }],
    workingDays: MON_FRI,
    sitesPerDay: 8,
    ...NOV,
    daysOff: [],
    existing: [],
  });
  assert.deepEqual(plan.noLocation.map((n) => n.siteId), ["x"]);
});
