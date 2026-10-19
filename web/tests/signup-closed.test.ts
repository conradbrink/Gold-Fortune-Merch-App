import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SELF_SERVE_SIGNUP_OPEN } from "@/lib/signup";
import { FOUNDING_OFFER } from "@/lib/founding-offer";
import { PROMO } from "@/lib/email/brand";

// The self-serve free trial was taken off (owner, 10 Oct 2026): the way in is
// the Founding offer, which since 19 Oct 2026 is a free 14-day pilot, set up
// by us, then the founding price (owner).

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
  assert.match(src.slice(gate, gate + 260), /FOUNDING_OFFER\.applyUrl/);
});

test("the Founding offer is a 14-day pilot, then the founding price, and the page it points to is the application", () => {
  assert.equal(FOUNDING_OFFER.pilotDays, 14);
  assert.equal(FOUNDING_OFFER.price, 2097);
  assert.equal(Math.round(FOUNDING_OFFER.fullPrice * (1 - FOUNDING_OFFER.percentOff / 100)), FOUNDING_OFFER.price);
  assert.equal(FOUNDING_OFFER.applyUrl, "https://tickd.co.za/founding");
  assert.ok(PROMO.url.startsWith(FOUNDING_OFFER.applyUrl));
  assert.doesNotMatch(`${PROMO.cta} ${PROMO.body} ${PROMO.headline}`, /14/);
});

test("the sign-up page offers the Founding pilot while it is closed, not a self-serve trial", () => {
  const page = readFileSync("app/signup/page.tsx", "utf8");
  assert.doesNotMatch(page, /14[- ]day free trial|14 days free/);
  assert.match(page, /Start my free \{FOUNDING_OFFER\.pilotDays\}-day pilot/);
});
