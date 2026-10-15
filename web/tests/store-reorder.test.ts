// Stores due for an order (owner, 15 Oct 2026). The dates come from the
// database (supabase/tests/store_reorder.sql proves them); these tests hold the
// rules that turn them into "due" to the same answers as the phone
// (mobile/test/store_reorder_test.dart uses the same cases).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DECLINE_REASONS,
  dayLabel,
  standingDeclines,
  type Decline,
  daysBetween,
  defaultSort,
  describeDue,
  groupMeaning,
  lastOrderProgress,
  orderLabel,
  orderRhythm,
  reorderStatus,
  sortRows,
  storeGroupChoices,
  storeGroupOf,
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

test("the reasons a rep can give are exactly the ones the database accepts", () => {
  const sql = readFileSync(join(process.cwd(), "..", "supabase", "migrations", "20261015200000_order_followups.sql"), "utf8");
  const check = sql.slice(sql.indexOf("reason                    text not null check"), sql.indexOf("note                      text"));
  const allowed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(DECLINE_REASONS).sort(), allowed);
  for (const words of Object.values(DECLINE_REASONS)) assert.ok(!words.includes("\u2014"), "no em dashes");
});

test("a reason stands only when it was given after the store's last order", () => {
  const d = (store_id: string, reason: Decline["reason"], created_at: string): Decline => ({
    store_id,
    rep_id: null,
    reason,
    note: null,
    created_at,
  });
  const rows = [
    { store_id: "a", last_order_on: "2026-09-01" },
    { store_id: "b", last_order_on: "2026-10-08" },
    { store_id: "c", last_order_on: null },
    { store_id: "d", last_order_on: "2026-10-14" },
  ];
  // Newest first, as fetchDeclines returns them.
  const standing = standingDeclines(
    [
      d("a", "price", "2026-10-14T10:00:00Z"),
      d("a", "has_stock", "2026-10-01T10:00:00Z"),
      d("b", "buyer_away", "2026-10-02T10:00:00Z"), // before b ordered on 8 Oct
      d("c", "no_money", "2026-10-03T10:00:00Z"),
      d("d", "price", "2026-10-14T21:30:00Z"), // 23:30 in Gaborone, the day d ordered: overtaken
    ],
    rows,
    "Africa/Gaborone"
  );
  assert.equal(standing.get("a")?.reason, "price");
  assert.equal(standing.has("b"), false);
  assert.equal(standing.get("c")?.reason, "no_money");
  assert.equal(standing.has("d"), false);
});

test("a day label carries the year only when it is not this year", () => {
  assert.equal(dayLabel("2026-09-19", "2026-10-15"), "19 Sept");
  assert.equal(dayLabel("2025-09-19", "2026-10-15"), "19 Sept 2025");
});

test("the win-back list puts the biggest buyers first, with their number", () => {
  const rows = [
    row({ store_id: "small", store_name: "Small", last_order_on: "2026-06-01", order_days_year: 9 }),
    row({ store_id: "big", store_name: "Big", last_order_on: "2026-07-01", order_days_year: 2 }),
    row({ store_id: "none", store_name: "None", last_order_on: "2026-05-01", order_days_year: 1 }),
  ];
  const sales = new Map([
    ["small", 1200],
    ["big", 45000],
  ]);
  const phones = new Map([["big", { name: "Buyer", phone: "+2673912345" }]]);
  const s = summarise(rows, TODAY, 30, 5, sales, phones);
  assert.deepEqual(
    s.winBack.map((w) => w.id),
    ["big", "small", "none"]
  );
  assert.equal(s.winBack[0].phone?.phone, "+2673912345");
  assert.equal(s.winBack[2].sales, null);
  // Without money (a person who may not see it), most order days first instead.
  assert.deepEqual(
    summarise(rows, TODAY, 30, 5, null).winBack.map((w) => w.id),
    ["small", "big", "none"]
  );
});

test("the group picker offers the groups with a store on the list, and No group last", () => {
  const groups = {
    groups: [
      { id: "g-choppies", name: "Choppies Group" },
      { id: "g-empty", name: "Empty Group" },
      { id: "g-forecourts", name: "Forecourts" },
    ],
    groupOf: new Map<string, string | null>([
      ["s1", "g-choppies"],
      ["s2", "g-choppies"],
      ["s3", "g-forecourts"],
      ["s4", null],
    ]),
  };
  const rows = ["s1", "s2", "s3", "s4", "s5"].map((id) => row({ store_id: id }));
  assert.deepEqual(storeGroupChoices(rows, groups, DEFAULT_TERMS), [
    { id: "g-choppies", name: "Choppies Group", n: 2 },
    { id: "g-forecourts", name: "Forecourts", n: 1 },
    // s4 has no group, and s5 was added after the groups were read.
    { id: "none", name: "No group", n: 2 },
  ]);
  assert.equal(storeGroupOf("s1", groups.groupOf), "g-choppies");
  assert.equal(storeGroupOf("s5", groups.groupOf), "none");
  // Every store in a group: no "No group" to choose.
  assert.deepEqual(
    storeGroupChoices(rows.slice(0, 3), groups, DEFAULT_TERMS).map((g) => g.id),
    ["g-choppies", "g-forecourts"]
  );
});
