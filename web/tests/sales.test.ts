// Sales are invoices (owner, 20 Oct 2026): a credit note takes money and units
// off but is not another sale, each row opens where it lives, and a company
// that does not invoice reads its delivered orders as deliveries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSales, saleWord, totalsFor, within } from "@/lib/sales";
import { DEFAULT_TERMS } from "@/lib/terms";

function row(over: Record<string, unknown>) {
  return {
    doc_id: "d",
    doc_kind: "invoice",
    doc_number: "1",
    invoice_id: "d",
    order_id: null,
    rep_id: "r1",
    rep_name: "Atang",
    store_id: "s1",
    store_name: "Spar Riverside",
    store_city: "Gaborone",
    issued_on: "2026-10-17",
    issued_at: "2026-10-17T10:00:00Z",
    units: 10,
    revenue_excl_vat: 1000,
    revenue_incl_vat: 1140,
    gross_profit: 200,
    uncosted_units: 0,
    ...over,
  };
}

/** One page of `sales_documents`, as the API hands it back. */
function client(rows: unknown[]) {
  const chain = { order: () => chain, range: async () => ({ data: rows, error: null }) };
  return { rpc: () => chain } as never;
}

test("a credit note takes money and units off, and is not counted as a sale", async () => {
  const sales = await fetchSales(
    client([
      row({ doc_id: "i1", invoice_id: "i1" }),
      row({ doc_id: "c1", doc_kind: "credit_note", doc_number: "CN-1", invoice_id: "i1", units: -1,
            revenue_excl_vat: -100, revenue_incl_vat: -114, issued_at: "2026-10-18T10:00:00Z" }),
    ]),
    DEFAULT_TERMS
  );
  assert.deepEqual(totalsFor(sales), { count: 1, units: 9, net: 900, gross: 1026 });
  assert.equal(sales[1].vat, -14);
});

test("an invoice and its credit note open the invoice; a delivered order opens the order", async () => {
  const sales = await fetchSales(
    client([
      row({ doc_id: "i1", invoice_id: "i1" }),
      row({ doc_id: "c1", doc_kind: "credit_note", invoice_id: "i1" }),
      row({ doc_id: "o1", doc_kind: "order", invoice_id: null, order_id: "o1" }),
    ]),
    DEFAULT_TERMS
  );
  assert.deepEqual(sales.map((s) => s.href), ["/invoices/i1", "/invoices/i1", "/orders/o1"]);
});

test("a sale is placed on the day it was issued", async () => {
  const [sale] = await fetchSales(client([row({})]), DEFAULT_TERMS);
  const day = { from: new Date("2026-10-16T22:00:00Z"), to: new Date("2026-10-17T21:59:59.999Z"), label: "" };
  const next = { from: new Date("2026-10-17T22:00:00Z"), to: new Date("2026-10-18T21:59:59.999Z"), label: "" };
  assert.equal(within(sale, day), true);
  assert.equal(within(sale, next), false);
});

test("the word follows the invoicing module", () => {
  assert.equal(saleWord(1, true), "invoice");
  assert.equal(saleWord(3, true), "invoices");
  assert.equal(saleWord(1, false), "delivery");
  assert.equal(saleWord(3, false), "deliveries");
});
