import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { documentTotals, formatQty, lineTotal } from "@/lib/money-docs";
import { drawMoneyPdf, paperDate, paperLines, paperMoney, vatRows, type Paper, type PdfSpec } from "@/lib/money-pdf";
import { billingErrorMessage } from "@/lib/billing";

/**
 * Everything the quote screens read and do.
 *
 * A quote is for a place on the books or for anyone else (a name, email and
 * address), and its lines are products (Distribution), items from the price
 * list, or free text. An accepted quote becomes an order (`quote_convert`,
 * products only) or is invoiced (`invoice_from_quote`: in full, a deposit, or
 * the final balance). An edited draft or sent quote is saved in one step
 * (`quote_save`). A product is priced per unit or per shrink; the order made
 * from it counts units. See `20261007095715_quotes.sql`,
 * `20261008180000_invoicing_for_every_trade.sql`, `20261023141700_quote_save.sql`
 * and `20261027154700_quote_shrink_lines.sql`.
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
  /** The store's group, whose price list the edit form prices new products from. */
  storeGroupId: string | null;
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
        "*, stores(name, address, store_group_id), profiles!quotes_rep_id_fkey(full_name), orders!quotes_converted_order_id_fkey(order_number)"
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
    stores: { name: string; address: string | null; store_group_id: string | null } | null;
    profiles: { full_name: string } | null;
    orders: { order_number: string } | null;
  };
  const { stores, profiles, orders, ...quote } = raw;
  return {
    quote,
    storeName: stores?.name ?? null,
    storeAddress: stores?.address ?? null,
    storeGroupId: stores?.store_group_id ?? null,
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
export function quoteTotals(detail: {
  quote: Pick<QuoteRow, "vat_rate" | "prices_include_vat">;
  lines: { qty: number; unit_price: number | null }[];
}) {
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
  | {
      kind: "product";
      productId: string;
      /** Units in the product's shrink when the line is priced per shrink (qty counts shrinks); null per unit. */
      unitsPerShrink: number | null;
      qty: number;
      listPrice: number;
      discountPct: number;
      /** Off the whole line, in place of the percentage. */
      discountAmount: number;
    }
  | { kind: "service"; serviceItemId: string; description: string; unit: string | null; qty: number; price: number }
  | { kind: "text"; description: string; unit: string | null; qty: number; price: number };

/** Who a quote is for and the rest of its header, as a new quote and an edited one both write it. */
export type QuoteHeader = {
  billTo: { storeId: string } | { name: string; address?: string; email?: string };
  contactName?: string;
  contactPhone?: string;
  repId?: string | null;
  validUntil?: string | null;
  deliveryAddress?: string | null;
  notes?: string;
};

/** The first part of who the quote is for that the database would refuse, in words, or null: said before saving. */
export function quoteHeaderProblem(input: Pick<QuoteHeader, "billTo">): string | null {
  if ("storeId" in input.billTo) return null;
  // Counted in characters, as the database counts them.
  const chars = (v?: string) => [...(v ?? "").trim()].length;
  if (chars(input.billTo.name) > 200) return "A name is 200 characters at most.";
  if (chars(input.billTo.address) > 500) return "An address is 500 characters at most.";
  if (chars(input.billTo.email) > 200) return "An email address is 200 characters at most.";
  return null;
}

function headerColumns(input: QuoteHeader) {
  const forStore = "storeId" in input.billTo;
  return {
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
  };
}

/**
 * What a line writes. Every column is spelt out, so an edited line drops what
 * it no longer has (a discount taken off, a unit cleared) rather than keeping it.
 */
export function lineColumns(l: NewQuoteLine, position: number) {
  return l.kind === "product"
    ? {
        position,
        product_id: l.productId,
        service_item_id: null,
        description: null,
        unit: l.unitsPerShrink ? "shrink" : null,
        units_per_shrink: l.unitsPerShrink,
        qty: l.qty,
        list_price: l.listPrice,
        discount_pct: l.discountAmount > 0 ? 0 : l.discountPct,
        discount_amount: l.discountAmount,
      }
    : {
        position,
        product_id: null,
        service_item_id: l.kind === "service" ? l.serviceItemId : null,
        description: l.description.trim(),
        unit: l.unit?.trim() || null,
        units_per_shrink: null,
        qty: l.qty,
        list_price: l.price,
        discount_pct: 0,
        discount_amount: 0,
      };
}

/**
 * Creates a quote and its lines.
 *
 * Two inserts and no transaction, as `createManualOrder` does it. A failure on
 * the lines leaves an empty draft, which is taken back out — a draft quote,
 * unlike an order, is not a record anybody acted on.
 */
export async function createQuote(
  supabase: Client,
  input: QuoteHeader & { orgId: string; prefix: string; lines: NewQuoteLine[] }
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

  const { data: created, error } = await supabase
    .from("quotes")
    .insert({ org_id: input.orgId, quote_number: number as string, ...headerColumns(input) })
    .select("id")
    .single();
  fail(error);
  const quoteId = (created as { id: string }).id;

  const { error: linesError } = await supabase
    .from("quote_lines")
    .insert(input.lines.map((l, i) => ({ org_id: input.orgId, quote_id: quoteId, ...lineColumns(l, i + 1) })));
  if (linesError) {
    // Take the empty draft back out, so a retry does not leave a second quote
    // with nothing on it. Its number is spent; a gap in quote numbers is
    // harmless, unlike one in invoice numbers.
    await supabase.from("quotes").delete().eq("id", quoteId);
    throw new Error(linesError.message);
  }
  return quoteId;
}

/**
 * Why a quote can no longer be changed, in words, or null while it is a draft
 * or sent. The same rule `quote_lines_enforce_org` keeps in the database.
 */
export function whyQuoteIsFixed(q: Pick<QuoteRow, "status">): string | null {
  if (q.status === "draft" || q.status === "sent") return null;
  if (q.status === "converted") return "This quote is already an order. Change the order instead.";
  if (q.status === "accepted") {
    return "This quote was accepted. Reopen it on its page to change it; if it has been invoiced, void the invoices first.";
  }
  return `This quote was ${q.status}. Reopen it on its page to change it.`;
}

/**
 * Saves an edited draft or sent quote: who it is for, its details and its
 * lines, in one step (`quote_save`), so a save that fails changes nothing.
 * Its number, date and VAT rate stay as they were.
 *
 * The database checks again that the quote is still a draft or sent and
 * unchanged since the form loaded it (`loadedAt`, its `updated_at` then), so a
 * save never undoes somebody else's, and a sent quote keeps its client: the
 * link in the client's email shows the quote as it is now. Each line goes in
 * under the id the screen gave it, a saved line under its own.
 */
export async function updateQuote(
  supabase: Client,
  id: string,
  input: QuoteHeader & { loadedAt: string; lines: (NewQuoteLine & { id: string })[] }
) {
  if (input.lines.length === 0) {
    throw new Error("Add at least one line before saving the quote.");
  }
  const header = quoteHeaderProblem(input);
  if (header) throw new Error(header);
  const { error } = await supabase.rpc("quote_save", {
    p_quote: id,
    p_loaded_at: input.loadedAt,
    p_header: headerColumns(input),
    p_lines: input.lines.map((l, i) => ({ id: l.id, ...lineColumns(l, i + 1) })),
  });
  if (error) throw new Error(billingErrorMessage(error) ?? error.message);
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

/** What the quote's PDF reads from a quote: pure, so the client's page builds the same one from its own data. */
export type QuotePdfInput = {
  quote: Pick<
    QuoteRow,
    "quote_number" | "created_at" | "valid_until" | "customer_name" | "customer_address" | "delivery_address" | "contact_email" | "vat_rate" | "prices_include_vat" | "notes"
  >;
  storeName: string | null;
  storeAddress: string | null;
  lines: { label: string; brand: string | null; sku?: string | null; unit: string | null; qty: number; unit_price: number | null }[];
};

export function quotePdfSpec(detail: QuotePdfInput, seller: QuoteSeller, paper: Paper): PdfSpec {
  const q = detail.quote;
  const totals = quoteTotals(detail);
  const fmt = paperMoney(paper);
  const meta: [string, string][] = [
    ["Quote no.", q.quote_number],
    ["Quote date", paperDate(q.created_at)],
  ];
  if (q.valid_until) meta.push(["Valid until", paperDate(q.valid_until)]);
  const address = q.customer_address ?? q.delivery_address ?? detail.storeAddress;
  // Where the goods go, beside who pays, when the quote names both and they differ.
  const deliverTo = q.customer_address && q.delivery_address && q.delivery_address.trim() !== q.customer_address.trim() ? q.delivery_address : null;
  return {
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
    metaTitle: "Quote details",
    meta,
    billTo: { label: "Quote for", name: quoteClientName(q, detail.storeName), address, email: q.contact_email },
    shipTo: deliverTo ? { label: "Deliver to", address: deliverTo } : null,
    ...paperLines(
      detail.lines.map((l) => ({
        code: l.sku,
        description: l.brand ? `${l.label} — ${l.brand}` : l.label,
        qty: l.unit ? `${formatQty(Number(l.qty))} ${l.unit}` : formatQty(Number(l.qty)),
        rate: fmt(Number(l.unit_price ?? 0)),
        amount: fmt(lineTotal(Number(l.qty), Number(l.unit_price ?? 0))),
      })),
      Number(q.vat_rate) > 0
    ),
    totals: [...vatRows(Number(q.vat_rate), q.prices_include_vat, totals.subtotal, totals.vat, fmt), ["Total", fmt(totals.total)]],
    notes: q.notes ? [q.notes] : [],
    payTo: seller.bank_details,
  };
}

export async function downloadQuotePdf(detail: QuoteDetail, seller: QuoteSeller) {
  const { loadPaper } = await import("@/lib/document-look");
  await drawMoneyPdf(quotePdfSpec(detail, seller, await loadPaper()));
}
