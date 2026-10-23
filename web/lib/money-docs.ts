/**
 * The arithmetic of quotes, invoices and credit notes, exactly as the database
 * does it (`money_totals` and `round(qty * unit_price, 2)` in
 * `20261008180000_invoicing_for_every_trade.sql`), so a total previewed on a
 * screen is the total the document gets.
 *
 * In whole cents and thousandths of a percent with BigInt, because the database
 * rounds numeric half away from zero and float arithmetic does not: 1.005 is
 * 100.4999… cents to a float.
 */

/** Half away from zero, as Postgres rounds numeric. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < BigInt(0) !== d < BigInt(0);
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  const q = (an * BigInt(2) + ad) / (ad * BigInt(2));
  return neg ? -q : q;
}

const hundredths = (n: number) => BigInt(Math.round(n * 100));
const thousandths = (n: number) => BigInt(Math.round(n * 1000));
const fromCents = (c: bigint) => Number(c) / 100;

/** A line's amount to the cent: quantity and price each to two decimals. */
export function lineTotal(qty: number, unitPrice: number): number {
  return fromCents(divRound(hundredths(qty) * hundredths(unitPrice), BigInt(100)));
}

export type DocumentTotals = { subtotal: number; vat: number; total: number };

/**
 * A document's totals from its lines. With `pricesIncludeVat` the lines already
 * carry the VAT and it is the part of them at the rate (15% of R1,150 is R150);
 * otherwise it is added on top.
 */
export function documentTotals(
  lines: { qty: number; unitPrice: number }[],
  vatRate: number,
  pricesIncludeVat: boolean
): DocumentTotals {
  const sum = lines.reduce(
    (n, l) => n + divRound(hundredths(l.qty) * hundredths(l.unitPrice), BigInt(100)),
    BigInt(0)
  );
  const rate = thousandths(vatRate);
  if (pricesIncludeVat) {
    const vat = divRound(sum * rate, BigInt(100000) + rate);
    return { subtotal: fromCents(sum - vat), vat: fromCents(vat), total: fromCents(sum) };
  }
  const vat = divRound(sum * rate, BigInt(100000));
  return { subtotal: fromCents(sum), vat: fromCents(vat), total: fromCents(sum + vat) };
}

/**
 * A price with the VAT added, to the cent: what a product's VAT-exclusive price
 * is on a quote whose prices include VAT (R100.00 at 15% is R115.00).
 */
export function grossPrice(net: number, vatRate: number): number {
  return fromCents(divRound(hundredths(net) * (BigInt(100000) + thousandths(vatRate)), BigInt(100000)));
}

/** A VAT-inclusive price without its VAT, to the cent (R115.00 at 15% is R100.00). */
export function netOfVat(gross: number, vatRate: number): number {
  return fromCents(divRound(hundredths(gross) * BigInt(100000), BigInt(100000) + thousandths(vatRate)));
}

/**
 * A price moved from one VAT basis to another: a price-list price, kept in the
 * company's basis as it is now, put on a quote that keeps the basis it was
 * written with. Unchanged when the two agree.
 */
export function priceInBasis(
  price: number,
  from: { inclusive: boolean; vatRate: number },
  to: { inclusive: boolean; vatRate: number }
): number {
  if (from.inclusive === to.inclusive && (!from.inclusive || from.vatRate === to.vatRate)) return price;
  const net = from.inclusive ? netOfVat(price, from.vatRate) : price;
  return to.inclusive ? grossPrice(net, to.vatRate) : net;
}

/** A quantity as people write it: 2, 1.5, 0.25 — never 2.00. */
export function formatQty(n: number): string {
  return Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

/** Whether a typed quantity is one the database takes: above zero, to two decimals. */
export function validQty(raw: string): boolean {
  const n = Number(raw);
  // With a tolerance, as for prices: 1.13 * 100 is 112.99999999999999 in floating point.
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

/** The letters some currencies are written with: R845.50, P12, N$40, KSh500. */
const LETTER_SYMBOLS = new Set(["R", "P", "E", "M", "K", "N$", "Z$", "SH", "KSH", "USH", "TSH"]);
let currencyCodes: Set<string> | null = null;

/** Whether what stands beside a number is money: nothing, a symbol ($, €), a currency's letters, or its code (ZAR). */
function moneyMark(s: string): boolean {
  if (s === "" || /^[^\p{L}\p{N}]+$/u.test(s) || LETTER_SYMBOLS.has(s.toUpperCase())) return true;
  if (!/^[A-Za-z]{3}$/.test(s)) return false;
  if (!currencyCodes) {
    try {
      currencyCodes = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      currencyCodes = new Set(["ZAR", "BWP", "NAD", "SZL", "LSL", "ZMW", "USD", "EUR", "GBP"]);
    }
  }
  return currencyCodes.has(s.toUpperCase());
}

/**
 * Whether a typed unit reads as a unit: a word like each, box or hour. A
 * number, or an amount of money (845.50, 12, R845.50, 845.50 ZAR), is a price
 * or a quantity put in the wrong box, and the document would print it after
 * the quantity: "1 845.50". A number with a word ("per 1000", "box of 12",
 * "1x12", "12 kg") is a unit.
 */
export function validUnit(raw: string): boolean {
  const m = /^[-+]?\s*([^\d\s.,+-]*)\s*[-+]?\d[\d\s.,]*\s*([^\d\s.,]*)$/u.exec(raw.trim());
  return !m || !moneyMark(m[1]) || !moneyMark(m[2]);
}

/**
 * The first line whose unit is a number or an amount of money, in words, or
 * null. A screen that shows saved lines may pass each line's `savedUnit`: a
 * unit saved before this rule stands until someone changes it, so a contract
 * can still be paused without retyping it first.
 */
export function unitProblem(lines: { description: string; unit: string; savedUnit?: string }[]): string | null {
  const bad = lines.find(
    (l) => !validUnit(l.unit) && !(l.savedUnit !== undefined && l.unit.trim() === l.savedUnit.trim())
  );
  if (!bad) return null;
  const what = bad.description.trim();
  return `${what ? `The unit for “${what}”` : "A unit"} is a word, like each, box or hour. The price goes in the Price box.`;
}

/** Whether a typed price is one the database takes: zero or more, to the cent. */
export function validPrice(raw: string): boolean {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n >= 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

/** The columns of "Who owes you", in the order `debtors_ageing` returns them. */
export const AGEING_COLUMNS = [
  { key: "not_due", label: "Not yet due" },
  { key: "days_1_30", label: "1–30 days" },
  { key: "days_31_60", label: "31–60 days" },
  { key: "days_61_90", label: "61–90 days" },
  { key: "days_over_90", label: "Over 90 days" },
] as const;

export type AgeingKey = (typeof AGEING_COLUMNS)[number]["key"];

/** Which column an amount falls in, by days past its due date at the as-of date. */
export function ageingKey(daysPastDue: number): AgeingKey {
  if (daysPastDue <= 0) return "not_due";
  if (daysPastDue <= 30) return "days_1_30";
  if (daysPastDue <= 60) return "days_31_60";
  if (daysPastDue <= 90) return "days_61_90";
  return "days_over_90";
}
