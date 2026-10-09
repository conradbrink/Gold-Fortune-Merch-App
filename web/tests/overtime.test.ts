// Overtime on the Hours report (Stage 8 Part 5): the page splits each
// person's days into normal hours and overtime from the rows `staff_hours()`
// returns. The database side (the settings and each trade's seeds) is
// supabase/tests/overtime.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hoursDay,
  hoursSheet,
  hoursTotals,
  overtimeOn,
  overtimeSplit,
  weekStart,
  type HoursDay,
  type OvertimeLimits,
  type StaffHoursRow,
} from "@/lib/staff-hours";
import { parseCompanyConfig } from "@/lib/company-config";
import { DEFAULT_TERMS } from "@/lib/terms";

const H = 3600;
const OFF: OvertimeLimits = { dayHours: 0, weekHours: 0, sundayOvertime: false };

/** One person's finished day; 2026-10-05 is a Monday. */
const day = (date: string, hours: number, over: Partial<StaffHoursRow> = {}): HoursDay =>
  hoursDay(
    {
      staff_id: "a",
      staff_name: "Thandi",
      day: date,
      first_in: `${date}T06:00:00Z`,
      last_out: `${date}T16:00:00Z`,
      open_now: false,
      workday_seconds: hours * H,
      onsite_seconds: 0,
      jobs: 3,
      km: null,
      ...over,
    },
    { shortHours: 0, longHours: 0 }
  );

/** [normal, overtime] in hours, in the order given. */
const split = (days: HoursDay[], limits: OvertimeLimits) =>
  overtimeSplit(days, limits).map((d) => [
    d.normalSeconds === null ? null : d.normalSeconds / H,
    d.overtimeSeconds === null ? null : d.overtimeSeconds / H,
  ]);

test("weeks start on Monday, Sunday ends them", () => {
  assert.equal(weekStart("2026-10-05"), "2026-10-05");
  assert.equal(weekStart("2026-10-11"), "2026-10-05");
  assert.equal(weekStart("2026-10-12"), "2026-10-12");
  // Across a month and a year.
  assert.equal(weekStart("2026-11-01"), "2026-10-26");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
});

test("a day's hours past the normal day are overtime", () => {
  const limits = { ...OFF, dayHours: 9 };
  assert.deepEqual(split([day("2026-10-05", 11), day("2026-10-06", 9), day("2026-10-07", 7.5)], limits), [
    [9, 2],
    [9, 0],
    [7.5, 0],
  ]);
});

test("normal hours past the normal week are overtime, and a day's overtime is not counted twice", () => {
  const limits = { ...OFF, dayHours: 9, weekHours: 45 };
  // Mon to Sat, newest first as the report sends them: 10 h days, so 1 h a
  // day over the normal day; the sixth day's 9 normal hours meet a week that
  // already has 45, so they are overtime too.
  const days = ["2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05"].map((d) =>
    day(d, 10)
  );
  assert.deepEqual(split(days, limits), [
    [0, 10],
    [9, 1],
    [9, 1],
    [9, 1],
    [9, 1],
    [9, 1],
  ]);
  const t = hoursTotals(overtimeSplit(days, limits));
  assert.equal(t.workdaySeconds, 60 * H);
  assert.equal(t.overtimeSeconds, 15 * H);
});

test("the week fills up part way through a day", () => {
  // No daily rule: 12 + 12 + 12 = 36, then 12 more against a 40-hour week.
  const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => day(d, 12));
  assert.deepEqual(split(days, { ...OFF, weekHours: 40 }), [
    [12, 0],
    [12, 0],
    [12, 0],
    [4, 8],
  ]);
});

test("each person and each week counts on its own", () => {
  const limits = { ...OFF, weekHours: 20 };
  const days = [
    day("2026-10-05", 15),
    day("2026-10-06", 15),
    day("2026-10-06", 15, { staff_id: "b" }),
    // Next week starts again.
    day("2026-10-12", 15),
  ];
  assert.deepEqual(split(days, limits), [
    [15, 0],
    [5, 10],
    [15, 0],
    [15, 0],
  ]);
});

test("every Sunday hour is overtime when the rule is on, and none of it fills the week", () => {
  const sunday = day("2026-10-11", 6);
  assert.deepEqual(split([sunday], { ...OFF, sundayOvertime: true }), [[0, 6]]);
  assert.deepEqual(split([sunday], OFF), [[6, 0]]);
  // A Sunday before the Monday of the next week does not use up its hours.
  const limits = { dayHours: 9, weekHours: 45, sundayOvertime: true };
  assert.deepEqual(split([day("2026-10-10", 8), sunday, day("2026-10-12", 8)], limits), [
    [8, 0],
    [0, 6],
    [8, 0],
  ]);
});

test("a limit of 0 turns its rule off; with every rule off nothing is overtime", () => {
  const days = [day("2026-10-05", 14), day("2026-10-06", 14), day("2026-10-07", 14), day("2026-10-08", 14)];
  assert.deepEqual(split(days, OFF), [
    [14, 0],
    [14, 0],
    [14, 0],
    [14, 0],
  ]);
  assert.deepEqual(split(days, { ...OFF, dayHours: 12 }).map(([, ot]) => ot), [2, 2, 2, 2]);
  assert.equal(overtimeOn(OFF), false);
  assert.equal(overtimeOn({ ...OFF, sundayOvertime: true }), true);
  assert.equal(overtimeOn({ ...OFF, weekHours: 45 }), true);
});

