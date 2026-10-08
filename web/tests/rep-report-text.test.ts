// The rep performance report in the company's words. Its sentences are built
// from the terms, and Gold Fortune's must read exactly as they did before the
// terminology system: these were copied from the report's output then.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeScore,
  managementSummary,
  storesNeedingAttention,
  type MissedVisit,
  type RepStore,
  type RepSummary,
} from "@/lib/rep-report";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  site_group: { one: "Chain", many: "Chains" },
  job: { one: "Visit", many: "Visits" },
  staff: { one: "Rep", many: "Reps" },
  client: { one: "Customer", many: "Customers" },
  region: { one: "Region", many: "Regions" },
  territory: { one: "Territory", many: "Territories" },
  prospect: { one: "Lead", many: "Leads" },
  schedule_cycle: { one: "Call cycle", many: "Call cycles" },
  day_plan: { one: "Today's route", many: "Today's routes" },
  workday: { one: "Workday", many: "Workdays" },
});

const summary: RepSummary = {
  repId: "r1",
  repName: "Atang",
  territories: null,
  storesAssigned: 12,
  plannedVisits: 40,
  completedPlanned: 30,
  missedVisits: 10,
  storesPlanned: 10,
  storesVisited: 9,
  completedVisits: 34,
  unplannedVisits: 4,
  salesNet: 101223.5,
  salesOrders: 17,
  storesWithSales: 8,
  visitsWithOrder: 15,
  zeroSalesVisits: 19,
  daysWorked: 18,
  avgWorkdayStartSeconds: null,
  avgFirstCheckinSeconds: null,
  avgLastCheckoutSeconds: null,
  avgVisitSeconds: null,
  gpsChecked: 30,
  gpsVerifiedRate: 0.9,
  formComplianceRate: 0.8,
  photoVisitRate: null,
  audits: 12,
  availabilityPct: 80,
  planogramPct: 70,
  pricePct: null,
  conditionPct: null,
  avgFacings: null,
  prospectsVisited: 0,
  prospectsConverted: 0,
};

function store(id: string, o: Partial<RepStore> = {}): RepStore {
  return {
    storeId: id,
    storeName: id,
    storeGroup: null,
    city: null,
    planned: 4,
    completed: 3,
    missed: 1,
    visits: 3,
    salesNet: 0,
    salesOrders: 0,
    priorSalesNet: 0,
    oosChecked: 0,
    oosVisits: 0,
    merchChecks: 0,
    merchOk: 0,
    lastVisitAt: null,
    ...o,
  };
}

let seq = 0;
function miss(storeId: string, visitedAt: string | null, previousSales: number | null): MissedVisit {
  return {
    routeId: `route-${++seq}`,
    storeId,
    storeName: storeId,
    storeGroup: null,
    city: null,
    plannedDate: "2026-09-01",
    reason: null,
    visitedAt,
    lastVisitAt: null,
    previousSales,
  };
}

const stores = [
  store("A", { salesNet: 9000 }),
  store("B", { completed: 0 }),
  store("C", { oosChecked: 7, oosVisits: 7, salesNet: 50 }),
  store("D", { priorSalesNet: 10000, salesNet: 2000 }),
  store("E", { priorSalesNet: 3000, visits: 1 }),
  store("F", { merchChecks: 5, merchOk: 1, salesNet: 10 }),
  store("G", { salesNet: 700 }),
];

const missed = [
  miss("A", null, 6000),
  miss("A", null, null),
  miss("G", null, null),
  miss("B", "2026-09-03", 100),
  miss("B", null, 200),
  ...Array.from({ length: 5 }, () => miss("D", "2026-09-04", null)),
];

/** A rep with one missed round, no sales, no audits and no name. */
const quiet: RepSummary = {
  ...summary,
  repName: null,
  missedVisits: 1,
  plannedVisits: 4,
  completedPlanned: 3,
  salesNet: 0,
  availabilityPct: null,
  planogramPct: null,
  audits: 0,
  formComplianceRate: null,
  gpsVerifiedRate: null,
};
const quietMissed = [miss("B", null, 100)];

test("Gold Fortune's score breakdown reads as it always did", () => {
  const score = computeScore(summary, stores, missed, goldFortune);
  assert.deepEqual(
    score.components.map((c) => [c.label, c.basis]),
    [
      ["Sales performance", "No sales target is recorded for this rep"],
      ["Visit completion", "36 of 40 planned visits served — 30 on the day, 6 gone back to"],
      ["Store coverage", "6 of 7 planned stores reached at least once"],
      ["Merchandising execution", "Mean of the pillars measured across 12 audits"],
      ["App / data compliance", "Mean of form completion per visit and GPS-verified check-ins"],
    ]
  );
  const q = computeScore(quiet, [store("B")], quietMissed, goldFortune);
  assert.equal(q.components[1].basis, "3 of 4 planned visits completed");
  assert.equal(q.components[2].basis, "1 of 1 planned stores reached at least once");
});

test("Gold Fortune's attention reasons read as they always did", () => {
  assert.deepEqual(
    storesNeedingAttention(stores, missed, "BWP", goldFortune, 10).map((a) => a.reason),
    [
      "2 planned visits never made — P9,000.00 in recent sales",
      "Out of stock on 7 of 7 stock checks",
      "Sales down 80% on the previous period (P10,000.00 → P2,000.00)",
      "Merchandising checks passed 1 of 5",
      "1 planned visit never made — P700.00 in recent sales",
      "1 planned visit never made — P200.00 in recent sales",
      "Sales down 100% on the previous period (P3,000.00 → P0.00)",
    ]
  );
});

