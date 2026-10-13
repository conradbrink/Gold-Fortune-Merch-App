// The Store health list (the dashboard card opened up). The groups themselves
// are the database's (supabase/tests/store_health.sql proves the card and the
// list count the same stores); these pin how the page splits, orders and words
// what it is given.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSort,
  describeDays,
  groupLabel,
  groupMeaning,
  groupsFor,
  inGroup,
  sortRows,
  windowDays,
  windowStart,
  type StoreHealthRow,
} from "@/lib/store-health";
import { DEFAULT_TERMS } from "@/lib/terms";

function row(over: Partial<StoreHealthRow> & { store_name: string }): StoreHealthRow {
  return {
    store_id: over.store_name,
    city: null,
    last_visit_at: null,
    last_order_at: null,
    orders_ever: 0,
    days_since_visit: null,
    days_since_order: null,
    status: "not_visited",
    lapsed: false,
    ...over,
  };
}

test("a company that sells sees the card's four groups; any other, visited or not", () => {
  assert.deepEqual(groupsFor(true), ["ordering", "no_order", "not_visited", "lapsed"]);
  assert.deepEqual(groupsFor(false), ["visited", "not_visited"]);
});

test("the groups are the database's statuses, with lapsed cutting across them", () => {
  const ordering = row({ store_name: "A", status: "ordering" });
  const noOrder = row({ store_name: "B", status: "no_order", lapsed: true });
  const unseen = row({ store_name: "C", status: "not_visited" });
  assert.equal(inGroup(ordering, "ordering"), true);
  assert.equal(inGroup(noOrder, "no_order"), true);
  assert.equal(inGroup(noOrder, "lapsed"), true);
  assert.equal(inGroup(unseen, "lapsed"), false);
  assert.equal(inGroup(unseen, "not_visited"), true);
  assert.equal(inGroup(ordering, "visited"), true);
  assert.equal(inGroup(noOrder, "visited"), true);
  assert.equal(inGroup(unseen, "visited"), false);
});

test("not visited opens never-visited first, then the longest gap, keeping the database's order on ties", () => {
  // The database hands rows over in "go here first" order; equal gaps keep it,
  // so the list's first five are the card's five whatever the names are.
  const rows = [
    row({ store_name: "Zeta never", days_since_visit: null }),
    row({ store_name: "alpha never", days_since_visit: null }),
    row({ store_name: "Old", days_since_visit: 90 }),
    row({ store_name: "Older", days_since_visit: 120 }),
  ];
  const sorted = sortRows(rows, defaultSort("not_visited")).map((r) => r.store_name);
  assert.deepEqual(sorted, ["Zeta never", "alpha never", "Older", "Old"]);
});

test("visited without an order opens with the longest since an order", () => {
  const rows = [
    row({ store_name: "Recent", status: "no_order", days_since_order: 31 }),
    row({ store_name: "Never ordered", status: "no_order", days_since_order: null }),
    row({ store_name: "Long ago", status: "no_order", days_since_order: 200 }),
  ];
  assert.deepEqual(
    sortRows(rows, defaultSort("no_order")).map((r) => r.store_name),
    ["Never ordered", "Long ago", "Recent"]
  );
});

test("stopped ordering opens with the biggest customers", () => {
  const rows = [
    row({ store_name: "Small", lapsed: true, orders_ever: 1 }),
    row({ store_name: "Big", lapsed: true, orders_ever: 12 }),
  ];
  assert.deepEqual(sortRows(rows, defaultSort("lapsed")).map((r) => r.store_name), ["Big", "Small"]);
});

test("a heading sorts both ways, and by name A to Z first", () => {
  const rows = [row({ store_name: "b" }), row({ store_name: "A" }), row({ store_name: "c" })];
  assert.deepEqual(sortRows(rows, { key: "name", dir: "asc" }).map((r) => r.store_name), ["A", "b", "c"]);
  assert.deepEqual(sortRows(rows, { key: "name", dir: "desc" }).map((r) => r.store_name), ["c", "b", "A"]);
  // The input is left as it was.
  assert.deepEqual(rows.map((r) => r.store_name), ["b", "A", "c"]);
});

test("days read as a person says them", () => {
  assert.equal(describeDays(null), "Never");
  assert.equal(describeDays(0), "Today");
  assert.equal(describeDays(1), "Yesterday");
  assert.equal(describeDays(42), "42 days ago");
});

test("the list uses the card's words and the company's own", () => {
  assert.equal(groupLabel("no_order"), "Visited, no order in 30 days");
  assert.equal(groupLabel("not_visited"), "Not visited in 30 days");
  const gf = {
    ...DEFAULT_TERMS,
    site: { one: "Store", many: "Stores", article: null },
    job: { one: "Visit", many: "Visits", article: null },
    staff: { one: "Rep", many: "Reps", article: null },
  };
  assert.equal(
    groupMeaning("no_order", gf),
    "These stores had a visit in the last 30 days but placed no order. Ask the rep who goes there why."
  );
  assert.match(groupMeaning("not_visited", DEFAULT_TERMS), /these sites/);
  for (const g of ["ordering", "no_order", "not_visited", "lapsed", "visited"] as const) {
    assert.doesNotMatch(groupMeaning(g, gf), /—/, "no em dashes in the copy");
  }
});

test("the window names itself the way the card does", () => {
  assert.equal(groupLabel("not_visited", { days: 14 }), "Not visited in 14 days");
  assert.equal(groupLabel("no_order", { days: 90 }), "Visited, no order in 90 days");
  assert.equal(groupLabel("not_visited", { since: "2026-09-01" }), "Not visited since 1 Sept");
  assert.equal(groupLabel("visited", { days: 7 }), "Visited in the last 7 days");
  // The card's own words are the default.
  assert.equal(groupLabel("not_visited"), "Not visited in 30 days");
});

test("stopped ordering is twice the window, as store_health counts it", () => {
  assert.match(groupMeaning("lapsed", DEFAULT_TERMS, { days: 14 }, "2026-10-13"), /nothing in 28 days/);
  assert.match(groupMeaning("lapsed", DEFAULT_TERMS, { days: 30 }, "2026-10-13"), /nothing in 60 days/);
  assert.match(groupMeaning("lapsed", DEFAULT_TERMS, { since: "2026-10-03" }, "2026-10-13"), /nothing in 20 days/);
  assert.equal(windowDays({ since: "2026-09-13" }, "2026-10-13"), 30);
});

test("the card's 30 days asks the database for its own default; other windows say where they start", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  assert.equal(windowStart({ days: 30 }, "Africa/Gaborone", now), null);
  assert.equal(windowStart({ days: 14 }, "Africa/Gaborone", now)?.toISOString(), "2026-09-29T10:00:00.000Z");
  // A date starts at the company's midnight: Gaborone is two hours ahead of UTC.
  assert.equal(windowStart({ since: "2026-09-01" }, "Africa/Gaborone", now)?.toISOString(), "2026-08-31T22:00:00.000Z");
});
