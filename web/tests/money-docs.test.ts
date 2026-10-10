// The arithmetic of quotes, invoices and credit notes (Stage 7 Part 1a). The
// screens preview what the database will write, so these cases are the ones
// the money suite (supabase/tests/money.sql) checks against the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageingKey, documentTotals, formatQty, grossPrice, lineTotal, validPrice, validQty } from "@/lib/money-docs";
import { invoiceSources, usesPriceList, workflowPreset, MONEY_WORKFLOWS } from "@/lib/money-workflow";
import { toModuleSet } from "@/lib/modules";
import { DEFAULT_TERMS } from "@/lib/terms";

test("line totals round half away from zero, as the database does", () => {
  assert.equal(lineTotal(1.5, 450), 675);
  assert.equal(lineTotal(2, 35.5), 71);
  assert.equal(lineTotal(1.5, 1.15), 1.73); // a float makes it 1.7249999… and rounds down
  assert.equal(lineTotal(0.25, 0.1), 0.03);
  assert.equal(lineTotal(1, -5000), -5000);
});

test("VAT added on top: the money suite's quote (746.00 + 111.90)", () => {
  const t = documentTotals([{ qty: 1.5, unitPrice: 450 }, { qty: 2, unitPrice: 35.5 }], 15, false);
  assert.deepEqual(t, { subtotal: 746, vat: 111.9, total: 857.9 });
});

test("VAT included: the part of the price at the rate", () => {
  assert.deepEqual(documentTotals([{ qty: 1, unitPrice: 1150 }], 15, true), { subtotal: 1000, vat: 150, total: 1150 });
  assert.deepEqual(documentTotals([{ qty: 0.5, unitPrice: 1150 }], 15, true), { subtotal: 500, vat: 75, total: 575 });
});

test("a final invoice's deductions and no VAT at all", () => {
  const t = documentTotals(
    [{ qty: 1, unitPrice: 10000 }, { qty: 1, unitPrice: -5000 }, { qty: 1, unitPrice: -2000 }],
    15,
    false
  );
  assert.deepEqual(t, { subtotal: 3000, vat: 450, total: 3450 });
  assert.deepEqual(documentTotals([{ qty: 2, unitPrice: 300 }], 0, false), { subtotal: 600, vat: 0, total: 600 });
});

test("quantities and prices the database takes", () => {
  assert.ok(validQty("1.5") && validQty("0.25") && validQty("3") && validQty("1.13") && validQty("2.07"));
  assert.ok(!validQty("0") && !validQty("-1") && !validQty("1.255") && !validQty("") && !validQty("x"));
  assert.ok(validPrice("0") && validPrice("12.30") && validPrice("450"));
  assert.ok(!validPrice("-1") && !validPrice("1.005") && !validPrice(""));
  assert.equal(formatQty(2), "2");
  assert.equal(formatQty(1.5), "1.5");
});

test("ageing columns by days past due", () => {
  assert.equal(ageingKey(-3), "not_due");
  assert.equal(ageingKey(0), "not_due");
  assert.equal(ageingKey(6), "days_1_30");
  assert.equal(ageingKey(31), "days_31_60");
  assert.equal(ageingKey(65), "days_61_90");
  assert.equal(ageingKey(91), "days_over_90");
});

test("every route has a name, a description and its switches, in the company's words", () => {
  for (const w of MONEY_WORKFLOWS) {
    const p = workflowPreset(w, DEFAULT_TERMS);
    assert.ok(p.label.length > 0 && p.description.length > 0, w);
  }
  assert.equal(workflowPreset("quote_deposit_final", DEFAULT_TERMS).switches.deposits, true);
  assert.equal(workflowPreset("order_invoice", DEFAULT_TERMS).switches.direct, false);
});

test("which ways of invoicing a company is offered", () => {
  const trade = toModuleSet({ invoicing: true });
  const distributor = toModuleSet({ invoicing: true, distribution: true });
  const plumber = workflowPreset("quote_job_invoice", DEFAULT_TERMS).switches;
  const gf = workflowPreset("order_invoice", DEFAULT_TERMS).switches;
  assert.deepEqual(invoiceSources(plumber, trade), ["jobs", "quote", "direct"]);
  assert.deepEqual(invoiceSources(gf, distributor), ["quote", "order"]);
  assert.equal(usesPriceList(plumber, trade), true);
  assert.equal(usesPriceList(gf, distributor), false);
});

test("a product's VAT-exclusive price becomes its VAT-inclusive price, to the cent", () => {
  assert.equal(grossPrice(100, 15), 115);
  assert.equal(grossPrice(59.95, 14), 68.34); // 68.343 rounds down
  assert.equal(grossPrice(0.35, 15), 0.4); // 0.4025
  assert.equal(grossPrice(10, 0), 10);
});

test("a product on a VAT-inclusive quote adds up to the same total as on an exclusive one", () => {
  // 10 at R100 excl. at 15%: R1,150 either way.
  const exclusive = documentTotals([{ qty: 10, unitPrice: 100 }], 15, false);
  const inclusive = documentTotals([{ qty: 10, unitPrice: grossPrice(100, 15) }], 15, true);
  assert.deepEqual(inclusive, exclusive);
});
