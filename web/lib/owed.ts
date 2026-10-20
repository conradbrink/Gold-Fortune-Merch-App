import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { drawMoneyPdf, paperDate, paperMoney, statementStatus, type Paper, type PdfSpec } from "@/lib/money-pdf";
import { AGEING_COLUMNS } from "@/lib/money-docs";
import type { ExportSheet } from "@/lib/export";

/**
 * Who owes the company what (`debtors_ageing`) and one client's account over a
 * period (`client_statement`). Both are worked out by the database as at a
 * date, so an earlier date shows the book as it stood then.
 */

type Client = SupabaseClient<Database>;

export type AgeingRow = Database["public"]["Functions"]["debtors_ageing"]["Returns"][number];
export type StatementRow = Database["public"]["Functions"]["client_statement"]["Returns"][number];

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * Each report is one document read in one statement (`debtors_ageing_json`,
 * `client_statement_json`): one snapshot, so a payment recorded meanwhile
 * cannot move a row, and no 1,000-row page limit applies.
 */
export async function fetchAgeing(supabase: Client, asOf: string): Promise<AgeingRow[]> {
  const { data, error } = await supabase.rpc("debtors_ageing_json", { p_as_of: asOf });
  fail(error);
  return ((data ?? []) as unknown as AgeingRow[]).map((r) => ({
    ...r,
    not_due: num(r.not_due),
    days_1_30: num(r.days_1_30),
    days_31_60: num(r.days_31_60),
    days_61_90: num(r.days_61_90),
    days_over_90: num(r.days_over_90),
    total: num(r.total),
  }));
}

/** The column totals of the ageing table. */
export function ageingTotals(rows: AgeingRow[]) {
  const out = { not_due: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 0 };
  for (const r of rows) {
    for (const c of AGEING_COLUMNS) out[c.key] += r[c.key];
    out.total += r.total;
  }
  return out;
}

/** One client's statement: by place on the books, or by the name on the invoices. */
export type StatementClient = { storeId: string | null; name: string };

export async function fetchStatement(
  supabase: Client,
  client: StatementClient,
  from: string,
  to: string
): Promise<StatementRow[]> {
  const { data, error } = await supabase.rpc("client_statement_json", {
    p_store_id: client.storeId,
    p_customer_name: client.storeId ? null : client.name,
    p_from: from,
    p_to: to,
  });
  fail(error);
  return ((data ?? []) as unknown as StatementRow[]).map((r) => ({
    ...r,
    debit: r.debit === null ? null : num(r.debit),
    credit: r.credit === null ? null : num(r.credit),
    balance: num(r.balance),
  }));
}

export const STATEMENT_KIND_LABELS: Record<string, string> = {
  opening: "Balance brought forward",
  invoice: "Invoice",
  credit_note: "Credit note",
  payment: "Payment",
};

