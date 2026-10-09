import type { CreditNote, Invoice, InvoiceLine, Payment } from "@/lib/invoices";
import type { StatementRow } from "@/lib/owed";
import type { QuoteRow } from "@/lib/quotes";
import { currencySymbol } from "@/lib/money";
import { DEFAULT_DOCUMENT_STYLE, isDocumentStyle, type PdfLook } from "@/lib/document-style";
import { parseBranding } from "@/lib/branding";

/**
 * What the client's page shows (Stage 8.10): an invoice, a quote or a
 * statement, from what `document_link_view()` returns, and the plain words
 * that go with it: amounts in the company's currency, dates in its days, and
 * what the banner at the top of an invoice or quote says. Pure, so the page,
 * the PDF and the emails say the same thing and the tests can pin it.
 */

export type DocCompany = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  vat_number: string | null;
  tax_number: string | null;
  registration_number: string | null;
  logo_path: string | null;
  bank_details: string | null;
};

type Common = {
  link_id: string;
  company: DocCompany;
  look: { style: string | null; primary: string | null; accent: string | null; currency: string | null };
  timezone: string;
};

export type InvoiceView = Common & {
  kind: "invoice";
  invoice: Invoice;
  lines: InvoiceLine[];
  credit_notes: CreditNote[];
  payments: Payment[];
  paid: number;
  credited: number;
  outstanding: number;
};

export type QuoteViewLine = {
  position: number | null;
  description: string;
  sku: string | null;
  unit: string | null;
  qty: number;
  list_price: number;
  discount_pct: number;
  discount_amount: number;
  unit_price: number;
};

export type QuoteView = Common & {
  kind: "quote";
  quote: QuoteRow;
  customer_name: string | null;
  customer_address: string | null;
  lines: QuoteViewLine[];
  subtotal: number;
  vat: number;
  total: number;
};

export type Ageing = { not_due: number; days_1_30: number; days_31_60: number; days_61_90: number; days_over_90: number; total: number };

export type StatementView = Common & {
  kind: "statement";
  statement: {
    client_name: string;
    client_address: string | null;
    from: string;
    to: string;
    rows: StatementRow[];
    ageing: Ageing;
  };
};

export type DocumentView = InvoiceView | QuoteView | StatementView;

/** The look the page and the PDF draw in: anything unknown is the classic style in the product's colours. */
export function documentLook(look: Common["look"] | null | undefined): PdfLook {
  const brand = parseBranding({ primary: look?.primary, accent: look?.accent });
  return {
    style: isDocumentStyle(look?.style) ? look.style : DEFAULT_DOCUMENT_STYLE,
    primary: brand.primary,
    accent: brand.accent,
  };
}

/**
 * An amount the way the company writes it: `R1,200.00`, `P1,200.00`. A
 * currency the server cannot name is written after the number, `1,200.00 XYZ`,
 * rather than guessed at; one that is not a currency code at all leaves the
 * number alone.
 */
export function amountText(n: unknown, currency: unknown): string {
  const value = Number(n);
  const number = Math.abs(Number.isFinite(value) ? value : 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = Number.isFinite(value) && value < 0 && Math.round(Math.abs(value) * 100) > 0 ? "-" : "";
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) return `${sign}${number}`;
  const symbol = currencySymbol(code);
  return symbol === code ? `${sign}${number} ${code}` : `${sign}${symbol}${number}`;
}

/** An amount formatter for one currency. */
export function moneyIn(currency: unknown): (n: unknown) => string {
  return (n) => amountText(n, currency);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8 Nov", or "8 Nov 2026" with `year`. A date that is not one is returned as it came. */
export function dayText(day: string | null | undefined, year = true): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  if (!m || +m[2] < 1 || +m[2] > 12) return day ?? "";
  return `${+m[3]} ${MONTHS[+m[2] - 1]}${year ? ` ${m[1]}` : ""}`;
}

/** Whole days from `a` to `b` (both "YYYY-MM-DD"); negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/** Today's date in the company's timezone, as "YYYY-MM-DD". */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const daysText = (n: number) => (n === 1 ? "1 day" : `${n} days`);

export type Banner = { tone: "paid" | "due" | "overdue" | "info" | "ended"; headline: string; note: string | null };

/**
 * What an invoice's banner says: paid, or what is still to pay and when it is
 * due. Dates show their year only when it is not this year, as people write
 * them.
 */
