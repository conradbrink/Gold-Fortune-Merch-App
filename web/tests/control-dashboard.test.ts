// The Control Centre's home: active and free-period companies, new per month,
// module adoption, and system health in plain words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { healthProblems, inFreePeriod, isActive, madeIn, moduleAdoption, newPerMonth, parseHealth } from "@/lib/control-dashboard";
import { periods } from "@/lib/acquisition";
import type { CompanyActivation } from "@/lib/activation";

const now = new Date("2026-10-20T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const company = (over: Partial<CompanyActivation>): CompanyActivation => ({
  orgId: "o", name: "Co", createdAt: daysAgo(30), setupStarted: true, setupFinishedAt: null, people: 3, teamOnAt: null,
  firstClientAt: null, firstWorkdayAt: null, firstJobStartedAt: null, firstJobFinishedAt: null, finishedDays14: 0,
  lastActivityAt: null, lastSignInAt: null, trialEndsAt: null, contactName: null, contactEmail: null, contactPhone: null,
  ...over,
});

test("active means something done in the last 14 days; free period means it hasn't ended", () => {
  assert.equal(isActive(company({ lastActivityAt: daysAgo(3) }), now), true);
  assert.equal(isActive(company({ lastActivityAt: daysAgo(15) }), now), false);
  assert.equal(isActive(company({}), now), false);
  assert.equal(inFreePeriod(company({ trialEndsAt: daysAgo(-10) }), now), true);
  assert.equal(inFreePeriod(company({ trialEndsAt: daysAgo(1) }), now), false);
});

test("new in a period, and per month for 12 months in South African time", () => {
  const p = periods("7d", now);
  assert.equal(madeIn(company({ createdAt: daysAgo(2) }), p.current), true);
  assert.equal(madeIn(company({ createdAt: daysAgo(9) }), p.current), false);
  assert.equal(madeIn(company({ createdAt: daysAgo(9) }), p.previous), true);
  const months = newPerMonth(
    [
      company({ createdAt: "2026-10-05T08:00:00Z" }),
      company({ createdAt: "2026-09-30T23:30:00Z" }), // 01:30 on 1 Oct in South Africa
      company({ createdAt: "2026-08-15T08:00:00Z" }),
      company({ createdAt: "2024-01-01T08:00:00Z" }), // too old to show
    ],
    now
  );
  assert.equal(months.length, 12);
  assert.equal(months[11].month, "2026-10");
  assert.equal(months[11].count, 2);
  assert.equal(months[9].count, 1);
  assert.equal(months[0].month, "2025-11");
});

test("module adoption counts companies with a built module switched on", () => {
  const use = moduleAdoption(
    [
      { code: "forms", name: "Forms", is_built: true },
      { code: "hr", name: "HR", is_built: true },
      { code: "fleet", name: "Fleet", is_built: false },
    ],
    [
      { org_id: "a", module_code: "forms" },
      { org_id: "b", module_code: "forms" },
      { org_id: "a", module_code: "hr" },
      { org_id: "a", module_code: "fleet" },
    ],
    4
  );
  assert.deepEqual(use.map((m) => [m.code, m.companies, m.share]), [["forms", 2, 0.5], ["hr", 1, 0.25]]);
});

test("system health: all well, and each problem in plain words", () => {
  const ok = parseHealth({ jobs: [{ name: "alerts", active: true, last_status: "succeeded", failed_24h: 0 }], emails_failed_24h: 0, emails_waiting: 0, web_events_24h: 12 });
  assert.deepEqual(healthProblems(ok), []);
  assert.equal(ok.webEvents24h, 12);
  const bad = parseHealth({
    jobs: [
      { name: "alerts", active: true, last_status: "failed", failed_24h: 3 },
      { name: "evening-report", active: true, last_status: "failed", failed_24h: 0 },
      { name: "old", active: false, last_status: "failed", failed_24h: 5 },
    ],
    emails_failed_24h: 1,
    emails_waiting: "4",
  });
  assert.deepEqual(healthProblems(bad), [
    'The scheduled job "alerts" failed 3 times in the last 24 hours.',
    'The scheduled job "evening-report" failed the last time it ran.',
    "1 email couldn't be sent in the last 24 hours.",
    "4 emails have been waiting to go out for over 30 minutes.",
  ]);
  assert.deepEqual(parseHealth(null).jobs, []);
});
