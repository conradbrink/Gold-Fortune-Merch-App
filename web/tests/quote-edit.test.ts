// Changing a draft or sent quote (lib/quotes.ts updateQuote): which lines are
// written, changed, added and taken off, against the lines the quote has now,
// and what a save refuses (a form opened before someone else's save, a write
// the database's row rules turned away, a sent quote's client).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lineColumns,
  planLineChanges,
  quoteHeaderProblem,
  updateQuote,
  whyQuoteIsFixed,
  type NewQuoteLine,
} from "@/lib/quotes";

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

test("a service line keeps its price-list item", () => {
  const plan = planLineChanges(
    [saved({ id: "s", description: "Call-out", service_item_id: "item-1", list_price: "450.00" })],
    [{ id: "s", kind: "service", serviceItemId: "item-1", description: "Call-out", unit: "visit", qty: 1, price: 450 }]
  );
  assert.deepEqual(plan.updates.map((u) => [u.id, u.columns.service_item_id, u.columns.unit]), [["s", "item-1", "visit"]]);
});

// ---------------------------------------------------------------- the save itself

type Row = Record<string, unknown>;

/**
 * A small stand-in for the browser client with real filtering. Every write is
 * logged in order; a quotes update moves `updated_at`, as the quotes_stamp
 * trigger does; `writable: false` makes updates and deletes match nothing, as
 * the billing gate's row rules do for a read-only company.
 */
function fakeDb(tables: { quotes: Row[]; quote_lines: Row[] }, opts: { writable?: boolean; failOn?: string; onWrite?: (w: string) => void } = {}) {
  const writes: string[] = [];
  let clock = 1;
  const log = (w: string) => {
    writes.push(w);
    opts.onWrite?.(w);
  };
  class Q {
    filters: ((r: Row) => boolean)[] = [];
    patch: Row | null = null;
    op: "read" | "update" | "delete" = "read";
    one = false;
    table: "quotes" | "quote_lines";
    constructor(table: "quotes" | "quote_lines") {
      this.table = table;
    }
    select() { return this; }
    single() { this.one = true; return this; }
    eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
    in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
    update(p: Row) { this.op = "update"; this.patch = p; return this; }
    delete() { this.op = "delete"; return this; }
    async insert(rows: Row[]) {
      const w = `insert ${this.table}`;
      log(w);
      if (opts.failOn === w) return { error: { message: "network" } };
      tables[this.table].push(...rows.map((r) => ({ ...r })));
      return { error: null };
    }
    then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
      let rows = tables[this.table].filter((r) => this.filters.every((f) => f(r)));
      if (this.op !== "read") {
        const w = `${this.op} ${this.table}`;
        log(w);
        if (opts.failOn === w) return Promise.resolve({ data: null, error: { message: "network" } }).then(ok, bad);
        if (opts.writable === false) rows = [];
        if (this.op === "update") {
          for (const r of rows) {
            Object.assign(r, this.patch);
            if (this.table === "quotes") r.updated_at = `t${++clock}`;
          }
        }
        if (this.op === "delete") tables[this.table] = tables[this.table].filter((r) => !rows.includes(r));
      }
      const data = rows.map((r) => ({ ...r }));
      return Promise.resolve({ data: this.one ? (data[0] ?? null) : data, error: null }).then(ok, bad);
    }
  }
  return { client: { from: (t: "quotes" | "quote_lines") => new Q(t) } as never, writes, tables };
}

const quoteRow = (over: Row = {}): Row => ({
  id: "q1",
  status: "sent",
  updated_at: "t1",
  store_id: null,
  customer_name: "Riverside Garage",
  customer_address: null,
  contact_email: null,
  notes: "old note",
  ...over,
});
const lineRow = (over: Row): Row => ({ ...(saved(over) as Row), quote_id: "q1", org_id: "o1" });
const save = (lines: (NewQuoteLine & { id: string })[], over: Partial<Parameters<typeof updateQuote>[2]> = {}) => ({
  orgId: "o1",
  loadedAt: "t1",
  billTo: { name: "Riverside Garage" },
  notes: "new note",
  lines,
  ...over,
});

