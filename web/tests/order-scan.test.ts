// Enter in an order's product search adds the top match, as a barcode scanner
// sends Enter after the code. A barcode several products share (one per
// quantity band, 31 Oct) is a guess, so it leaves the clerk to pick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enterPick, matchProducts } from "@/lib/orders";

const p = (name: string, unit: string | null, shrink: string | null) => ({
  name, brand: null, sku_code: null, unit_barcode: unit, shrink_barcode: shrink,
});
const products = [
  p("4 x 5L (up to 6)", null, "0745853789817"),
  p("4 x 5L (7-12)", null, "0745853789817"),
  p("6 x 1.5L", "6008460100548", "0745853789824"),
];

test("a barcode on one product is added", () => {
  const q = "0745853789824";
  assert.equal(enterPick(matchProducts(products, q), q)?.name, "6 x 1.5L");
});

test("a barcode several products share is not guessed", () => {
  const q = "0745853789817";
  assert.equal(matchProducts(products, q).length, 2);
  assert.equal(enterPick(matchProducts(products, q), q), null);
});

test("typed text still takes the top match", () => {
  assert.equal(enterPick(matchProducts(products, "4 x 5l"), "4 x 5l")?.name, "4 x 5L (up to 6)");
  assert.equal(enterPick([], "x"), null);
});
