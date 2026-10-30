// Customer lists past the 1,000 rows one response holds. A distributor passed
// 1,000 customers on 30 Oct 2026: the order and invoice pickers, the schedule
// and the territory counts all stopped at 1,000 without a word, so the
// customers at the end of the list could not be found in the office.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoresForOrder } from "@/lib/orders";
import { fetchStoreGroupUse } from "@/lib/price-lists";
import { fetchAssignments, fetchStores } from "@/lib/representatives";
import { fetchTerritoryStoreCounts, fetchTerritoryStores } from "@/lib/territories";

const CUSTOMERS = 2345;
const MAX_ROWS = 1000;

type Row = Record<string, unknown>;

/**
 * A client whose every table holds [rows], answered as the API does: no more
 * than 1,000 a request, whatever the query asked for. Filters are ignored —
 * these tests are about how many rows come back, not which.
 */
function fakeClient(rows: (table: string) => Row[]) {
  const ranges: Record<string, [number, number][]> = {};
  const client = {
    from(table: string) {
      const all = rows(table);
      let window: [number, number] = [0, all.length - 1];
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        order: () => builder,
        limit: (n: number) => {
          window = [0, n - 1];
          return builder;
        },
        range: (from: number, to: number) => {
          (ranges[table] ??= []).push([from, to]);
          window = [from, to];
          return builder;
        },
        then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
          const [from, to] = window;
          const end = Math.min(to, from + MAX_ROWS - 1);
          return Promise.resolve(resolve({ data: all.slice(from, end + 1), error: null }));
        },
      };
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient, ranges };
}

const stores = Array.from({ length: CUSTOMERS }, (_, i) => ({
  id: `s${String(i).padStart(5, "0")}`,
  name: `Shop ${i}`,
  address: null,
  city: null,
  store_group_id: i % 2 ? "g1" : "g2",
  territory_id: i % 3 ? "t1" : "t2",
  location_confirmed_at: null,
  store_groups: { name: "Group" },
}));

test("the order and invoice pickers list every customer", async () => {
  const { supabase, ranges } = fakeClient(() => stores);
  const list = await fetchStoresForOrder(supabase as never);
  assert.equal(list.length, CUSTOMERS);
  assert.deepEqual(ranges.stores, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("the team's customer list and assignments are whole", async () => {
  const assignments = Array.from({ length: 1500 }, (_, i) => ({
    id: `a${i}`,
    store_id: stores[i].id,
    rep_id: "r1",
    is_primary: true,
  }));
  const { supabase } = fakeClient((t) => (t === "store_assignments" ? assignments : stores));
  assert.equal((await fetchStores(supabase)).length, CUSTOMERS);
  assert.equal((await fetchAssignments(supabase)).length, 1500);
});

test("price-group and territory counts count every customer", async () => {
  const { supabase } = fakeClient((t) =>
    t === "store_groups"
      ? [
          { id: "g1", name: "One", price_list_id: null },
          { id: "g2", name: "Two", price_list_id: null },
        ]
      : stores
  );
  const use = await fetchStoreGroupUse(supabase as never);
  assert.equal(
    use.reduce((n, g) => n + g.stores, 0),
    CUSTOMERS
  );

  const counts = await fetchTerritoryStoreCounts(supabase);
  assert.equal(
    Object.values(counts).reduce((n, c) => n + c, 0),
    CUSTOMERS
  );
  assert.equal((await fetchTerritoryStores(supabase, "t1")).length, CUSTOMERS);
});
