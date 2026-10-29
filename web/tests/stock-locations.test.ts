// Delivery vehicles are not shelves (20261029235300). A van's empty lines are
// left out of stock_on_hand and no van or rep location raises a low-stock
// alert; the rules are the database's (supabase/tests/low_stock_locations.sql).
// This holds what the inventory table says when a picked location has nothing,
// and what Ask AI says about a line with no minimum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toModuleSet } from "@/lib/modules";
import { toPermissionSet } from "@/lib/permissions";
import { parseTerms } from "@/lib/terms";
import { runTool, type ToolEnv } from "@/lib/assistant-data";
import { emptyStockText, type StockLocation } from "@/lib/warehouse";

const van: StockLocation = { id: "v1", name: "Vehicle BWK 418 FS", type: "vehicle", is_default: false };
const main: StockLocation = { id: "w1", name: "Main warehouse", type: "warehouse", is_default: true };
const none = { search: "", onlyBelowMin: false, lowOnly: false };

test("an empty van says it holds nothing, not that no stock was ever received", () => {
  assert.equal(emptyStockText({ ...none, location: van }), "Vehicle BWK 418 FS holds no stock right now.");
});

test("an empty warehouse, or every location, still asks for a first delivery", () => {
  const first = "No stock recorded yet. Receive a delivery to get started.";
  assert.equal(emptyStockText({ ...none, location: main }), first);
  assert.equal(emptyStockText({ ...none, location: null }), first);
});

test("a filter that matches nothing says so, wherever it is", () => {
  const nothing = "Nothing matches those filters.";
  assert.equal(emptyStockText({ ...none, location: van, onlyBelowMin: true }), nothing);
  assert.equal(emptyStockText({ ...none, location: van, search: "jam" }), nothing);
  assert.equal(emptyStockText({ ...none, location: null, lowOnly: true, search: "jam" }), nothing);
  assert.equal(
    emptyStockText({ ...none, location: null, lowOnly: true }),
    "Nothing is at or below its reorder point."
  );
});

/** A stock_on_hand line as the database returns it. */
function line(over: Record<string, unknown>) {
  return {
    product_id: "p1", product_name: "Apricot Jam 450 g", brand: null, sku_code: null,
    location_id: "w1", location_name: "Main warehouse",
    qty_available: 0, qty_reserved: 0, qty_damaged: 0, qty_expired: 0,
    qty_in_transit: 0, qty_promotional: 0, qty_on_hand: 0,
    min_stock_level: null, reorder_point: null, is_below_min: false, is_out_of_stock: false,
    ...over,
  };
}

test("Ask AI leaves a van's minimum blank instead of calling it 0", async () => {
  const rows = [
    line({ qty_available: 30, qty_on_hand: 30, min_stock_level: 120, reorder_point: 240, is_below_min: true }),
    line({ location_id: "v1", location_name: "Vehicle BWK 418 FS", qty_in_transit: 36 }),
  ];
  const env: ToolEnv = {
    // stock_on_hand is the lookup's only read.
    supabase: { rpc: async () => ({ data: rows, error: null }) } as never,
    terms: parseTerms({}),
    timeZone: "Africa/Johannesburg",
    today: "2026-10-29",
    orgId: "org-1",
    permissions: toPermissionSet(["warehouse"]),
    modules: toModuleSet({ warehouse: true }),
    isManager: false,
    dashboardDefault: [],
  };
  const out = await runTool("stock", "{}", env);
  const lines = (out.model as { lines: { location: string; minimum: number | null; below_minimum: string }[] }).lines;
  assert.deepEqual(
    lines.map((l) => [l.location, l.minimum, l.below_minimum]),
    [
      ["Main warehouse", 120, "Below minimum"],
      ["Vehicle BWK 418 FS", null, ""],
    ]
  );
  assert.equal(out.sheet?.rows[1].minimum, null);
});
