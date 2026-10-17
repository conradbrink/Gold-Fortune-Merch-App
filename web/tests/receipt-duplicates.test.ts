// A delivery keyed twice (owner, 17 Oct 2026: "when I loaded stock into the
// system as goods received note it added an extra unit per thing"). GRN-000006
// was GRN-000005 again, in single items instead of cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findLookAlike,
  lineBase,
  receiptsLookAlike,
  type ReceiptForMatch,
} from "@/lib/receipt-duplicates";

const grn5: ReceiptForMatch = {
  id: "g5",
  grn_number: "GRN-000005",
  status: "posted",
  supplier_name: null,
  invoice_number: null,
  received_at: "2026-09-01T08:36:00+00:00",
  posted_at: "2026-09-04T09:28:07+00:00",
  lines: [
    { product_id: "pure-hemp", qty_received: 3, base: 150 },
    { product_id: "newport", qty_received: 1, base: 12 },
    { product_id: "xqs-cherry", qty_received: 2, base: 20 },
  ],
};

const grn6: ReceiptForMatch = {
  id: "g6",
  grn_number: "GRN-000006",
  status: "posted",
  supplier_name: "OTP South Africa",
  invoice_number: "INV000366345",
  received_at: "2026-09-14T15:02:00+00:00",
  posted_at: "2026-09-15T06:47:08+00:00",
  lines: [
    { product_id: "xqs-cherry", qty_received: 2, base: 2 },
    { product_id: "pure-hemp", qty_received: 3, base: 3 },
    { product_id: "newport", qty_received: 1, base: 1 },
  ],
};

test("the same products and quantities, in another unit, is the same delivery", () => {
  const m = receiptsLookAlike(grn6, grn5);
  assert.ok(m);
  assert.equal(m.grn_number, "GRN-000005");
  assert.equal(m.sameLines, true);
  assert.equal(m.sameInvoice, false);
  assert.deepEqual(m.units, { theirs: 182, ours: 6 });
});

test("a draft of GRN-000006 would have been stopped before posting", () => {
  const draft = { ...grn6, status: "draft", posted_at: null };
  assert.equal(findLookAlike(draft, [grn5])?.grn_number, "GRN-000005");
});

test("the first of a pair is never called a copy of the second", () => {
  assert.equal(findLookAlike(grn5, [grn6]), null);
  assert.equal(findLookAlike(grn6, [grn5])?.grn_number, "GRN-000005");
  // A reversed receipt no longer counts.
  assert.equal(findLookAlike(grn6, [{ ...grn5, status: "cancelled" }]), null);
});

test("the same supplier invoice number is a match on its own", () => {
  const again: ReceiptForMatch = {
    ...grn6,
    id: "g9",
    grn_number: "GRN-000009",
    status: "draft",
    posted_at: null,
    invoice_number: " inv000366345 ",
    lines: [{ product_id: "newport", qty_received: 5, base: 5 }],
  };
  const m = findLookAlike(again, [grn6]);
  assert.equal(m?.sameInvoice, true);
  assert.equal(m?.sameLines, false);
  // Another supplier's invoice with the same number is not.
  assert.equal(findLookAlike({ ...again, supplier_name: "HK IFIX" }, [grn6]), null);
});

test("one product alone, or different quantities, is a new delivery", () => {
  const monthly = (id: string): ReceiptForMatch => ({
    ...grn5,
    id,
    grn_number: id,
    status: id === "a" ? "posted" : "draft",
    lines: [{ product_id: "okso-kiwi", qty_received: 200, base: 200 }],
  });
  assert.equal(findLookAlike(monthly("b"), [monthly("a")]), null);

  const different = {
    ...grn6,
    status: "draft",
    posted_at: null,
    invoice_number: null,
    lines: grn6.lines.map((l, i) => (i === 0 ? { ...l, qty_received: 4 } : l)),
  };
  assert.equal(findLookAlike(different, [grn5]), null);
});

test("single items a line puts into stock, as posting works them out", () => {
  const line = { uom: "case", qty_received: 3, units_per_uom: 50, qty_base: null, units_per_shrink: null };
  assert.equal(lineBase(line), 150);
  assert.equal(lineBase({ ...line, uom: "each", units_per_uom: null }), 3);
  assert.equal(lineBase({ ...line, uom: "shrink", units_per_uom: null, units_per_shrink: 10 }), 30);
  assert.equal(lineBase({ ...line, uom: "shrink", units_per_uom: null }), null);
  // Once posted, the frozen figure wins.
  assert.equal(lineBase({ ...line, qty_base: 12 }), 12);
});
