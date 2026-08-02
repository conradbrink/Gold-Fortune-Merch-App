import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Goods received notes: keying a delivery, and posting it into stock.
 *
 * A receipt is a draft until it is posted, and posting is the single RPC that
 * creates the batches, converts the pack sizes and writes the movements. This
 * module never touches `status` — it is revoked from `authenticated` — so the
 * only way stock comes into existence is through `goods_receipt_post`.
 */

type Client = SupabaseClient<Database>;

export type GoodsReceiptRow = Database["public"]["Tables"]["goods_receipts"]["Row"];
export type GoodsReceiptLineRow =
  Database["public"]["Tables"]["goods_receipt_lines"]["Row"];

export type ReceiptListRow = GoodsReceiptRow & {
  location_name: string | null;
  line_count: number;
};

export type ReceiptDetail = {
  receipt: GoodsReceiptRow;
  locationName: string | null;
  lines: (GoodsReceiptLineRow & {
    product_name: string;
    brand: string | null;
    is_batch_tracked: boolean;
    units_per_shrink: number | null;
  })[];
};

export const RECEIPT_TYPES = [
  { value: "supplier", label: "Supplier delivery" },
  { value: "opening_stock", label: "Opening stock" },
  { value: "customer_return", label: "Customer return" },
] as const;

export const UOMS = [
  { value: "each", label: "Each" },
  { value: "shrink", label: "Shrink" },
  { value: "case", label: "Case" },
] as const;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function fetchReceipts(supabase: Client): Promise<ReceiptListRow[]> {
  const { data, error } = await supabase
    .from("goods_receipts")
    .select("*, stock_locations(name), goods_receipt_lines(id)")
    .order("created_at", { ascending: false })
    .limit(200);
  fail(error);
  return ((data ?? []) as unknown as (GoodsReceiptRow & {
    stock_locations: { name: string } | { name: string }[] | null;
    goods_receipt_lines: { id: string }[] | null;
  })[]).map((r) => ({
    ...r,
    location_name: one(r.stock_locations)?.name ?? null,
    line_count: (r.goods_receipt_lines ?? []).length,
  }));
}

export async function fetchReceipt(
  supabase: Client,
  id: string
): Promise<ReceiptDetail> {
  const [head, lines] = await Promise.all([
    supabase
      .from("goods_receipts")
      .select("*, stock_locations(name)")
      .eq("id", id)
      .single(),
    supabase
      .from("goods_receipt_lines")
      .select("*, products(name, brand, is_batch_tracked, units_per_shrink)")
      .eq("goods_receipt_id", id)
      .order("created_at"),
  ]);
  fail(head.error);
  fail(lines.error);

  const raw = head.data as unknown as GoodsReceiptRow & {
    stock_locations: { name: string } | { name: string }[] | null;
  };

  return {
    receipt: raw,
    locationName: one(raw.stock_locations)?.name ?? null,
    lines: ((lines.data ?? []) as unknown as (GoodsReceiptLineRow & {
      products:
        | { name: string; brand: string | null; is_batch_tracked: boolean; units_per_shrink: number | null }
        | { name: string; brand: string | null; is_batch_tracked: boolean; units_per_shrink: number | null }[]
        | null;
    })[]).map((l) => {
      const p = one(l.products);
      return {
        ...l,
        product_name: p?.name ?? "Unknown product",
        brand: p?.brand ?? null,
        is_batch_tracked: p?.is_batch_tracked ?? false,
        units_per_shrink: p?.units_per_shrink ?? null,
      };
    }),
  };
}

export async function fetchSuppliers(supabase: Client) {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("active", true)
    .order("name");
  fail(error);
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Creates a draft receipt and its lines. Nothing moves until it is posted.
 *
 * `units_per_uom` is sent only for a case, where the catalogue has no factor to
 * offer. For `each` and `shrink` it is deliberately left null so that
 * `goods_receipt_post` resolves it and freezes the value it actually used onto
 * the line — the whole point of that column is that it records the factor at
 * post time, not one the browser guessed at.
 */
export async function createReceipt(
  supabase: Client,
  input: {
    orgId: string;
    receiptType: string;
    supplierId: string | null;
    supplierName: string | null;
    invoiceNumber: string | null;
    locationId: string;
    receivedAt: string | null;
    notes: string | null;
    lines: {
      productId: string;
      batchNumber: string | null;
      expiryDate: string | null;
      uom: string;
      unitsPerUom: number | null;
      qtyReceived: number;
      qtyDamaged: number;
      unitCost: number | null;
    }[];
  }
): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one line before saving the receipt.");
  }

  const { data: number, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_org_id: input.orgId, p_doc_type: "goods_receipt", p_prefix: "GRN" }
  );
  fail(numberError);

  const { data: created, error: headError } = await supabase
    .from("goods_receipts")
    .insert({
      org_id: input.orgId,
      grn_number: number as string,
      receipt_type: input.receiptType,
      supplier_id: input.supplierId,
      supplier_name: input.supplierName,
      invoice_number: input.invoiceNumber,
      location_id: input.locationId,
      received_at: input.receivedAt ?? new Date().toISOString(),
      notes: input.notes,
    })
    .select("id")
    .single();
  fail(headError);

  const receiptId = (created as { id: string }).id;

  const { error: lineError } = await supabase.from("goods_receipt_lines").insert(
    input.lines.map((l) => ({
      org_id: input.orgId,
      goods_receipt_id: receiptId,
      product_id: l.productId,
      batch_number: l.batchNumber,
      expiry_date: l.expiryDate,
      uom: l.uom,
      units_per_uom: l.uom === "case" ? l.unitsPerUom : null,
      qty_received: l.qtyReceived,
      qty_damaged: l.qtyDamaged,
      unit_cost: l.unitCost,
    }))
  );
  fail(lineError);

  return receiptId;
}

export async function postReceipt(supabase: Client, id: string) {
  const { data, error } = await supabase.rpc("goods_receipt_post", {
    p_goods_receipt_id: id,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function cancelReceipt(supabase: Client, id: string, reason: string) {
  const { data, error } = await supabase.rpc("goods_receipt_cancel", {
    p_goods_receipt_id: id,
    p_reason: reason,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function deleteDraftReceipt(supabase: Client, id: string) {
  // Lines cascade. Only a draft can be deleted — the policy enforces it, so a
  // posted receipt coming through here fails rather than silently doing nothing.
  const { data, error } = await supabase
    .from("goods_receipts")
    .delete()
    .eq("id", id)
    .select("id");
  fail(error);
  if (!data || data.length === 0) {
    throw new Error("That receipt could not be deleted — it may already be posted.");
  }
}
