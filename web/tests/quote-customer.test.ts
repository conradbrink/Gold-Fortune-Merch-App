// A quote for someone new becomes an order for the customer of the same name,
// or adds them (quote_convert, 20261028113700). The web matches names the
// same way, to warn on the quote form and to word the Convert question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameName } from "@/lib/quotes";

test("case and spacing do not make a different customer", () => {
  assert.equal(sameName("MAIN ROAD GARAGE", "Main Road Garage"), true);
  assert.equal(sameName("  Hill   Superette ", "hill superette"), true);
  assert.equal(sameName("River\tCafe", "River Cafe"), true);
});

test("a different name is a different customer", () => {
  assert.equal(sameName("Main Road Garage", "Main Road Garage 2"), false);
  assert.equal(sameName("Riverside Fuel - Maun", "Riverside Fuel"), false);
});

test("an empty name matches nothing", () => {
  assert.equal(sameName("", ""), false);
  assert.equal(sameName("   ", " "), false);
});
