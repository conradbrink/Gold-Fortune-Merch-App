// The free trial and the getting-started list (Stage 5): the countdown, the
// list's wording through the company's terms, reading my_onboarding(), the
// sign-up form's checks and payload, and who may open /plans. The database
// half is supabase/tests/trial_onboarding.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTermTokens, parseOnboarding, showOnboarding, trialState } from "@/lib/onboarding";
import {
  clientAddress,
  industryFromQuery,
  signupCompanyPayload,
  signupIssues,
  signupProblems,
  type SignupInput,
} from "@/lib/signup";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";
import { canAccessPath, toPermissionSet } from "@/lib/permissions";

const cleaning: Terms = {
  ...DEFAULT_TERMS,
  staff: { one: "Cleaner", many: "Cleaners", article: null },
  site: { one: "Site", many: "Sites", article: null },
  job: { one: "Clean", many: "Cleans", article: null },
};

test("titles name things in the company's own words", () => {
  assert.equal(fillTermTokens("Invite your {staff.many|lower}", cleaning), "Invite your cleaners");
  assert.equal(fillTermTokens("Plan your recurring {job.many|lower}", cleaning), "Plan your recurring cleans");
  assert.equal(fillTermTokens("Your first {site.one}", cleaning), "Your first Site");
  assert.equal(fillTermTokens("Add your {site.many|lower}", DEFAULT_TERMS), "Add your sites");
  // Not a token, or a term that does not exist: left as written.
  assert.equal(fillTermTokens("No tokens here", cleaning), "No tokens here");
  assert.equal(fillTermTokens("{nothing.many}", cleaning), "{nothing.many}");
});

test("the trial counts down in whole days, warns in the last three, then ends", () => {
  const now = new Date("2026-10-08T09:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
  assert.deepEqual(trialState(null, now), { kind: "none" });
  assert.deepEqual(trialState("not a date", now), { kind: "none" });
  assert.deepEqual(trialState(inDays(14), now), { kind: "active", daysLeft: 14 });
  assert.deepEqual(trialState(inDays(4), now), { kind: "active", daysLeft: 4 });
  assert.deepEqual(trialState(inDays(3), now), { kind: "ending", daysLeft: 3 });
  // Ends this evening: still "1 day left" until it has ended.
  assert.deepEqual(trialState(inDays(0.4), now), { kind: "ending", daysLeft: 1 });
  assert.deepEqual(trialState(inDays(0), now), { kind: "ended" });
  assert.deepEqual(trialState(inDays(-2), now), { kind: "ended" });
});

test("my_onboarding() is read field by field; the card shows only while there is something to do", () => {
  const o = parseOnboarding({
    dismissed_at: null,
    steps: [
      { code: "add_sites", title: "Add your {site.many|lower}", description: "d", href: "/stores", done: true },
      { code: "invite_staff", title: "Invite", description: "d", href: "/representatives", done: false },
      { code: "bad_link", title: "x", description: "d", href: "https://elsewhere.example", done: false },
      { title: "no code", href: "/x" },
    ],
  });
  assert.deepEqual(o.steps.map((s) => [s.code, s.done]), [["add_sites", true], ["invite_staff", false]]);
  assert.equal(showOnboarding(o), true);
  assert.equal(showOnboarding({ ...o, dismissedAt: "2026-10-08T09:00:00Z" }), false);
  assert.equal(showOnboarding({ dismissedAt: null, steps: o.steps.map((s) => ({ ...s, done: true })) }), false);
  assert.deepEqual(parseOnboarding(null), { dismissedAt: null, steps: [] });
});

function valid(): SignupInput {
  return {
    fullName: " Thandi Owner ",
    email: " Thandi@Example.com ",
    password: "abcd2345",
    companyName: " Sparkle Cleaning ",
    countryCode: "za",
    currencyCode: "zar",
    timezone: "Africa/Johannesburg",
    templates: ["cleaning"],
  };
}

test("a complete sign-up has no problems; each problem names its field", () => {
  assert.deepEqual(signupProblems(valid()), []);
  const empty: SignupInput = {
    fullName: "", email: "x", password: "short", companyName: " ",
    countryCode: "", currencyCode: "R", timezone: "", templates: [],
  };
  assert.deepEqual(signupIssues(empty).map((i) => i.field), [
    "fullName", "email", "password", "companyName", "countryCode", "currencyCode", "timezone", "templates",
  ]);
  assert.deepEqual(signupProblems({ ...valid(), templates: ["cleaning", "cleaning"] }), [
    "That choice of work was not understood. Please choose again.",
  ]);
  assert.deepEqual(signupProblems({ ...valid(), templates: ["Robert'); drop"] }), [
    "That choice of work was not understood. Please choose again.",
  ]);
});

test("the company payload is trimmed, codes upper-cased, the email lower-cased, and no password in it", () => {
  const p = signupCompanyPayload(valid());
  assert.equal(p.name, "Sparkle Cleaning");
  assert.equal(p.country_code, "ZA");
  assert.equal(p.currency_code, "ZAR");
  assert.deepEqual(p.owner, { full_name: "Thandi Owner", email: "thandi@example.com" });
  assert.ok(!JSON.stringify(p).includes("abcd2345"));
});

test("the rate-limit key is the first forwarded address", () => {
  assert.equal(clientAddress("203.0.113.7, 10.0.0.1", null), "203.0.113.7");
  assert.equal(clientAddress(null, " 198.51.100.2 "), "198.51.100.2");
  assert.equal(clientAddress("", ""), null);
});

test("the sales site's ?industry= picks a trade only if it is one we offer", () => {
  const offered = ["cleaning", "delivery"];
  assert.equal(industryFromQuery("delivery", offered), "delivery");
  assert.equal(industryFromQuery(["cleaning", "x"], offered), "cleaning");
  assert.equal(industryFromQuery("rocketry", offered), null);
  assert.equal(industryFromQuery(undefined, offered), null);
});

test("/plans is for whoever runs the company", () => {
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/plans"), true);
  assert.equal(canAccessPath(toPermissionSet(["admin"]), "/plans"), true);
  assert.equal(canAccessPath(toPermissionSet(["field_ops", "team"]), "/plans"), false);
});
