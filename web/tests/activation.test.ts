// The onboarding pipeline: stages by the furthest step reached, activation as
// the first job finished, and what needs the operator with the next action.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attentionFor,
  daysToFirstJob,
  fromRow,
  median,
  pipeline,
  stageOf,
  STAGES,
  whatsappNumber,
  type CompanyActivation,
} from "@/lib/activation";

const now = new Date("2026-10-20T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

const company = (over: Partial<CompanyActivation> = {}): CompanyActivation => ({
  orgId: "o",
  name: "Test Co",
  createdAt: daysAgo(1),
  setupStarted: false,
  setupFinishedAt: null,
  people: 1,
  teamOnAt: null,
  firstClientAt: null,
  firstWorkdayAt: null,
  firstJobStartedAt: null,
  firstJobFinishedAt: null,
  finishedDays14: 0,
  lastActivityAt: null,
  lastSignInAt: daysAgo(0),
  trialEndsAt: null,
  accountStatus: "trial",
  periodEnd: null,
  contactName: "Owner",
  contactEmail: "owner@example.com",
  contactPhone: "+27 82 555 0142",
  ...over,
});

const label = (c: CompanyActivation) => STAGES[stageOf(c)].label;

test("the stage is the furthest step reached, even if one was skipped", () => {
  assert.equal(label(company()), "New");
  assert.equal(label(company({ setupStarted: true })), "Setup started");
  assert.equal(label(company({ people: 4, firstClientAt: daysAgo(1) })), "Clients or sites added");
  // The operator did the setup; the team went straight to work.
  assert.equal(label(company({ firstJobStartedAt: daysAgo(1) })), "First workday");
  assert.equal(label(company({ firstJobFinishedAt: daysAgo(1) })), "First job finished");
  assert.equal(label(company({ firstJobFinishedAt: daysAgo(9), finishedDays14: 5 })), "Using it every workday");
  assert.equal(label(company({ firstJobFinishedAt: daysAgo(9), finishedDays14: 4 })), "First job finished");
});

test("the pipeline counts each company once, at its furthest step", () => {
  const counts = pipeline([company(), company({ setupStarted: true }), company({ firstJobFinishedAt: daysAgo(1) })]);
  assert.deepEqual(counts, [1, 1, 0, 0, 0, 1, 0]);
});

test("days to the first job finished, and the typical speed", () => {
  assert.equal(daysToFirstJob(company({ createdAt: daysAgo(10), firstJobFinishedAt: daysAgo(7) })), 3);
  assert.equal(daysToFirstJob(company({ createdAt: daysAgo(1), firstJobFinishedAt: daysAgo(1) })), 0);
  assert.equal(daysToFirstJob(company()), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 6]), 2.5);
  assert.equal(median([]), null);
});

test("a new company has a few days before it needs anyone", () => {
  assert.deepEqual(attentionFor(company({ createdAt: daysAgo(1) }), now), []);
});

test("a stuck company says what's wrong and what to do, most urgent first", () => {
  const stuck = attentionFor(company({ createdAt: daysAgo(6), lastSignInAt: daysAgo(6) }), now);
  assert.deepEqual(
    stuck.map((a) => a.reason),
    ["No job finished yet, 6 days in", "Nobody has started a workday yet", "No clients or sites added yet", "Only the owner is on Tickd"]
  );
  assert.ok(stuck.every((a) => a.action.length > 0));
});

test("an activated company that went quiet, and one nobody signs in to", () => {
  const quiet = attentionFor(
    company({ createdAt: daysAgo(30), people: 5, firstClientAt: daysAgo(29), firstWorkdayAt: daysAgo(28), firstJobFinishedAt: daysAgo(28), lastActivityAt: daysAgo(8), lastSignInAt: daysAgo(9) }),
    now
  );
  assert.deepEqual(quiet.map((a) => a.reason), ["Nothing done for 8 days", "Nobody has signed in for 9 days"]);
  const never = attentionFor(company({ createdAt: daysAgo(8), people: 3, firstClientAt: daysAgo(7), firstJobStartedAt: daysAgo(6), firstJobFinishedAt: daysAgo(6), lastActivityAt: daysAgo(1), lastSignInAt: null }), now);
  assert.deepEqual(never.map((a) => a.reason), ["Nobody has signed in yet"]);
});

