// Customer lists past the 1,000 rows one response holds. A distributor passed
// 1,000 customers on 30 Oct 2026: the order and invoice pickers, the schedule
// and the territory counts all stopped at 1,000 without a word, so the
// customers at the end of the list could not be found in the office.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allByKey, byName, type KeyedQuery } from "@/lib/all-pages";
import { fetchStoresForOrder } from "@/lib/orders";
import { fetchStoreGroupUse } from "@/lib/price-lists";
import { fetchAssignments, fetchStoreChoices, fetchStores } from "@/lib/representatives";
import { fetchTerritoryImpact, fetchTerritoryStoreCounts, fetchTerritoryStores } from "@/lib/territories";

const CUSTOMERS = 2345;

type Row = Record<string, unknown>;

/**
 * A client whose every table holds [rows], answered as the API does: rows
 * past `gt` on the ordered key, no more than [maxRows] a request whatever the
 * query asked for. Other filters are ignored — these tests are about how many
 * rows come back, not which. [beforeRead] runs before each request, to change
 * the table while it is being read.
 */
function fakeClient(rows: (table: string) => Row[], { maxRows = 1000, beforeRead = () => {} } = {}) {
  const requests: { table: string; after: string | null }[] = [];
  const client = {
    from(table: string) {
      let after: string | null = null;
      let key = "id";
      let limit = Infinity;
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        gt: (column: string, value: string) => {
          key = column;
          after = value;
          return builder;
        },
        order: (column: string) => {
          key = column;
          return builder;
        },
        limit: (n: number) => {
          limit = n;
          return builder;
        },
        then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
          beforeRead();
          requests.push({ table, after });
          const sorted = [...rows(table)].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
          const past = sorted.filter((r) => after === null || String(r[key]) > after);
          return Promise.resolve(resolve({ data: past.slice(0, Math.min(limit, maxRows)), error: null }));
        },
      };
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient, requests };
}

const stores = Array.from({ length: CUSTOMERS }, (_, i) => ({
  id: `s${String(i).padStart(5, "0")}`,
  name: `Shop ${String(CUSTOMERS - i).padStart(5, "0")}`,
  address: null,
  city: null,
  store_group_id: i % 2 ? "g1" : "g2",
  territory_id: i % 3 ? "t1" : "t2",
  location_confirmed_at: null,
  store_groups: { name: "Group" },
}));

test("the order and invoice pickers list every customer, A-Z", async () => {
  const { supabase, requests } = fakeClient(() => stores);
  const list = await fetchStoresForOrder(supabase as never);
  assert.equal(list.length, CUSTOMERS);
  assert.deepEqual(
    requests.map((r) => r.after),
    [null, "s00999", "s01999"]
  );
  assert.equal(list[0].name, "Shop 00001");
});

test("a server that answers fewer rows than asked for is still read to the end", async () => {
  const { supabase } = fakeClient(() => stores, { maxRows: 400 });
  assert.equal((await fetchStoresForOrder(supabase as never)).length, CUSTOMERS);
});

test("a customer added while the list is read is not read twice", async () => {
  const table = stores.slice(0, 1500).map((s) => ({ ...s }));
  let reads = 0;
  const { supabase } = fakeClient(() => table, {
    beforeRead: () => {
      // A rep adds a customer between the first and second page.
      if (++reads === 2) table.push({ ...stores[0], id: "s00000a", name: "Aaa Shop" });
    },
  });
  const ids = (await fetchStoresForOrder(supabase as never)).map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 1500);
});

test("a short list asks once more to be sure, and stops", async () => {
  const { supabase, requests } = fakeClient(() => stores.slice(0, 12));
  assert.equal((await fetchStoreChoices(supabase)).length, 12);
  assert.equal(requests.length, 2);
});

test("a server that ignores the key filter cannot keep the read going", async () => {
  const page = stores.slice(0, 5);
  const query = () =>
    ({
      gt: () => query(),
      order: () => ({ limit: () => Promise.resolve({ data: page, error: null }) }),
    }) as unknown as KeyedQuery<Row>;
  assert.equal((await allByKey<Row>(query)).length, 10);
});

test("equal names keep one order", () => {
  const a = { id: "b", name: "Double Store" };
  const b = { id: "a", name: "double store" };
  assert.deepEqual([a, b].sort(byName), [b, a]);
  assert.deepEqual([b, a].sort(byName), [b, a]);
});

test("the team's customer list and assignments are whole", async () => {
  const assignments = Array.from({ length: 1500 }, (_, i) => ({
    id: `a${String(i).padStart(5, "0")}`,
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

test("a territory's delete check is counted by the database, routes through the store", async () => {
  const calls: { table: string; select?: string; eq: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, select: undefined as string | undefined, eq: [] as [string, unknown][] };
      calls.push(call);
      const builder = {
        select: (columns: string) => {
          call.select = columns;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          call.eq.push([column, value]);
          return builder;
        },
        gte: () => builder,
        then<T>(resolve: (v: { data: Row[] | null; count: number | null; error: null }) => T) {
          const count = table === "stores" ? 1500 : table === "routes" ? 42 : null;
          return Promise.resolve(resolve({ data: count === null ? [] : null, count, error: null }));
        },
      };
      return builder;
    },
  };
  const impact = await fetchTerritoryImpact(client as unknown as SupabaseClient, {
    id: "t1",
    name: "Mitchells Plain",
  } as never);
  assert.equal(impact.stores, 1500);
  assert.equal(impact.upcomingRoutes, 42);
  const routes = calls.find((c) => c.table === "routes")!;
  assert.match(routes.select ?? "", /stores!inner\(territory_id\)/);
  assert.deepEqual(routes.eq, [["stores.territory_id", "t1"]]);
});
