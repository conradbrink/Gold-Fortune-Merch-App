// Stores due for an order (owner, 15 Oct 2026). The dates come from the
// database (supabase/tests/store_reorder.sql proves them); these tests hold the
// rules that turn them into "due" to the same answers as the phone
// (mobile/test/store_reorder_test.dart uses the same cases).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween,
  defaultSort,
  describeDue,
  groupMeaning,
  lastOrderProgress,
  orderLabel,
  orderRhythm,
  reorderStatus,
  sortRows,
  summarise,
  type StoreReorderRow,
} from "@/lib/store-reorder";
import { REORDER_GROUPS, reorderGroupFromQuery, storeReorderHref } from "@/lib/dashboard-links";
import { DEFAULT_TERMS } from "@/lib/terms";

const TODAY = "2026-10-15";

function row(over: Partial<StoreReorderRow> = {}): StoreReorderRow {
  return {
    store_id: "s1",
    store_name: "Choppies Phakalane",
    city: "Gaborone",
    last_order_on: null,
    last_order_ref: null,
    last_order_status: null,
    order_days_year: 0,
    usual_days: null,
    due_after_days: 30,
    due_on: null,
    ...over,
  };
}

test("calendar days between two dates", () => {
  assert.equal(daysBetween("2026-10-14", TODAY), 1);
  assert.equal(daysBetween("2026-09-15", TODAY), 30);
  // Across the end of March (no clock change in Botswana, but the browser may have one).
  assert.equal(daysBetween("2026-03-28", "2026-04-02"), 5);
});

test("the same states as the phone, on the same days", () => {
  assert.equal(reorderStatus(row(), TODAY).state, "never");
  assert.equal(reorderStatus(row({ last_order_on: "2026-10-14" }), TODAY).state, "not_due");
  assert.equal(reorderStatus(row({ last_order_on: "2026-09-23" }), TODAY).state, "not_due"); // due in 8
  assert.equal(reorderStatus(row({ last_order_on: "2026-09-22" }), TODAY).state, "soon"); // due in 7
  assert.equal(reorderStatus(row({ last_order_on: "2026-09-15" }), TODAY).state, "due"); // 30 days
  assert.equal(reorderStatus(row({ last_order_on: "2026-08-17" }), TODAY).state, "due"); // 59 days
  assert.equal(reorderStatus(row({ last_order_on: "2026-08-16" }), TODAY).state, "stopped"); // 60 days
  // A store with its own 14-day rhythm.
  const fortnightly = row({ last_order_on: "2026-10-01", usual_days: 14, due_after_days: 14 });
  assert.equal(reorderStatus(fortnightly, TODAY).state, "due");
  assert.equal(reorderStatus({ ...fortnightly, last_order_on: "2026-09-17" }, TODAY).state, "stopped");
});

test("due in words", () => {
  assert.equal(describeDue(reorderStatus(row(), TODAY)), "");
  assert.equal(describeDue(reorderStatus(row({ last_order_on: "2026-09-15" }), TODAY)), "Due today");
  assert.equal(describeDue(reorderStatus(row({ last_order_on: "2026-09-14" }), TODAY)), "1 day overdue");
  assert.equal(describeDue(reorderStatus(row({ last_order_on: "2026-09-10" }), TODAY)), "5 days overdue");
  assert.equal(describeDue(reorderStatus(row({ last_order_on: "2026-09-16" }), TODAY)), "Due in 1 day");
  assert.equal(describeDue(reorderStatus(row({ last_order_on: "2026-10-01" }), TODAY)), "Due in 16 days");
});

test("how often, the way a person says it (as on the phone)", () => {
  assert.equal(orderRhythm(7), "every 7 days");
  assert.equal(orderRhythm(14), "every 2 weeks");
  assert.equal(orderRhythm(19), "every 3 weeks");
  assert.equal(orderRhythm(30), "every 4 weeks");
  assert.equal(orderRhythm(41), "every 6 weeks");
  assert.equal(orderRhythm(60), "every 2 months");
  assert.equal(orderRhythm(108), "every 4 months");
});

test("an order or a QuickBooks invoice, and whether it is still on its way", () => {
  assert.equal(orderLabel(row({ last_order_ref: "SO-000150", last_order_status: "delivered" })), "SO-000150");
  assert.equal(orderLabel(row({ last_order_ref: "1790", last_order_status: "invoiced" })), "Invoice 1790");
  assert.equal(lastOrderProgress("packed"), "packed, not sent yet");
  assert.equal(lastOrderProgress("delivered"), null);
  assert.equal(lastOrderProgress("invoiced"), null);
});

test("due and stopped open with the best customers first", () => {
  const rows = [
    row({ store_id: "a", store_name: "A", last_order_on: "2026-09-10", order_days_year: 2 }),
    row({ store_id: "b", store_name: "B", last_order_on: "2026-09-01", order_days_year: 9 }),
    row({ store_id: "c", store_name: "C", last_order_on: "2026-08-30", order_days_year: 2 }),
  ];
  assert.deepEqual(
    sortRows(rows, defaultSort("due"), TODAY).map((r) => r.store_id),
    ["b", "c", "a"] // 9 order days, then the tie broken by the longest since an order
  );
  assert.deepEqual(defaultSort("soon"), { key: "due", dir: "asc" });
  // Planned visits sort soonest first, nothing planned last.
  const visits: Record<string, string> = { a: "2026-10-20", c: "2026-10-16" };
  assert.deepEqual(
    sortRows(rows, { key: "visit", dir: "asc" }, TODAY, (id) => visits[id] ?? null).map((r) => r.store_id),
    ["c", "a", "b"]
  );
});

test("the card counts every store once, and its five are the page's first five", () => {
  const rows = [
    row({ store_id: "never" }),
    row({ store_id: "fresh", last_order_on: "2026-10-10" }),
    row({ store_id: "soon", last_order_on: "2026-09-20" }),
    row({ store_id: "due1", last_order_on: "2026-09-10", order_days_year: 3 }),
    row({ store_id: "due2", last_order_on: "2026-09-01", order_days_year: 8, usual_days: 25, due_after_days: 25 }),
    row({ store_id: "gone", last_order_on: "2026-06-01", order_days_year: 12 }),
  ];
  const s = summarise(rows, TODAY, 30);
  assert.deepEqual(s.counts, { due: 2, soon: 1, stopped: 1, never: 1, not_due: 1 });
  assert.deepEqual(
    s.first.map((f) => f.id),
    sortRows(rows.filter((r) => reorderStatus(r, TODAY).state === "due"), defaultSort("due"), TODAY).map((r) => r.store_id)
  );
  assert.equal(s.first[0].id, "due2");
});

test("every group's link opens that group", () => {
  for (const g of REORDER_GROUPS) {
    assert.equal(reorderGroupFromQuery(new URLSearchParams(storeReorderHref(g).split("?")[1])), g);
  }
  assert.equal(storeReorderHref(), "/stores/reorder");
  assert.equal(reorderGroupFromQuery(new URLSearchParams("show=everything")), null);
});

test("the sentences use the company's own words and the rule it chose", () => {
  const due = groupMeaning("due", DEFAULT_TERMS, 21);
  assert.match(due, /21 days/);
  assert.match(groupMeaning("stopped", DEFAULT_TERMS, 21), /42 days/);
  assert.ok(!due.includes("—"), "no em dashes");
});
