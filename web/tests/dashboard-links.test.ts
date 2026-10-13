// Every dashboard number opens the list it counted (owner, 13 Oct 2026). These
// tests send each link a card builds through the parser on the page it opens,
// so a renamed parameter or a changed rule fails here, not on a manager's
// screen as a list that quietly disagrees with the number they clicked.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HEALTH_GROUPS,
  OPEN_ORDER_STATUSES,
  commissionsHref,
  dayAfter,
  dueDaysFromQuery,
  healthGroupFromQuery,
  invoicesHref,
  isLowStock,
  lastDayOf,
  lowStockHref,
  nextMonth,
  orderStatusesFromQuery,
  ordersHref,
  quoteStatusFromQuery,
  quotesHref,
  rangeFromQuery,
  rangeQuery,
  recurringDueHref,
  recurringDueWithin,
  reportHref,
  salesHref,
  storeHealthHref,
  storeHref,
  trackingHref,
} from "@/lib/dashboard-links";
import { ORDER_STATUSES } from "@/lib/warehouse";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes";
import { rangeForPreset } from "@/lib/date-range";

const query = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

test("a range survives the trip, and the last day is the day before its end", () => {
  const range = { from: new Date(2026, 8, 13), to: new Date(2026, 9, 13) };
  assert.deepEqual(rangeQuery(range), { from: "2026-09-13", to: "2026-10-13" });
  const back = rangeFromQuery(query(salesHref(rangeQuery(range))));
  assert.ok(back);
  assert.equal(+back.from, +range.from);
  assert.equal(+back.to, +range.to);
  assert.equal(lastDayOf(range), "2026-10-12");
  // The dashboard's own presets travel too.
  const preset = rangeForPreset("30d", new Date(2026, 9, 13, 15, 0));
  const parsed = rangeFromQuery(query(reportHref("coverage", preset)));
  assert.ok(parsed);
  assert.equal(+parsed.to, +preset.to);
});

test("a malformed or backwards range is ignored, not turned into an empty list", () => {
  assert.equal(rangeFromQuery(new URLSearchParams("from=2026-10-01")), null);
  assert.equal(rangeFromQuery(new URLSearchParams("from=yesterday&to=today")), null);
  assert.equal(rangeFromQuery(new URLSearchParams("from=2026-10-13&to=2026-10-01")), null);
  assert.equal(rangeFromQuery(new URLSearchParams("from=2026-10-13&to=2026-10-13")), null);
});

test("days and months roll over the ends of months and years", () => {
  assert.equal(dayAfter("2026-10-31"), "2026-11-01");
  assert.equal(dayAfter("2026-12-31"), "2027-01-01");
  assert.equal(nextMonth("2026-12-01"), "2027-01-01");
  assert.equal(nextMonth("2026-01-01"), "2026-02-01");
});

test("reports keep the link they always had", () => {
  const range = { from: new Date(2026, 8, 13), to: new Date(2026, 9, 13) };
  assert.equal(reportHref("coverage", range), "/reports?tab=coverage&from=2026-09-13&to=2026-10-13");
  assert.equal(
    reportHref("perfect_store", range, "trends"),
    "/reports?tab=perfect_store&view=trends&from=2026-09-13&to=2026-10-13"
  );
});

test("every Store health group opens itself", () => {
  for (const g of HEALTH_GROUPS) {
    assert.equal(healthGroupFromQuery(query(storeHealthHref(g))), g);
  }
  assert.equal(healthGroupFromQuery(new URLSearchParams("show=everything")), null);
  assert.equal(healthGroupFromQuery(new URLSearchParams("")), null);
  assert.equal(storeHref("Choppies Super Store & Co"), "/stores?q=Choppies+Super+Store+%26+Co");
});

