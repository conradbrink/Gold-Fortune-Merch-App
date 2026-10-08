import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { documentTotals, formatQty, lineTotal } from "@/lib/money-docs";
import { drawMoneyPdf, money } from "@/lib/money-pdf";

/**
 * Everything the quote screens read and do.
 *
 * A quote is for a place on the books or for anyone else (a name, email and
 * address), and its lines are products (Distribution), items from the price
 * list, or free text. An accepted quote becomes an order (`quote_convert`,
 * products only) or is invoiced (`invoice_from_quote`: in full, a deposit, or
 * the final balance). See `20261007095715_quotes.sql` and
 * `20261008180000_invoicing_for_every_trade.sql`.
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

/** Past its valid-until date and still waiting on the client. Shown, not stored. */
export function isExpired(q: Pick<QuoteRow, "status" | "valid_until">, today = new Date()) {
  if (!q.valid_until || (q.status !== "draft" && q.status !== "sent")) return false;
  return q.valid_until < today.toISOString().slice(0, 10);
}

/** Who a quote is for: the place on the books, or the name typed in. */
export function quoteClientName(q: Pick<QuoteRow, "customer_name">, storeName: string | null) {
  return storeName ?? q.customer_name ?? "—";
}

export type QuoteListRow = QuoteRow & {
  store_name: string | null;
  client_name: string;
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
    client_name: quoteClientName(q, stores?.name ?? null),
    order_number: orders?.order_number ?? null,
    total_incl_vat: documentTotals(
      quote_lines.map((l) => ({ qty: Number(l.qty), unitPrice: Number(l.unit_price ?? 0) })),
      Number(q.vat_rate),
      q.prices_include_vat
    ).total,
  }));
}

export type QuoteLine = QuoteLineRow & {
  /** What the line says: the product's name, or the line's own description. */
  label: string;
  brand: string | null;
};

export type QuoteInvoice = {
  id: string;
  invoice_number: string;
  kind: string;
  status: string;
  total: number;
  issue_date: string;
};

export type QuoteDetail = {
  quote: QuoteRow;
  storeName: string | null;
  storeAddress: string | null;
  repName: string | null;
  orderNumber: string | null;
  lines: QuoteLine[];
  /** Its invoices, void ones included, oldest first. */
  invoices: QuoteInvoice[];
};

export async function fetchQuote(supabase: Client, id: string): Promise<QuoteDetail> {
  const [q, l, inv] = await Promise.all([
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
      .order("position", { nullsFirst: false })
      .order("created_at"),
    supabase
      .from("tax_invoices")
      .select("id, invoice_number, kind, status, total, issue_date")
      .eq("quote_id", id)
      .order("created_at"),
  ]);
  fail(q.error);
  fail(l.error);
  fail(inv.error);
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
      label: line.description ?? products?.name ?? "—",
      brand: line.description ? null : (products?.brand ?? null),
    })),
    invoices: ((inv.data ?? []) as QuoteInvoice[]).map((i) => ({ ...i, total: Number(i.total) })),
  };
}

/** The quote's own totals, in its VAT basis. */
export function quoteTotals(detail: Pick<QuoteDetail, "quote" | "lines">) {
  return documentTotals(
    detail.lines.map((l) => ({ qty: Number(l.qty), unitPrice: Number(l.unit_price ?? 0) })),
    Number(detail.quote.vat_rate),
    detail.quote.prices_include_vat
  );
}

/**
 * How much of an accepted quote its live invoices already charge, in the
 * quote's own basis — what is left for a deposit or the final invoice.
 */
export function invoicedSoFar(detail: Pick<QuoteDetail, "invoices">) {
  return detail.invoices
    .filter((i) => i.status === "issued")
    .reduce((n, i) => n + i.total, 0);
}

export type NewQuoteLine =
  | { kind: "product"; productId: string; qty: number; listPrice: number; discountPct: number }
  | { kind: "service"; serviceItemId: string; description: string; unit: string | null; qty: number; price: number }
  | { kind: "text"; description: string; unit: string | null; qty: number; price: number };

/**
 * Creates a quote and its lines.
 *
 * Two inserts and no transaction, as `createManualOrder` does it. A failure on
 * the lines leaves an empty draft, which is taken back out — a draft quote,
 * unlike an order, is not a record anybody acted on.
 */
