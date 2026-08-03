import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Transfers between our own locations, and authorised adjustments.
 *
 * Both are draft-first: nothing moves until a transfer is dispatched or an
 * adjustment is approved by a manager. This module never writes `status` —
 * it is revoked from `authenticated` on both tables — so the RPCs are the only
 * way either of them takes effect.
 */

type Client = SupabaseClient<Database>;

export type TransferRow = Database["public"]["Tables"]["stock_transfers"]["Row"];
export type TransferLineRow =
  Database["public"]["Tables"]["stock_transfer_lines"]["Row"];
export type AdjustmentRow = Database["public"]["Tables"]["stock_adjustments"]["Row"];
export type AdjustmentLineRow =
  Database["public"]["Tables"]["stock_adjustment_lines"]["Row"];

export type TransferListRow = TransferRow & {
  from_name: string | null;
  to_name: string | null;
  line_count: number;
};

export type AdjustmentListRow = AdjustmentRow & {
  location_name: string | null;
  line_count: number;
};

/** What is actually on the shelf at one location, batch by batch. */
export type SourceStock = {
  product_id: string;
  product_name: string;
  brand: string | null;
  batch_id: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  qty_available: number;
  qty_damaged: number;
  qty_expired: number;
  qty_promotional: number;
};

export const TRANSFER_VARIANCE_REASONS = [
  "short_shipped",
  "damaged_in_transit",
  "lost",
  "miscount",
  "other",
] as const;

/**
 * Adjustment reasons, and the bucket movement each one means.
 *
 * The legs are derived from the reason rather than being picked separately,
 * because "available → damaged" *is* what "damage" means and offering the two
 * as independent choices invites an adjustment that says one thing and does
 * another. `other` is the exception: it has no implied movement, so it asks.
 *
 * A null bucket is the system boundary — stock leaving, or arriving from,
 * outside. The ledger only permits that for reasons that say so out loud, and
 * these four are on that list.
 */
export const ADJUSTMENT_REASONS = [
  {
    value: "damage",
    label: "Damaged",
    from: "available",
    to: "damaged",
    hint: "Still ours, no longer sellable",
  },
  {
    value: "expiry",
    label: "Expired",
    from: "available",
    to: "expired",
    hint: "Past its date",
  },
  {
    value: "promotional",
    label: "Promotional",
    from: "available",
    to: "promotional",
    hint: "Set aside for a promotion or giveaway",
  },
  {
    value: "missing",
    label: "Missing",
    from: "available",
    to: null,
    hint: "Gone, and we do not know where",
  },
  {
    value: "found",
    label: "Found",
    from: null,
    to: "available",
    hint: "On the shelf but not in the system",
  },
  {
    value: "write_off",
    label: "Written off",
    from: "damaged",
    to: null,
    hint: "Damaged stock finally disposed of",
  },
  {
    value: "other",
    label: "Something else",
    from: null,
    to: null,
    hint: "Choose the buckets yourself and say why",
  },
] as const;

export const BUCKETS = [
  "available",
  "reserved",
  "damaged",
  "expired",
  "in_transit",
  "promotional",
] as const;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * The batches actually held at a location.
 *
 * Read from `stock_balances` rather than from `stock_on_hand`, because a
 * transfer or an adjustment has to name a specific batch and the reporting RPC
 * deliberately sums those away.
 */
export async function fetchSourceStock(
  supabase: Client,
  locationId: string
): Promise<SourceStock[]> {
  const { data, error } = await supabase
    .from("stock_balances")
    .select(
      "product_id, batch_id, qty_available, qty_damaged, qty_expired, qty_promotional, products(name, brand), product_batches(batch_number, expiry_date)"
    )
    .eq("location_id", locationId);
  fail(error);

  return ((data ?? []) as unknown as {
    product_id: string;
    batch_id: string | null;
    qty_available: number;
    qty_damaged: number;
    qty_expired: number;
    qty_promotional: number;
    products: { name: string; brand: string | null } | { name: string; brand: string | null }[] | null;
    product_batches:
      | { batch_number: string; expiry_date: string | null }
      | { batch_number: string; expiry_date: string | null }[]
      | null;
  }[])
    .map((b) => {
      const p = one(b.products);
      const batch = one(b.product_batches);
      return {
        product_id: b.product_id,
        product_name: p?.name ?? "Unknown product",
        brand: p?.brand ?? null,
        batch_id: b.batch_id,
        batch_number: batch?.batch_number ?? null,
        expiry_date: batch?.expiry_date ?? null,
        qty_available: b.qty_available,
        qty_damaged: b.qty_damaged,
        qty_expired: b.qty_expired,
        qty_promotional: b.qty_promotional,
      };
    })
    .sort(
      (a, b) =>
        a.product_name.localeCompare(b.product_name) ||
        (a.expiry_date ?? "").localeCompare(b.expiry_date ?? "")
    );
}

