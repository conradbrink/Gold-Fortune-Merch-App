// The month plan Ask drafts for one person. Plain rules, no AI, so these pin
// them: days go to towns in the order asked; each site gets the visits its
// frequency wants in the weeks its town has days; a full day spills to another
// day that week or is reported; nothing already planned is planned twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVisitPlan, visitsWanted, workingDates, NO_TOWN, type PlanSite } from "@/lib/visit-plan";

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
  // Four monthly sites across four weeks: one a week, not all in the first.
  const weekOfVisit = ["m1", "m2", "m3", "m4"].map((id) => plan.days.find((d) => d.siteIds.includes(id))!.date);
  assert.equal(new Set(weekOfVisit.map((d) => d.slice(0, 8) + String(Math.floor((Number(d.slice(8)) - 2) / 7)))).size, 4);
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
