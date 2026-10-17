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
  /** Who handed the sheet in, or who started it while it is still being counted. */
  counted_by: string | null;
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
    .select(
      "*, stock_locations(name), stocktake_lines(id), " +
        "started:profiles!stocktakes_started_by_fkey(full_name), " +
        "submitted:profiles!stocktakes_submitted_by_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);
  fail(error);
  type Name = { full_name: string | null } | { full_name: string | null }[] | null;
  return ((data ?? []) as unknown as (StocktakeRow & {
    stock_locations: { name: string } | { name: string }[] | null;
    stocktake_lines: { id: string }[] | null;
    started: Name;
    submitted: Name;
  })[]).map((s) => ({
    ...s,
    location_name: one(s.stock_locations)?.name ?? null,
    line_count: (s.stocktake_lines ?? []).length,
    counted_by: one(s.submitted)?.full_name ?? one(s.started)?.full_name ?? null,
  }));
}

/** Who did each step of a count. Null when nobody has, or the person was removed. */
export type StocktakePeople = {
  startedBy: string | null;
  submittedBy: string | null;
  decidedBy: string | null;
};

/** `${product_id}|${batch_id}`, the grain a balance row and a count line share. */
export const balanceKey = (productId: string, batchId: string | null) =>
  `${productId}|${batchId ?? ""}`;

export async function fetchStocktake(supabase: Client, id: string) {
  const [head, lines] = await Promise.all([
    supabase
      .from("stocktakes")
      .select(
        "*, stock_locations(name), " +
          "started:profiles!stocktakes_started_by_fkey(full_name), " +
          "submitted:profiles!stocktakes_submitted_by_fkey(full_name), " +
          "decided:profiles!stocktakes_decided_by_fkey(full_name)"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("stocktake_lines")
      .select("*, products(name, brand)")
      .eq("stocktake_id", id),
  ]);
  fail(head.error);
  fail(lines.error);

  type Name = { full_name: string | null } | { full_name: string | null }[] | null;
  const raw = head.data as unknown as StocktakeRow & {
    stock_locations: { name: string } | { name: string }[] | null;
    started: Name;
    submitted: Name;
    decided: Name;
  };

  // What is packed or set aside for orders at this location right now. The
  // count has to include it, and a counter who is not told that it is in the
  // number counts the shelf and leaves the packed boxes out.
  const balances = await supabase
    .from("stock_balances")
    .select("product_id, batch_id, qty_reserved")
    .eq("location_id", raw.location_id);
  fail(balances.error);
  const setAside: Record<string, number> = {};
  for (const b of balances.data ?? []) {
    if (b.qty_reserved > 0) setAside[balanceKey(b.product_id, b.batch_id)] = b.qty_reserved;
  }

  return {
    stocktake: raw,
    locationName: one(raw.stock_locations)?.name ?? null,
    people: {
      startedBy: one(raw.started)?.full_name ?? null,
      submittedBy: one(raw.submitted)?.full_name ?? null,
      decidedBy: one(raw.decided)?.full_name ?? null,
    } satisfies StocktakePeople,
    setAside,
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
/**
 * A partial save, carrying the lines that did not make it.
 *
 * The count alone is not actionable: told "3 of 40 failed", a counter has no
 * way to find which three among forty rows, and the safe move is to key the
 * whole sheet again. The ids are what let the screen point at them.
 */
export class CountSaveError extends Error {
  constructor(
    message: string,
    readonly failedLineIds: string[]
  ) {
    super(message);
    this.name = "CountSaveError";
  }
}

export async function saveCounts(
  supabase: Client,
  counts: { id: string; countedQty: number | null; varianceReason: string | null }[]
) {
  // Sent in bounded batches rather than one at a time: a full count runs to
  // hundreds of lines, and a round trip each made saving a sheet slow enough
  // that a counter would reasonably think it had hung.
  //
  // This is still not atomic. A line that fails leaves the ones already sent
  // saved, so the failure has to name them — a counter told only "save failed"
  // would retype a sheet that is already half-written, and the half that was
  // written is the half they cannot see.
  const CHUNK = 20;
  const failed: string[] = [];

  for (let i = 0; i < counts.length; i += CHUNK) {
    const batch = counts.slice(i, i + CHUNK);
    const results = await Promise.all(
      batch.map(async (c) => {
        const { error } = await supabase
          .from("stocktake_lines")
          .update({ counted_qty: c.countedQty, variance_reason: c.varianceReason })
          .eq("id", c.id);
        return { id: c.id, error };
      })
    );
    for (const r of results) if (r.error) failed.push(r.id);
  }

  if (failed.length > 0) {
    throw new CountSaveError(
      `${failed.length} of ${counts.length} counted lines did not save. ` +
        `The rest were saved. The lines that failed are marked in the table.`,
      failed
    );
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

/**
 * A manager recounts one line of a handed-in sheet. The recount is measured
 * against what the system says now, and the first count stays on the line.
 */
export async function recountLine(
  supabase: Client,
  input: { lineId: string; counted: number }
) {
  const { data, error } = await supabase.rpc("stocktake_recount_line", {
    p_line_id: input.lineId,
    p_counted: input.counted,
  });
  fail(error);
  return data as Record<string, unknown>;
}
