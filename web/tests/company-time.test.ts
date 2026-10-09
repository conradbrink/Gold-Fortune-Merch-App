// Report days and times on the company's clock (Stage 7 Part 4a, CodeRabbit
// on #102): a viewer in another timezone sees the company's days and times.
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyMidnight, companyRange, companyTime } from "@/lib/company-time";

test("a company day starts at the company's midnight", () => {
  assert.equal(companyMidnight("2026-10-01", "Africa/Johannesburg").toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(companyMidnight("2026-10-01", "Africa/Gaborone").toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(companyMidnight("2026-10-01", "UTC").toISOString(), "2026-10-01T00:00:00.000Z");
});

test("midnight is right on both sides of a daylight-saving change", () => {
  // London leaves summer time on 25 October 2026.
  assert.equal(companyMidnight("2026-10-25", "Europe/London").toISOString(), "2026-10-24T23:00:00.000Z");
  assert.equal(companyMidnight("2026-10-26", "Europe/London").toISOString(), "2026-10-26T00:00:00.000Z");
});

test("the picked calendar days become the company's, whatever the viewer's timezone", () => {
  // The pickers hold the viewer's midnights; only the calendar days are kept.
  const picked = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 8) };
  const r = companyRange(picked, "Africa/Johannesburg");
  assert.equal(r.from.toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-10-07T22:00:00.000Z");
});

test("times read on the company's clock", () => {
  assert.equal(companyTime("2026-10-01T06:05:00Z", "Africa/Johannesburg"), "08:05");
  assert.equal(companyTime("2026-10-01T22:30:00Z", "Africa/Johannesburg"), "00:30");
  assert.equal(companyTime(null, "Africa/Johannesburg"), "");
});
