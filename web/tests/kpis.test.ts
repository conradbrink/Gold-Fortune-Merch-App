// The dashboard's numbers (Stage 7 Part 3): every trade's default numbers
// exist in the catalogue, read in the company's words, and change colour the
// right way. The database side is supabase/tests/dashboard.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KPIS,
  codesFromSetting,
  findKpi,
  formatKpi,
  hasEnoughData,
  kpiChange,
  parseFirstWeek,
  parseKpis,
  tileColumns,
} from "@/lib/kpis";
import { DEFAULT_TERMS } from "@/lib/terms";

// The trade lists the migration seeds (20261009080000_dashboards_per_trade).
const TRADE_CARDS: Record<string, string> = {
  cleaning: "jobs_done_pct,missed,proof_pct,gps_verified_pct,time_on_site,owed,unbilled_jobs",
  garden: "jobs_done_pct,missed,onsite_share,km_per_job,owed,unbilled_jobs",
  plumbing: "jobs_today,response_hours,quote_win_rate,avg_invoice,invoiced,unbilled_jobs,owed",
  installation: "jobs_done,quotes_waiting_value,quote_win_value,accepted_not_invoiced,invoiced,owed",
  maintenance: "jobs_done_pct,missed,planned_share,onsite_share,unbilled_jobs,owed",
  security: "jobs_done_pct,longest_gap,rounds_proven_pct,hours_worked,owed",
  pest_control: "jobs_done_pct,upcoming_7d,jobs_per_staff_day,proof_pct,owed",
  pool: "jobs_done_pct,time_on_site,jobs_per_staff_day,proof_pct,owed",
  delivery: "jobs_done_pct,jobs_per_hour,km_per_job,proof_pct,owed",
  distribution: "jobs_done_pct,missed,gps_verified_pct,owed",
  generic: "jobs_done_pct,missed,hours_worked,onsite_share,km,proof_pct,gps_verified_pct,owed",
};

test("every trade's numbers are in the catalogue, 4 to 8 of them", () => {
  for (const [trade, list] of Object.entries(TRADE_CARDS)) {
    const codes = list.split(",");
    for (const c of codes) assert.ok(findKpi(c), `${trade}: ${c}`);
    assert.ok(codes.length >= 4 && codes.length <= 8, trade);
  }
});

test("codes are unique and every label reads in the company's words", () => {
  assert.equal(new Set(KPIS.map((k) => k.code)).size, KPIS.length);
  const terms = { ...DEFAULT_TERMS, job: { one: "Clean", many: "Cleans", article: null } };
  assert.equal(findKpi("jobs_done_pct")!.label(terms), "Cleans done as planned");
  assert.equal(findKpi("missed")!.label(terms), "Missed cleans");
  assert.equal(findKpi("km_per_job")!.label(terms), "Km per clean");
});

test("a comma list setting becomes known codes, in order, once each", () => {
  const known = (c: string) => !!findKpi(c);
  assert.deepEqual(codesFromSetting("owed, missed,nonsense,owed", known), ["owed", "missed"]);
  assert.deepEqual(codesFromSetting(null, known), []);
  assert.deepEqual(codesFromSetting("", known), []);
});

test("dashboard_kpis is read field by field", () => {
  const k = parseKpis({
    owed: { value: 650, events: 1, extra: 0 },
    missed: { value: 2, events: 6, previous: 3 },
    jobs_done_pct: { value: null, events: 0, previous: null },
    first_week: { sites: 1, workdays: 0, proven: 0, invoices: null },
    junk: "x",
  });
  assert.deepEqual(k.owed, { value: 650, events: 1, extra: 0 });
  assert.deepEqual(k.missed, { value: 2, events: 6, previous: 3 });
  assert.equal(k.jobs_done_pct.value, null);
  assert.equal(k.first_week, undefined);
  assert.equal(k.junk, undefined);
  assert.deepEqual(parseFirstWeek({ first_week: { sites: 1, workdays: 0, proven: 0, invoices: null } }),
    { sites: true, workdays: false, proven: false, invoices: null });
  assert.equal(parseFirstWeek({}), null);
});

test("not enough data under the number's minimum", () => {
  const pct = findKpi("proof_pct")!;
  assert.equal(hasEnoughData(pct, { value: 1, events: 4 }), false);
  assert.equal(hasEnoughData(pct, { value: 0.6, events: 5 }), true);
  assert.equal(hasEnoughData(findKpi("owed")!, { value: 0, events: 0 }), true);
  assert.equal(hasEnoughData(pct, undefined), false);
});

test("the change is coloured by which way is good", () => {
  assert.deepEqual(kpiChange(findKpi("missed")!, { value: 2, previous: 4, events: 6 }), { pct: -50, good: true });
  assert.deepEqual(kpiChange(findKpi("jobs_done_pct")!, { value: 0.6, previous: 0.8, events: 6 }), { pct: -25, good: false });
  assert.deepEqual(kpiChange(findKpi("time_on_site")!, { value: 33, previous: 30, events: 6 }), { pct: 10, good: null });
  assert.equal(kpiChange(findKpi("owed")!, { value: 650, previous: 100, events: 1 }), null); // about now
  assert.equal(kpiChange(findKpi("missed")!, { value: 2, previous: 0, events: 6 }), null); // from nothing
  assert.deepEqual(kpiChange(findKpi("proof_pct")!, { value: 0.94, previous: 0.95, events: 41 }), { pct: -1, good: null }); // noise
});

test("numbers read as people say them", () => {
  const money = (n: number) => `R ${n}`;
  assert.equal(formatKpi(findKpi("proof_pct")!, 0.6667, money), "67%");
  assert.equal(formatKpi(findKpi("owed")!, 650, money), "R 650");
  assert.equal(formatKpi(findKpi("time_on_site")!, 35.2, money), "35 min");
  assert.equal(formatKpi(findKpi("longest_gap")!, 240, money), "4 h 0 min");
  assert.equal(formatKpi(findKpi("km")!, 6416.1, money), "6,416 km");
  assert.equal(formatKpi(findKpi("km_per_job")!, 10, money), "10 km");
  assert.equal(formatKpi(findKpi("hours_worked")!, 923.9, money), "923.9 h");
  assert.equal(formatKpi(findKpi("jobs_per_staff_day")!, 1.3, money), "1.3");
});

test("no row is left with one tile on its own", () => {
  for (let n = 1; n <= 9; n++) {
    const cols = tileColumns(n);
    assert.ok(n <= cols || n % cols !== 1, `${n} tiles in ${cols} columns`);
  }
});