test("a save writes changed and new lines, then takes lines off, then the header, which keeps a sent quote's client", async () => {
  const db = fakeDb({
    quotes: [quoteRow()],
    quote_lines: [
      lineRow({ id: "a", position: 1, description: "Maize meal 10kg", unit: "845.50", list_price: "845.50" }),
      lineRow({ id: "b", position: 2, description: "Cooking oil 5L", list_price: "120.25" }),
    ],
  });
  await updateQuote(
    db.client,
    "q1",
    save([text("a", { description: "Maize meal 10kg", price: 845.5 }), text("new-1", { description: "Delivery", price: 250 })], {
      billTo: { name: "Someone else entirely" },
    })
  );
  assert.ok(db.writes.indexOf("insert quote_lines") < db.writes.indexOf("delete quote_lines"), db.writes.join(", "));
  assert.equal(db.writes.at(-1), "update quotes");
  assert.deepEqual(
    db.tables.quote_lines.map((r) => [r.id, r.description, r.unit]),
    [
      ["a", "Maize meal 10kg", null],
      ["new-1", "Delivery", null],
    ]
  );
  // The link in the first client's email shows the quote as it is now: a sent quote never changes hands.
  assert.equal(db.tables.quotes[0].customer_name, "Riverside Garage");
  assert.equal(db.tables.quotes[0].notes, "new note");
});

test("a draft can still change who it is for", async () => {
  const db = fakeDb({ quotes: [quoteRow({ status: "draft" })], quote_lines: [lineRow({ id: "a", description: "Delivery" })] });
  await updateQuote(db.client, "q1", save([text("a", { description: "Delivery", price: 0 })], { billTo: { name: "Someone else" } }));
  assert.equal(db.tables.quotes[0].customer_name, "Someone else");
});

test("a form opened before somebody else's save is refused, and writes nothing", async () => {
  const db = fakeDb({ quotes: [quoteRow({ updated_at: "t9" })], quote_lines: [lineRow({ id: "a", description: "Delivery" })] });
  await assert.rejects(updateQuote(db.client, "q1", save([text("a", { description: "Delivery" })])), /changed after you opened it/);
  assert.deepEqual(db.writes, []);
});

test("an accepted quote is refused before anything is written", async () => {
  const db = fakeDb({ quotes: [quoteRow({ status: "accepted" })], quote_lines: [lineRow({ id: "a", description: "Delivery" })] });
  await assert.rejects(updateQuote(db.client, "q1", save([text("a", { description: "Delivery" })])), /accepted/);
  assert.deepEqual(db.writes, []);
});

test("a write the row rules turn away (a read-only company) is an error, not a success", async () => {
  const db = fakeDb(
    { quotes: [quoteRow()], quote_lines: [lineRow({ id: "a", description: "Delivery", list_price: "100.00" })] },
    { writable: false }
  );
  await assert.rejects(updateQuote(db.client, "q1", save([text("a", { description: "Delivery", price: 150 })])), /not saved/);
  assert.ok(!db.writes.includes("update quotes"), db.writes.join(", "));
});

test("accepted while the save was under way: the header is not written over it", async () => {
  const quotes = [quoteRow()];
  const db = fakeDb(
    { quotes, quote_lines: [lineRow({ id: "a", description: "Delivery", list_price: "100.00" })] },
    { onWrite: (w) => w === "update quote_lines" && (quotes[0].status = "accepted") }
  );
  await assert.rejects(updateQuote(db.client, "q1", save([text("a", { description: "Delivery", price: 150 })])), /not saved/);
  assert.equal(quotes[0].notes, "old note");
});

test("saving again after a failure part-way finishes the job, with no line twice", async () => {
  const tables = {
    quotes: [quoteRow()],
    quote_lines: [lineRow({ id: "a", description: "Deep clean", list_price: "100.00" }), lineRow({ id: "b", position: 2, description: "Windows" })],
  };
  const lines = [text("a", { description: "Deep clean", price: 100 }), text("new-1", { description: "Carpets", price: 300 })];
  // The new line goes in, then the connection drops before "Windows" is taken off.
  await assert.rejects(updateQuote(fakeDb(tables, { failOn: "delete quote_lines" }).client, "q1", save(lines)), /network/);
  assert.equal(tables.quote_lines.length, 3);
  await updateQuote(fakeDb(tables).client, "q1", save(lines));
  assert.deepEqual(tables.quote_lines.map((r) => r.id), ["a", "new-1"]);
});