export function invoiceBanner(
  invoice: { outstanding: number; due_date: string },
  today: string,
  money: (n: number) => string
): Banner {
  const left = Math.round(Number(invoice.outstanding) * 100) / 100;
  if (left <= 0) {
    return { tone: "paid", headline: "Paid", note: left < 0 ? `You have a credit of ${money(-left)}.` : null };
  }
  const sameYear = invoice.due_date.slice(0, 4) === today.slice(0, 4);
  const due = dayText(invoice.due_date, !sameYear);
  const days = daysBetween(today, invoice.due_date);
  if (days < 0) {
    return { tone: "overdue", headline: `${money(left)} still to pay, was due ${due}`, note: `${daysText(-days)} overdue` };
  }
  if (days === 0) return { tone: "due", headline: `${money(left)} still to pay, due today`, note: null };
  return { tone: "due", headline: `${money(left)} still to pay, due ${due}`, note: `In ${daysText(days)}` };
}

/** What a quote's banner says: still open until a date, expired, accepted or declined. Null when there is nothing to say. */
export function quoteBanner(quote: Pick<QuoteRow, "status" | "valid_until">, today: string): Banner | null {
  if (quote.status === "accepted" || quote.status === "converted") {
    return { tone: "paid", headline: "This quote was accepted", note: null };
  }
  if (quote.status === "declined") return { tone: "ended", headline: "This quote was declined", note: null };
  if (!quote.valid_until) return null;
  const sameYear = quote.valid_until.slice(0, 4) === today.slice(0, 4);
  const until = dayText(quote.valid_until, !sameYear);
  const days = daysBetween(today, quote.valid_until);
  if (days < 0) {
    return { tone: "ended", headline: `This quote expired on ${until}`, note: "Ask the company whether the prices still hold." };
  }
  if (days === 0) return { tone: "info", headline: "Valid until today", note: null };
  return { tone: "info", headline: `Valid until ${until}`, note: `${daysText(days)} left` };
}

/** The closing balance of a statement: the last row's, or nothing. */
export function statementClosing(rows: Pick<StatementRow, "balance">[]): number {
  return rows.length ? Number(rows[rows.length - 1].balance) : 0;
}

/** The opening row of a statement is the balance brought forward; the rest are what happened. */
export function statementParts(rows: StatementRow[]) {
  const opening = rows.find((r) => r.entry_kind === "opening") ?? null;
  return { opening: opening ? Number(opening.balance) : 0, moves: rows.filter((r) => r.entry_kind !== "opening") };
}

/** A statement banner: what is owed at the end of the period. */
export function statementBanner(
  closing: number,
  to: string,
  money: (n: number) => string
): Banner {
  const at = dayText(to);
  const left = Math.round(closing * 100) / 100;
  if (left > 0) return { tone: "due", headline: `${money(left)} to pay at ${at}`, note: null };
  if (left < 0) return { tone: "paid", headline: "Nothing to pay", note: `You have a credit of ${money(-left)} at ${at}.` };
  return { tone: "paid", headline: "Nothing to pay", note: `Your account was settled at ${at}.` };
}

/** "1 Oct to 31 Oct 2026", or with both years when they differ. */
export function periodText(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayText(from, !sameYear)} to ${dayText(to)}`;
}

export const AGEING_WORDS: { key: Exclude<keyof Ageing, "total">; label: string }[] = [
  { key: "not_due", label: "Not yet due" },
  { key: "days_1_30", label: "1 to 30 days overdue" },
  { key: "days_31_60", label: "31 to 60 days overdue" },
  { key: "days_61_90", label: "61 to 90 days overdue" },
  { key: "days_over_90", label: "Over 90 days overdue" },
];

/** The ageing buckets that hold something, in order. */
export function ageingParts(a: Partial<Ageing> | null | undefined) {
  return AGEING_WORDS.map((w) => ({ ...w, amount: Number(a?.[w.key] ?? 0) })).filter((w) => w.amount > 0.004);
}

/** "1 day overdue", "31 days overdue". */
export function overdueText(days: number): string {
  return `${daysText(Math.max(0, Math.round(days)))} overdue`;
}

/** Who the document is from, as it is written at its head. An invoice keeps the details it was issued with. */
export type Seller = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  vatNumber: string | null;
  taxNumber: string | null;
  registrationNumber: string | null;
  logoPath: string | null;
  bankDetails: string | null;
};

export function sellerOf(v: DocumentView): Seller {
  const c = v.company;
  if (v.kind === "invoice") {
    const i = v.invoice;
    return {
      name: i.seller_name,
      address: i.seller_address,
      phone: i.seller_phone,
      email: i.seller_email,
      vatNumber: i.seller_vat_number,
      taxNumber: i.seller_tax_number,
      registrationNumber: i.seller_registration_number,
      // The letterhead the invoice was issued with, as on its PDF.
      logoPath: i.seller_logo_path ?? c.logo_path,
      bankDetails: i.bank_details ?? c.bank_details,
    };
  }
  return {
    name: c.name,
    address: c.address,
    phone: c.phone,
    email: c.email,
    vatNumber: c.vat_number,
    taxNumber: c.tax_number,
    registrationNumber: c.registration_number,
    logoPath: c.logo_path,
    bankDetails: c.bank_details,
  };
}
