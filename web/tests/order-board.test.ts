// The orders board (19 Oct 2026): purchase orders, invoiced, packed,
// dispatched, delivered. A drop is a real step (stock, invoices), so the rules
// for what each drop means are tested here rather than left to the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardSince,
  boardViewFromQuery,
  dayInZone,
  daysBetween,
  deliversOrders,
  finishedWithoutStock,
  invoicesOnConfirm,
  invoicesWithoutStock,
  keepsStock,
  podFileProblem,
  statusWords,
  waitWords,
  columnLabel,
  columnOf,
  dropAnswer,
  matchesSearch,
  nextStepOf,
  poExpiry,
  sentWithoutStock,
  waitTone,
} from "@/lib/order-board";
import { archiveMonths } from "@/lib/orders";
import { toModuleSet } from "@/lib/modules";

const order = (status: string, extra: Partial<{ podStatus: string; onHold: boolean }> = {}) => ({
  orderNumber: "SO-000190",
  status,
  podStatus: extra.podStatus ?? "not_required",
  onHold: extra.onHold ?? false,
});

test("each status sits in the owner's column, and a delivered order with its POD leaves the board", () => {
  assert.equal(columnOf(order("new")), "purchase_orders");
  assert.equal(columnOf(order("confirmed")), "invoiced");
  // Being picked is still "invoiced, not yet in a box".
  assert.equal(columnOf(order("picking")), "invoiced");
  assert.equal(columnOf(order("packed")), "packed");
  assert.equal(columnOf(order("dispatched")), "dispatched");
  assert.equal(columnOf(order("delivered", { podStatus: "outstanding" })), "delivered");
  assert.equal(columnOf(order("delivered", { podStatus: "received" })), null);
  assert.equal(columnOf(order("delivered", { podStatus: "not_required" })), null);
  assert.equal(columnOf(order("cancelled")), null);
});

test("the second column says Invoiced only where confirming issues the invoice", () => {
  assert.equal(columnLabel("invoiced", true), "Invoiced");
  assert.equal(columnLabel("invoiced", false), "Confirmed");
  assert.equal(columnLabel("purchase_orders", true), "Purchase orders");
});

test("one step forward opens that step", () => {
  assert.deepEqual(dropAnswer(order("new"), "invoiced", true), { step: "confirm" });
  assert.deepEqual(dropAnswer(order("confirmed"), "packed", true), { step: "pack" });
  assert.deepEqual(dropAnswer(order("picking"), "packed", true), { step: "pack" });
  assert.deepEqual(dropAnswer(order("packed"), "dispatched", true), { step: "dispatch" });
  assert.deepEqual(dropAnswer(order("dispatched"), "delivered", true), { step: "deliver" });
});

test("dropping a card back where it was is not a move", () => {
  assert.equal(dropAnswer(order("confirmed"), "invoiced", true), null);
  assert.equal(dropAnswer(order("picking"), "invoiced", true), null);
});

test("nothing jumps a step, and the refusal names the next column", () => {
  const a = dropAnswer(order("new"), "packed", true);
  assert.ok(a && "refuse" in a);
  assert.match(a.refuse, /one step at a time\. Next it goes to Invoiced\./);
  const b = dropAnswer(order("new"), "delivered", false);
  assert.ok(b && "refuse" in b);
  assert.match(b.refuse, /Next it goes to Confirmed\./);
});

test("the only way back is a delivery that did not happen", () => {
  assert.deepEqual(dropAnswer(order("dispatched"), "packed", true), { step: "failed" });
  const toInvoiced = dropAnswer(order("dispatched"), "invoiced", true);
  assert.ok(toInvoiced && "refuse" in toInvoiced);
  assert.match(toInvoiced.refuse, /drag it back to Packed/);
  const unpack = dropAnswer(order("packed"), "invoiced", true);
  assert.ok(unpack && "refuse" in unpack);
  assert.match(unpack.refuse, /cannot go back a step/);
});

test("an order on hold, or delivered, does not move", () => {
  const held = dropAnswer(order("packed", { onHold: true }), "dispatched", true);
  assert.ok(held && "refuse" in held);
  assert.match(held.refuse, /on hold/);
  const done = dropAnswer(order("delivered", { podStatus: "outstanding" }), "dispatched", true);
  assert.ok(done && "refuse" in done);
  assert.match(done.refuse, /has been delivered/);
});

