import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { drawMoneyPdf, money } from "@/lib/money-pdf";
import { formatQty } from "@/lib/money-docs";
import { periodLabel } from "@/lib/contract-periods";

/**
 * Invoices, credit notes and payments.
 *
 * Every write is one RPC: the database numbers the invoice, copies what it is
 * for onto it (an order, an accepted quote, completed jobs, or lines typed in),
 * refuses an order already invoiced in QuickBooks or a job already invoiced,
 * and keeps the credit and payment arithmetic. This module reads, calls, and
 * draws PDFs from what was frozen onto the invoice — never from the live
 * order, quote or place.
 */

type Client = SupabaseClient<Database>;

export type Invoice = Database["public"]["Tables"]["tax_invoices"]["Row"];
export type InvoiceLine = Database["public"]["Tables"]["tax_invoice_lines"]["Row"];
export type CreditNote = Database["public"]["Tables"]["credit_notes"]["Row"];
export type CreditNoteLine = Database["public"]["Tables"]["credit_note_lines"]["Row"];
export type Payment = Database["public"]["Tables"]["invoice_payments"]["Row"];
export type Balance = Database["public"]["Views"]["tax_invoice_balances"]["Row"];

export const PAYMENT_METHODS: Record<string, string> = {
  eft: "EFT",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export { money };

/** Where an invoice came from (`tax_invoices.source`). */
export const INVOICE_SOURCE_LABELS: Record<string, string> = {
  order: "Order",
  quote: "Quote",
  jobs: "Completed work",
  direct: "Direct",
  contract: "Contract",
};

/** A quote's invoices: in full, a deposit, or the final balance (`tax_invoices.kind`). */
export const INVOICE_KIND_LABELS: Record<string, string> = {
  standard: "",
  deposit: "Deposit",
  final: "Final",
};

/** A line as the invoice RPCs take it. */
export type NewInvoiceLine = {
  description: string;
  qty: number;
  unitPrice: number;
  unit?: string | null;
  serviceItemId?: string | null;
};

const linesJson = (lines: NewInvoiceLine[]) =>
  lines.map((l) => ({
    description: l.description,
    qty: l.qty,
    unit_price: l.unitPrice,
    unit: l.unit || null,
    service_item_id: l.serviceItemId || null,
  })) as unknown as Json;

/** Unpaid / part-paid / paid / credited, from the balance rather than stored. */
export function paymentStatus(inv: Pick<Invoice, "status" | "total">, bal: Balance | undefined) {
  if (inv.status === "void") return "void";
  if (!bal) return "unpaid";
  if (Number(bal.outstanding) <= 0) return Number(bal.paid) > 0 ? "paid" : "credited";
  if (Number(bal.paid) > 0 || Number(bal.credited) > 0) return "part_paid";
  return "unpaid";
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  part_paid: "Part paid",
  paid: "Paid",
  credited: "Fully credited",
  void: "Void",
};

export type InvoiceListRow = Invoice & { balance: Balance | undefined };

export async function fetchInvoices(
  supabase: Client,
  range: { from: string; to: string }
): Promise<InvoiceListRow[]> {
  const { data, error } = await supabase
    .from("tax_invoices")
    .select("*")
    .gte("issue_date", range.from)
    .lte("issue_date", range.to)
    .order("issue_date", { ascending: false })
    .order("invoice_number", { ascending: false })
    .limit(2000);
  fail(error);
  const invoices = (data ?? []) as Invoice[];
  const balances = await fetchBalances(supabase, invoices.map((i) => i.id));
  return invoices.map((i) => ({ ...i, balance: balances.get(i.id) }));
}

async function fetchBalances(supabase: Client, ids: string[]) {
  const map = new Map<string, Balance>();
  // Chunked: an `in` filter is a URL, and a few hundred uuids is a long one.
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("tax_invoice_balances")
      .select("*")
      .in("invoice_id", ids.slice(i, i + 200));
    fail(error);
    for (const b of (data ?? []) as Balance[]) map.set(b.invoice_id, b);
  }
  return map;
}

export type InvoiceDetail = {
  invoice: Invoice;
  lines: InvoiceLine[];
  credits: (CreditNote & { lines: CreditNoteLine[] })[];
  payments: Payment[];
  balance: Balance | undefined;
  /** The completed jobs it covers (an invoice from completed work). */
  visits: { id: string; checkin_at: string | null; checkout_at: string | null; staff_name: string | null }[];
  /** The contract it was issued for (a contract invoice). */
  contract: { id: string; name: string } | null;
};