test("the pipeline's stages open exactly their statuses", () => {
  const read = (href: string) => orderStatusesFromQuery(query(href).get("status"), ORDER_STATUSES);
  // "Orders needing action" is everything not yet delivered.
  assert.deepEqual(read(ordersHref({ status: "open" })), [...OPEN_ORDER_STATUSES]);
  // "To confirm" counts new and confirmed together.
  assert.deepEqual(read(ordersHref({ status: ["new", "confirmed"] })), ["new", "confirmed"]);
  assert.deepEqual(read(ordersHref({ status: ["packed"] })), ["packed"]);
  // Proof of delivery missing travels on its own.
  assert.equal(query(ordersHref({ pod: "outstanding" })).get("pod"), "outstanding");
  assert.equal(ordersHref({ pod: "outstanding" }), "/orders?pod=outstanding");
});

test("a stale or hand-edited orders link drops what the page does not offer", () => {
  assert.equal(orderStatusesFromQuery(null, ORDER_STATUSES), null);
  assert.equal(orderStatusesFromQuery("all", ORDER_STATUSES), null);
  assert.equal(orderStatusesFromQuery("shipped", ORDER_STATUSES), null);
  assert.deepEqual(orderStatusesFromQuery("confirmed,shipped,new,new", ORDER_STATUSES), ["new", "confirmed"]);
});

test("quotes open on the status that was counted", () => {
  const known = Object.keys(QUOTE_STATUS_LABELS);
  assert.equal(quoteStatusFromQuery(query(quotesHref("sent")).get("status"), known), "sent");
  assert.equal(quoteStatusFromQuery(query(quotesHref("accepted")).get("status"), known), "accepted");
  assert.equal(quoteStatusFromQuery("open", known), "open");
  assert.equal(quoteStatusFromQuery("lost", known), null);
});

test("recurring orders placing this week match the pipeline's count", () => {
  const days = dueDaysFromQuery(query(recurringDueHref()));
  assert.equal(days, 7);
  const today = "2026-10-13";
  // next_run <= today + 7, active only, as dashboard_business counts it.
  assert.equal(recurringDueWithin({ status: "active", next_run: "2026-10-20" }, today, 7), true);
  assert.equal(recurringDueWithin({ status: "active", next_run: "2026-10-21" }, today, 7), false);
  assert.equal(recurringDueWithin({ status: "active", next_run: "2026-10-01" }, today, 7), true);
  assert.equal(recurringDueWithin({ status: "paused", next_run: "2026-10-14" }, today, 7), false);
  assert.equal(recurringDueWithin({ status: "active", next_run: null }, today, 7), false);
  assert.equal(dueDaysFromQuery(new URLSearchParams("due=soon")), null);
});

test("low stock is low_stock_alerts' rule: none left, below minimum, or at the reorder point", () => {
  assert.equal(lowStockHref(), "/inventory?low=1");
  assert.equal(isLowStock({ qty_available: 0, is_below_min: false, reorder_point: null }), true);
  assert.equal(isLowStock({ qty_available: 4, is_below_min: true, reorder_point: null }), true);
  assert.equal(isLowStock({ qty_available: 10, is_below_min: false, reorder_point: 10 }), true);
  assert.equal(isLowStock({ qty_available: 11, is_below_min: false, reorder_point: 10 }), false);
  assert.equal(isLowStock({ qty_available: 11, is_below_min: false, reorder_point: null }), false);
});

test("money links carry their dates or say every date", () => {
  const range = { from: "2026-09-13", to: "2026-10-13" };
  assert.equal(invoicesHref(range), "/invoices?from=2026-09-13&to=2026-10-13");
  assert.equal(commissionsHref("pending", "all"), "/commissions?status=pending&period=all");
  assert.equal(commissionsHref("pending", range), "/commissions?status=pending&from=2026-09-13&to=2026-10-13");
  assert.equal(salesHref(range, "rep-1"), "/sales?from=2026-09-13&to=2026-10-13&rep=rep-1");
  assert.equal(trackingHref("rep-1"), "/tracking/rep-1");
});
