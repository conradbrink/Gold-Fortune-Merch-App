import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import { lower, type Terms } from "@/lib/terms";

type Client = SupabaseClient<Database>;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/**
 * What a sale is, here.
 *
 * **An invoice, on the day it was issued** (owner, 20 Oct 2026: "Invoiced").
 * Counting only orders somebody had marked delivered left out everything on
 * the road or waiting for its proof, and all the history brought over from
 * QuickBooks, so the dashboard showed a quarter of what had been invoiced.
 *
 * **Less credit notes, on theirs**: a credit note is a sale with a minus, so
 * goods sent back or short reduce the day they were credited.
 *
 * **Excluding VAT** for the revenue figure, with the invoice's own total
 * beside it. A company that does not invoice in Tickd still counts delivered
 * orders, the rule before this one.
 *
 * The rule itself lives in the database (`sales_documents`, migration
 * 20261020213700), so this page, the dashboard, targets, the rep report and
 * the AI Manager cannot disagree.
 */
export type SaleKind = "invoice" | "credit_note" | "order";

export type Sale = {
  id: string;
  kind: SaleKind;
  /** The invoice, credit note or order number. */
  number: string;
  /** Where it opens: the invoice (a credit note shows on its invoice), or the order. */
  href: string;
  /** Midday of the day it was issued, in the company's time. */
  at: string;
  repId: string | null;
  repName: string;
  storeId: string | null;
  storeName: string;
  units: number;
  /** Excluding VAT: the revenue figure. Negative for a credit note. */
  net: number;
  vat: number;
  /** Including VAT: what the invoice says. */
  gross: number;
};

export type Period = { from: Date; to: Date; label: string };

/** Monday-first, because a merchandising week is a working week. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay() is 0 on Sunday, which is the *end* of the week here, not the
  // start — the naive `- getDay()` puts Sunday's sales in the week ahead.
  const shift = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - shift);
  return out;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * The periods the screen offers, and the one before each for comparison.
 *
 * "This week so far" against "the whole of last week" flatters or damns
 * depending on the day, so the comparison is the same span: the previous week
 * up to the same weekday.
 */
export function periodsFor(now: Date) {
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const elapsedMs = now.getTime() - weekStart.getTime();

  return {
    week: { from: weekStart, to: now, label: "This week" },
    weekBefore: {
      from: addDays(weekStart, -7),
      to: new Date(addDays(weekStart, -7).getTime() + elapsedMs),
      label: "Same point last week",
    },
    month: { from: monthStart, to: now, label: "This month" },
    monthBefore: {
      from: addMonths(monthStart, -1),
      // Clamped to the last instant of the prior month. Months are not the same
      // length, so carrying the elapsed time across can land past the end of a
      // shorter one: on 31 March, a month's worth of elapsed time added to
      // 1 February reaches 3 March, and "last month" would quietly include the
      // first days of this one and flatter the comparison.
      to: new Date(
        Math.min(
          addMonths(monthStart, -1).getTime() +
            (now.getTime() - monthStart.getTime()),
          monthStart.getTime() - 1
        )
      ),
      label: "Same point last month",
    },
  };
}

export function within(sale: Sale, period: Period): boolean {
  const t = new Date(sale.at).getTime();
  return t >= period.from.getTime() && t <= period.to.getTime();
}

/** `count` is the invoices (or orders); a credit note changes the money, not the count. */
export type Totals = { count: number; units: number; net: number; gross: number };

export function totalsFor(sales: Sale[], period?: Period): Totals {
  const rows = period ? sales.filter((s) => within(s, period)) : sales;
  return rows.reduce<Totals>(
    (acc, s) => ({
      count: acc.count + (s.kind === "credit_note" ? 0 : 1),
      units: acc.units + s.units,
      net: acc.net + s.net,
      gross: acc.gross + s.gross,
    }),
    { count: 0, units: 0, net: 0, gross: 0 }
  );
}

export function byRep(sales: Sale[], period?: Period) {
  const rows = period ? sales.filter((s) => within(s, period)) : sales;
  const map = new Map<string, Totals & { repName: string }>();
  for (const s of rows) {
    const key = s.repId ?? "none";
    const acc =
      map.get(key) ??
      { repName: s.repName, count: 0, units: 0, net: 0, gross: 0 };
    map.set(key, {
      repName: acc.repName,
      count: acc.count + (s.kind === "credit_note" ? 0 : 1),
      units: acc.units + s.units,
      net: acc.net + s.net,
      gross: acc.gross + s.gross,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

/** What one sale is called, and the plural, for counts and empty lists. */
export function saleWord(n: number, invoices: boolean): string {
  if (invoices) return n === 1 ? "invoice" : "invoices";
  return n === 1 ? "delivery" : "deliveries";
}

/**
 * Every sale, valued: one row per invoice, credit note or (for a company that
 * does not invoice) delivered order, from `sales_documents`.
 *
 * Paged to exhaustion rather than capped: the API returns at most a thousand
 * rows a call, and a figure that silently stops at the newest thousand is
 * wrong in the one direction nobody checks. Ordered by day *and* id so a page
 * boundary can neither repeat nor skip a row.
 */
export async function fetchSales(supabase: Client, t: Terms): Promise<Sale[]> {
  const PAGE = 1000;
  type Row = Database["public"]["Functions"]["sales_documents"]["Returns"][number];
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc("sales_documents", {})
      .order("issued_on", { ascending: false })
      .order("doc_id", { ascending: false })
      .range(from, from + PAGE - 1);
    fail(error);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  return rows.map((r) => {
    const net = Number(r.revenue_excl_vat);
    const gross = Number(r.revenue_incl_vat);
    const kind = r.doc_kind as SaleKind;
    return {
      id: r.doc_id,
      kind,
      number: r.doc_number,
      href: kind === "order" ? `/orders/${r.order_id}` : `/invoices/${r.invoice_id}`,
      at: r.issued_at,
      repId: r.rep_id,
      // A sale nobody was responsible for (QuickBooks history, an invoice
      // typed in at the office) still has to land in a row of the per-person
      // table; it reads "No rep" in the company's own word.
      repName: r.rep_name ?? `No ${lower(t.staff.one)}`,
      storeId: r.store_id,
      storeName: r.store_name ?? "—",
      units: Number(r.units),
      net,
      vat: gross - net,
      gross,
    };
  });
}
