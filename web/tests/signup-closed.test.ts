import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SELF_SERVE_SIGNUP_OPEN } from "@/lib/signup";
import { FOUNDING_OFFER } from "@/lib/founding-offer";
import { PROMO } from "@/lib/email/brand";

// The 14-day free trial was taken off (owner, 10 Oct 2026): the way in is the
// Founding offer, and no page says "14 days".

test("self-serve sign-up is closed, and its action refuses before it touches anything", () => {
  assert.equal(SELF_SERVE_SIGNUP_OPEN, false);
  // The action (a server action: it cannot be imported by the test runner) checks
  // the switch first, ahead of its validation, its rate limits and every database call.
  const src = readFileSync("app/signup/actions.ts", "utf8");
  const gate = src.indexOf("if (!SELF_SERVE_SIGNUP_OPEN)");
  assert.ok(gate > 0);
  for (const later of ["signupProblems(input)", "platformAdminClient()", "consume_anonymous_rate_limit", "createUser("]) {
    assert.ok(src.indexOf(later, src.indexOf("export async function signupAction")) > gate, later);
  }
  assert.match(src.slice(gate, gate + 260), /founding member/);
});

test("the Founding offer is 60 days and the page it points to is the application", () => {
  assert.equal(FOUNDING_OFFER.days, 60);
  assert.equal(FOUNDING_OFFER.applyUrl, "https://tickd.co.za/founding");
  assert.ok(PROMO.url.startsWith(FOUNDING_OFFER.applyUrl));
  assert.doesNotMatch(`${PROMO.cta} ${PROMO.body} ${PROMO.headline}`, /14/);
});

test("the sign-up page says nothing about a 14-day trial while it is closed", () => {
  const page = readFileSync("app/signup/page.tsx", "utf8");
  assert.doesNotMatch(page, /14[- ]day|14 days/);
  assert.match(page, /Become a founding member/);
});
