import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { drawMoneyPdf, money } from "@/lib/money-pdf";
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
 * Every row of a set-returning RPC, a page at a time: the API returns at most
 * 1,000 rows a response, and a receivables report that silently stops at
 * 1,000 clients or lines is wrong rather than short. Both functions order
 * their rows, so pages follow one another.
 */
const PAGE = 1000;
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    fail(error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function fetchAgeing(supabase: Client, asOf: string): Promise<AgeingRow[]> {
  const data = await allRows<AgeingRow>((from, to) =>
    supabase.rpc("debtors_ageing", { p_as_of: asOf }).range(from, to)
  );
  return data.map((r) => ({
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
  const data = await allRows<StatementRow>((first, last) =>
    supabase
      .rpc("client_statement", {
        p_store_id: client.storeId,
        p_customer_name: client.storeId ? null : client.name,
        p_from: from,
        p_to: to,
      })
      .range(first, last)
  );
  return data.map((r) => ({
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

export async function downloadStatementPdf(
  seller: StatementSeller,
  client: StatementClient & { address?: string | null },
  from: string,
  to: string,
  rows: StatementRow[]
) {
  const closing = rows.length ? rows[rows.length - 1].balance : 0;
  await drawMoneyPdf({
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
    meta: [
      ["Date", to],
      ["From", from],
      ["To", to],
    ],
    billTo: { label: "STATEMENT FOR", name: client.name, address: client.address ?? null },
    head: ["Date", "Type", "Number", "Detail", "Debit", "Credit", "Balance"],
    numeric: [4, 5, 6],
    rows: rows.map((r) => [
      r.entry_date,
      STATEMENT_KIND_LABELS[r.entry_kind] ?? r.entry_kind,
      r.document_number ?? "",
      statementDetail(r),
      r.debit === null ? "" : money(r.debit),
      r.credit === null ? "" : money(r.credit),
      money(r.balance),
    ]),
    totals: [["Balance due", money(closing)]],
    payTo: seller.bank_details,
  });
}
