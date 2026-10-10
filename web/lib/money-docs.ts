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