test("the free period ending comes first", () => {
  const ending = attentionFor(company({ createdAt: daysAgo(55), people: 3, firstClientAt: daysAgo(54), firstJobFinishedAt: daysAgo(50), lastActivityAt: daysAgo(1), trialEndsAt: new Date(now.getTime() + 4 * 86_400_000).toISOString() }), now);
  assert.equal(ending[0].reason, "Free period ends in 4 days");
  const ended = attentionFor(company({ createdAt: daysAgo(65), people: 3, firstClientAt: daysAgo(64), firstJobFinishedAt: daysAgo(60), lastActivityAt: daysAgo(1), trialEndsAt: daysAgo(2) }), now);
  assert.equal(ending[0].action, "Talk to them about carrying on before it ends.");
  assert.equal(ended[0].reason, "Free period ended 2 days ago");
  assert.equal(ended[0].action, "Talk to them about choosing a plan to carry on.");
  const today = attentionFor(company({ createdAt: daysAgo(65), people: 3, firstClientAt: daysAgo(64), firstJobFinishedAt: daysAgo(60), lastActivityAt: daysAgo(1), trialEndsAt: daysAgo(0.1) }), now);
  assert.equal(today[0].reason, "Free period ended today", "not 'ends in 0 days'");
  assert.equal(today[0].action, "Talk to them about choosing a plan to carry on.");
  const long = attentionFor(company({ createdAt: daysAgo(90), people: 3, firstClientAt: daysAgo(89), firstJobFinishedAt: daysAgo(85), lastActivityAt: daysAgo(1), trialEndsAt: daysAgo(30) }), now);
  assert.deepEqual(long, [], "a free period that ended weeks ago is no longer news");
});

// Paying leaves trial_ends_at as it was: the status decides (#221 for the
// company's own screens, the same rule here).
const usingIt = { createdAt: daysAgo(65), people: 3, firstClientAt: daysAgo(64), firstJobFinishedAt: daysAgo(60), lastActivityAt: daysAgo(1) };

test("a company that has paid is not told its free period is ending or has ended", () => {
  assert.deepEqual(attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(2), accountStatus: "active", periodEnd: daysAgo(-28) }), now), []);
  assert.deepEqual(
    attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(-4), accountStatus: "active", periodEnd: daysAgo(-30) }), now),
    [],
    "paid before its pilot date"
  );
  assert.deepEqual(attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(2), accountStatus: "past_due", periodEnd: daysAgo(1) }), now), []);
  assert.deepEqual(
    attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(2), accountStatus: "read_only", periodEnd: daysAgo(3) }), now),
    [],
    "locked because a paid plan lapsed, not after the pilot"
  );
  assert.deepEqual(attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(2), accountStatus: "exempt" }), now), []);
  assert.deepEqual(attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(2), accountStatus: null }), now), [], "no account row");
});

test("a pilot locked after it ended without paying still needs the talk", () => {
  const locked = attentionFor(company({ ...usingIt, trialEndsAt: daysAgo(2), accountStatus: "read_only", periodEnd: null }), now);
  assert.equal(locked[0].reason, "Free period ended 2 days ago");
  assert.equal(locked[0].action, "Talk to them about choosing a plan to carry on.");
});

test("the read carries the account status and paid period end", () => {
  const row = {
    org_id: "o", name: "Co", created_at: daysAgo(9), setup_started: true, setup_finished_at: null, people: 2, team_on_at: null,
    first_client_at: null, first_workday_at: null, first_job_started_at: null, first_job_finished_at: null, finished_days_14: 0,
    last_activity_at: null, last_sign_in_at: null, trial_ends_at: daysAgo(2), contact_name: null, contact_email: null, contact_phone: null,
  };
  const paid = fromRow({ ...row, account_status: "active", period_end: daysAgo(-28) });
  assert.equal(paid.accountStatus, "active");
  assert.equal(paid.periodEnd, daysAgo(-28));
  assert.equal(fromRow({ ...row, account_status: null, period_end: null }).accountStatus, null);
});

test("WhatsApp needs an international number", () => {
  assert.equal(whatsappNumber("+27 82 555 0142"), "27825550142");
  assert.equal(whatsappNumber("082"), null);
  assert.equal(whatsappNumber(null), null);
});