// ------------------------------------------------------------- transfers

export async function fetchTransfers(supabase: Client): Promise<TransferListRow[]> {
  const { data, error } = await supabase
    .from("stock_transfers")
    .select(
      "*, from_location:stock_locations!stock_transfers_from_location_id_fkey(name), to_location:stock_locations!stock_transfers_to_location_id_fkey(name), stock_transfer_lines(id)"
    )
    .order("created_at", { ascending: false })
    .limit(100);
  fail(error);
  return ((data ?? []) as unknown as (TransferRow & {
    from_location: { name: string } | { name: string }[] | null;
    to_location: { name: string } | { name: string }[] | null;
    stock_transfer_lines: { id: string }[] | null;
  })[]).map((t) => ({
    ...t,
    from_name: one(t.from_location)?.name ?? null,
    to_name: one(t.to_location)?.name ?? null,
    line_count: (t.stock_transfer_lines ?? []).length,
  }));
}

export async function fetchTransfer(supabase: Client, id: string) {
  const [head, lines] = await Promise.all([
    supabase
      .from("stock_transfers")
      .select(
        "*, from_location:stock_locations!stock_transfers_from_location_id_fkey(name), to_location:stock_locations!stock_transfers_to_location_id_fkey(name)"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("stock_transfer_lines")
      .select("*, products(name, brand), product_batches(batch_number, expiry_date)")
      .eq("transfer_id", id),
  ]);
  fail(head.error);
  fail(lines.error);

  const raw = head.data as unknown as TransferRow & {
    from_location: { name: string } | { name: string }[] | null;
    to_location: { name: string } | { name: string }[] | null;
  };

  return {
    transfer: raw,
    fromName: one(raw.from_location)?.name ?? null,
    toName: one(raw.to_location)?.name ?? null,
    lines: ((lines.data ?? []) as unknown as (TransferLineRow & {
      products: { name: string; brand: string | null } | { name: string; brand: string | null }[] | null;
      product_batches:
        | { batch_number: string; expiry_date: string | null }
        | { batch_number: string; expiry_date: string | null }[]
        | null;
    })[])
      .map((l) => ({
        ...l,
        product_name: one(l.products)?.name ?? "Unknown product",
        batch_number: one(l.product_batches)?.batch_number ?? null,
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name)),
  };
}

export async function createTransfer(
  supabase: Client,
  input: {
    orgId: string;
    fromLocationId: string;
    toLocationId: string;
    notes: string | null;
    lines: { productId: string; batchId: string | null; qtySent: number }[];
  }
): Promise<string> {
  if (input.fromLocationId === input.toLocationId) {
    throw new Error("A transfer has to go somewhere else.");
  }
  if (input.lines.length === 0) {
    throw new Error("Add at least one line.");
  }

  const { data: number, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_org_id: input.orgId, p_doc_type: "transfer", p_prefix: "TRF" }
  );
  fail(numberError);

  const { data: created, error: headError } = await supabase
    .from("stock_transfers")
    .insert({
      org_id: input.orgId,
      transfer_number: number as string,
      from_location_id: input.fromLocationId,
      to_location_id: input.toLocationId,
      notes: input.notes,
    })
    .select("id")
    .single();
  fail(headError);

  const transferId = (created as { id: string }).id;

  const { error: lineError } = await supabase.from("stock_transfer_lines").insert(
    input.lines.map((l) => ({
      org_id: input.orgId,
      transfer_id: transferId,
      product_id: l.productId,
      batch_id: l.batchId,
      qty_sent: l.qtySent,
    }))
  );

  // No transaction spans these three writes — the number, the header, the
  // lines — so a failed line insert would strand a draft with none, holding a
  // document number nobody can use: `stock_transfer_dispatch` refuses an empty
  // transfer, so the row can only be cleared by hand. Removing the header is
  // the client-side approximation of the rollback this wants. The real fix is
  // one `security definer` RPC, which is a migration.
  if (lineError) {
    await supabase.from("stock_transfers").delete().eq("id", transferId);
    fail(lineError);
  }

  return transferId;
}

export async function dispatchTransfer(supabase: Client, id: string) {
  const { data, error } = await supabase.rpc("stock_transfer_dispatch", {
    p_transfer_id: id,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function receiveTransfer(
  supabase: Client,
  id: string,
  lines: { line_id: string; qty_received: number; variance_reason?: string | null }[]
) {
  const { data, error } = await supabase.rpc("stock_transfer_receive", {
    p_transfer_id: id,
    p_lines: lines as unknown as Database["public"]["Functions"]["stock_transfer_receive"]["Args"]["p_lines"],
  });
  fail(error);
  return data as Record<string, unknown>;
}

// ----------------------------------------------------------- adjustments

export async function fetchAdjustments(supabase: Client): Promise<AdjustmentListRow[]> {
  const { data, error } = await supabase
    .from("stock_adjustments")
    .select("*, stock_locations(name), stock_adjustment_lines(id)")
    .order("created_at", { ascending: false })
    .limit(100);
  fail(error);
  return ((data ?? []) as unknown as (AdjustmentRow & {
    stock_locations: { name: string } | { name: string }[] | null;
    stock_adjustment_lines: { id: string }[] | null;
  })[]).map((a) => ({
    ...a,
    location_name: one(a.stock_locations)?.name ?? null,
    line_count: (a.stock_adjustment_lines ?? []).length,
  }));
}

export async function fetchAdjustment(supabase: Client, id: string) {
  const [head, lines] = await Promise.all([
    supabase
      .from("stock_adjustments")
      .select("*, stock_locations(name)")
      .eq("id", id)
      .single(),
    supabase
      .from("stock_adjustment_lines")
      .select("*, products(name, brand), product_batches(batch_number)")
      .eq("adjustment_id", id),
  ]);
  fail(head.error);
  fail(lines.error);

  const raw = head.data as unknown as AdjustmentRow & {
    stock_locations: { name: string } | { name: string }[] | null;
  };

  return {
    adjustment: raw,
    locationName: one(raw.stock_locations)?.name ?? null,
    lines: ((lines.data ?? []) as unknown as (AdjustmentLineRow & {
      products: { name: string; brand: string | null } | { name: string; brand: string | null }[] | null;
      product_batches: { batch_number: string } | { batch_number: string }[] | null;
    })[])
      .map((l) => ({
        ...l,
        product_name: one(l.products)?.name ?? "Unknown product",
        batch_number: one(l.product_batches)?.batch_number ?? null,
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name)),
  };
}

export async function createAdjustment(
  supabase: Client,
  input: {
    orgId: string;
    locationId: string;
    reasonCode: string;
    reasonNote: string | null;
    lines: {
      productId: string;
      batchId: string | null;
      fromBucket: string | null;
      toBucket: string | null;
      qty: number;
      note: string | null;
    }[];
  }
): Promise<string> {
  if (input.lines.length === 0) throw new Error("Add at least one line.");

  const { data: number, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_org_id: input.orgId, p_doc_type: "adjustment", p_prefix: "ADJ" }
  );
  fail(numberError);

  const { data: created, error: headError } = await supabase
    .from("stock_adjustments")
    .insert({
      org_id: input.orgId,
      adjustment_number: number as string,
      location_id: input.locationId,
      reason_code: input.reasonCode,
      reason_note: input.reasonNote,
    })
    .select("id")
    .single();
  fail(headError);

  const adjustmentId = (created as { id: string }).id;

  const { error: lineError } = await supabase.from("stock_adjustment_lines").insert(
    input.lines.map((l) => ({
      org_id: input.orgId,
      adjustment_id: adjustmentId,
      product_id: l.productId,
      batch_id: l.batchId,
      from_bucket: l.fromBucket,
      to_bucket: l.toBucket,
      qty: l.qty,
      note: l.note,
    }))
  );

  // Same shape as `createTransfer` above, and the same reasoning:
  // `stock_adjustment_submit` refuses an adjustment with no lines, so a header
  // left behind is unusable rather than merely untidy.
  if (lineError) {
    await supabase.from("stock_adjustments").delete().eq("id", adjustmentId);
    fail(lineError);
  }

  return adjustmentId;
}

export async function submitAdjustment(supabase: Client, id: string) {
  const { data, error } = await supabase.rpc("stock_adjustment_submit", {
    p_adjustment_id: id,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function decideAdjustment(
  supabase: Client,
  id: string,
  approve: boolean,
  note: string | null
) {
  const { data, error } = await supabase.rpc("stock_adjustment_decide", {
    p_adjustment_id: id,
    p_approve: approve,
    p_note: note ?? undefined,
  });
  fail(error);
  return data as Record<string, unknown>;
}
