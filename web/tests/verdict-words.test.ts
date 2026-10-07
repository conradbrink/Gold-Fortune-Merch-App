// Location verdicts in the company's words. The codes are data; the labels a
// manager reads (and exports) follow the terms, and Gold Fortune's must read
// exactly as they did before the terminology system.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTerms } from "@/lib/terms";
import { verdictWords } from "@/lib/verdict-words";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  client: { one: "Customer", many: "Customers" },
});

test("Gold Fortune's verdicts read as they always did", () => {
  const w = verdictWords(goldFortune);
  assert.equal(w.at_store.label, "At store");
  assert.equal(w.at_store.hint, "Inside the store's geofence — location confirmed.");
  assert.equal(
    w.off_site.hint,
    "Further from the store than your company's off-site distance — a genuine discrepancy worth checking."
  );
  assert.equal(
    w.prospect.hint,
    "A sales call on a shop that is not a customer yet. Position recorded, but there is no store geofence to measure it against."
  );
  assert.equal(w.nearby.label, "Nearby");
  assert.equal(w.off_site.label, "Off site");
  assert.equal(w.invalid_gps.label, "Invalid GPS");
  assert.equal(w.unknown.label, "No fix");
  assert.equal(w.prospect.label, "Prospect");
});

test("another company's verdicts use its words", () => {
  const w = verdictWords(
    parseTerms({
      site: { one: "Outlet", many: "Outlets" },
      client: { one: "Account", many: "Accounts" },
    })
  );
  assert.equal(w.at_store.label, "At outlet");
  assert.equal(w.at_store.hint, "Inside the outlet's geofence — location confirmed.");
  assert.match(w.prospect.hint, /not an account yet/);
  assert.match(w.prospect.hint, /no outlet geofence/);
});
