/**
 * A contract's billing periods, exactly as the database works them out
 * (`contract_first_period_start`, `contract_period_end`,
 * `contract_invoice_date` and `service_contracts_stamp` in
 * `20261008200000_contracts_and_proof_of_service.sql`), so the contract form
 * can say when the first invoice will go out before it is saved.
 *
 * Dates are YYYY-MM-DD strings and plain calendar arithmetic in UTC, which is
 * what the database's `date` type is: no timezone moves a day.
 */

export type ContractTerms = {
  period: "monthly" | "quarterly";
  billing: "advance" | "arrears";
  invoiceDay: number;
};

const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

/** Billing starts with the first whole calendar month. */
export function firstPeriodStart(startsOn: string): string {
  const d = parse(startsOn);
  return d.getUTCDate() === 1 ? startsOn : iso(addMonths(d, 1));
}

export function periodEnd(start: string, period: ContractTerms["period"]): string {
  const next = addMonths(parse(start), period === "quarterly" ? 3 : 1);
  return iso(new Date(next.getTime() - 86_400_000));
}

/** In its first month (in advance) or the month after it ends (in arrears), on the contract's day. */
export function invoiceDate(start: string, end: string, terms: ContractTerms): string {
  const base = terms.billing === "arrears" ? addMonths(parse(end), 1) : addMonths(parse(start), 0);
  return iso(new Date(base.getTime() + (terms.invoiceDay - 1) * 86_400_000));
}

/**
 * The first period billed when the contract is entered `today`: the first
 * whose invoice day has not passed. Nothing is billed backwards by itself.
 */
export function firstBilledPeriod(startsOn: string, terms: ContractTerms, today: string) {
  let start = firstPeriodStart(startsOn);
  for (let i = 0; i < 1200; i += 1) {
    const end = periodEnd(start, terms.period);
    const on = invoiceDate(start, end, terms);
    if (on >= today) return { start, end, invoiceOn: on };
    start = iso(new Date(parse(end).getTime() + 86_400_000));
  }
  return null;
}

/**
 * "October 2026", or "Oct–Dec 2026" for a quarter. A contract's last period
 * can stop part-way (it is charged by the days served), and then the days are
 * named: "1–15 March 2026", "1 Jan–1 Feb 2026".
 */
export function periodLabel(start: string, end: string): string {
  const s = parse(start);
  const e = parse(end);
  const month = (d: Date, style: "long" | "short") => d.toLocaleString("en-GB", { month: style, timeZone: "UTC" });
  const lastDay = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  if (s.getUTCDate() !== 1 || e.getUTCDate() !== lastDay) {
    const sy = s.getUTCFullYear();
    const ey = e.getUTCFullYear();
    if (s.getUTCMonth() === e.getUTCMonth() && sy === ey) {
      return `${s.getUTCDate()}–${e.getUTCDate()} ${month(e, "long")} ${ey}`;
    }
    return sy === ey
      ? `${s.getUTCDate()} ${month(s, "short")}–${e.getUTCDate()} ${month(e, "short")} ${ey}`
      : `${s.getUTCDate()} ${month(s, "short")} ${sy}–${e.getUTCDate()} ${month(e, "short")} ${ey}`;
  }
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) {
    return `${month(s, "long")} ${s.getUTCFullYear()}`;
  }
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  return sameYear
    ? `${month(s, "short")}–${month(e, "short")} ${e.getUTCFullYear()}`
    : `${month(s, "short")} ${s.getUTCFullYear()}–${month(e, "short")} ${e.getUTCFullYear()}`;
}