export async function createQuote(
  supabase: Client,
  input: {
    orgId: string;
    prefix: string;
    billTo: { storeId: string } | { name: string; address?: string; email?: string };
    contactName?: string;
    contactPhone?: string;
    repId?: string | null;
    validUntil?: string | null;
    deliveryAddress?: string | null;
    notes?: string;
    lines: NewQuoteLine[];
  }
): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one line before saving the quote.");
  }
  const { data: number, error: numberError } = await supabase.rpc("next_document_number", {
    p_org_id: input.orgId,
    p_doc_type: "quote",
    p_prefix: input.prefix,
  });
  fail(numberError);

  const forStore = "storeId" in input.billTo;
  const { data: created, error } = await supabase
    .from("quotes")
    .insert({
      org_id: input.orgId,
      quote_number: number as string,
      store_id: forStore ? (input.billTo as { storeId: string }).storeId : null,
      customer_name: forStore ? null : (input.billTo as { name: string }).name.trim(),
      customer_address: forStore ? null : (input.billTo as { address?: string }).address?.trim() || null,
      contact_email: forStore ? null : (input.billTo as { email?: string }).email?.trim() || null,
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
    input.lines.map((l, i) =>
      l.kind === "product"
        ? {
            org_id: input.orgId,
            quote_id: quoteId,
            position: i + 1,
            product_id: l.productId,
            qty: l.qty,
            list_price: l.listPrice,
            discount_pct: l.discountPct,
          }
        : {
            org_id: input.orgId,
            quote_id: quoteId,
            position: i + 1,
            service_item_id: l.kind === "service" ? l.serviceItemId : null,
            description: l.description.trim(),
            unit: l.unit?.trim() || null,
            qty: l.qty,
            list_price: l.price,
          }
    )
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

/**
 * Invoices an accepted quote: in full, a deposit (a percentage or an amount),
 * or the final balance less the deposits. Returns the invoice's id.
 */
export async function invoiceQuote(
  supabase: Client,
  id: string,
  mode: "full" | "deposit" | "final",
  deposit?: { percent?: number; amount?: number }
): Promise<string> {
  const { data, error } = await supabase.rpc("invoice_from_quote", {
    p_quote_id: id,
    p_mode: mode,
    p_percent: deposit?.percent,
    p_amount: deposit?.amount,
  });
  fail(error);
  return data as string;
}

/** The company's details for the quote's letterhead: its current ones, as a quote is not a tax document. */
export type QuoteSeller = Pick<
  Database["public"]["Tables"]["organizations"]["Row"],
  | "name"
  | "legal_name"
  | "address"
  | "tax_number"
  | "vat_number"
  | "registration_number"
  | "phone"
  | "support_email"
  | "logo_path"
  | "bank_details"
>;

export async function fetchQuoteSeller(supabase: Client): Promise<QuoteSeller> {
  const { data, error } = await supabase
    .from("organizations")
    .select("name, legal_name, address, tax_number, vat_number, registration_number, phone, support_email, logo_path, bank_details")
    .limit(1)
    .single();
  fail(error);
  return data as QuoteSeller;
}

export async function downloadQuotePdf(detail: QuoteDetail, seller: QuoteSeller) {
  const q = detail.quote;
  const totals = quoteTotals(detail);
  const rate = Number(q.vat_rate);
  const meta: [string, string][] = [
    ["Quote no", q.quote_number],
    ["Date", q.created_at.slice(0, 10)],
  ];
  if (q.valid_until) meta.push(["Valid until", q.valid_until]);
  await drawMoneyPdf({
    heading: "QUOTE",
    fileName: q.quote_number,
    seller: {
      name: seller.legal_name || seller.name,
      address: seller.address,
      registrationNumber: seller.registration_number,
      taxNumber: seller.tax_number,
      vatNumber: seller.vat_number,
      phone: seller.phone,
      email: seller.support_email,
      logoPath: seller.logo_path,
    },
    meta,
    billTo: {
      label: "QUOTE FOR",
      name: quoteClientName(q, detail.storeName),
      address: q.customer_address ?? q.delivery_address ?? detail.storeAddress,
      email: q.contact_email,
    },
    head: ["Description", "Qty", "Unit price", "Amount"],
    numeric: [1, 2, 3],
    rows: detail.lines.map((l) => [
      l.brand ? `${l.label} — ${l.brand}` : l.label,
      l.unit ? `${formatQty(Number(l.qty))} ${l.unit}` : formatQty(Number(l.qty)),
      money(Number(l.unit_price ?? 0)),
      money(lineTotal(Number(l.qty), Number(l.unit_price ?? 0))),
    ]),
    totals:
      rate === 0
        ? [["Total", money(totals.total)]]
        : [
            ["Subtotal (excl. VAT)", money(totals.subtotal)],
            [q.prices_include_vat ? `VAT ${rate}% (included)` : `VAT ${rate}%`, money(totals.vat)],
            ["Total", money(totals.total)],
          ],
    notes: q.notes ? [q.notes] : [],
    payTo: seller.bank_details,
  });
}