export async function fetchInvoice(supabase: Client, id: string): Promise<InvoiceDetail> {
  const [inv, lines, credits, payments, balances, links, contract] = await Promise.all([
    supabase.from("tax_invoices").select("*").eq("id", id).single(),
    supabase.from("tax_invoice_lines").select("*").eq("invoice_id", id).order("position"),
    supabase
      .from("credit_notes")
      .select("*, credit_note_lines(*)")
      .eq("invoice_id", id)
      .order("created_at"),
    supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("paid_on"),
    fetchBalances(supabase, [id]),
    supabase
      .from("tax_invoice_visits")
      .select("visit_id, visits(checkin_at, checkout_at, profiles(full_name))")
      .eq("invoice_id", id),
    supabase
      .from("service_contract_invoices")
      .select("contract_id, service_contracts(name)")
      .eq("invoice_id", id)
      .maybeSingle(),
  ]);
  fail(links.error);
  fail(contract.error);
  const contractRow = contract.data as unknown as { contract_id: string; service_contracts: { name: string } | null } | null;
  fail(inv.error);
  fail(lines.error);
  fail(credits.error);
  fail(payments.error);
  return {
    invoice: inv.data as Invoice,
    lines: (lines.data ?? []) as InvoiceLine[],
    credits: ((credits.data ?? []) as unknown as (CreditNote & { credit_note_lines: CreditNoteLine[] })[]).map(
      ({ credit_note_lines, ...c }) => ({ ...c, lines: credit_note_lines ?? [] })
    ),
    payments: (payments.data ?? []) as Payment[],
    balance: balances.get(id),
    visits: ((links.data ?? []) as unknown as {
      visit_id: string;
      visits: { checkin_at: string | null; checkout_at: string | null; profiles: { full_name: string } | null } | null;
    }[])
      .map((l) => ({
        id: l.visit_id,
        checkin_at: l.visits?.checkin_at ?? null,
        checkout_at: l.visits?.checkout_at ?? null,
        staff_name: l.visits?.profiles?.full_name ?? null,
      }))
      .sort((a, b) => (a.checkin_at ?? "").localeCompare(b.checkin_at ?? "")),
    contract: contractRow
      ? { id: contractRow.contract_id, name: contractRow.service_contracts?.name ?? "Contract" }
      : null,
  };
}

/** The live (not void) invoice for an order, if there is one. */
export async function fetchInvoiceForOrder(supabase: Client, orderId: string) {
  const { data, error } = await supabase
    .from("tax_invoices")
    .select("id, invoice_number")
    .eq("order_id", orderId)
    .eq("status", "issued")
    .maybeSingle();
  fail(error);
  return data as { id: string; invoice_number: string } | null;
}

export async function issueInvoice(supabase: Client, orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc("tax_invoice_issue", { p_order_id: orderId });
  fail(error);
  return data as string;
}

/**
 * An invoice typed in: for a place on the books (`storeId`) or anyone else
 * (`name`, with an address and email if known).
 */
export async function issueDirectInvoice(
  supabase: Client,
  input: {
    billTo: { storeId: string } | { name: string; address?: string; email?: string };
    lines: NewInvoiceLine[];
    issueDate?: string | null;
    reference?: string | null;
  }
): Promise<string> {
  const billTo =
    "storeId" in input.billTo
      ? { store_id: input.billTo.storeId }
      : { name: input.billTo.name, address: input.billTo.address || null, email: input.billTo.email || null };
  const { data, error } = await supabase.rpc("invoice_direct", {
    p_bill_to: billTo as unknown as Json,
    p_lines: linesJson(input.lines),
    p_issue_date: input.issueDate || undefined,
    p_reference: input.reference || undefined,
  });
  fail(error);
  return data as string;
}

/** An invoice for completed jobs at one place; none of them can be invoiced twice. */
export async function issueInvoiceForVisits(
  supabase: Client,
  input: { visitIds: string[]; lines: NewInvoiceLine[]; issueDate?: string | null; reference?: string | null }
): Promise<string> {
  const { data, error } = await supabase.rpc("invoice_from_visits", {
    p_visit_ids: input.visitIds,
    p_lines: linesJson(input.lines),
    p_issue_date: input.issueDate || undefined,
    p_reference: input.reference || undefined,
  });
  fail(error);
  return data as string;
}

