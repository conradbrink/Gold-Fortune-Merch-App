// The operator's company page says where a company stands with its free
// pilot, from its account status (paying leaves trial_ends_at as it was), and
// offers Extend, Start a trial or nothing to match what the database's own
// functions accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pilotStanding, type OperatorAccount } from "@/lib/control-centre";

const now = new Date("2026-10-20T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const account = (over: Partial<OperatorAccount>): OperatorAccount => ({
  status: "trial",
  trial_ends_at: null,
  period: null,
  period_end: null,
  ...over,
});

test("a company on its pilot can be given more days", () => {
  assert.deepEqual(pilotStanding(account({ trial_ends_at: "2026-10-28T10:00:00Z" }), false, now), {
    text: "Free pilot ends 28 Oct 2026, 10:00 UTC (8 days left).",
    button: "extend",
  });
  assert.equal(pilotStanding(account({ trial_ends_at: daysAgo(-0.5) }), false, now).text, "Free pilot ends 20 Oct 2026, 22:00 UTC (1 day left).");
  assert.deepEqual(pilotStanding(account({ trial_ends_at: "2026-10-18T10:00:00Z" }), false, now), {
    text: "Free pilot ended 18 Oct 2026, 10:00 UTC, and it hasn't paid yet.",
    button: "extend",
  });
  assert.deepEqual(pilotStanding(account({}), false, now), { text: "On a free pilot with no end date.", button: "extend" });
});

test("a company that has paid is never told its pilot has ended, and gets no Extend", () => {
  const paidEarly = pilotStanding(
    account({ status: "active", trial_ends_at: daysAgo(-4), period: "monthly", period_end: "2026-11-15T10:00:00Z" }),
    false,
    now
  );
  assert.deepEqual(paidEarly, { text: "Paying (paid up to 15 Nov 2026, 10:00 UTC).", button: null });
  const paidLate = pilotStanding(account({ status: "active", trial_ends_at: daysAgo(10), period: "monthly", period_end: daysAgo(-20) }), false, now);
  assert.equal(paidLate.button, null);
  assert.doesNotMatch(paidLate.text, /pilot/);
  assert.match(pilotStanding(account({ status: "past_due", period: "monthly", period_end: daysAgo(1) }), false, now).text, /^Paying, but the last payment didn't go through/);
  assert.match(pilotStanding(account({ status: "read_only", period: "monthly", period_end: daysAgo(5) }), false, now).text, /^Read-only: its plan wasn't paid/);
  assert.equal(pilotStanding(account({ status: "read_only", period: "monthly", period_end: daysAgo(5) }), false, now).button, null);
  assert.equal(pilotStanding(account({ status: "cancelled", period: "monthly" }), false, now).button, null);
  assert.equal(pilotStanding(account({ status: "trial", period: "monthly" }), false, now).button, null, "has had a plan: the database refuses");
});

test("a pilot locked after it ended without paying can be extended, which unlocks it", () => {
  assert.deepEqual(pilotStanding(account({ status: "read_only", trial_ends_at: "2026-10-18T10:00:00Z" }), false, now), {
    text: "Read-only since its free pilot ended 18 Oct 2026, 10:00 UTC, and it hasn't paid. Extending unlocks it.",
    button: "extend",
  });
});

test("a company free by arrangement can be started on a pilot", () => {
  const free = { text: "Free by arrangement: not on a pilot and not paying.", button: "start" };
  assert.deepEqual(pilotStanding(account({ status: "exempt" }), false, now), free);
  assert.deepEqual(pilotStanding(null, false, now), free, "no account row yet");
});

test("a closed company's pilot can't be changed", () => {
  assert.deepEqual(pilotStanding(account({ status: "cancelled" }), true, now), { text: "Closed, so its pilot can't be changed.", button: null });
  assert.equal(pilotStanding(account({ trial_ends_at: daysAgo(-5) }), true, now).button, null);
});

test("Extend goes through the database's own pilot functions, never a bare date write", () => {
  const src = readFileSync(new URL("../app/platform/actions.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function extendTrial"), src.indexOf("export async function setCompanyClosed"));
  assert.match(body, /pilotStanding\(/);
  assert.match(body, /rpc\(\s*"billing_operator_extend_trial"/);
  assert.match(body, /rpc\(\s*"billing_operator_set_exempt",\s*\{[^}]*p_exempt:\s*false/);
  assert.doesNotMatch(body, /\.upsert\(|\.update\(|trial_ends_at:/);
});
