// Price lists per store group (owner, 15 Oct 2026). The screens prefill what
// `store_unit_price` in the database gives a line saved without a price, so
// these are the cases supabase/tests/price_lists.sql checks there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shrinkPriceFor, unitPriceFor } from "@/lib/orders";
import { differenceFromOwn, listForGroup, type PriceBook } from "@/lib/price-lists";

const lighter = { id: "p1", units_per_shrink: 50, shrink_price_excl_vat: 272.37 };
const book: PriceBook = { forecourts: { name: "Forecourts & HRC", prices: { p1: 294.16, p4: 60 } } };

test("a store's list price wins over the product's own, per unit", () => {
  assert.equal(unitPriceFor(lighter), "5.45");
  assert.equal(unitPriceFor(lighter, listForGroup(book, "forecourts")), "5.88");
});

test("a product the list leaves out, or a store with no list, uses its own price", () => {
  assert.equal(unitPriceFor({ ...lighter, id: "p2" }, listForGroup(book, "forecourts")), "5.45");
  assert.equal(unitPriceFor(lighter, listForGroup(book, "choppies")), "5.45");
  assert.equal(unitPriceFor(lighter, listForGroup(book, null)), "5.45");
});

test("a list price with no pack size, or no price anywhere, gives nothing", () => {
  assert.equal(unitPriceFor({ id: "p4", units_per_shrink: null, shrink_price_excl_vat: null }, book.forecourts), null);
  assert.equal(unitPriceFor({ id: "p4", units_per_shrink: 12, shrink_price_excl_vat: null }, book.forecourts), "5.00");
  assert.equal(unitPriceFor({ id: "p5", units_per_shrink: 12, shrink_price_excl_vat: null }, book.forecourts), null);
});

test("half a cent rounds up, as Postgres does", () => {
  // 0.25 / 50 = 0.005: round(…, 2) in the database is 0.01.
  assert.equal(unitPriceFor({ units_per_shrink: 50, shrink_price_excl_vat: 0.25 }), "0.01");
  assert.equal(unitPriceFor({ units_per_shrink: 2, shrink_price_excl_vat: 1.01 }), "0.51");
});

test("the difference from the product's own price", () => {
  assert.equal(differenceFromOwn(294.16, 272.37), "+8.0%");
  assert.equal(differenceFromOwn(250, 272.37), "-8.2%");
  assert.equal(differenceFromOwn(272.37, 272.37), "Same");
  assert.equal(differenceFromOwn(10, null), null);
});

test("a quote priced per shrink starts at the shrink price: the store's list's, or the product's own", () => {
  assert.equal(shrinkPriceFor(lighter), "272.37");
  assert.equal(shrinkPriceFor(lighter, listForGroup(book, "forecourts")), "294.16");
  assert.equal(shrinkPriceFor({ ...lighter, id: "p2" }, listForGroup(book, "forecourts")), "272.37");
  // No pack size is needed for the shrink's own price.
  assert.equal(shrinkPriceFor({ id: "p4", shrink_price_excl_vat: null }, book.forecourts), "60.00");
  assert.equal(shrinkPriceFor({ id: "p5", shrink_price_excl_vat: null }, book.forecourts), null);
});
