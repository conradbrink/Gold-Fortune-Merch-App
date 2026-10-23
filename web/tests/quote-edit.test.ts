// Changing a draft or sent quote (lib/quotes.ts updateQuote): which lines are
// written, changed, added and taken off, against the lines the quote has now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineColumns, planLineChanges, whyQuoteIsFixed, type NewQuoteLine } from "@/lib/quotes";

// As PostgREST returns them: numerics as strings.
const saved = (over: Record<string, unknown>) => ({
  id: "x",
  position: 1,
  product_id: null,
  service_item_id: null,
  description: null,
  unit: null,
  qty: "1.00",
  list_price: "0.00",
  discount_pct: "0.00",
  discount_amount: "0.00",
  ...over,
}) as never;

const text = (id: string, over: Partial<Extract<NewQuoteLine, { kind: "text" }>> = {}) =>
  ({ id, kind: "text", description: "Cooking oil 5L", unit: null, qty: 1, price: 120.25, ...over }) as const;
const product = (id: string, productId: string, over: Partial<Extract<NewQuoteLine, { kind: "product" }>> = {}) =>
  ({ id, kind: "product", productId, qty: 2, listPrice: 50, discountPct: 0, discountAmount: 0, ...over }) as const;

test("a draft or sent quote can be changed; the rest say why not", () => {
  assert.equal(whyQuoteIsFixed({ status: "draft" }), null);
  assert.equal(whyQuoteIsFixed({ status: "sent" }), null);
  assert.match(whyQuoteIsFixed({ status: "accepted" }) ?? "", /Reopen it/);
  assert.match(whyQuoteIsFixed({ status: "declined" }) ?? "", /Reopen it/);
  assert.match(whyQuoteIsFixed({ status: "converted" }) ?? "", /Change the order/);
});

test("clearing the unit typed as a price changes only that line", () => {
  // The quote that started this: its first line had the price in the unit box as well.
  const plan = planLineChanges(
    [
      saved({ id: "a", position: 1, description: "Maize meal 10kg", unit: "845.50", list_price: "845.50" }),
      saved({ id: "b", position: 2, description: "Cooking oil 5L", unit: null, list_price: "120.25" }),
    ],
    [text("a", { description: "Maize meal 10kg", price: 845.5 }), text("b")]
  );
  assert.deepEqual(plan.updates.map((u) => [u.id, u.columns.unit]), [["a", null]]);
  assert.deepEqual(plan.inserts, []);
  assert.deepEqual(plan.deletes, []);
});

test("a line added, a line taken off, and the order moved", () => {
  const plan = planLineChanges(
    [saved({ id: "a", position: 1, description: "Deep clean" }), saved({ id: "b", position: 2, description: "Windows" })],
    [text("b", { description: "Windows", price: 0 }), text("new-1", { description: "Carpets", price: 300 })]
  );
  assert.deepEqual(plan.updates.map((u) => [u.id, u.columns.position]), [["b", 1]]);
  assert.deepEqual(plan.inserts.map((r) => [r.id, r.position, r.description]), [["new-1", 2, "Carpets"]]);
  assert.deepEqual(plan.deletes, ["a"]);
});

test("a product taken off and put back on is the same saved line, not a second one", () => {
  // quote_lines is unique on (quote_id, product_id): an insert would be refused.
  const plan = planLineChanges(
    [saved({ id: "a", product_id: "p1", qty: "2.00", list_price: "50.00" })],
    [product("fresh-id", "p1", { qty: 3 })]
  );
  assert.deepEqual(plan.updates.map((u) => [u.id, u.columns.qty]), [["a", 3]]);
  assert.deepEqual(plan.inserts, []);
  assert.deepEqual(plan.deletes, []);
});

test("saving again after a part-way failure adds nothing twice", () => {
  // The first try wrote the new line under its own id, then failed; the screen still holds that id.
  const lines = [text("a", { description: "Deep clean", price: 100 }), text("new-1", { description: "Carpets", price: 300 })];
  const plan = planLineChanges(
    [
      saved({ id: "a", position: 1, description: "Deep clean", list_price: "100.00" }),
      saved({ id: "new-1", position: 2, description: "Carpets", list_price: "300.00" }),
    ],
    lines
  );
  assert.deepEqual(plan, { updates: [], inserts: [], deletes: [] });
});

test("an edited line drops what it no longer has", () => {
  const c = lineColumns(product("a", "p1", { discountPct: 10, discountAmount: 5 }), 1);
  // An amount off the line wins over a percentage, as on a new quote.
  assert.equal(c.discount_pct, 0);
  assert.equal(c.discount_amount, 5);
  const t = lineColumns(text("b", { unit: "  " }), 2);
  assert.equal(t.unit, null);
  assert.equal(t.product_id, null);
  assert.equal(t.discount_amount, 0);
});
