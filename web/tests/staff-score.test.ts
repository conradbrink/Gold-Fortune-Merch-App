// The staff score per trade (Stage 7 Part 4b): weights as data, one engine,
// the research's fairness rules. The database side is supabase/tests/score.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_EVENTS,
  SCORE_PARTS,
  findPart,
  parseWeights,
  teamScorable,
  teamScores,
  teamValues,
  weighScore,
  weightsSetting,
  weightsTotal,
  type StaffScoreInputs,
} from "@/lib/staff-score";
import { computeScore, type RepStore, type RepSummary } from "@/lib/rep-report";
import { DEFAULT_TERMS } from "@/lib/terms";

const t = DEFAULT_TERMS;

/** The weights the migration seeds, read from the migration itself so the two cannot drift. */
function seededWeights(): Record<string, string> {
  const sql = readFileSync(join(process.cwd(), "../supabase/migrations/20261009130000_staff_score_per_trade.sql"), "utf8");
  const block = sql.slice(sql.indexOf("'staff_score_weights', to_jsonb(v.weights)"), sql.indexOf("as v(template_code, weights)"));
  return Object.fromEntries([...block.matchAll(/\('([a-z_]+)', '([a-z_:0-9,]+)'\)/g)].map((m) => [m[1], m[2]]));
}

test("every trade's weights add up to 100 and name only known parts, each once", () => {
  const seeds = seededWeights();
  assert.equal(Object.keys(seeds).length, 11);
  for (const [trade, setting] of Object.entries(seeds)) {
    const parsed = parseWeights(setting);
    assert.equal(weightsSetting(parsed), setting, `${trade} names an unknown or repeated part`);
    assert.equal(weightsTotal(parsed), 100, `${trade} adds up to ${weightsTotal(parsed)}`);
  }
});

test("Gold Fortune keeps today's weights, which the Staff tab cannot score team-wide", () => {
  const gf = seededWeights().distribution;
  assert.equal(gf, "sales:35,visits:25,coverage:15,merchandising:15,compliance:10");
  assert.equal(teamScorable(parseWeights(gf)), false);
  for (const trade of ["cleaning", "garden", "plumbing", "security", "pool", "delivery", "generic"]) {
    assert.equal(teamScorable(parseWeights(seededWeights()[trade])), true, trade);
  }
});

test("no part measured today rewards reporting less", () => {
  // Research: "No component may reward reporting less: incidents, defects and
  // failure reasons." A part that counts incidents or defects must never be
  // measured; driver_failures waits for reasons recorded by the office (B3).
  for (const p of SCORE_PARTS.filter((x) => x.measure)) {
    assert.doesNotMatch(`${p.code} ${p.label(t)}`, /incident|defect|failure|complaint/i, p.code);
  }
});

test("a part is either measured, a stand-in, or says what would measure it", () => {
  for (const p of SCORE_PARTS) {
    assert.ok(p.measure || p.needs || p.reportOnly, p.code);
    if (p.standIn) assert.ok(p.measure, p.code);
  }
});

const row = (o: Partial<StaffScoreInputs>): StaffScoreInputs => ({
  staff_id: "a",
  staff_name: "Thandi",
  planned: 20,
  served: 18,
  leave_planned: 0,
  leave_served: 0,
  sites_planned: 8,
  sites_reached: 8,
  finished: 18,
  proven: 9,
  with_form: 12,
  rounds_proven: 10,
  with_fix: 16,
  inside: 12,
  onsite_seconds: 4 * 3600,
  workday_seconds: 8 * 3600,
  workdays: 6,
  staff_days: 6,
  ...o,
});

test("leave days leave completion: planned and done on them are both taken out", () => {
  const v = teamValues(row({ planned: 20, served: 15, leave_planned: 4, leave_served: 1 }), [], t);
  assert.equal(v.completion.value, (14 / 16) * 100);
  assert.equal(v.completion.events, 16);
  assert.match(v.completion.basis, /4 on approved leave left out/);
});

test("a part under five events is not enough data, and its weight goes to the rest", () => {
  const r = weighScore(parseWeights("completion:50,proof:50"), teamValues(row({ finished: 4, proven: 4 }), [], t), t);
  const proof = r.components.find((c) => c.key === "proof")!;
  assert.equal(proof.state, "not_enough");
  assert.equal(proof.basis, `Not enough data: 4 of ${MIN_EVENTS} needed`);
  assert.equal(r.components.find((c) => c.key === "completion")!.effectiveWeight, 100);
  assert.equal(r.score, 90);
});

test("a part nothing measures yet sits out and says what it needs", () => {
  const r = weighScore(parseWeights("completion:60,punctuality:40"), teamValues(row({}), [], t), t);
  const p = r.components.find((c) => c.key === "punctuality")!;
  assert.equal(p.state, "not_measured");
  assert.equal(p.basis, findPart("punctuality")!.needs);
  assert.equal(r.reweighted, true);
  assert.equal(r.score, 90);
});

