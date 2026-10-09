// A line's discount as a percentage or as an amount off the whole line (owner,
// 9 Oct). The screens preview the price each that the database stores, so
// these are the cases supabase/tests/line_discount.sql checks there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { discountProblem, netUnitPrice } from "@/lib/orders";

test("an amount off the line is spread over the quantity, to the cent", () => {
  assert.equal(netUnitPrice(59.95, 10, 50, "amount"), 54.95);
  assert.equal(netUnitPrice(20, 3, 50, "amount"), 3.33); // P50.01 off, not P50
  assert.equal(netUnitPrice(100, 2, 0, "amount"), 100);
  assert.equal(netUnitPrice(20, 2, 40, "amount"), 0);
});

test("a percentage is the same as before", () => {
  assert.equal(netUnitPrice(159.5, 10, 10, "pct"), 143.55);
  assert.equal(netUnitPrice(10.05, 4, 50, "pct"), 5.03); // 5.025, the quantity plays no part
});

test("half a cent rounds up, as Postgres does, where floats round down", () => {
  // 1.14 - 0.29 / 2 is exactly 0.995, which round(…, 2) makes 1.00. In
  // floats it is 0.99499…, and Math.round would give 0.99.
  assert.equal(Math.round((1.14 - 0.29 / 2) * 100) / 100, 0.99);
  assert.equal(netUnitPrice(1.14, 2, 0.29, "amount"), 1);
  assert.equal(netUnitPrice(10.07, 2, 0.01, "amount"), 10.07); // 10.065
});

test("no quantity yet leaves the price alone", () => {
  assert.equal(netUnitPrice(20, 0, 50, "amount"), 20);
});

test("what the screens refuse before the database does", () => {
  const line = { qty: 3, price: 20 };
  assert.equal(discountProblem({ ...line, discount: 10, kind: "pct" }), null);
  assert.match(discountProblem({ ...line, discount: 101, kind: "pct" }) ?? "", /between 0 and 100/);
  assert.match(discountProblem({ ...line, discount: -1, kind: "pct" }) ?? "", /between 0 and 100/);
  assert.equal(discountProblem({ ...line, discount: 60, kind: "amount" }), null);
  assert.match(discountProblem({ ...line, discount: 60.01, kind: "amount" }) ?? "", /more than the line is worth/);
  assert.match(discountProblem({ ...line, discount: -5, kind: "amount" }) ?? "", /negative/);
  assert.match(discountProblem({ ...line, discount: 1.005, kind: "amount" }) ?? "", /to the cent/);
  // A recurring order's catalogue price on the day: nothing to compare with.
  assert.equal(discountProblem({ qty: 3, price: null, discount: 500, kind: "amount" }), null);
});
