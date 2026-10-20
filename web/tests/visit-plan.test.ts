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
  // And each monthly store in a different week, not two in the quietest one.
  const weekOfVisit = ["m1", "m2", "m3", "m4"].map((id) => Math.floor((Number(plan.days.find((d) => d.siteIds.includes(id))!.date.slice(8)) - 2) / 7));
  assert.equal(new Set(weekOfVisit).size, 4, weekOfVisit.join(","));
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

/** A line of stores along one road, 1 km apart, west to east: a(0)..e(4) unless names say otherwise. */
const onRoad = (names: string[], town = "Gaborone", frequency: PlanSite["frequency"] = "weekly") =>
  names.map((id, i) => ({ ...site(id, town, frequency), lat: -24.6, lng: 25.9 + i * 0.01 }));

const plainNov = { workingDays: MON_FRI, sitesPerDay: 8, ...NOV, daysOff: [] as string[], existing: [] };
const dayOf = (plan: ReturnType<typeof buildVisitPlan>, id: string) => plan.days.filter((d) => d.siteIds.includes(id)).map((d) => d.date);

test("a day is one part of town, and each weekly store keeps its weekday though the weeks differ", () => {
  // Every second week and monthly stores make each week's load different;
  // the parts of town must still keep their weekdays.
  const extra = [
    { ...site("nb", "Gaborone", "biweekly"), lat: -24.551, lng: 25.921 },
    { ...site("sm", "Gaborone", "monthly"), lat: -24.701, lng: 25.921 },
  ];
  const plan = buildVisitPlan({
    sites: [...SOUTH, ...NORTH, ...extra],
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
  for (const s of [...NORTH, ...SOUTH]) {
    const weekdays = new Set(dayOf(plan, s.id).map(isoWeekday));
    assert.equal(weekdays.size, 1, `${s.id} moves between weekdays`);
  }
});

test("a full day moves the store on its edge to the day next door, not one across town", () => {
  // West, middle and east parts, one a weekday (Mon-Wed), 3 a day. One stop is
  // already on the west part's day, so one of its 3 stores must move: the one
  // nearest the middle part (w2) goes to the middle part's day, not the east's.
  const west = [
    { ...site("w0", "T", "weekly"), lat: -24.6, lng: 25.78 },
    { ...site("w1", "T", "weekly"), lat: -24.6, lng: 25.81 },
    { ...site("w2", "T", "weekly"), lat: -24.6, lng: 25.815 },
  ];
  const middle = onRoad(["m0", "m1"], "T").map((s, i) => ({ ...s, lng: 25.9 + i * 0.002 }));
  const east = onRoad(["e0", "e1"], "T").map((s, i) => ({ ...s, lng: 26.0 + i * 0.002 }));
  const sites = [...west, ...middle, ...east];
  const westWeekday = townAreas(sites, 3).get("w1")! + 1;
  const westDay = ["2026-11-02", "2026-11-03", "2026-11-04"][westWeekday - 1];
  const plan = buildVisitPlan({
    sites,
    towns: [{ town: "T", days: 3 }],
    workingDays: [1, 2, 3],
    sitesPerDay: 3,
    from: "2026-11-02",
    to: "2026-11-04",
    daysOff: [],
    existing: [{ siteId: "elsewhere", date: westDay }],
  });
  const day = (date: string) => plan.days.find((d) => d.date === date)!.siteIds;
  assert.deepEqual([...day(westDay)].sort(), ["w0", "w1"]);
  const w2Day = dayOf(plan, "w2")[0];
  assert.ok(day(w2Day).some((id) => id.startsWith("m")), `w2 went to ${w2Day} with ${day(w2Day).join(",")}`);
  assert.deepEqual(plan.didNotFit, []);
});

test("a store with no location gives way on a full day, not a neighbour", () => {
  // Five parts of four stores, 4 a day, plus one store with no location: every
  // located store keeps its part's day, and the unlocated one goes where there is room.
  const parts = [0, 1, 2, 3, 4].flatMap((p) =>
    [0, 1, 2, 3].map((i) => ({ ...site(`p${p}_${i}`, "T", "weekly"), lat: -24.6, lng: 25.9 + p * 0.05 + i * 0.001 }))
  );
  const plan = buildVisitPlan({ ...plainNov, sitesPerDay: 5, sites: [...parts, site("u", "T", "weekly")], towns: [{ town: "T", days: 20 }], to: "2026-11-27" });
  for (const p of [0, 1, 2, 3, 4]) {
    const days = new Set(parts.filter((s) => s.id.startsWith(`p${p}_`)).flatMap((s) => dayOf(plan, s.id).map(isoWeekday)));
    assert.equal(days.size, 1, `part ${p} split across ${[...days].join("/")}`);
  }
  assert.deepEqual(plan.didNotFit, []);
});

test("a weekly store keeps its weekday when every-second-week and monthly stores join its day", () => {
  // West: 8 weekly along a street plus one every-second-week and one monthly in
  // the middle of them; east: 4 weekly 10 km away. Mon/Tue, 8 a day.
  const west = onRoad(["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"]).map((s, i) => ({ ...s, lng: 25.9 + i * 0.002 }));
  const wb = { ...site("wb", "Gaborone", "biweekly"), lat: -24.6, lng: 25.907 };
  const wm = { ...site("wm", "Gaborone", "monthly"), lat: -24.6, lng: 25.906 };
  const east = onRoad(["e0", "e1", "e2", "e3"]).map((s, i) => ({ ...s, lng: 26.0 + i * 0.002 }));
  const plan = buildVisitPlan({
    sites: [...west, wb, wm, ...east],
    towns: [{ town: "Gaborone", days: 8 }],
    workingDays: [1, 2],
    sitesPerDay: 8,
    from: "2026-11-02",
    to: "2026-11-29",
    daysOff: [],
    existing: [],
  });
  for (const s of [...west, ...east]) {
    assert.equal(new Set(dayOf(plan, s.id).map(isoWeekday)).size, 1, `${s.id} moves between weekdays`);
  }
});

test("a day's stores are in driving order, end to end, whatever their names", () => {
  // Names sorted alphabetically do not follow the road: 'a' is in the middle.
  const line = onRoad(["c", "e", "a", "d", "b"]);
  const plan = buildVisitPlan({ ...plainNov, sites: line, towns: [{ town: "Gaborone", days: 1 }] });
  const order = plan.days[0].siteIds.join(",");
  assert.ok(order === "c,e,a,d,b" || order === "b,d,a,e,c", order);
});

test("new visits carry on from the last stop already on that day", () => {
  // A stop is already at the east end of the road on Mon 2 Nov: the new visits
  // start next to it and work west, rather than starting at the west end.
  const line = onRoad(["r0", "r1", "r2", "r3", "r4"]);
  const plan = buildVisitPlan({
    ...plainNov,
    sites: line,
    towns: [{ town: "Gaborone", days: 1 }],
    existing: [{ siteId: "x", date: "2026-11-02", lat: -24.6, lng: 25.96, sequence: 1 }],
  });
  assert.equal(plan.days[0].siteIds.join(","), "r4,r3,r2,r1,r0");
});

test("without a stop on the day, the route starts where the person usually starts", () => {
  const line = onRoad(["r0", "r1", "r2", "r3", "r4"]);
  const plan = buildVisitPlan({ ...plainNov, sites: line, towns: [{ town: "Gaborone", days: 1 }], start: { lat: -24.6, lng: 25.85 } });
  assert.equal(plan.days[0].siteIds.join(","), "r0,r1,r2,r3,r4");
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

test("one store a little way out does not get a weekday to itself", () => {
  // 16 stores close together and one 12 km out, Mon/Tue, 20 a day: before, the
  // outlier had Monday alone every week and Tuesday took 16. Now the store
  // joins neighbours from the edge of the group nearest it.
  const centre = Array.from({ length: 16 }, (_, i) => ({ ...site(`c${i}`, "T", "weekly"), lat: -24.6 + (i % 4) * 0.003, lng: 25.9 + Math.floor(i / 4) * 0.003 }));
  const out = { ...site("out", "T", "weekly"), lat: -24.49, lng: 25.9 };
  const plan = buildVisitPlan({ ...plainNov, sitesPerDay: 20, workingDays: [1, 2], sites: [...centre, out], towns: [{ town: "T", days: 9 }] });
  for (const d of plan.days.filter((d) => d.date < "2026-11-30")) {
    assert.ok(d.siteIds.length >= 5, `${d.date}: only ${d.siteIds.length}`);
  }
});

test("every second week stores share the weeks out when the days tie", () => {
  // East (Mon): 3 weekly + 1 every second week; west (Tue): 4 weekly + 1 every
  // second week; 4 a day, four whole weeks. Everything fits.
  const east = onRoad(["a1", "a2", "a3"]).map((s, i) => ({ ...s, lng: 26.0 + i * 0.002 }));
  const ab = { ...site("ab", "Gaborone", "biweekly"), lat: -24.6, lng: 26.001 };
  const west = onRoad(["b1", "b2", "b3", "b4"]).map((s, i) => ({ ...s, lng: 25.9 + i * 0.002 }));
  const bb = { ...site("bb", "Gaborone", "biweekly"), lat: -24.6, lng: 25.901 };
  const plan = buildVisitPlan({
    sites: [...east, ab, ...west, bb],
    towns: [{ town: "Gaborone", days: 8 }],
    workingDays: [1, 2],
    sitesPerDay: 4,
    from: "2026-11-02",
    to: "2026-11-27",
    daysOff: [],
    existing: [],
  });
  assert.deepEqual(plan.didNotFit, []);
});

test("a monthly store goes to the week with room, not into a full one", () => {
  // Mon/Tue, 2 a day. a1,a2 on one day; b1,b2 and monthly m on the other.
  // a1 and a2 already have a visit in the week of 9 Nov, and Tue 10 Nov has
  // another stop: the week of 9 Nov has room, so nothing is left out.
  const a = onRoad(["a1", "a2"]).map((s, i) => ({ ...s, lng: 26.0 + i * 0.002 }));
  const b = onRoad(["b1", "b2"]).map((s, i) => ({ ...s, lng: 25.9 + i * 0.002 }));
  const m = { ...site("m", "Gaborone", "monthly"), lat: -24.6, lng: 25.901 };
  const plan = buildVisitPlan({
    sites: [...a, ...b, m],
    towns: [{ town: "Gaborone", days: 8 }],
    workingDays: [1, 2],
    sitesPerDay: 2,
    from: "2026-11-02",
    to: "2026-11-27",
    daysOff: [],
    existing: [
      { siteId: "a1", date: "2026-11-14" },
      { siteId: "a2", date: "2026-11-14" },
      { siteId: "other", date: "2026-11-10" },
    ],
  });
  assert.deepEqual(plan.didNotFit, []);
});

test("a short week shares the areas out over its own days: no working day left empty", () => {
  // T's run starts on a Wednesday: Wed-Fri, then Mon-Wed. Every one of its days gets work.
  const parts = [0, 1, 2].flatMap((p) =>
    [0, 1, 2, 3].map((i) => ({ ...site(`t${p}_${i}`, "T", "weekly"), lat: -24.6, lng: 25.9 + p * 0.05 + i * 0.001 }))
  );
  const plan = buildVisitPlan({
    ...plainNov,
    sitesPerDay: 20,
    sites: [...parts, site("a", "A", "weekly")],
    towns: [{ town: "A", days: 2 }, { town: "T", days: 6 }],
  });
  for (const d of plan.days.filter((d) => d.town === "T")) assert.ok(d.siteIds.length > 0, `${d.date} is empty`);
});

test("a two-day week keeps each end of town together", () => {
  // Five parts west to east; the town's last week is Mon-Tue only.
  const parts = [0, 1, 2, 3, 4].flatMap((p) =>
    [0, 1, 2].map((i) => ({ ...site(`p${p}_${i}`, "T", "weekly"), lat: -24.6, lng: 25.9 + p * 0.05 + i * 0.001 }))
  );
  const plan = buildVisitPlan({ ...plainNov, sites: parts, towns: [{ town: "T", days: 7 }] });
  for (const date of ["2026-11-09", "2026-11-10"]) {
    const ids = plan.days.find((d) => d.date === date)!.siteIds;
    assert.ok(!(ids.some((id) => id.startsWith("p0")) && ids.some((id) => id.startsWith("p4"))), `${date} has both ends: ${ids.join(",")}`);
  }
});

test("a part of town fully on the schedule already does not hold a weekday", () => {
  // East's 4 weekly stores are on the schedule every Tuesday already; west's 4
  // still need planning. Monday is not left empty for the east part.
  const east = onRoad(["e0", "e1", "e2", "e3"]).map((s, i) => ({ ...s, lng: 26.1 + i * 0.002 }));
  const west = onRoad(["w0", "w1", "w2", "w3"]).map((s, i) => ({ ...s, lng: 25.9 + i * 0.002 }));
  const tuesdays = ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"];
  const plan = buildVisitPlan({
    sites: [...east, ...west],
    towns: [{ town: "Gaborone", days: 8 }],
    workingDays: [1, 2],
    sitesPerDay: 8,
    from: "2026-11-02",
    to: "2026-11-27",
    daysOff: [],
    existing: tuesdays.flatMap((date) => east.map((s, i) => ({ siteId: s.id, date, lat: s.lat, lng: s.lng, sequence: i }))),
  });
  for (const d of plan.days.filter((d) => isoWeekday(d.date) === 1)) assert.ok(d.siteIds.length > 0, `${d.date} empty`);
  assert.ok(plan.days.every((d) => !d.siteIds.some((id) => id.startsWith("e"))), "east was not planned again");
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
  const plan = buildVisitPlan({ ...plainNov, sites: mochudi, towns: [{ town: "Mochudi", days: 2 }] });
  assert.equal(plan.farFromTown.length, 1);
  assert.equal(plan.farFromTown[0].name, "Site wrong");
  assert.ok(plan.farFromTown[0].km > 500);
  // Named once, as far, not again as having no location.
  assert.deepEqual(plan.noLocation, []);
  // Still visited, and never on a day of its own.
  for (const d of plan.days.filter((d) => d.siteIds.includes("wrong"))) {
    assert.ok(d.siteIds.some((id) => id !== "wrong"), `${d.date} is spent on the far store alone`);
  }
});

test("only a location that is really out of place is doubted", () => {
  const at = (id: string, town: string | null, lat: number, lng: number, trusted = false) => ({ ...site(id, town, "weekly"), lat, lng, trusted });
  // No town: nothing to be far from.
  const noTown = [at("g1", null, -24.6, 25.9), at("g2", null, -24.61, 25.91), at("g3", null, -24.62, 25.92), at("f1", null, -21.17, 27.51)];
  assert.equal(sitesFarFromTown(noTown).size, 0);
  // An even split has no middle worth trusting.
  const split = [at("a", "Mochudi", -24.39, 26.14), at("b", "Mochudi", -24.4, 26.15), at("x", "Mochudi", -19.99, 23.42), at("y", "Mochudi", -20.0, 23.43)];
  assert.equal(sitesFarFromTown(split).size, 0);
  // A big town's edge (Atlantis, 40 km from the middle of Cape Town) is not doubted.
  const capeTown = [at("c1", "Cape Town", -33.92, 18.42), at("c2", "Cape Town", -33.93, 18.43), at("c3", "Cape Town", -33.94, 18.44), at("atlantis", "Cape Town", -33.57, 18.49)];
  assert.equal(sitesFarFromTown(capeTown).size, 0);
  // A location a person confirmed is never doubted, and sets the middle.
  const confirmed = [at("ok", "Mochudi", -24.39, 26.14, true), at("p", "Mochudi", -19.99, 23.42), at("q", "Mochudi", -19.99, 23.42), at("r", "Mochudi", -20.0, 23.43)];
  assert.deepEqual([...sitesFarFromTown(confirmed).keys()].sort(), ["p", "q", "r"]);
  // Two stores sharing one wrong pin count once, so they cannot outvote the right one.
  const collapsed = [at("right", "Mochudi", -24.39, 26.14), at("w1", "Mochudi", -19.99, 23.42), at("w2", "Mochudi", -19.99, 23.42)];
  assert.ok(!sitesFarFromTown(collapsed).has("right"));
  // With the company's other stores in the town, one rep's two stores are judged properly.
  const repStores = [at("mine", "Mochudi", -24.39, 26.14), at("mine-wrong", "Mochudi", -19.99, 23.42)];
  const company = [at("o1", "Mochudi", -24.4, 26.15), at("o2", "Mochudi", -24.41, 26.16)];
  assert.deepEqual([...sitesFarFromTown(repStores, company).keys()], ["mine-wrong"]);
});

test("stores with no map location are planned and named", () => {
  const plan = buildVisitPlan({
    ...plainNov,
    sites: [site("x", "Gaborone", "weekly"), { ...site("y", "Gaborone", "weekly"), lat: -24.6, lng: 25.9 }],
    towns: [{ town: "Gaborone", days: 5 }],
  });
  assert.deepEqual(plan.noLocation.map((n) => n.siteId), ["x"]);
});

test("a town with days in fewer weeks than the month is said", () => {
  const plan = buildVisitPlan({
    ...plainNov,
    sites: [site("g", "Gaborone", "weekly"), site("m", "Mogoditshane", "weekly")],
    towns: [{ town: "Gaborone", days: 18 }, { town: "Mogoditshane", days: 3 }],
  });
  // Mogoditshane has the week of 23 Nov and Mon 30 Nov (a week shared with
  // December): one of November's four whole weeks.
  assert.deepEqual(plan.fewerWeeks, [{ town: "Mogoditshane", weeks: 1, of: 4 }]);
});

test("a day off moves only that day's area, the rest keep their weekdays", () => {
  // Five parts of a town, one a weekday; Wed 11 Nov is off.
  const parts = [0, 1, 2, 3, 4].flatMap((p) =>
    // Parts 5 km apart: one town, not five.
    [0, 1].map((i) => ({ ...site(`p${p}_${i}`, "Gaborone", "weekly"), lat: -24.6, lng: 25.9 + p * 0.05 + i * 0.001 }))
  );
  const plan = buildVisitPlan({
    ...plainNov,
    sites: parts,
    towns: [{ town: "Gaborone", days: 19 }],
    from: "2026-11-02",
    to: "2026-11-27",
    daysOff: ["2026-11-11"],
  });
  const weekdayOf = (prefix: string) =>
    plan.days.filter((d) => d.siteIds.some((id) => id.startsWith(prefix))).map((d) => isoWeekday(d.date));
  // Every part other than Wednesday's is on one weekday all month.
  const sets = ["p0", "p1", "p2", "p3", "p4"].map((p) => new Set(weekdayOf(p)));
  assert.equal(sets.filter((x) => x.size === 1).length, 4, sets.map((x) => [...x].join("/")).join(" "));
});
