// Damaged stock (owner, 15 Oct 2026). The rules are the database's
// (supabase/tests/damaged_stock.sql); this holds the words on the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { damagedWhat } from "@/lib/damages";
import { moduleForPath } from "@/lib/modules";

test("what was damaged: the product, else what the rep wrote", () => {
  assert.equal(damagedWhat({ product_name: "Elf Box Grape Ice", item: null }), "Elf Box Grape Ice");
  assert.equal(damagedWhat({ product_name: null, item: "Display stand" }), "Display stand");
  assert.equal(damagedWhat({ product_name: null, item: null }), "Not recorded");
});

test("the damaged stock and reorder pages belong to the distribution module", () => {
  assert.equal(moduleForPath("/stores/damages"), "distribution");
  assert.equal(moduleForPath("/stores/reorder"), "distribution");
  assert.equal(moduleForPath("/stores"), "core");
});
