// Changing a draft or sent quote (lib/quotes.ts updateQuote): what the screen
// sends to `quote_save`, which saves it in one step, and how the database's
// refusals reach the screen. The database's own side (stale forms, a sent
// quote's client, nothing kept from a failed save) is supabase/tests/quote_save.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineColumns, quoteHeaderProblem, updateQuote, whyQuoteIsFixed, type NewQuoteLine } from "@/lib/quotes";

const text = (id: string, over: Partial<Extract<NewQuoteLine, { kind: "text" }>> = {}) =>
  ({ id, kind: "text", description: "Cooking oil 5L", unit: null, qty: 1, price: 120.25, ...over }) as const;
const product = (id: string, productId: string, over: Partial<Extract<NewQuoteLine, { kind: "product" }>> = {}) =>
  ({ id, kind: "product", productId, unitsPerShrink: null, qty: 2, listPrice: 50, discountPct: 0, discountAmount: 0, ...over }) as const;

test("a draft or sent quote can be changed; the rest say why not", () => {
  assert.equal(whyQuoteIsFixed({ status: "draft" }), null);
  assert.equal(whyQuoteIsFixed({ status: "sent" }), null);
  assert.match(whyQuoteIsFixed({ status: "accepted" }) ?? "", /Reopen it/);
  assert.match(whyQuoteIsFixed({ status: "declined" }) ?? "", /Reopen it/);
  assert.match(whyQuoteIsFixed({ status: "converted" }) ?? "", /Change the order/);
  // An invoiced quote cannot simply be reopened: its invoices are voided first.
  assert.match(whyQuoteIsFixed({ status: "accepted" }) ?? "", /void the invoices/);
});

test("who the quote is for, within the database's limits, said before saving", () => {
  assert.equal(quoteHeaderProblem({ billTo: { storeId: "s1" } }), null);
  assert.equal(quoteHeaderProblem({ billTo: { name: "Riverside Garage", address: "1 Main Road", email: "a@b.co" } }), null);
  assert.match(quoteHeaderProblem({ billTo: { name: "x".repeat(201) } }) ?? "", /name is 200/);
  assert.match(quoteHeaderProblem({ billTo: { name: "A", address: "x".repeat(501) } }) ?? "", /address is 500/);
  assert.match(quoteHeaderProblem({ billTo: { name: "A", email: `${"x".repeat(200)}@b.co` } }) ?? "", /email address is 200/);
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

test("a product priced per shrink says so, and keeps the shrink's size", () => {
  const unit = lineColumns(product("a", "p1"), 1);
  assert.equal(unit.unit, null);
  assert.equal(unit.units_per_shrink, null);
  const shrink = lineColumns(product("a", "p1", { unitsPerShrink: 10, qty: 2, listPrice: 771.69 }), 1);
  assert.equal(shrink.unit, "shrink");
  assert.equal(shrink.units_per_shrink, 10);
  // qty counts shrinks and the price is a shrink's, as typed.
  assert.equal(shrink.qty, 2);
  assert.equal(shrink.list_price, 771.69);
  // Typed and price-list lines never carry a shrink.
  assert.equal(lineColumns(text("b"), 2).units_per_shrink, null);
});

// ---------------------------------------------------------------- the save itself

type Rpc = { name: string; args: Record<string, unknown> };

/** A stand-in client that records the one call and answers with `error`. */
function fakeClient(error: { message: string; hint?: string; code?: string } | null = null) {
  const calls: Rpc[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: null, error };
    },
    from() {
      throw new Error("an edited quote is saved in one call, not table by table");
    },
  };
  return { client: client as never, calls };
}

const save = (lines: (NewQuoteLine & { id: string })[], over: Partial<Parameters<typeof updateQuote>[2]> = {}) => ({
  loadedAt: "2026-10-23T07:34:18.062732+00:00",
  billTo: { name: " Riverside Garage ", address: "1 Main Road" },
  contactName: "Thandi",
  notes: "Delivery on Fridays",
  lines,
  ...over,
});

test("a save is one call to quote_save with the header, the time the form loaded, and every line under its id", async () => {
  const db = fakeClient();
  await updateQuote(
    db.client,
    "q1",
    save([
      product("line-p", "p1", { qty: 3, discountAmount: 10 }),
      text("line-a", { description: " Maize meal 10kg ", unit: " bag ", price: 845.5 }),
      { id: "line-s", kind: "service", serviceItemId: "item-1", description: "Call-out", unit: "visit", qty: 1, price: 450 },
    ])
  );
  assert.equal(db.calls.length, 1);
  const [{ name, args }] = db.calls;
  assert.equal(name, "quote_save");
  assert.equal(args.p_quote, "q1");
  assert.equal(args.p_loaded_at, "2026-10-23T07:34:18.062732+00:00");
  assert.deepEqual(args.p_header, {
    store_id: null,
    customer_name: "Riverside Garage",
    customer_address: "1 Main Road",
    contact_email: null,
    contact_name: "Thandi",
    contact_phone: null,
    rep_id: null,
    valid_until: null,
    delivery_address: null,
    notes: "Delivery on Fridays",
  });
  assert.deepEqual(args.p_lines, [
    { id: "line-p", position: 1, product_id: "p1", service_item_id: null, description: null, unit: null, units_per_shrink: null, qty: 3, list_price: 50, discount_pct: 0, discount_amount: 10 },
    { id: "line-a", position: 2, product_id: null, service_item_id: null, description: "Maize meal 10kg", unit: "bag", units_per_shrink: null, qty: 1, list_price: 845.5, discount_pct: 0, discount_amount: 0 },
    { id: "line-s", position: 3, product_id: null, service_item_id: "item-1", description: "Call-out", unit: "visit", units_per_shrink: null, qty: 1, list_price: 450, discount_pct: 0, discount_amount: 0 },
  ]);
});

test("a quote for a store sends the store and no typed-in client", async () => {
  const db = fakeClient();
  await updateQuote(db.client, "q1", save([text("a")], { billTo: { storeId: "store-1" } }));
  const header = db.calls[0].args.p_header as Record<string, unknown>;
  assert.equal(header.store_id, "store-1");
  assert.equal(header.customer_name, null);
  assert.equal(header.contact_email, null);
});

test("what the database refuses reaches the screen in its words", async () => {
  const stale = "This quote was changed after you opened it, perhaps by someone else or by sending it. Reload the page to see it as it is now, then make your changes again.";
  await assert.rejects(updateQuote(fakeClient({ message: stale, hint: "stale" }).client, "q1", save([text("a")])), /changed after you opened it/);
  // A read-only company is told what to do about it.
  await assert.rejects(
    updateQuote(fakeClient({ message: "Your company's account is read-only until the plan is paid.", hint: "read_only", code: "42501" }).client, "q1", save([text("a")])),
    /Open Billing to choose a plan/
  );
});

test("nothing is sent when the screen can already say what is wrong", async () => {
  const db = fakeClient();
  await assert.rejects(updateQuote(db.client, "q1", save([])), /at least one line/);
  await assert.rejects(updateQuote(db.client, "q1", save([text("a")], { billTo: { name: "x".repeat(201) } })), /name is 200/);
  assert.equal(db.calls.length, 0);
});