test("Gold Fortune's management summary reads as it always did", () => {
  const score = computeScore(summary, stores, missed, goldFortune);
  assert.equal(
    managementSummary(summary, score, missed, "BWP", goldFortune),
    "Atang generated P101,223.50 from 17 delivered orders and served 36 of 40 planned visits (90%), 6 of them by going back on an unscheduled visit. Merchandising compliance was 75% across 12 audits, but 10 planned visits were missed on the day, 6 of which the rep went back for — 1 store with more than P5,000 in previous sales was never returned to. The score of 85 out of 100 excludes sales performance, which this database cannot measure, and re-weights the rest."
  );

  const q = computeScore(quiet, [store("B")], quietMissed, goldFortune);
  assert.equal(
    managementSummary(quiet, q, quietMissed, "BWP", goldFortune),
    "The rep recorded no delivered sales in this period and completed 3 of 4 planned visits (75%). 1 planned visit was missed. The score of 84 out of 100 excludes sales performance, merchandising execution and app / data compliance, which this database cannot measure, and re-weights the rest."
  );

  const idle = { ...quiet, plannedVisits: 0, missedVisits: 0, completedPlanned: 0 };
  assert.equal(
    managementSummary(idle, computeScore(idle, [], [], goldFortune), [], "BWP", goldFortune),
    "The rep recorded no delivered sales in this period and had no visits planned in this period."
  );

  const twoShops = [miss("A", null, 6000), miss("G", null, 7000)];
  const two = { ...summary, missedVisits: 2, availabilityPct: null, planogramPct: null };
  assert.equal(
    managementSummary(two, computeScore(two, stores, twoShops, goldFortune), twoShops, "BWP", goldFortune),
    "Atang generated P101,223.50 from 17 delivered orders and completed 30 of 40 planned visits (75%). 2 planned visits were missed — 2 stores with more than P5,000 in previous sales were never returned to. The score of 80 out of 100 excludes sales performance and merchandising execution, which this database cannot measure, and re-weights the rest."
  );
});

test("the neutral words reach every sentence", () => {
  const t = DEFAULT_TERMS;
  const score = computeScore(summary, stores, missed, t);
  assert.deepEqual(
    score.components.map((c) => [c.label, c.basis]),
    [
      ["Sales performance", "No sales target is recorded for this staff member"],
      ["Job completion", "36 of 40 planned jobs served — 30 on the day, 6 gone back to"],
      ["Site coverage", "6 of 7 planned sites reached at least once"],
      ["Merchandising execution", "Mean of the pillars measured across 12 audits"],
      ["App / data compliance", "Mean of form completion per job and GPS-verified check-ins"],
    ]
  );
  const reasons = storesNeedingAttention(stores, missed, "BWP", t, 10).map((a) => a.reason);
  assert.equal(reasons[0], "2 planned jobs never made — P9,000.00 in recent sales");
  assert.equal(reasons[4], "1 planned job never made — P700.00 in recent sales");
  assert.equal(
    managementSummary(summary, score, missed, "BWP", t),
    "Atang generated P101,223.50 from 17 delivered orders and served 36 of 40 planned jobs (90%), 6 of them by going back on an unscheduled job. Merchandising compliance was 75% across 12 audits, but 10 planned jobs were missed on the day, 6 of which the staff member went back for — 1 site with more than P5,000 in previous sales was never returned to. The score of 85 out of 100 excludes sales performance, which this database cannot measure, and re-weights the rest."
  );
  const q = computeScore(quiet, [store("B")], quietMissed, t);
  assert.equal(
    managementSummary(quiet, q, quietMissed, "BWP", t),
    "The staff member recorded no delivered sales in this period and completed 3 of 4 planned jobs (75%). 1 planned job was missed. The score of 84 out of 100 excludes sales performance, merchandising execution and app / data compliance, which this database cannot measure, and re-weights the rest."
  );
});

test("a dropped component keeps a company's acronym in the summary", () => {
  const t = { ...DEFAULT_TERMS, job: { one: "POS check", many: "POS checks", article: null } };
  // Nothing planned, so completion is dropped; coverage still measures.
  const none = { ...quiet, plannedVisits: 0, missedVisits: 0, completedPlanned: 0 };
  const score = computeScore(none, [store("B")], [], t);
  const text = managementSummary(none, score, [], "BWP", t);
  assert.match(text, /had no POS checks planned/);
  assert.match(text, /excludes sales performance, POS check completion, merchandising execution/);
});

test("a company that does not sell is scored without sales or merchandising, and the summary never mentions them", () => {
  const score = computeScore(summary, stores, missed, goldFortune, false);
  const keys = score.components.map((c) => c.key);
  assert.ok(!keys.includes("sales") && !keys.includes("merchandising"), keys.join(","));
  assert.deepEqual(keys, ["visits", "coverage", "compliance"]);
  const text = managementSummary(summary, score, missed, "ZAR", goldFortune, false);
  assert.ok(!/sales|merchandising/i.test(text), text);
  // Without the sales clause the sentence still has its subject.
  assert.ok(text.startsWith(summary.repName ?? "The"), text);
});
