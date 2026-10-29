// Delivery vehicles are not shelves (20261029235300). A van's empty lines are
// left out of stock_on_hand and no van or rep location raises a low-stock
// alert; the rules are the database's (supabase/tests/low_stock_locations.sql).
// This holds what the inventory table says when a picked location has nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStockText, type StockLocation } from "@/lib/warehouse";

const van: StockLocation = { id: "v1", name: "Vehicle BWK 418 FS", type: "vehicle", is_default: false };
const main: StockLocation = { id: "w1", name: "Main warehouse", type: "warehouse", is_default: true };
const none = { search: "", onlyBelowMin: false, lowOnly: false };

test("an empty van says it holds nothing, not that no stock was ever received", () => {
  assert.equal(emptyStockText({ ...none, location: van }), "Vehicle BWK 418 FS holds no stock right now.");
});

test("an empty warehouse, or every location, still asks for a first delivery", () => {
  const first = "No stock recorded yet. Receive a delivery to get started.";
  assert.equal(emptyStockText({ ...none, location: main }), first);
  assert.equal(emptyStockText({ ...none, location: null }), first);
});

test("a filter that matches nothing says so, wherever it is", () => {
  const nothing = "Nothing matches those filters.";
  assert.equal(emptyStockText({ ...none, location: van, onlyBelowMin: true }), nothing);
  assert.equal(emptyStockText({ ...none, location: van, search: "jam" }), nothing);
  assert.equal(emptyStockText({ ...none, location: null, lowOnly: true, search: "jam" }), nothing);
  assert.equal(
    emptyStockText({ ...none, location: null, lowOnly: true }),
    "Nothing is at or below its reorder point."
  );
});
