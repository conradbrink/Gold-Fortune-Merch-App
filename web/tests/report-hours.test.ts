// Proof of service and Hours (Stage 7 Part 4a): the page's arithmetic on the
// rows `service_log()` and `staff_hours()` return. The database side is
// supabase/tests/reports.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clockDuration, hoursDay, hoursTotals, type StaffHoursRow } from "@/lib/staff-hours";
import { minutesLabel, onSiteLabel, serviceLogTotals, type ServiceLogRow } from "@/lib/service-log";

const day = (over: Partial<StaffHoursRow>): StaffHoursRow => ({
  staff_id: "a",
  staff_name: "Thandi",
  day: "2026-10-01",
  first_in: "2026-10-01T06:00:00Z",
  last_out: "2026-10-01T14:00:00Z",
  open_now: false,
  workday_seconds: 8 * 3600,
  onsite_seconds: 5 * 3600,
  jobs: 4,
  km: 32.5,
  ...over,
});

test("a finished day: time between jobs and jobs per hour", () => {
  const d = hoursDay(day({}), { shortHours: 0, longHours: 0 });
  assert.equal(d.betweenSeconds, 3 * 3600);
  assert.equal(d.jobsPerHour, 0.5);
  assert.equal(d.mark, null);
});

test("short and long days follow the trade's limits; 0 turns a mark off", () => {
  assert.equal(hoursDay(day({ workday_seconds: 5 * 3600 }), { shortHours: 6, longHours: 0 }).mark, "short");
  assert.equal(hoursDay(day({ workday_seconds: 6 * 3600 }), { shortHours: 6, longHours: 0 }).mark, null);
  assert.equal(hoursDay(day({ workday_seconds: 13 * 3600 }), { shortHours: 0, longHours: 12 }).mark, "long");
  assert.equal(hoursDay(day({ workday_seconds: 13 * 3600 }), { shortHours: 0, longHours: 0 }).mark, null);
});

test("a day still open, or with jobs and no workday, is never marked or divided", () => {
  const open = hoursDay(day({ workday_seconds: 0, open_now: true, last_out: null }), { shortHours: 6, longHours: 12 });
  assert.equal(open.mark, null);
  assert.equal(open.betweenSeconds, null);
  assert.equal(open.jobsPerHour, null);
  const none = hoursDay(day({ workday_seconds: 0, first_in: null, last_out: null }), { shortHours: 6, longHours: 12 });
  assert.equal(none.mark, null);
});

test("time on site longer than the workday never makes negative travel", () => {
  assert.equal(hoursDay(day({ onsite_seconds: 9 * 3600 }), { shortHours: 0, longHours: 0 }).betweenSeconds, 0);
});

test("totals count people once and add up the marks", () => {
  const limits = { shortHours: 6, longHours: 12 };
  const t = hoursTotals([
    hoursDay(day({}), limits),
    hoursDay(day({ day: "2026-10-02", workday_seconds: 4 * 3600, km: null }), limits),
    hoursDay(day({ staff_id: "b", workday_seconds: 13 * 3600, km: 10 }), limits),
  ]);
  assert.deepEqual(
    { people: t.people, days: t.days, short: t.short, long: t.long, km: t.km, jobs: t.jobs },
    { people: 2, days: 3, short: 1, long: 1, km: 42.5, jobs: 12 }
  );
  assert.equal(clockDuration(t.workdaySeconds), "25:00");
});

test("durations read as a timesheet does", () => {
  assert.equal(clockDuration(7 * 3600 + 45 * 60), "7:45");
  assert.equal(clockDuration(null), "-");
  assert.equal(minutesLabel(45), "45 min");
  assert.equal(minutesLabel(125), "2 h 05");
  assert.equal(minutesLabel(null), "-");
});

const visit = (over: Partial<ServiceLogRow>): ServiceLogRow => ({
  visit_id: crypto.randomUUID(),
  store_id: "s1",
  store_name: "Site one",
  store_address: null,
  day: "2026-10-01",
  staff_name: "Thandi",
  checkin_at: "2026-10-01T07:00:00Z",
  checkout_at: "2026-10-01T07:30:00Z",
  minutes: 30,
  on_site: true,
  forms: 1,
  photos: 2,
  planned: true,
  gap_minutes: null,
  ...over,
});

test("proof of service totals: no GPS is unknown, not away; the longest gap wins", () => {
  const t = serviceLogTotals([
    visit({}),
    visit({ on_site: false, gap_minutes: 240, photos: 0, forms: 0 }),
    visit({ store_id: "s2", on_site: null, gap_minutes: 90, minutes: null }),
  ]);
  assert.deepEqual(t, { jobs: 3, onSite: 1, withFix: 2, photos: 4, forms: 2, minutes: 60, places: 2, longestGap: 240 });
  assert.equal(serviceLogTotals([visit({})]).longestGap, null);
  assert.deepEqual([true, false, null].map(onSiteLabel), ["On site", "Away", "No GPS"]);
});