export type ProofRow = Database["public"]["Functions"]["invoice_proof_of_service"]["Returns"][number];

/**
 * The jobs behind a job or contract invoice: each finished one (when, who, how
 * long, GPS inside the site's radius, forms, photos) and, for a contract, the
 * planned ones in its period that were missed or caught up later.
 */
export async function fetchProofOfService(supabase: Client, invoiceId: string): Promise<ProofRow[]> {
  const { data, error } = await supabase.rpc("invoice_proof_of_service", { p_invoice_id: invoiceId });
  fail(error);
  return (data ?? []) as ProofRow[];
}

/** "1 Oct – 31 Oct 2026"-style period of an invoice, when it has one. */
export function invoicePeriod(inv: Pick<Invoice, "period_start" | "period_end">): string | null {
  return inv.period_start && inv.period_end ? periodLabel(inv.period_start, inv.period_end) : null;
}

export async function voidInvoice(supabase: Client, id: string, reason: string) {
  const { error } = await supabase.rpc("tax_invoice_void", { p_id: id, p_reason: reason });
  fail(error);
}

export async function issueCreditNote(
  supabase: Client,
  invoiceId: string,
  reason: string,
  lines: { invoiceLineId: string; qty: number }[]
): Promise<string> {
  const { data, error } = await supabase.rpc("credit_note_issue", {
    p_invoice_id: invoiceId,
    p_reason: reason,
    p_lines: lines.map((l) => ({ invoice_line_id: l.invoiceLineId, qty: l.qty })) as unknown as Json,
  });
  fail(error);
  return data as string;
}

export async function recordPayment(
  supabase: Client,
  input: { invoiceId: string; amount: number; paidOn: string; method: string; reference: string }
) {
  const { error } = await supabase.rpc("invoice_payment_record", {
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
  });
  fail(error);
}

export async function deletePayment(supabase: Client, paymentId: string) {
  const { error } = await supabase.rpc("invoice_payment_delete", { p_payment_id: paymentId });
  fail(error);
}

// ------------------------------------------------------------------ PDFs

function sellerOf(inv: Invoice) {
  return {
    name: inv.seller_name,
    address: inv.seller_address,
    registrationNumber: inv.seller_registration_number,
    taxNumber: inv.seller_tax_number,
    vatNumber: inv.seller_vat_number,
    phone: inv.seller_phone,
    email: inv.seller_email,
    // The logo copied onto the invoice at issue, not the company's current one:
    // a reissued letterhead must not change an invoice already sent.
    logoPath: inv.seller_logo_path,
  };
}

/** "Tax invoice" when VAT is charged; a company that is not VAT registered issues an invoice. */
export function invoiceHeading(inv: Pick<Invoice, "vat_rate">) {
  return Number(inv.vat_rate) > 0 ? "TAX INVOICE" : "INVOICE";
}

function totalsOf(inv: Invoice, subtotal: number, vat: number, total: number, credit = false): [string, string][] {
  const rate = Number(inv.vat_rate);
  if (rate === 0) return [[credit ? "Total credited" : "Total", money(total)]];
  return [
    ["Subtotal (excl. VAT)", money(subtotal)],
    [inv.prices_include_vat ? `VAT ${rate}% (included)` : `VAT ${rate}%`, money(vat)],
    [credit ? "Total credited" : "Total", money(total)],
  ];
}

const qtyCell = (qty: number, unit: string | null | undefined) => (unit ? `${formatQty(qty)} ${unit}` : formatQty(qty));

