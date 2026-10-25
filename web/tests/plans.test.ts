// The plans page: the same three plans as the sales site, the plan that fits
// a team, and the ready-written message each button opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOUNDING_OFFER } from "@/lib/founding-offer";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";
import { PLANS, contactLink, foundingFrom, foundingLine, foundingPrice, planFor, planMessage, rand } from "@/lib/plans";
// The site's own code, loaded by address so this project's type checker doesn't reach into the other project.
const sitePath = new URL("../../site/lib/site.ts", import.meta.url).href;
const site = (await import(sitePath)) as {
  pricing: { plans: readonly { reps: number; monthly: number }[]; popularReps: number; yearlyMonths: number; setupValue: number };
  founding: { pilotDays: number; pilotReps: number; priceMonths: number; percentOff: number; spots: number; caller: string; callerNumber: string };
  foundingPrice: (plan: { reps: number; monthly: number }) => number;
  foundingFrom: number;
  foundingStack: { name: string; worth: number }[];
};

test("the app's plans are the site's plans", () => {
  assert.deepEqual(
    PLANS.plans.map((p) => ({ ...p })),
    site.pricing.plans.map((p) => ({ ...p }))
  );
  assert.equal(PLANS.popularReps, site.pricing.popularReps);
  assert.equal(PLANS.yearlyMonths, site.pricing.yearlyMonths);
  assert.equal(PLANS.setupValue, site.pricing.setupValue);
});

test("the founding price is the site's: 40% off the plan that fits, for the first 3 months", () => {
  for (const k of ["pilotDays", "pilotReps", "priceMonths", "percentOff", "spots", "caller", "callerNumber"] as const) {
    assert.equal(FOUNDING_OFFER[k], site.founding[k], k);
  }
  assert.equal(FOUNDING_OFFER.percentOff, 40);
  assert.equal(FOUNDING_OFFER.priceMonths, 3);
  assert.deepEqual(PLANS.plans.map(foundingPrice), [1197, 2097, 3597]);
  assert.deepEqual(PLANS.plans.map(foundingPrice), site.pricing.plans.map(site.foundingPrice));
  assert.equal(foundingFrom, site.foundingFrom);
  assert.equal(foundingLine, "40% off your plan for 3 months, from R1,197 a month");
  // The AI Manager is part of every plan, so it is not a founding bonus.
  assert.ok(!site.foundingStack.some((b) => b.name.includes("AI Manager")));
});

test("the plan that fits is the smallest one with room for the team", () => {
  assert.equal(planFor(1)?.reps, 5);
  assert.equal(planFor(5)?.reps, 5);
  assert.equal(planFor(6)?.reps, 10);
  assert.equal(planFor(15)?.reps, 15);
  assert.equal(planFor(16), null);
});

// A distributor's words, as its template sets them.
const t: Terms = { ...DEFAULT_TERMS, staff: { one: "Rep", many: "Reps", article: null } };

test("each button's message names the company and the plan, in the company's words", () => {
  assert.equal(
    planMessage({ kind: "plan", reps: 10 }, " Gf motors ", t),
    "Hi, we'd like the plan for up to 10 reps for Gf motors (R3,495 a month)."
  );
  assert.equal(
    planMessage({ kind: "founding" }, null, t),
    "Hi, we'd like the founding price: 40% off your plan for 3 months, from R1,197 a month."
  );
  assert.equal(
    planMessage({ kind: "founding", reps: 4 }, "Moloto Foods", t),
    "Hi, we'd like the founding price for Moloto Foods: R1,197 a month for 3 months, on the plan for up to 5 reps."
  );
  assert.equal(
    planMessage({ kind: "founding", reps: 18 }, "Moloto Foods", t),
    "Hi, we'd like the founding price for Moloto Foods. We have 18 reps. What would it be for our whole team?"
  );
  assert.equal(
    planMessage({ kind: "bigger" }, "Moloto Foods", t),
    "Hi, this is Moloto Foods. We have more than 15 reps. What would Tickd cost us?"
  );
  assert.equal(planMessage({ kind: "bigger" }, "", t), "Hi, we have more than 15 reps. What would Tickd cost us?");
  assert.equal(
    planMessage({ kind: "plan", reps: 5 }, null, DEFAULT_TERMS),
    "Hi, we'd like the plan for up to 5 staff (R1,995 a month)."
  );
  assert.equal(rand(16776), "R16,776");
});

test("WhatsApp when the number is set, else email, else no button", () => {
  assert.equal(
    contactLink({ email: "hello@tickd.co.za", whatsapp: "+27 82 123 4567" }, "Hi there", "Plan"),
    "https://wa.me/27821234567?text=Hi%20there"
  );
  assert.equal(
    contactLink({ email: "hello@tickd.co.za", whatsapp: null }, "Hi there", "The plan"),
    "mailto:hello@tickd.co.za?subject=The%20plan&body=Hi%20there"
  );
  assert.equal(contactLink({ email: null, whatsapp: " " }, "Hi", "Plan"), null);
});