const PAYMENT_METHOD_WORDS: Record<string, string> = {
  eft: "EFT",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

/** A statement row's detail as people read it: "EFT · REF123" rather than "eft · REF123". */
export function statementDetail(r: StatementRow): string {
  if (!r.detail) return "";
  if (r.entry_kind !== "payment") return r.detail;
  const [method, ...rest] = r.detail.split(" · ");
  return [PAYMENT_METHOD_WORDS[method] ?? method, ...rest].join(" · ");
}

export function statementSheet(
  client: StatementClient,
  from: string,
  to: string,
  rows: StatementRow[]
): ExportSheet {
  return {
    title: `Statement — ${client.name}`,
    filename: `statement-${client.name}`,
    context: [`${from} to ${to}`],
    columns: [
      { header: "Date", key: "date" },
      { header: "Type", key: "kind" },
      { header: "Number", key: "number" },
      { header: "Detail", key: "detail" },
      { header: "Debit", key: "debit", numeric: true },
      { header: "Credit", key: "credit", numeric: true },
      { header: "Balance", key: "balance", numeric: true },
    ],
    rows: rows.map((r) => ({
      date: r.entry_date,
      kind: STATEMENT_KIND_LABELS[r.entry_kind] ?? r.entry_kind,
      number: r.document_number ?? "",
      detail: statementDetail(r),
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
    })),
  };
}

export type StatementSeller = {
  name: string;
  legal_name: string | null;
  address: string | null;
  tax_number: string | null;
  vat_number: string | null;
  registration_number: string | null;
  phone: string | null;
  support_email: string | null;
  logo_path: string | null;
  bank_details: string | null;
};

/** The company's own details and logo, for the head of the statement. */
export async function fetchStatementSeller(supabase: Client): Promise<StatementSeller> {
  const { data, error } = await supabase
    .from("organizations")
    .select("name, legal_name, address, tax_number, vat_number, registration_number, phone, support_email, logo_path, bank_details")
    .limit(1)
    .single();
  fail(error);
  return data as StatementSeller;
}

/** What is owed by how late, as the statement's strip shows it (`debtors_ageing_json`, or the client's page). */
export type StatementAgeing = Partial<Record<(typeof AGEING_COLUMNS)[number]["key"], number>>;

/** "Invoice INV-0042", "Payment for INV-0042": what a statement row was, by the document it moved. */
export function statementActivity(r: Pick<StatementRow, "entry_kind" | "document_number">): string {
  const kind = STATEMENT_KIND_LABELS[r.entry_kind] ?? r.entry_kind;
  if (!r.document_number) return kind;
  return r.entry_kind === "payment" ? `${kind} for ${r.document_number}` : `${kind} ${r.document_number}`;
}

/**
 * The statement as the PDF drawer takes it: the account's activity in the
 * period from the balance brought forward, what is owed by how late (when the
 * ageing is known), the balance due, and whether any of it is overdue.
 */
export function statementPdfSpec(
  seller: StatementSeller,
  client: StatementClient & { address?: string | null },
  from: string,
  to: string,
  rows: StatementRow[],
  paper: Paper,
  ageing: StatementAgeing | null = null
): PdfSpec {
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;
  const fmt = paperMoney(paper);
  const amount = (n: number | null) => (n !== null && Number(n) !== 0 ? fmt(Number(n)) : "");
  const overdue = ageing
    ? AGEING_COLUMNS.filter((c) => c.key !== "not_due").reduce((n, c) => n + Number(ageing[c.key] ?? 0), 0)
    : null;
  return {
    heading: "STATEMENT",
    fileName: `Statement ${client.name} ${to}`,
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
    metaTitle: "Statement details",
    meta: [
      ["Statement date", paperDate(to)],
      ["Period", `${paperDate(from)} to ${paperDate(to)}`],
      ["Amount due", fmt(Math.max(0, closing))],
    ],
    billTo: { label: "Statement for", name: client.name, address: client.address ?? null },
    head: ["Date", "Activity", "Charged", "Paid or credited", "Balance"],
    numeric: [2, 3, 4],
    rows: rows.map((r) => {
      const detail = statementDetail(r);
      return [
        paperDate(r.entry_date),
        detail ? `${statementActivity(r)}\n${detail}` : statementActivity(r),
        amount(r.debit),
        amount(r.credit),
        fmt(Number(r.balance)),
      ];
    }),
    ageing: ageing
      ? AGEING_COLUMNS.map((c) => [c.key === "not_due" ? c.label : `${c.label} overdue`, fmt(Number(ageing[c.key] ?? 0))])
      : null,
    totals: [["Balance due", fmt(closing)]],
    status: statementStatus(closing, overdue, fmt),
    payTo: seller.bank_details,
  };
}

export async function downloadStatementPdf(
  seller: StatementSeller,
  client: StatementClient & { address?: string | null },
  from: string,
  to: string,
  rows: StatementRow[],
  ageing: StatementAgeing | null = null
) {
  const { loadPaper } = await import("@/lib/document-look");
  await drawMoneyPdf(statementPdfSpec(seller, client, from, to, rows, await loadPaper(), ageing));
}