test("each card's button is its next step", () => {
  assert.equal(nextStepOf(order("new")), "confirm");
  assert.equal(nextStepOf(order("confirmed")), "pack");
  assert.equal(nextStepOf(order("picking")), "pack");
  assert.equal(nextStepOf(order("packed")), "dispatch");
  assert.equal(nextStepOf(order("dispatched")), "deliver");
  assert.equal(nextStepOf(order("delivered", { podStatus: "outstanding" })), "pod");
  assert.equal(nextStepOf(order("delivered", { podStatus: "received" })), null);
});

test("waiting turns amber after two days and red after a week", () => {
  assert.equal(waitTone(0), "calm");
  assert.equal(waitTone(2), "calm");
  assert.equal(waitTone(3), "amber");
  assert.equal(waitTone(7), "amber");
  assert.equal(waitTone(8), "red");
});

test("the warehouse dashboard's links light up their column", () => {
  const q = (s: string) => boardViewFromQuery(new URLSearchParams(s));
  assert.deepEqual(q("status=new"), { columns: ["purchase_orders"], archive: null });
  assert.deepEqual(q("status=confirmed"), { columns: ["invoiced"], archive: null });
  assert.deepEqual(q("status=new,confirmed"), { columns: ["purchase_orders", "invoiced"], archive: null });
  assert.deepEqual(q("status=packed"), { columns: ["packed"], archive: null });
  assert.deepEqual(q("pod=outstanding"), { columns: ["delivered"], archive: null });
  // "open" is the whole board.
  assert.deepEqual(q("status=open"), { columns: [], archive: null });
  assert.deepEqual(q(""), { columns: [], archive: null });
});

test("a link that only asks for finished orders goes to the archive, with its search", () => {
  const q = (s: string) => boardViewFromQuery(new URLSearchParams(s)).archive;
  assert.equal(q("status=delivered"), "/orders/archive");
  assert.equal(q("status=cancelled"), "/orders/archive?show=cancelled");
  assert.equal(q("status=delivered,cancelled"), "/orders/archive");
  assert.equal(q("status=cancelled&q=SO 12"), "/orders/archive?show=cancelled&q=SO%2012");
  // Mixed with a live status, it stays on the board.
  assert.equal(q("status=packed,delivered"), null);
  // A name the app does not know is dropped, as the dashboard's own parser does.
  assert.equal(q("status=delivered,shipped"), "/orders/archive");
  assert.equal(q("status=shipped"), null);
});

test("the board's search reads order, invoice, store and contact", () => {
  const o = { orderNumber: "SO-000190", invoiceNumber: "1834", storeName: "Choppies Mogoditshane", contactName: "Neo" };
  assert.ok(matchesSearch(o, ""));
  assert.ok(matchesSearch(o, "so-0001"));
  assert.ok(matchesSearch(o, "1834"));
  assert.ok(matchesSearch(o, "choppies"));
  assert.ok(matchesSearch(o, " neo "));
  assert.ok(!matchesSearch(o, "sefalana"));
  assert.ok(!matchesSearch({ ...o, invoiceNumber: null, contactName: null }, "neo"));
  // The chain's own PO number, which is what Choppies quotes when it rings.
  assert.ok(matchesSearch({ ...o, customerPoNumber: "1001160022257" }, "100116002"));
  assert.ok(!matchesSearch(o, "100116002"));
});

test("a customer's PO turns amber two days before it lapses and red after", () => {
  assert.deepEqual(poExpiry("2026-10-26", "2026-10-20", "26 Oct"), { tone: "calm", words: "PO valid until 26 Oct" });
  assert.deepEqual(poExpiry("2026-10-26", "2026-10-24", "26 Oct"), { tone: "amber", words: "PO expires in 2 days, on 26 Oct" });
  assert.deepEqual(poExpiry("2026-10-26", "2026-10-25", "26 Oct"), { tone: "amber", words: "PO expires tomorrow" });
  // Still valid on its last day: Choppies takes the delivery on the 26th.
  assert.deepEqual(poExpiry("2026-10-26", "2026-10-26", "26 Oct"), { tone: "amber", words: "PO expires today" });
  assert.deepEqual(poExpiry("2026-10-26", "2026-10-27", "26 Oct"), { tone: "red", words: "PO expired on 26 Oct" });
  // Across a month end, counted in calendar days.
  assert.equal(poExpiry("2026-11-01", "2026-10-30", "1 Nov").tone, "amber");
});

