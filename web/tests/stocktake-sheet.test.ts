// Stocktake print-out and Excel file (owner, 17 Oct 2026: "i'd like to see who
// took the stocktake and what date and have it give me a print out and excell
// format for it"). The approval rules are the database's
// (supabase/tests/stocktakes.sql); this holds what the sheet says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stocktakeSheet, whoAndWhen, type SheetInput } from "@/lib/stocktake-sheet";

const base: SheetInput = {
  stocktake: {
    stocktake_number: "STK-000005",
    stocktake_type: "full",
    status: "submitted",
    started_at: "2026-10-16T13:17:32Z",
    submitted_at: "2026-10-17T10:09:31Z",
    decided_at: null,
    decision_note: null,
  },
  locationName: "Gaborone Warehouse",
  people: { startedBy: "Conrad Brink", submittedBy: "Conrad Brink", decidedBy: null },
  lines: [
    {
      id: "l1",
      product_name: "Kiwi Passion Fruit",
      brand: "OKSO",
      system_qty_at_open: 53,
      counted_qty: 8,
      recount_qty: 48,
      variance_reason: "system_error",
    },
    {
      id: "l2",
      product_name: "Newport Butane Gas 300ml",
      brand: null,
      system_qty_at_open: 13,
      counted_qty: 12,
      recount_qty: null,
      variance_reason: null,
    },
  ],
  variance: [
    {
      line_id: "l1",
      product_name: "Kiwi Passion Fruit",
      batch_number: null,
      system_qty_at_open: 53,
      counted_qty: 8,
      system_qty_at_submit: 50,
      variance_qty: -2,
      variance_reason: "system_error",
    },
    {
      line_id: "l2",
      product_name: "Newport Butane Gas 300ml",
      batch_number: null,
      system_qty_at_open: 13,
      counted_qty: 12,
      system_qty_at_submit: 12,
      variance_qty: 0,
      variance_reason: null,
    },
  ],
  setAside: { l1: 40 },
};

test("the top of the sheet says who counted it and when, one line per step", () => {
  const steps = whoAndWhen(base);
  assert.equal(steps.length, 2);
  assert.match(steps[0], /^Started by Conrad Brink on 16 Oct 2026, \d\d:\d\d$/);
  assert.match(steps[1], /^Handed in by Conrad Brink on 17 Oct 2026, \d\d:\d\d$/);

  const approved = whoAndWhen({
    stocktake: { ...base.stocktake, status: "approved", decided_at: "2026-10-17T12:00:00Z" },
    people: { ...base.people, decidedBy: "Kelebogile Mooketsi" },
  });
  assert.match(approved[2], /^Approved by Kelebogile Mooketsi on 17 Oct 2026/);

  // A step nobody has taken yet is not printed as if it had been.
  const counting = whoAndWhen({
    stocktake: { ...base.stocktake, status: "counting", submitted_at: null },
    people: base.people,
  });
  assert.deepEqual(counting.length, 1);
});

test("a handed-in sheet is the record: counts, recounts, the difference and why", () => {
  const sheet = stocktakeSheet(base);
  assert.equal(sheet.title, "Stocktake STK-000005");
  assert.equal(sheet.filename, "stocktake-STK-000005");
  assert.equal(sheet.context?.[0], "Gaborone Warehouse · full count · submitted");
  assert.match(sheet.context?.[1] ?? "", /^Started by Conrad Brink/);
  assert.equal(sheet.context?.at(-1), "2 lines counted · 1 with a difference · 0 over · 2 short");
  // No batches on any line: no empty Batch column.
  assert.deepEqual(
    sheet.columns.map((c) => c.header),
    ["Product", "System at start", "Counted", "Recounted", "System at hand-in", "Difference", "Reason"]
  );
  assert.deepEqual(sheet.rows[0], {
    product: "Kiwi Passion Fruit",
    batch: "",
    open: 53,
    counted: 8,
    recount: 48,
    submit: 50,
    variance: -2,
    reason: "system error",
  });
  assert.equal(sheet.rows[1].recount, null);
});

test("while counting, the sheet is the one to carry round: blank counts, packed boxes named", () => {
  const sheet = stocktakeSheet({
    ...base,
    stocktake: { ...base.stocktake, status: "counting", submitted_at: null },
    lines: base.lines.map((l) => ({ ...l, counted_qty: null, recount_qty: null })),
    variance: [],
  });
  assert.deepEqual(
    sheet.columns.map((c) => c.header),
    ["Product", "System says", "Of which packed for orders", "Counted", "If different, why?"]
  );
  assert.equal(sheet.rows[0].product, "Kiwi Passion Fruit (OKSO)");
  assert.equal(sheet.rows[0].packed, 40);
  assert.equal(sheet.rows[0].counted, null);
  assert.equal(sheet.rows[1].packed, null);
  assert.match(sheet.context?.at(-1) ?? "", /including boxes packed for orders/);
});

test("the count's own note is on the sheet", () => {
  const sheet = stocktakeSheet({
    ...base,
    stocktake: { ...base.stocktake, notes: "GRN-000006 reversed: keyed twice" },
  });
  assert.ok(sheet.context?.includes("Note: GRN-000006 reversed: keyed twice"));
});

test("a rejection's reason is on the sheet", () => {
  const sheet = stocktakeSheet({
    ...base,
    stocktake: {
      ...base.stocktake,
      status: "rejected",
      decided_at: "2026-10-17T12:00:00Z",
      decision_note: "Packed boxes not counted",
    },
    people: { ...base.people, decidedBy: "Conrad Brink" },
  });
  assert.ok(sheet.context?.includes("Rejected: Packed boxes not counted"));
  assert.ok(sheet.context?.some((l) => l.startsWith("Rejected by Conrad Brink on")));
});

test("a cancelled count is the sheet as it stood: who cancelled it, why, and no packed boxes", () => {
  const sheet = stocktakeSheet({
    ...base,
    stocktake: {
      ...base.stocktake,
      status: "cancelled",
      submitted_at: null,
      decided_at: "2026-10-31T09:00:00Z",
      decision_note: "Started at the wrong warehouse",
    },
    people: { ...base.people, submittedBy: null, decidedBy: "Conrad Brink" },
    lines: base.lines.map((l, i) => ({ ...l, counted_qty: i === 0 ? 8 : null, recount_qty: null })),
    variance: [],
  });
  assert.deepEqual(
    sheet.columns.map((c) => c.header),
    ["Product", "System says", "Counted", "If different, why?"]
  );
  assert.equal(sheet.rows[0].counted, 8);
  assert.equal(sheet.rows[1].counted, null);
  assert.ok(sheet.context?.includes("Cancelled: Started at the wrong warehouse"));
  assert.ok(sheet.context?.some((l) => l.startsWith("Cancelled by Conrad Brink on 31 Oct 2026")));
  assert.equal(sheet.context?.at(-1), "Cancelled before it was handed in. Nothing in the stock changed.");
});
