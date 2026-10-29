// An order's lines read per unit or per shrink (owner, 29 Oct 2026). The order
// is kept in units, so per shrink only changes what the boxes count in: these
// are the conversions there and back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  perUnitOfShrink,
  shownLine,
  shrinkUnits,
  switchedShown,
  unitPriceFromShown,
  unitsFromShown,
} from "@/lib/orders";

test("only a shrink of more than one unit can be priced per shrink", () => {
  assert.equal(shrinkUnits(10), 10);
  assert.equal(shrinkUnits(1), null);
  assert.equal(shrinkUnits(0), null);
  assert.equal(shrinkUnits(null), null);
  assert.equal(shrinkUnits(undefined), null);
});

test("a line per shrink shows shrinks and the shrink's price", () => {
  assert.deepEqual(shownLine({ qty_ordered: 20, unit_price: 37.89 }, 10), { qty: "2", price: "378.90" });
  assert.deepEqual(shownLine({ qty_ordered: 5, unit_price: 2 }, 12), { qty: "0.417", price: "24.00" });
  assert.deepEqual(shownLine({ qty_ordered: 20, unit_price: null }, 10), { qty: "2", price: "" });
  assert.deepEqual(shownLine({ qty_ordered: 20, unit_price: 37.89 }, null), { qty: "20", price: "37.89" });
});

test("switching moves what was typed across", () => {
  assert.equal(switchedShown("37.89", "price", true, 10), "378.90");
  assert.equal(switchedShown("527.95", "price", false, 10), "52.80");
  assert.equal(switchedShown("3", "qty", true, 10), "0.3");
  assert.equal(switchedShown("2.5", "qty", false, 10), "25");
  assert.equal(switchedShown("", "price", true, 10), "");
  assert.equal(switchedShown("abc", "qty", true, 10), "abc");
});

test("shrinks save as whole units, or not at all", () => {
  assert.equal(unitsFromShown("2", 10), 20);
  assert.equal(unitsFromShown("2.5", 10), 25);
  assert.equal(unitsFromShown("0.417", 12), null);
  assert.equal(unitsFromShown("0.25", 10), null);
  assert.equal(unitsFromShown("0", 10), null);
  assert.equal(unitsFromShown("", 10), null);
  assert.equal(unitsFromShown("7", null), 7);
  assert.equal(unitsFromShown("7.5", null), null);
});

test("a price per shrink saves per unit, to the cent, as the database rounds", () => {
  assert.equal(unitPriceFromShown("378.90", 10), 37.89);
  assert.equal(unitPriceFromShown("527.95", 10), 52.8);
  assert.equal(unitPriceFromShown("294.16", 50), 5.88);
  assert.equal(unitPriceFromShown("5.88", null), 5.88);
  assert.equal(unitPriceFromShown("-1", 10), null);
  assert.equal(unitPriceFromShown("", 10), null);
  assert.equal(perUnitOfShrink(0.05, 10), "0.01");
});
