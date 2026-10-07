import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Tax invoices, credit notes and payments.
 *
 * Every write is one RPC: the database copies the order onto the invoice,
 * numbers it, refuses an order already invoiced in QuickBooks, and keeps the
 * credit and payment arithmetic. This module reads, calls, and draws PDFs from
 * what was frozen onto the invoice — never from the live order or store.
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

export const money = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
};

export async function fetchInvoice(supabase: Client, id: string): Promise<InvoiceDetail> {
  const [inv, lines, credits, payments, balances] = await Promise.all([
    supabase.from("tax_invoices").select("*").eq("id", id).single(),
    supabase.from("tax_invoice_lines").select("*").eq("invoice_id", id).order("position"),
    supabase
      .from("credit_notes")
      .select("*, credit_note_lines(*)")
      .eq("invoice_id", id)
      .order("created_at"),
    supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("paid_on"),
    fetchBalances(supabase, [id]),
  ]);
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

type PdfDoc = {
  heading: "TAX INVOICE" | "CREDIT NOTE";
  number: string;
  meta: [string, string][];
  invoice: Invoice;
  rows: { description: string; sku: string | null; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  vat: number;
  total: number;
  note?: string;
};

async function drawPdf(d: PdfDoc) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const inv = d.invoice;
  const left = 40;
  const right = width - 40;

  // Seller, top left — as it stood on the day of issue.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(inv.seller_name, left, 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const seller = [
    ...(inv.seller_address ? doc.splitTextToSize(inv.seller_address, 240) : []),
    inv.seller_tax_number && `TIN: ${inv.seller_tax_number}`,
    inv.seller_vat_number && `VAT no: ${inv.seller_vat_number}`,
    inv.seller_phone,
    inv.seller_email,
  ].filter(Boolean) as string[];
  seller.forEach((line, i) => doc.text(line, left, 68 + i * 12));

  // Document heading and its numbers, top right.
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(d.heading, right, 52, { align: "right" });
  doc.setFontSize(9);
  d.meta.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    doc.text(k, right - 110, 70 + i * 13);
    doc.setTextColor(20);
    doc.text(v, right, 70 + i * 13, { align: "right" });
  });

  // Customer.
  let y = Math.max(68 + seller.length * 12, 70 + d.meta.length * 13) + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text("BILL TO", left, y);
  doc.setTextColor(20);
  doc.setFontSize(10);
  doc.text(inv.customer_name, left, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const addr = inv.customer_address ? doc.splitTextToSize(inv.customer_address, 260) : [];
  addr.forEach((line: string, i: number) => doc.text(line, left, y + 27 + i * 12));
  y += 27 + addr.length * 12 + 12;

  autoTable(doc, {
    startY: y,
    head: [["Description", "Code", "Qty", "Unit price", "Amount"]],
    body: d.rows.map((r) => [r.description, r.sku ?? "", String(r.qty), money(r.unitPrice), money(r.total)]),
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
    margin: { left, right: 40 },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  const totals: [string, string][] = [
    ["Subtotal (excl. VAT)", money(d.subtotal)],
    [`VAT ${Number(inv.vat_rate)}%`, money(d.vat)],
    [d.heading === "CREDIT NOTE" ? "Total credited" : "Total", money(d.total)],
  ];
  totals.forEach(([k, v], i) => {
    const last = i === totals.length - 1;
    doc.setFont("helvetica", last ? "bold" : "normal");
    doc.setFontSize(last ? 11 : 9);
    doc.text(k, right - 130, finalY + i * 15);
    doc.text(v, right, finalY + i * 15, { align: "right" });
  });

  let fy = finalY + totals.length * 15 + 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60);
  if (d.note) {
    for (const line of doc.splitTextToSize(d.note, right - left)) {
      doc.text(line, left, fy);
      fy += 12;
    }
    fy += 6;
  }
  if (inv.footer) {
    for (const line of doc.splitTextToSize(inv.footer, right - left)) {
      doc.text(line, left, fy);
      fy += 12;
    }
  }
  doc.save(`${d.number}.pdf`);
}

export async function downloadInvoicePdf(detail: InvoiceDetail) {
  const inv = detail.invoice;
  await drawPdf({
    heading: "TAX INVOICE",
    number: inv.invoice_number,
    invoice: inv,
    meta: [
      ["Invoice no", inv.invoice_number],
      ["Date", inv.issue_date],
      ["Due", inv.due_date],
      ["Order", inv.order_number],
    ],
    rows: detail.lines.map((l) => ({
      description: l.description,
      sku: l.sku,
      qty: l.qty,
      unitPrice: Number(l.unit_price),
      total: Number(l.line_total),
    })),
    subtotal: Number(inv.subtotal),
    vat: Number(inv.vat),
    total: Number(inv.total),
    note: inv.status === "void" ? `VOID — ${inv.void_reason}` : undefined,
  });
}

export async function downloadCreditNotePdf(
  detail: InvoiceDetail,
  credit: CreditNote & { lines: CreditNoteLine[] }
) {
  const byId = new Map(detail.lines.map((l) => [l.id, l]));
  await drawPdf({
    heading: "CREDIT NOTE",
    number: credit.credit_number,
    invoice: detail.invoice,
    meta: [
      ["Credit note no", credit.credit_number],
      ["Date", credit.issue_date],
      ["Against invoice", detail.invoice.invoice_number],
    ],
    rows: credit.lines.map((l) => ({
      description: byId.get(l.invoice_line_id)?.description ?? "",
      sku: byId.get(l.invoice_line_id)?.sku ?? null,
      qty: l.qty,
      unitPrice: Number(l.unit_price),
      total: Number(l.line_total),
    })),
    subtotal: Number(credit.subtotal),
    vat: Number(credit.vat),
    total: Number(credit.total),
    note: `Reason: ${credit.reason}`,
  });
}