export async function downloadInvoicePdf(detail: InvoiceDetail) {
  const inv = detail.invoice;
  const meta: [string, string][] = [
    ["Invoice no", inv.invoice_number],
    ["Date", inv.issue_date],
    ["Due", inv.due_date],
  ];
  const period = invoicePeriod(inv);
  if (period) meta.push(["Period", period]);
  if (inv.order_number) meta.push(["Order", inv.order_number]);
  else if (inv.source === "quote" && inv.reference) meta.push(["Quote", inv.reference]);
  else if (inv.reference) meta.push(["Reference", inv.reference]);
  const notes: string[] = [];
  if (inv.status === "void") notes.push(`VOID — ${inv.void_reason}`);
  if (detail.visits.length > 0) {
    notes.push(
      `For the work done on ${detail.visits
        .map((v) => (v.checkin_at ? v.checkin_at.slice(0, 10) : "—"))
        .join(", ")}.`
    );
  }
  await drawMoneyPdf({
    heading: invoiceHeading(inv),
    fileName: inv.invoice_number,
    seller: sellerOf(inv),
    meta,
    billTo: { name: inv.customer_name, address: inv.customer_address, email: inv.customer_email },
    head: ["Description", "Code", "Qty", "Unit price", "Amount"],
    numeric: [2, 3, 4],
    rows: detail.lines.map((l) => [
      l.description,
      l.sku ?? "",
      qtyCell(Number(l.qty), l.unit),
      money(Number(l.unit_price)),
      money(Number(l.line_total)),
    ]),
    totals: totalsOf(inv, Number(inv.subtotal), Number(inv.vat), Number(inv.total)),
    notes,
    payTo: inv.bank_details,
    footer: inv.footer,
  });
}

export async function downloadCreditNotePdf(
  detail: InvoiceDetail,
  credit: CreditNote & { lines: CreditNoteLine[] }
) {
  const byId = new Map(detail.lines.map((l) => [l.id, l]));
  const inv = detail.invoice;
  await drawMoneyPdf({
    heading: "CREDIT NOTE",
    fileName: credit.credit_number,
    seller: sellerOf(inv),
    meta: [
      ["Credit note no", credit.credit_number],
      ["Date", credit.issue_date],
      ["Against invoice", inv.invoice_number],
    ],
    billTo: { name: inv.customer_name, address: inv.customer_address, email: inv.customer_email },
    head: ["Description", "Code", "Qty", "Unit price", "Amount"],
    numeric: [2, 3, 4],
    rows: credit.lines.map((l) => {
      const line = byId.get(l.invoice_line_id);
      return [
        line?.description ?? "",
        line?.sku ?? "",
        qtyCell(Number(l.qty), line?.unit),
        money(Number(l.unit_price)),
        money(Number(l.line_total)),
      ];
    }),
    totals: totalsOf(inv, Number(credit.subtotal), Number(credit.vat), Number(credit.total), true),
    notes: [`Reason: ${credit.reason}`],
    footer: inv.footer,
  });
}

const PROOF_STATUS: Record<string, string> = { done: "Done", caught_up: "Caught up later", missed: "Missed" };

/**
 * The proof of service as its own PDF, to send with the invoice: the client
 * sees what was done for what they are asked to pay.
 */
export async function downloadProofOfServicePdf(
  detail: InvoiceDetail,
  rows: ProofRow[],
  words: { job: string; jobs: string; staff: string }
) {
  const inv = detail.invoice;
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  const done = rows.filter((r) => r.status === "done");
  const minutes = done.reduce((n, r) => n + (r.minutes ?? 0), 0);
  const meta: [string, string][] = [["Invoice no", inv.invoice_number]];
  const period = invoicePeriod(inv);
  if (period) meta.push(["Period", period]);
  await drawMoneyPdf({
    heading: "PROOF OF SERVICE",
    fileName: `${inv.invoice_number} proof of service`,
    seller: sellerOf(inv),
    meta,
    billTo: { label: "FOR", name: inv.customer_name, address: inv.customer_address },
    head: ["Date", words.staff, "In", "Out", "Minutes", "GPS", "Forms", "Photos", ""],
    numeric: [4, 6, 7],
    rows: rows.map((r) => [
      r.day,
      r.staff_name ?? "",
      time(r.checkin_at),
      time(r.checkout_at),
      r.minutes === null ? "" : String(r.minutes),
      r.gps_ok === null ? "" : r.gps_ok ? "On site" : "Away",
      r.forms === null ? "" : String(r.forms),
      r.photos === null ? "" : String(r.photos),
      PROOF_STATUS[r.status] ?? r.status,
    ]),
    totals: [
      [`${words.jobs} done`, String(done.length)],
      ["Hours on site", (Math.round(minutes / 6) / 10).toLocaleString("en-GB")],
    ],
    notes: [
      `"On site" means the check-in was within the place's radius. "Caught up later" is a planned ${words.job} done on a later day.`,
    ],
  });
}
