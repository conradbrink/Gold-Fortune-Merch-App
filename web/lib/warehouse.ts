import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Everything the warehouse and inventory screens read.
 *
 * Follows the shape `lib/leads.ts` established: each function takes the client,
 * throws on error, and returns plain rows. The page owns the loading and error
 * state; this module owns the query and the normalisation, so a page never has
 * to know an RPC name or remember which column is nullable.
 */

type Client = SupabaseClient<Database>;

export type StockLocation = { id: string; name: string; type: string; is_default: boolean };

export type StockLine =
  Database["public"]["Functions"]["stock_on_hand"]["Returns"][number];
export type StockPosition =
  Database["public"]["Functions"]["stock_position_summary"]["Returns"][number];
export type LowStockAlert =
  Database["public"]["Functions"]["low_stock_alerts"]["Returns"][number];
export type ExpiringBatch =
  Database["public"]["Functions"]["expiring_stock"]["Returns"][number];
export type PipelineRow =
  Database["public"]["Functions"]["orders_pipeline_summary"]["Returns"][number];
export type PerformanceRow =
  Database["public"]["Functions"]["warehouse_performance"]["Returns"][number];
export type VelocityRow =
  Database["public"]["Functions"]["product_velocity"]["Returns"][number];
export type MovementSummaryRow =
  Database["public"]["Functions"]["stock_movement_summary"]["Returns"][number];
export type AgeingRow =
  Database["public"]["Functions"]["stock_ageing"]["Returns"][number];
export type ValuationRow =
  Database["public"]["Functions"]["stock_valuation"]["Returns"][number];
export type MissingPodRow =
  Database["public"]["Functions"]["orders_missing_pod"]["Returns"][number];

/** Every status an order can sit at, in the order the warehouse works them. */
export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "picking",
  "packed",
  "dispatched",
  "delivered",
  "cancelled",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  confirmed: "Confirmed",
  picking: "Picking",
  packed: "Packed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function unwrap<T>(data: T[] | null, error: { message: string } | null): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchLocations(supabase: Client): Promise<StockLocation[]> {
  const { data, error } = await supabase
    .from("stock_locations")
    .select("id, name, type, is_default")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("name");
  return unwrap(data as StockLocation[] | null, error);
}

export async function fetchStockOnHand(
  supabase: Client,
  opts: { locationId?: string | null; search?: string; onlyBelowMin?: boolean } = {}
): Promise<StockLine[]> {
  const { data, error } = await supabase.rpc("stock_on_hand", {
    p_location_id: opts.locationId ?? undefined,
    p_search: opts.search?.trim() || undefined,
    p_only_below_min: opts.onlyBelowMin ?? false,
  });
  return unwrap(data, error);
}

export async function fetchStockPosition(
  supabase: Client,
  locationId?: string | null
): Promise<StockPosition | null> {
  const { data, error } = await supabase.rpc("stock_position_summary", {
    p_location_id: locationId ?? undefined,
  });
  // A set-returning function with one row. No stock at all still returns a row
  // of zeroes, but an empty array is possible and must not crash the tiles.
  return unwrap(data, error)[0] ?? null;
}

export async function fetchLowStock(
  supabase: Client,
  locationId?: string | null
): Promise<LowStockAlert[]> {
  const { data, error } = await supabase.rpc("low_stock_alerts", {
    p_location_id: locationId ?? undefined,
  });
  return unwrap(data, error);
}

export async function fetchExpiring(
  supabase: Client,
  withinDays = 90,
  locationId?: string | null
): Promise<ExpiringBatch[]> {
  const { data, error } = await supabase.rpc("expiring_stock", {
    p_within_days: withinDays,
    p_location_id: locationId ?? undefined,
  });
  return unwrap(data, error);
}

export async function fetchPipeline(
  supabase: Client,
  from: Date,
  to: Date
): Promise<PipelineRow[]> {
  const { data, error } = await supabase.rpc("orders_pipeline_summary", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  return unwrap(data, error);
}

export async function fetchPerformance(
  supabase: Client,
  from: Date,
  to: Date,
  groupBy: "overall" | "staff" | "driver" | "area" | "date" = "overall"
): Promise<PerformanceRow[]> {
  const { data, error } = await supabase.rpc("warehouse_performance", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_group_by: groupBy,
  });
  return unwrap(data, error);
}

export async function fetchVelocity(
  supabase: Client,
  days = 30,
  locationId?: string | null
): Promise<VelocityRow[]> {
  const { data, error } = await supabase.rpc("product_velocity", {
    p_days: days,
    p_location_id: locationId ?? undefined,
  });
  return unwrap(data, error);
}

export async function fetchMovementSummary(
  supabase: Client,
  from: Date,
  to: Date,
  locationId?: string | null
): Promise<MovementSummaryRow[]> {
  const { data, error } = await supabase.rpc("stock_movement_summary", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_location_id: locationId ?? undefined,
  });
  return unwrap(data, error);
}

export async function fetchAgeing(
  supabase: Client,
  locationId?: string | null
): Promise<AgeingRow[]> {
  const { data, error } = await supabase.rpc("stock_ageing", {
    p_location_id: locationId ?? undefined,
  });
  return unwrap(data, error);
}

export async function fetchValuation(
  supabase: Client,
  locationId?: string | null
): Promise<ValuationRow[]> {
  const { data, error } = await supabase.rpc("stock_valuation", {
    p_location_id: locationId ?? undefined,
  });
  return unwrap(data, error);
}

export async function fetchMissingPods(
  supabase: Client,
  minDays = 0
): Promise<MissingPodRow[]> {
  const { data, error } = await supabase.rpc("orders_missing_pod", {
    p_min_days: minDays,
  });
  return unwrap(data, error);
}

/**
 * Total inventory value at cost.
 *
 * Products with no purchase history have a null cost, and those are summed as
 * zero here — but the count of them is returned alongside, so the page can say
 * "of which N products have no cost on record" rather than presenting a total
 * that is quietly missing some of the stock.
 */
export function totalValuation(rows: ValuationRow[]): {
  total: number;
  productsWithoutCost: number;
} {
  let total = 0;
  let productsWithoutCost = 0;
  for (const r of rows) {
    if (r.value_at_cost == null) productsWithoutCost += 1;
    else total += Number(r.value_at_cost);
  }
  return { total, productsWithoutCost };
}
