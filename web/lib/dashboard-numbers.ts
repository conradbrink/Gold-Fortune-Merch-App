import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { DateRange } from "@/lib/date-range";
import { parseFirstWeek, parseKpis, type FirstWeek, type Kpi } from "@/lib/kpis";
import { lineTotal } from "@/lib/money-docs";

/**
 * The data behind the trade dashboards' cards (Stage 7 Part 3): the numbers,
 * today's planned work, and the contract invoices about to go out.
 */

type Client = SupabaseClient<Database>;

export type Numbers = { kpis: Record<string, Kpi>; firstWeek: FirstWeek | null };

/** The requested numbers for the dashboard's dates, computed by the database. */
export async function fetchNumbers(supabase: Client, range: DateRange, codes: string[]): Promise<Numbers> {
  const { data, error } = await supabase.rpc("dashboard_kpis", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_codes: codes,
  });
  if (error) throw new Error(error.message);
  return { kpis: parseKpis(data), firstWeek: parseFirstWeek(data) };
}

export type TodayJob = {
  id: string;
  staff: string;
  site: string;
  status: "done" | "in_progress" | "not_started";
  /** Check-in time for work under way or done, as "HH:MM" in the company's time. */
  at: string | null;
  planned: boolean;
};

export type Today = { jobs: TodayJob[] };

function localDay(timeZone: string, d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function localTime(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso)
  );
}

/**
 * Today's work: every planned job with where it stands, plus work done today
 * that was not on the plan. Read through the caller's own rights.
 */
export async function fetchToday(supabase: Client, timeZone: string): Promise<Today> {
  const day = localDay(timeZone);
  const start = new Date(`${day}T00:00:00Z`);
  // A day's visits, by check-in: a generous UTC window, narrowed to the local day below.
  const from = new Date(start.getTime() - 14 * 3600 * 1000).toISOString();
  const to = new Date(start.getTime() + 38 * 3600 * 1000).toISOString();
  const [routes, visits] = await Promise.all([
    supabase
      .from("routes")
      .select("id, rep_id, store_id, stores(name), profiles!routes_rep_id_fkey(full_name)")
      .eq("scheduled_date", day)
      .order("sequence_order", { nullsFirst: false }),
    supabase
      .from("visits")
      .select("id, route_id, rep_id, store_id, status, checkin_at, stores(name), profiles!visits_rep_id_fkey(full_name)")
      .gte("checkin_at", from)
      .lt("checkin_at", to),
  ]);
  if (routes.error) throw new Error(routes.error.message);
  if (visits.error) throw new Error(visits.error.message);
  type R = { id: string; stores: { name: string } | null; profiles: { full_name: string | null } | null };
  type V = R & { route_id: string | null; status: string; checkin_at: string | null };
  const todays = ((visits.data ?? []) as unknown as V[]).filter(
    (v) => v.checkin_at && localDay(timeZone, new Date(v.checkin_at)) === day
  );
  const byRoute = new Map(todays.filter((v) => v.route_id).map((v) => [v.route_id as string, v]));
  const jobs: TodayJob[] = ((routes.data ?? []) as unknown as R[]).map((r) => {
    const v = byRoute.get(r.id);
    return {
      id: r.id,
      staff: r.profiles?.full_name ?? "",
      site: r.stores?.name ?? "",
      status: !v ? "not_started" : v.status === "checked_out" ? "done" : "in_progress",
      at: v?.checkin_at ? localTime(timeZone, v.checkin_at) : null,
      planned: true,
    };
  });
  for (const v of todays) {
    if (v.route_id) continue;
    jobs.push({
      id: v.id,
      staff: v.profiles?.full_name ?? "",
      site: v.stores?.name ?? "",
      status: v.status === "checked_out" ? "done" : "in_progress",
      at: v.checkin_at ? localTime(timeZone, v.checkin_at) : null,
      planned: false,
    });
  }
  return { jobs };
}

export type ContractsDue = { count: number; value: number; first: string | null };

/** Contract invoices due in the next `days` days: how many, what they come to, and the first date. */
export async function fetchContractsDue(supabase: Client, today: string, days = 7): Promise<ContractsDue> {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const { data, error } = await supabase
    .from("service_contracts")
    .select("next_invoice_on, service_contract_lines(qty, unit_price)")
    .eq("active", true)
    .gte("next_invoice_on", today)
    .lt("next_invoice_on", until.toISOString().slice(0, 10));
  if (error) throw new Error(error.message);
  type Row = { next_invoice_on: string; service_contract_lines: { qty: number; unit_price: number }[] };
  const rows = (data ?? []) as unknown as Row[];
  return {
    count: rows.length,
    value: rows.reduce(
      (n, r) => n + r.service_contract_lines.reduce((m, l) => m + lineTotal(Number(l.qty), Number(l.unit_price)), 0),
      0
    ),
    first: rows.map((r) => r.next_invoice_on).sort()[0] ?? null,
  };
}
