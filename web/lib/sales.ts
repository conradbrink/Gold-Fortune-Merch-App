import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";

type Client = SupabaseClient<Database>;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/**
 * What a sale is, here.
 *
 * **Counted on the day it was delivered**, not the day the rep took it. The
 * owner's call, and the right one: an order is a request until the goods are
 * with the shop, and the POD is what proves the week's figure. An order taken
 * on Friday and delivered on Monday belongs to next week.
 *
 * **Valued on what actually arrived**, `qty_delivered` less `qty_returned`, not
 * on what was ordered. A line short-picked or brought back is not revenue, and
 * a sales figure that counts it is one nobody can reconcile to an invoice.
 *
 * **At the order's own VAT rate**, frozen onto it at capture — orders taken
 * before the rate was set carry 0%, which is correct and not a gap to patch.
 */
export type SoldLine = {
  qty: number;
  unitPrice: number;
  vatRate: number;
};

export type Sale = {
  orderId: string;
  orderNumber: string;
  deliveredAt: string;
  repId: string | null;
  repName: string;
  storeName: string;
  units: number;
  /** Excluding VAT — the revenue figure. */
  net: number;
  vat: number;
  /** Including VAT — what the shop was invoiced. */
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
  const t = new Date(sale.deliveredAt).getTime();
  return t >= period.from.getTime() && t <= period.to.getTime();
}

export type Totals = { orders: number; units: number; net: number; gross: number };

export function totalsFor(sales: Sale[], period?: Period): Totals {
  const rows = period ? sales.filter((s) => within(s, period)) : sales;
  return rows.reduce<Totals>(
    (acc, s) => ({
      orders: acc.orders + 1,
      units: acc.units + s.units,
      net: acc.net + s.net,
      gross: acc.gross + s.gross,
    }),
    { orders: 0, units: 0, net: 0, gross: 0 }
  );
}

export function byRep(sales: Sale[], period?: Period) {
  const rows = period ? sales.filter((s) => within(s, period)) : sales;
  const map = new Map<string, Totals & { repName: string }>();
  for (const s of rows) {
    const key = s.repId ?? "none";
    const acc =
      map.get(key) ??
      { repName: s.repName, orders: 0, units: 0, net: 0, gross: 0 };
    map.set(key, {
      repName: acc.repName,
      orders: acc.orders + 1,
      units: acc.units + s.units,
      net: acc.net + s.net,
      gross: acc.gross + s.gross,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

/**
 * Every delivered order, valued.
 *
 * Aggregated here rather than in a database function on purpose: three reps and
 * a few hundred orders is nothing to sum in the browser, and a reporting RPC is
 * a migration against production for a number that changes shape the first time
 * somebody asks a slightly different question. If this ever gets slow, that is
 * the moment for the RPC — and by then the questions will have settled.
 */
export async function fetchSales(supabase: Client): Promise<Sale[]> {
  type Row = {
    id: string;
    order_number: string;
    delivered_at: string;
    rep_id: string | null;
    vat_rate: number | null;
    stores: { name: string } | { name: string }[] | null;
    profiles: { full_name: string } | { full_name: string }[] | null;
    order_lines:
      | { qty_delivered: number; qty_returned: number; unit_price: number | null }[]
      | null;
  };

  // Paged to exhaustion rather than capped.
  //
  // A single `.limit()` silently discarded everything past the newest N and
  // labelled the result "All time" — a figure that is wrong in the one
  // direction nobody checks, quietly under-reporting as the business grows.
  // Ordered by `delivered_at` *and* `id` because ties are not hypothetical:
  // several orders are marked delivered in the same second when a driver
  // closes a run, and an unstable sort can repeat or skip rows across pages.
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, delivered_at, rep_id, vat_rate, " +
          "stores(name), profiles!orders_rep_id_fkey(full_name), " +
          "order_lines(qty_delivered, qty_returned, unit_price)"
      )
      .eq("status", "delivered")
      .not("delivered_at", "is", null)
      .order("delivered_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    fail(error);

    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;

  return rows.map((r) => {
    const rate = Number(r.vat_rate ?? 0);
    let units = 0;
    let net = 0;
    for (const l of r.order_lines ?? []) {
      const qty = l.qty_delivered - l.qty_returned;
      if (qty <= 0) continue;
      units += qty;
      net += qty * (l.unit_price == null ? 0 : Number(l.unit_price));
    }
    const vat = net * (rate / 100);
    return {
      orderId: r.id,
      orderNumber: r.order_number,
      deliveredAt: r.delivered_at,
      repId: r.rep_id,
      repName: one(r.profiles)?.full_name ?? "No rep",
      storeName: one(r.stores)?.name ?? "—",
      units,
      net,
      vat,
      gross: net + vat,
    };
  });
}
