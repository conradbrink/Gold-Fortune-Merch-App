// Every-two-weeks sites alternate A/B by whole weeks from Monday 1 Jan 2001,
// as `generate_routes` does (20261010210000). ISO week parity planned week A
// twice running over the 53-week year end of 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fortnightParity, isoWeekNumber, occursOn } from "@/lib/schedule";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

test("same A/B weeks as before on every day up to 27 Dec 2026", () => {
  for (let t = day(2021, 1, 4); t <= day(2026, 12, 27); t = day(t.getFullYear(), t.getMonth() + 1, t.getDate() + 1)) {
    assert.equal(fortnightParity(t), isoWeekNumber(t) % 2, t.toDateString());
  }
});

test("week A and week B keep alternating over the 2026/27 year end", () => {
  const mondays = [day(2026, 12, 14), day(2026, 12, 21), day(2026, 12, 28), day(2027, 1, 4), day(2027, 1, 11)];
  assert.deepEqual(mondays.map((m) => occursOn(m, "biweekly", 1)), [true, false, true, false, true]);
  assert.deepEqual(mondays.map((m) => occursOn(m, "biweekly", 2)), [false, true, false, true, false]);
});
