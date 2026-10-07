// The schedule's loaders and writers in the company's words. They name a store
// nobody can see, a rep with no name, and the stores a write could not reach;
// Gold Fortune's text must read exactly as it did before the terminology
// system, and a company on the defaults gets the neutral words.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySpread,
  fetchDayBoard,
  fetchManualStops,
  fetchPlannedStores,
  fetchRepDayPlans,
  type SpreadAssignment,
} from "@/lib/schedule";
import { applyStopOrder, fetchDaysToOrder, type DayPlan } from "@/lib/route-order";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";

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

type Response = { data: unknown; error: { message: string } | null };

/**
 * A stand-in for the Supabase client: every query on a table answers with that
 * table's canned response, whatever filters were chained on the way, and every
 * RPC with `rpc`.
 */
function fakeClient(
  tables: Record<string, Response>,
  rpc: Response = { data: null, error: null }
): SupabaseClient {
  const builder = (res: Response): unknown => {
    const b: unknown = new Proxy(
      {},
      {
        get(_, key) {
          if (key === "then") {
            return (ok: (r: Response) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve(res).then(ok, fail);
          }
          return () => b;
        },
      }
    );
    return b;
  };
  return {
    from: (table: string) => builder(tables[table] ?? { data: [], error: null }),
    rpc: () => Promise.resolve(rpc),
  } as unknown as SupabaseClient;
}

const from = new Date(2026, 9, 1);
const to = new Date(2026, 9, 31);

test("a store nobody can see, and a rep with no name, on the day board", async () => {
  const client = fakeClient({
    profiles: { data: [{ id: "r1", full_name: null }], error: null },
    routes: {
      data: [
        { id: "x", rep_id: "r1", store_id: "s1", sequence_order: 1, stores: null, visits: [] },
      ],
      error: null,
    },
    visits: { data: [], error: null },
  });

  const [gf] = await fetchDayBoard(client, from, goldFortune);
  assert.equal(gf.repName, "Unnamed rep");
  assert.equal(gf.stops[0].storeName, "Unknown store");

  const [neutral] = await fetchDayBoard(client, from, DEFAULT_TERMS);
  assert.equal(neutral.repName, "Unnamed staff member");
  assert.equal(neutral.stops[0].storeName, "Unknown site");
});

test("a store nobody can see, in the planner's loaders", async () => {
  const client = fakeClient({
    routes: {
      data: [
        {
          id: "x",
          store_id: "s1",
          scheduled_date: "2026-10-08",
          sequence_order: 1,
          source: "manual",
          stores: null,
          visits: [],
        },
      ],
      error: null,
    },
    store_assignments: {
      data: [
        { id: "a", store_id: "s1", is_primary: true, day_of_week: null, week_of_cycle: null, stores: null },
      ],
      error: null,
    },
  });

  assert.equal((await fetchManualStops(client, "r1", from, to, goldFortune))[0].store_name, "Unknown store");
  assert.equal((await fetchManualStops(client, "r1", from, to, DEFAULT_TERMS))[0].store_name, "Unknown site");

  const gfDays = await fetchRepDayPlans(client, "r1", from, to, goldFortune);
  assert.equal(gfDays["2026-10-08"].stops[0].store_name, "Unknown store");
  const neutralDays = await fetchRepDayPlans(client, "r1", from, to, DEFAULT_TERMS);
  assert.equal(neutralDays["2026-10-08"].stops[0].store_name, "Unknown site");

  assert.equal((await fetchPlannedStores(client, "r1", goldFortune))[0].store_name, "Unknown store");
  assert.equal((await fetchPlannedStores(client, "r1", DEFAULT_TERMS))[0].store_name, "Unknown site");
});

test("a spread that would not land names how many stores missed it", async () => {
  // Every write matches nothing, so the retry fails too and the error is raised.
  const client = fakeClient({ store_assignments: { data: [], error: null } });
  const row = (n: number, storeName: string): SpreadAssignment => ({
    assignmentId: `a${n}`,
    storeId: `s${n}`,
    storeName,
    city: null,
    dayOfWeek: 2,
    weekOfCycle: null,
  });
  const one = [row(1, "Riverside")];
  const two = [...one, row(2, "Hilltop")];

  await assert.rejects(applySpread(client, one, goldFortune), {
    message:
      "1 store could not be updated (Riverside). They may have been unassigned since the plan was proposed — reload and try again.",
  });
  await assert.rejects(applySpread(client, two, goldFortune), {
    message: /^2 stores could not be updated \(Riverside, Hilltop\)/,
  });
  await assert.rejects(applySpread(client, two, DEFAULT_TERMS), {
    message: /^2 sites could not be updated \(Riverside, Hilltop\)/,
  });
});

test("a store nobody can see, in the days offered for re-ordering", async () => {
  const client = fakeClient({
    routes: {
      data: [
        {
          id: "x",
          rep_id: "r1",
          store_id: "s1",
          scheduled_date: "2026-10-08",
          sequence_order: 1,
          profiles: null,
          stores: null,
          visits: [],
        },
      ],
      error: null,
    },
  });
  const gf = await fetchDaysToOrder(client, 1, goldFortune);
  assert.equal(gf.days[0].stops[0].storeName, "Unknown store");
  const neutral = await fetchDaysToOrder(client, 1, DEFAULT_TERMS);
  assert.equal(neutral.days[0].stops[0].storeName, "Unknown site");
});

test("a re-order the database refused says whose day it was", async () => {
  const client = fakeClient({}, { data: null, error: { message: "that round has already started" } });
  const plan: DayPlan = {
    repId: "r1",
    repName: null,
    date: "2026-10-08",
    routeIds: ["x"],
    currentKm: 10,
    plannedKm: 8,
    stops: 1,
    unplaceable: 0,
    changed: true,
  };

  await assert.rejects(applyStopOrder(client, [plan], goldFortune), {
    message: "A rep's 2026-10-08 was not re-ordered: that round has already started",
  });
  await assert.rejects(applyStopOrder(client, [plan], DEFAULT_TERMS), {
    message: "A staff member's 2026-10-08 was not re-ordered: that round has already started",
  });
  await assert.rejects(applyStopOrder(client, [{ ...plan, repName: "Atang" }], DEFAULT_TERMS), {
    message: "Atang's 2026-10-08 was not re-ordered: that round has already started",
  });
});
