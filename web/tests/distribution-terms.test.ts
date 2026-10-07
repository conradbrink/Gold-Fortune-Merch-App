// The order and sales helpers in the company's words. Gold Fortune's text must
// read exactly as it did before the terminology system; a company on the
// neutral defaults gets the neutral words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchOrder, PartialDispatchError, receivedViaOptions } from "@/lib/orders";
import { fetchSales } from "@/lib/sales";
import { DEFAULT_TERMS, parseTerms, type Terms } from "@/lib/terms";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  site_group: { one: "Chain", many: "Chains" },
  job: { one: "Visit", many: "Visits" },
  staff: { one: "Rep", many: "Reps" },
  client: { one: "Customer", many: "Customers" },
  region: { one: "Region", many: "Regions" },
  territory: { one: "Territory", many: "Territories" },
  prospect: { one: "Lead", many: "Leads" },
  schedule_cycle: { one: "Call cycle", many: "Call cycles" },
  day_plan: { one: "Today's route", many: "Today's routes" },
  workday: { one: "Workday", many: "Workdays" },
});

test("an order taken on a call is labelled in the company's words", () => {
  const label = (t: Terms) => receivedViaOptions(t).find((o) => o.value === "rep_visit")?.label;
  assert.equal(label(goldFortune), "Rep visit");
  assert.equal(label(DEFAULT_TERMS), "Staff member job");
  // The other channels are not business words and do not move.
  assert.deepEqual(
    receivedViaOptions(DEFAULT_TERMS).map((o) => o.label),
    ["WhatsApp", "Email", "Phone", "In person", "Staff member job", "Other"]
  );
});

/** Just enough of a Supabase client for dispatchOrder: two RPCs. */
function dispatchClient(opts: { dispatchId: unknown; assignError?: string }) {
  return {
    rpc: async (fn: string) =>
      fn === "order_dispatch"
        ? { data: { dispatch_id: opts.dispatchId }, error: null }
        : { data: null, error: opts.assignError ? { message: opts.assignError } : null },
  } as never;
}

async function dispatchMessage(t: Terms, opts: { dispatchId: unknown; assignError?: string }) {
  try {
    await dispatchOrder(dispatchClient(opts), "o1", { assignedRepId: "r1" }, t);
  } catch (e) {
    assert.ok(e instanceof PartialDispatchError);
    return e.message;
  }
  assert.fail("expected a PartialDispatchError");
}

test("a dispatch that could not be handed over says so in the company's words", async () => {
  assert.equal(
    await dispatchMessage(goldFortune, { dispatchId: undefined }),
    "The order was dispatched, but it could not be given to a rep — the dispatch id came " +
      "back missing. Set the rep on the delivery below."
  );
  assert.equal(
    await dispatchMessage(goldFortune, { dispatchId: "d1", assignError: "Not allowed." }),
    "The order was dispatched, but it could not be given to a rep: Not allowed. Set the rep " +
      "on the delivery below — do not dispatch again."
  );
  assert.equal(
    await dispatchMessage(DEFAULT_TERMS, { dispatchId: "d1", assignError: "Not allowed." }),
    "The order was dispatched, but it could not be given to a staff member: Not allowed. Set " +
      "the staff member on the delivery below — do not dispatch again."
  );
});

/** A one-page `orders` read for fetchSales: one order with nobody on it. */
function salesClient() {
  const rows = [
    {
      id: "o1",
      order_number: "ORD-1",
      delivered_at: "2026-10-01T10:00:00Z",
      rep_id: null,
      vat_rate: 15,
      stores: { name: "Spar Riverside" },
      profiles: null,
      order_lines: [{ qty_delivered: 2, qty_returned: 0, unit_price: 10 }],
    },
  ];
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    range: async () => ({ data: rows, error: null }),
  };
  return { from: () => chain } as never;
}

test("a sale nobody was responsible for is filed under the company's word", async () => {
  assert.equal((await fetchSales(salesClient(), goldFortune))[0].repName, "No rep");
  assert.equal((await fetchSales(salesClient(), DEFAULT_TERMS))[0].repName, "No staff member");
});
