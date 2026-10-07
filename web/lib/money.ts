/**
 * Money in the company's currency (`currency_code` in company settings).
 *
 * Written the way businesses in the region write it on their own paperwork:
 * the narrow symbol hard against a grouped number — `P101,223.50`, `R1,499.00`.
 * `Intl.NumberFormat` with `style: "currency"` puts a space between them in
 * en-GB ("P 101,223.50"), which is not how Gold Fortune's reports have ever
 * read, so only the *symbol* is taken from Intl and the number is formatted
 * plainly. Any ISO 4217 code works; nothing here knows a particular currency.
 */

const symbols = new Map<string, string>();

export function currencySymbol(code: string): string {
  const cached = symbols.get(code);
  if (cached !== undefined) return cached;
  let symbol = code;
  try {
    const part = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    if (part) symbol = part.value;
  } catch {
    // An unknown code: show the code itself rather than nothing.
  }
  symbols.set(code, symbol);
  return symbol;
}

/** The currency's English name, for prose: "Botswanan Pula", "South African Rand". */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** `P101,223.50`. Null or not finite is an em dash, never a false zero. */
export function formatMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${currencySymbol(currency)}${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The same figure without the cents, for a dense table cell: `P101,224`. */
export function formatMoneyShort(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${currencySymbol(currency)}${Math.round(n).toLocaleString("en-GB")}`;
}