test("the archive groups by month in the order given, newest first", () => {
  const rows = [
    { id: "a", closedAt: "2026-10-19T09:00:00Z" },
    { id: "b", closedAt: "2026-10-02T09:00:00Z" },
    { id: "c", closedAt: "2026-09-30T09:00:00Z" },
    { id: "d", closedAt: null },
  ];
  const months = archiveMonths(rows);
  assert.deepEqual(
    months.map((m) => [m.month, m.rows.map((r) => r.id)]),
    [
      ["October 2026", ["a", "b"]],
      ["September 2026", ["c"]],
      ["Date not recorded", ["d"]],
    ]
  );
});

test("an order being picked has waited in Invoiced since it was confirmed", () => {
  const o = { enteredAt: "2026-10-19T08:00:00Z", confirmedAt: "2026-10-10T08:00:00Z" };
  assert.equal(boardSince({ ...o, status: "picking" }), o.confirmedAt);
  assert.equal(boardSince({ ...o, status: "packed" }), o.enteredAt);
  assert.equal(boardSince({ ...o, status: "picking", confirmedAt: null }), o.enteredAt);
});

test("waiting is counted in the company's calendar days, not 24-hour blocks", () => {
  const zone = "Africa/Gaborone"; // UTC+2
  // 16:00 yesterday, read at 08:00 today: yesterday, not "today".
  const delivered = "2026-10-18T14:00:00Z";
  const read = Date.parse("2026-10-19T06:00:00Z");
  assert.equal(dayInZone(delivered, zone), "2026-10-18");
  assert.equal(dayInZone(read, zone), "2026-10-19");
  assert.equal(daysBetween(dayInZone(delivered, zone), dayInZone(read, zone)), 1);
  // 00:30 on the 1st in Gaborone is still the 31st in UTC.
  assert.equal(dayInZone("2026-10-31T22:30:00Z", zone), "2026-11-01");
  assert.equal(dayInZone("2026-10-31T22:30:00Z", "UTC"), "2026-10-31");
  assert.equal(daysBetween("2026-10-19", "2026-10-19"), 0);
  assert.equal(daysBetween("2026-09-30", "2026-10-02"), 2);
  // An unknown zone falls back rather than throwing.
  assert.match(dayInZone(read, "Not/AZone"), /^\d{4}-\d{2}-\d{2}$/);
});

test("the card says how long in plain words", () => {
  assert.equal(waitWords(0, false), "Arrived here today");
  assert.equal(waitWords(1, false), "Waiting 1 day");
  assert.equal(waitWords(9, false), "Waiting 9 days");
  assert.equal(waitWords(0, true), "Delivered today");
  assert.equal(waitWords(1, true), "Delivered yesterday");
  assert.equal(waitWords(15, true), "Delivered 15 days ago");
});

test("an order's state reads as words, not a status code", () => {
  assert.equal(statusWords("picking", true), "being picked");
  assert.equal(statusWords("confirmed", true), "invoiced");
  assert.equal(statusWords("confirmed", false), "confirmed");
  assert.equal(statusWords("new", true), "a purchase order");
  assert.equal(statusWords("dispatched", true), "on the road");
});

test("confirming invoices only with the setting and the invoicing module both on", () => {
  const config = (setting: boolean, modules: Record<string, boolean>) => ({
    settings: { money_invoice_orders: setting },
    modules: toModuleSet(modules),
  });
  assert.equal(invoicesOnConfirm(config(true, { invoicing: true })), true);
  assert.equal(invoicesOnConfirm(config(true, { invoicing: false })), false);
  assert.equal(invoicesOnConfirm(config(false, { invoicing: true })), false);
  assert.equal(invoicesOnConfirm(null), false);
});

