// Money → Statements: the quick period choices, the client list's search and
// balance words, and finding a client's row in the ageing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageingFor, balanceState, clientKey, filterClients, periodFor } from "@/lib/statements";
import type { AgeingRow } from "@/lib/owed";

test("this month runs from the 1st to today", () => {
  assert.deepEqual(periodFor("this_month", "2026-10-09"), { from: "2026-10-01", to: "2026-10-09" });
  // On the 1st the month is one day long.
  assert.deepEqual(periodFor("this_month", "2026-10-01"), { from: "2026-10-01", to: "2026-10-01" });
});

test("last month is the whole of the month before, including February and January", () => {
  assert.deepEqual(periodFor("last_month", "2026-10-09"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(periodFor("last_month", "2026-10-01"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(periodFor("last_month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(periodFor("last_month", "2026-03-01"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodFor("last_month", "2028-03-31"), { from: "2028-02-01", to: "2028-02-29" });
});

test("last 3 months is this month and the two before, up to today", () => {
  assert.deepEqual(periodFor("last_3_months", "2026-10-09"), { from: "2026-08-01", to: "2026-10-09" });
  assert.deepEqual(periodFor("last_3_months", "2026-01-01"), { from: "2025-11-01", to: "2026-01-01" });
  assert.deepEqual(periodFor("last_3_months", "2026-02-20"), { from: "2025-12-01", to: "2026-02-20" });
});

test("this year runs from 1 January to today", () => {
  assert.deepEqual(periodFor("this_year", "2026-10-09"), { from: "2026-01-01", to: "2026-10-09" });
  assert.deepEqual(periodFor("this_year", "2026-01-01"), { from: "2026-01-01", to: "2026-01-01" });
});

test("search matches part of a name, ignoring case and spaces at the ends", () => {
  const rows = [{ client_name: "Acacia Foods" }, { client_name: "Baobab Traders" }, { client_name: "ACACIA Cafe" }];
  assert.deepEqual(filterClients(rows, "  acacia "), [rows[0], rows[2]]);
  assert.equal(filterClients(rows, "").length, 3);
  assert.equal(filterClients(rows, "   ").length, 3);
  assert.equal(filterClients(rows, "zzz").length, 0);
});

test("a balance of nothing is settled, below nothing is a credit", () => {
  assert.equal(balanceState(0), "settled");
  assert.equal(balanceState(0.004), "settled");
  assert.equal(balanceState(-0.004), "settled");
  assert.equal(balanceState(120.5), "owing");
  assert.equal(balanceState(-20), "credit");
});

const ageing = (store_id: string | null, client_name: string, total: number): AgeingRow => ({
  store_id,
  client_name,
  not_due: total,
  days_1_30: 0,
  days_31_60: 0,
  days_61_90: 0,
  days_over_90: 0,
  total,
  invoices: 1,
  oldest_due: "2026-09-01",
  last_paid_on: null,
});

test("a client on the books is found by place, even if the name differs", () => {
  const rows = [ageing("s1", "Acacia Foods (Pty) Ltd", 100), ageing(null, "Acacia Foods", 50)];
  assert.equal(ageingFor(rows, { store_id: "s1", client_name: "Acacia Foods" })?.total, 100);
  assert.equal(ageingFor(rows, { store_id: "s2", client_name: "Acacia Foods" }), null);
});

test("a client known only by name is found by name, never by someone's place", () => {
  const rows = [ageing("s1", "Acacia Foods", 100), ageing(null, "Walk-in Cafe", 75)];
  assert.equal(ageingFor(rows, { store_id: null, client_name: " walk-in CAFE " })?.total, 75);
  assert.equal(ageingFor(rows, { store_id: null, client_name: "Acacia Foods" }), null);
  assert.equal(ageingFor([], { store_id: null, client_name: "Anyone" }), null);
});

test("the same client has the same key on every list", () => {
  assert.equal(clientKey({ store_id: "s1", client_name: "A" }), clientKey({ store_id: "s1", client_name: "A" }));
  assert.notEqual(clientKey({ store_id: null, client_name: "A" }), clientKey({ store_id: "s1", client_name: "A" }));
});
