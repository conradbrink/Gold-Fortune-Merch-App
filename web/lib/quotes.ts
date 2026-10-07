import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { orderTotals } from "@/lib/orders";

/**
 * Everything the quote screens read and do.
 *
 * A quote is never an order until `quote_convert` makes one, so nothing here
 * touches `orders` directly. See `20261007095715_quotes.sql` for why quotes
 * have tables of their own rather than an order status.
 */

type Client = SupabaseClient<Database>;

export type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
export type QuoteLineRow = Database["public"]["Tables"]["quote_lines"]["Row"];

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  converted: "Converted",
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** Past its valid-until date and still waiting on the customer. Shown, not stored. */
export function isExpired(q: Pick<QuoteRow, "status" | "valid_until">, today = new Date()) {
  if (!q.valid_until || (q.status !== "draft" && q.status !== "sent")) return false;
  return q.valid_until < today.toISOString().slice(0, 10);
}

export type QuoteListRow = QuoteRow & {
  store_name: string | null;
  order_number: string | null;
  total_incl_vat: number;
};

export async function fetchQuotes(supabase: Client): Promise<QuoteListRow[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "*, stores(name), orders!quotes_converted_order_id_fkey(order_number), quote_lines(qty, unit_price)"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  fail(error);
  type Raw = QuoteRow & {
    stores: { name: string } | null;
    orders: { order_number: string } | null;
    quote_lines: { qty: number; unit_price: number | null }[];
  };
  return ((data ?? []) as unknown as Raw[]).map(({ stores, orders, quote_lines, ...q }) => ({
    ...q,
    store_name: stores?.name ?? null,
    order_number: orders?.order_number ?? null,
    total_incl_vat: orderTotals(
      quote_lines.map((l) => ({ qty: l.qty, unitPrice: Number(l.unit_price ?? 0) })),
      Number(q.vat_rate)
    ).total,
  }));
}

export type QuoteDetail = {
  quote: QuoteRow;
  storeName: string | null;
  storeAddress: string | null;
  repName: string | null;
  orderNumber: string | null;
  lines: (QuoteLineRow & { product_name: string; brand: string | null })[];
};

export async function fetchQuote(supabase: Client, id: string): Promise<QuoteDetail> {
  const [q, l] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "*, stores(name, address), profiles!quotes_rep_id_fkey(full_name), orders!quotes_converted_order_id_fkey(order_number)"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("quote_lines")
      .select("*, products(name, brand)")
      .eq("quote_id", id)
      .order("created_at"),
  ]);
  fail(q.error);
  fail(l.error);
  const raw = q.data as unknown as QuoteRow & {
    stores: { name: string; address: string | null } | null;
    profiles: { full_name: string } | null;
    orders: { order_number: string } | null;
  };
  const { stores, profiles, orders, ...quote } = raw;
  return {
    quote,
    storeName: stores?.name ?? null,
    storeAddress: stores?.address ?? null,
    repName: profiles?.full_name ?? null,
    orderNumber: orders?.order_number ?? null,
    lines: ((l.data ?? []) as unknown as (QuoteLineRow & {
      products: { name: string; brand: string | null } | null;
    })[]).map(({ products, ...line }) => ({
      ...line,
      product_name: products?.name ?? "Unknown product",
      brand: products?.brand ?? null,
    })),
  };
}

/**
 * Creates a quote and its lines.
 *
 * Two inserts and no transaction, as `createManualOrder` does it. A failure on
 * the lines leaves an empty draft, which is visible and can be deleted — a
 * draft quote, unlike an order, is not a record anybody acted on.
 */
export async function createQuote(
  supabase: Client,
  input: {
    orgId: string;
    storeId: string;
    contactName?: string;
    contactPhone?: string;
    repId?: string | null;
    validUntil?: string | null;
    deliveryAddress?: string | null;
    notes?: string;
    lines: { productId: string; qty: number; listPrice: number; discountPct: number }[];
  }
): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one product before saving the quote.");
  }
  const { data: number, error: numberError } = await supabase.rpc("next_document_number", {
    p_org_id: input.orgId,
    p_doc_type: "quote",
    p_prefix: "QT",
  });
  fail(numberError);

  const { data: created, error } = await supabase
    .from("quotes")
    .insert({
      org_id: input.orgId,
      quote_number: number as string,
      store_id: input.storeId,
      contact_name: input.contactName || null,
      contact_phone: input.contactPhone || null,
      rep_id: input.repId || null,
      valid_until: input.validUntil || null,
      delivery_address: input.deliveryAddress || null,
      notes: input.notes || null,
    })
    .select("id")
    .single();
  fail(error);
  const quoteId = (created as { id: string }).id;

  const { error: linesError } = await supabase.from("quote_lines").insert(
    input.lines.map((l) => ({
      org_id: input.orgId,
      quote_id: quoteId,
      product_id: l.productId,
      qty: l.qty,
      list_price: l.listPrice,
      discount_pct: l.discountPct,
    }))
  );
  if (linesError) {
    // Take the empty draft back out, so a retry does not leave a second quote
    // with nothing on it. Its number is spent; a gap in quote numbers is
    // harmless, unlike one in invoice numbers.
    await supabase.from("quotes").delete().eq("id", quoteId);
    throw new Error(linesError.message);
  }
  return quoteId;
}

export async function setQuoteStatus(
  supabase: Client,
  id: string,
  status: "draft" | "sent" | "accepted" | "declined"
) {
  const { error } = await supabase.from("quotes").update({ status }).eq("id", id);
  fail(error);
}

export async function deleteQuote(supabase: Client, id: string) {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  fail(error);
}

/** Makes the order and returns its id. The database refuses a second convert by name. */
export async function convertQuote(supabase: Client, id: string): Promise<string> {
  const { data, error } = await supabase.rpc("quote_convert", { p_quote_id: id });
  fail(error);
  return data as string;
}