test("without the warehouse, an order is invoiced and finished in one step, with invoicing on", () => {
  const config = (modules: Record<string, boolean>) => ({ modules: toModuleSet(modules) });
  assert.equal(keepsStock(config({ warehouse: true })), true);
  assert.equal(keepsStock(config({ warehouse: false })), false);
  // Loading: the stock buttons stay rather than flicker.
  assert.equal(keepsStock(null), true);

  assert.equal(invoicesWithoutStock(config({ distribution: true, invoicing: true, warehouse: false })), true);
  assert.equal(invoicesWithoutStock(config({ distribution: true, invoicing: true, warehouse: true })), false);
  assert.equal(invoicesWithoutStock(config({ distribution: true, invoicing: false, warehouse: false })), false);
  assert.equal(invoicesWithoutStock(config({ distribution: false, invoicing: true, warehouse: false })), false);
  assert.equal(invoicesWithoutStock(null), false);
});

test("an order finished without stock is told apart by the order, not the company", () => {
  const o = (status: string, dispatched_at: string | null, fulfil_location_id: string | null) => ({
    status,
    dispatched_at,
    fulfil_location_id,
  });
  assert.equal(finishedWithoutStock(o("delivered", null, null)), true);
  // Delivered through the warehouse: dispatched, from a location.
  assert.equal(finishedWithoutStock(o("delivered", "2026-10-29T08:00:00Z", "loc-1")), false);
  assert.equal(finishedWithoutStock(o("new", null, null)), false);
  assert.equal(finishedWithoutStock(o("cancelled", null, null)), false);
});

test("Deliveries is its own module, on while the config loads", () => {
  const config = (modules: Record<string, boolean>) => ({ modules: toModuleSet(modules) });
  assert.equal(deliversOrders(config({ distribution: true, deliveries: true })), true);
  // A distributor without the Stock control add-on still sends its orders out.
  assert.equal(deliversOrders(config({ distribution: true, deliveries: true, warehouse: false })), true);
  assert.equal(deliversOrders(config({ distribution: true, deliveries: false })), false);
  assert.equal(deliversOrders(null), true);
});

test("an order sent out without stock: no location, from confirmed until delivered", () => {
  const o = (status: string, dispatched_at: string | null, fulfil_location_id: string | null) => ({
    status,
    dispatched_at,
    fulfil_location_id,
  });
  assert.equal(sentWithoutStock(o("confirmed", null, null)), true);
  assert.equal(sentWithoutStock(o("dispatched", "2026-10-29T08:00:00Z", null)), true);
  assert.equal(sentWithoutStock(o("delivered", "2026-10-29T08:00:00Z", null)), true);
  // Finished in one step (no Deliveries): not sent, nothing to show as sent.
  assert.equal(sentWithoutStock(o("delivered", null, null)), false);
  // A new or cancelled order has no location whoever it belongs to.
  assert.equal(sentWithoutStock(o("new", null, null)), false);
  assert.equal(sentWithoutStock(o("cancelled", null, null)), false);
  // Through the warehouse: it holds stock at a location.
  assert.equal(sentWithoutStock(o("confirmed", null, "loc-1")), false);
  assert.equal(sentWithoutStock(o("dispatched", "2026-10-29T08:00:00Z", "loc-1")), false);
});

test("a POD file storage would refuse is caught before the delivery is recorded", () => {
  assert.equal(podFileProblem({ size: 2_000_000, type: "application/pdf" }), null);
  assert.equal(podFileProblem({ size: 2_000_000, type: "image/heic" }), null);
  assert.match(podFileProblem({ size: 16 * 1024 * 1024, type: "application/pdf" }) ?? "", /bigger than 15 MB/);
  assert.match(podFileProblem({ size: 1000, type: "" }) ?? "", /cannot be filed/);
  assert.match(podFileProblem({ size: 1000, type: "application/msword" }) ?? "", /cannot be filed/);
});

test("the archive's months follow the company's time zone", () => {
  const rows = [{ id: "a", closedAt: "2026-10-31T22:30:00Z" }];
  assert.equal(archiveMonths(rows, "Africa/Gaborone")[0].month, "November 2026");
  assert.equal(archiveMonths(rows, "UTC")[0].month, "October 2026");
});
