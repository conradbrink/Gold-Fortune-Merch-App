import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Stocktakes: counting, submitting, and a manager's decision.
 *
 * The three system quantities on a line are the whole point of this feature, so
 * they are surfaced rather than hidden. `stocktake_variance_report` returns
 * `moved_since_submit`, and the approval screen shows it — approving a line
 * whose balance has changed since the sheet was handed in requires ticking that
 * specific line, which is what `p_reconfirm_line_ids` carries.
 */

type Client = SupabaseClient<Database>;

export type StocktakeRow = Database["public"]["Tables"]["stocktakes"]["Row"];
export type StocktakeLineRow = Database["public"]["Tables"]["stocktake_lines"]["Row"];
export type VarianceRow =
  Database["public"]["Functions"]["stocktake_variance_report"]["Returns"][number];

export type StocktakeListRow = StocktakeRow & {
  location_name: string | null;
  line_count: number;
};

export const STOCKTAKE_TYPES = [
  { value: "full", label: "Full count", hint: "Everything at the location" },
  { value: "cycle", label: "Cycle count", hint: "A regular slice of the range" },
  { value: "spot", label: "Spot check", hint: "A few lines, right now" },
] as const;

export const VARIANCE_REASONS = [
  "miscount",
  "theft",
  "damage_unrecorded",
  "expiry_unrecorded",
  "receiving_error",
  "picking_error",
  "system_error",
  "other",
] as const;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function fetchStocktakes(supabase: Client): Promise<StocktakeListRow[]> {
  const { data, error } = await supabase
    .from("stocktakes")
    .select("*, stock_locations(name), stocktake_lines(id)")
    .order("created_at", { ascending: false })
    .limit(100);
  fail(error);
  return ((data ?? []) as unknown as (StocktakeRow & {
    stock_locations: { name: string } | { name: string }[] | null;
    stocktake_lines: { id: string }[] | null;
  })[]).map((s) => ({
    ...s,
    location_name: one(s.stock_locations)?.name ?? null,
    line_count: (s.stocktake_lines ?? []).length,
  }));
}

export async function fetchStocktake(supabase: Client, id: string) {
  const [head, lines] = await Promise.all([
    supabase
      .from("stocktakes")
      .select("*, stock_locations(name)")
      .eq("id", id)
      .single(),
    supabase
      .from("stocktake_lines")
      .select("*, products(name, brand)")
      .eq("stocktake_id", id),
  ]);
  fail(head.error);
  fail(lines.error);

  const raw = head.data as unknown as StocktakeRow & {
    stock_locations: { name: string } | { name: string }[] | null;
  };

  return {
    stocktake: raw,
    locationName: one(raw.stock_locations)?.name ?? null,
    lines: ((lines.data ?? []) as unknown as (StocktakeLineRow & {
      products: { name: string; brand: string | null } | { name: string; brand: string | null }[] | null;
    })[])
      .map((l) => {
        const p = one(l.products);
        return { ...l, product_name: p?.name ?? "Unknown product", brand: p?.brand ?? null };
      })
      .sort((a, b) => a.product_name.localeCompare(b.product_name)),
  };
}

export async function fetchVarianceReport(
  supabase: Client,
  id: string
): Promise<VarianceRow[]> {
  const { data, error } = await supabase.rpc("stocktake_variance_report", {
    p_stocktake_id: id,
  });
  fail(error);
  return data ?? [];
}

export async function openStocktake(
  supabase: Client,
  input: { locationId: string; type: string; freeze: boolean }
) {
  const { data, error } = await supabase.rpc("stocktake_open", {
    p_location_id: input.locationId,
    p_stocktake_type: input.type,
    p_freeze: input.freeze,
  });
  fail(error);
  return data as Record<string, unknown>;
}

/**
 * Saves the counted quantities.
 *
 * `counted_qty` and `variance_reason` are the only columns a counter holds a
 * grant on; everything the variance is computed from is server-controlled. So
 * this is a plain update per line rather than an RPC, and the database is what
 * stops it being anything more.
 */
export async function saveCounts(
  supabase: Client,
  counts: { id: string; countedQty: number | null; varianceReason: string | null }[]
) {
  for (const c of counts) {
    const { error } = await supabase
      .from("stocktake_lines")
      .update({ counted_qty: c.countedQty, variance_reason: c.varianceReason })
      .eq("id", c.id);
    fail(error);
  }
}

export async function submitStocktake(supabase: Client, id: string) {
  const { data, error } = await supabase.rpc("stocktake_submit", {
    p_stocktake_id: id,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function decideStocktake(
  supabase: Client,
  input: {
    id: string;
    approve: boolean;
    note: string | null;
    reconfirmLineIds?: string[];
  }
) {
  const { data, error } = await supabase.rpc("stocktake_decide", {
    p_stocktake_id: input.id,
    p_approve: input.approve,
    p_note: input.note ?? undefined,
    p_reconfirm_line_ids: input.reconfirmLineIds?.length
      ? input.reconfirmLineIds
      : undefined,
  });
  fail(error);
  return data as Record<string, unknown>;
}