test("a workday still open, or jobs without a workday, has no hours to split yet", () => {
  const open = day("2026-10-06", 0, { open_now: true, last_out: null });
  const none = day("2026-10-07", 0, { first_in: null, last_out: null });
  const limits = { dayHours: 9, weekHours: 45, sundayOvertime: true };
  assert.deepEqual(split([open, none], limits), [
    [null, null],
    [null, null],
  ]);
  // And they take nothing from the week.
  assert.deepEqual(split([open, day("2026-10-08", 10)], { ...OFF, weekHours: 10 }), [
    [null, null],
    [10, 0],
  ]);
});

test("a week cut by the period start counts its earlier days once the page has them", () => {
  // The period starts on Thursday 8 October. The page asks for hours from
  // Monday 5 October, splits them, then shows the period's days only.
  const limits = { ...OFF, weekHours: 45 };
  const fetched = [day("2026-10-09", 10), day("2026-10-08", 10), day("2026-10-07", 10), day("2026-10-06", 10), day("2026-10-05", 10)];
  const shown = overtimeSplit(fetched, limits).filter((d) => d.day >= "2026-10-08");
  assert.deepEqual(
    shown.map((d) => [d.day, d.normalSeconds! / H, d.overtimeSeconds! / H]),
    [
      ["2026-10-09", 5, 5],
      ["2026-10-08", 10, 0],
    ]
  );
  // A week running past the period's end is fine as it is: overtime falls on
  // the later days, which the period does not have.
  assert.equal(weekStart("2026-10-08"), "2026-10-05");
});

test("the export has normal and overtime hours only when a rule is on", () => {
  const days = overtimeSplit([day("2026-10-05", 10.5)], { ...OFF, dayHours: 9 });
  const on = hoursSheet(days, DEFAULT_TERMS, [], "Africa/Johannesburg", true);
  assert.deepEqual(
    on.columns.slice(4, 7).map((c) => c.key),
    ["workday", "normal", "overtime"]
  );
  assert.equal(on.rows[0].normal, 9);
  assert.equal(on.rows[0].overtime, 1.5);
  const off = hoursSheet(days, DEFAULT_TERMS, [], "Africa/Johannesburg");
  assert.ok(!off.columns.some((c) => c.key === "overtime"));
  assert.ok(!("overtime" in off.rows[0]));
});

test("the settings parse with 0 and off as their fallback", () => {
  const cfg = parseCompanyConfig({
    org_id: "o",
    settings: { report_day_normal_hours: 9, report_week_normal_hours: 45, report_sunday_is_overtime: true },
  })!;
  assert.equal(cfg.settings.report_day_normal_hours, 9);
  assert.equal(cfg.settings.report_week_normal_hours, 45);
  assert.equal(cfg.settings.report_sunday_is_overtime, true);
  const bad = parseCompanyConfig({
    org_id: "o",
    settings: { report_day_normal_hours: "9", report_week_normal_hours: 4.5, report_sunday_is_overtime: "yes" },
  })!;
  assert.equal(bad.settings.report_day_normal_hours, 0);
  assert.equal(bad.settings.report_week_normal_hours, 0);
  assert.equal(bad.settings.report_sunday_is_overtime, false);
});

/** The migration's per-trade seeds, read from the migration itself so the two cannot drift. */
function seedBlock(): string {
  const sql = readFileSync(join(process.cwd(), "../supabase/migrations/20261009180000_overtime.sql"), "utf8");
  return sql.slice(sql.indexOf("insert into public.template_settings"), sql.indexOf("insert into public.company_settings"));
}

function seededOvertime(): Record<string, { day: number; week: number }> {
  const block = seedBlock().slice(0, seedBlock().indexOf("as v(template_code, day_hours, week_hours)"));
  return Object.fromEntries(
    [...block.matchAll(/\('([a-z_]+)', (\d+), (\d+)\)/g)].map((m) => [m[1], { day: Number(m[2]), week: Number(m[3]) }])
  );
}

test("the service trades are seeded a normal day and week; distribution, and so Gold Fortune, nothing", () => {
  const seeds = seededOvertime();
  assert.deepEqual(Object.keys(seeds).sort(), [
    "cleaning",
    "delivery",
    "garden",
    "generic",
    "installation",
    "maintenance",
    "pest_control",
    "plumbing",
    "pool",
    "security",
  ]);
  assert.ok(!("distribution" in seeds));
  for (const [trade, { day: d, week }] of Object.entries(seeds)) {
    assert.ok(d >= 1 && d <= 24, `${trade}'s normal day is out of range`);
    assert.ok(week >= 1 && week <= 168, `${trade}'s normal week is out of range`);
    assert.ok(d <= week, `${trade}'s day is longer than its week`);
  }
  assert.deepEqual(seeds.cleaning, { day: 9, week: 45 });
  // A guard's 12-hour shift is the security trade's normal day (its long day mark).
  assert.deepEqual(seeds.security, { day: 12, week: 45 });
  // No trade is seeded a Sunday rule; a company turns it on.
  assert.ok(!seedBlock().includes("report_sunday_is_overtime"));
});
