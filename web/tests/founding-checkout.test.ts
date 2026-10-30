// The founding price, paid by card (owner, 30 Oct 2026: "we're giving them
// the price of R2097 per month - so there should be a checkout button"), and
// the one add-on offered with it. The database prices both
// (supabase/tests/founding_price.sql); these hold the page's side. The plans
// page itself is checked on screen (a .tsx cannot load in this runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFounding, usesCheckoutAddon, CHECKOUT_ADDON } from "@/lib/billing";
import { ADDON } from "@/lib/plans";

test("founding terms are read as the database sends them, and nothing else is", () => {
  assert.deepEqual(parseFounding({ percent_off: 40, months: 3, months_left: 3 }), { percentOff: 40, months: 3, monthsLeft: 3 });
  assert.deepEqual(parseFounding({ percent_off: 40, months: 3, months_left: 9 }), { percentOff: 40, months: 3, monthsLeft: 3 });
  assert.deepEqual(parseFounding({ percent_off: 40, months: 3, months_left: null }), { percentOff: 40, months: 3, monthsLeft: 0 });
  for (const raw of [null, undefined, "x", [], {}, { percent_off: 0, months: 3 }, { percent_off: 40, months: 0 }, { percent_off: 140, months: 3 }]) {
    assert.equal(parseFounding(raw), null, JSON.stringify(raw));
  }
});

test("the add-on is ticked from the start only for a company already using it", () => {
  assert.equal(usesCheckoutAddon(null), false);
  assert.equal(usesCheckoutAddon({ modules: new Set(["core", "distribution", "deliveries"]) }), false);
  assert.equal(usesCheckoutAddon({ modules: new Set(["core", "warehouse"]) }), true);
  assert.equal(usesCheckoutAddon({ modules: new Set(["core", "hr"]) }), true);
  assert.equal(CHECKOUT_ADDON, "warehouse");
});

test("the add-on is described and priced as the sales site sells it", () => {
  const site = readFileSync(join(process.cwd(), "..", "site", "components", "pricing-section.tsx"), "utf8").replace(/&apos;/g, "'");
  assert.ok(site.includes(ADDON.name), ADDON.name);
  assert.ok(site.includes(ADDON.what), ADDON.what);
  assert.ok(site.includes(`R${ADDON.monthly} a month for both`), `R${ADDON.monthly}`);
});