test("no GPS fix is unknown: check-ins without one are left out, not failed", () => {
  const v = teamValues(row({ with_fix: 10, inside: 10 }), [], t);
  assert.equal(v.gps_verified.value, 100);
  assert.equal(v.gps_verified.events, 10);
});

test("speed is compared with the team's middle person and capped at 100", () => {
  const team = [
    row({ staff_id: "a", finished: 12, staff_days: 6 }), // 2 a day
    row({ staff_id: "b", finished: 24, staff_days: 6 }), // 4 a day
    row({ staff_id: "c", finished: 18, staff_days: 6 }), // 3 a day: the middle
  ];
  assert.equal(Math.round(teamValues(team[0], team, t).jobs_per_day.value!), 67);
  assert.equal(teamValues(team[1], team, t).jobs_per_day.value, 100);
  assert.equal(teamValues(team[2], team, t).jobs_per_day.value, 100);
});

test("stand-ins say what they measure for now", () => {
  const r = weighScore(parseWeights("handover:100"), teamValues(row({}), [], t), t);
  assert.match(r.components[0].basis, /For now: a photo and a checklist/);
  assert.equal(r.score, 50);
});

test("work on this next is the part losing the most points", () => {
  const r = weighScore(parseWeights("completion:50,proof:30,gps_verified:20"), teamValues(row({}), [], t), t);
  // completion 90% x 50 loses 5, proof 50% x 30 loses 15, gps 75% x 20 loses 5.
  assert.equal(r.focus?.key, "proof");
});

test("the team is scored best first, with no score last", () => {
  const team = [row({ staff_id: "a", staff_name: "Low", served: 10 }), row({ staff_id: "b", staff_name: "High" }), row({ staff_id: "c", staff_name: "None", planned: 0, served: 0, finished: 0, proven: 0, with_fix: 0, inside: 0, with_form: 0 })];
  const s = teamScores(team, parseWeights("completion:100"), t);
  assert.deepEqual(s.map((x) => x.name), ["High", "Low", "None"]);
  assert.equal(s[2].result.score, null);
});

// Gold Fortune's employee report: the same score as before, apart from leave.
const summary: RepSummary = {
  repId: "r1", repName: "Atang", territories: null, storesAssigned: 12, plannedVisits: 40, completedPlanned: 30,
  missedVisits: 10, storesPlanned: 10, storesVisited: 9, completedVisits: 34, unplannedVisits: 4, salesNet: 0,
  salesOrders: 0, storesWithSales: 0, visitsWithOrder: 0, zeroSalesVisits: 0, daysWorked: 18,
  avgWorkdayStartSeconds: null, avgFirstCheckinSeconds: null, avgLastCheckoutSeconds: null, avgVisitSeconds: null,
  gpsChecked: 30, gpsVerifiedRate: 0.9, formComplianceRate: 0.8, photoVisitRate: null, audits: 12,
  availabilityPct: 80, planogramPct: 70, pricePct: null, conditionPct: null, avgFacings: null,
  prospectsVisited: 0, prospectsConverted: 0,
};
const stores: RepStore[] = Array.from({ length: 10 }, (_, i) => ({
  storeId: `s${i}`, storeName: `s${i}`, storeGroup: null, city: null, planned: 4, completed: i < 9 ? 3 : 0, missed: 1,
  visits: 3, salesNet: 0, salesOrders: 0, priorSalesNet: 0, oosChecked: 0, oosVisits: 0, merchChecks: 0, merchOk: 0,
  lastVisitAt: null,
}));

test("Gold Fortune's weights give today's score when nobody was on leave", () => {
  const before = computeScore(summary, stores, [], t, true);
  const gf = parseWeights(seededWeights().distribution);
  const me = row({ staff_id: "r1" });
  const after = computeScore(summary, stores, [], t, { weights: gf, team: [me], sells: true });
  assert.equal(after.score, before.score);
  assert.deepEqual(
    after.components.map((c) => [c.key, c.weight, c.value, Math.round(c.effectiveWeight * 10)]),
    before.components.map((c) => [c.key, c.weight, c.value, Math.round(c.effectiveWeight * 10)])
  );
});

test("Gold Fortune's completion leaves out planned work on approved leave", () => {
  const gf = parseWeights(seededWeights().distribution);
  const me = row({ staff_id: "r1", leave_planned: 5, leave_served: 0 });
  const after = computeScore(summary, stores, [], t, { weights: gf, team: [me], sells: true });
  const visits = after.components.find((c) => c.key === "visits")!;
  assert.equal(visits.value, (30 / 35) * 100);
  assert.match(visits.basis, /5 on approved leave left out/);
});

test("a company without a weights setting keeps the old weights", () => {
  const after = computeScore(summary, stores, [], t, { weights: [], team: [], sells: false });
  assert.deepEqual(after.components.map((c) => c.key), ["visits", "coverage", "compliance"]);
});
