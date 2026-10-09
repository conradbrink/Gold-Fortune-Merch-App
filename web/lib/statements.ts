import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { AgeingRow } from "@/lib/owed";

/**
 * Money → Statements: every client the company has ever invoiced
 * (`statement_clients`), the periods a statement is made for, and the
 * client's own row in the ageing. Paid-up clients are here too; Who owes you
 * lists only the ones who owe.
 */

type Client = SupabaseClient<Database>;

export type StatementClientRow = Database["public"]["Functions"]["statement_clients"]["Returns"][number];

const num = (v: unknown) => Number(v ?? 0);

/**
 * One document read in one statement (`statement_clients_json`), as the
 * ageing is: one snapshot, and no 1,000-row page limit.
 */
export async function fetchStatementClients(supabase: Client, asOf: string): Promise<StatementClientRow[]> {
  const { data, error } = await supabase.rpc("statement_clients_json", { p_as_of: asOf });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StatementClientRow[])
    .map((r) => ({
      ...r,
      invoices: num(r.invoices),
      invoiced: num(r.invoiced),
      credited: num(r.credited),
      paid: num(r.paid),
      balance: num(r.balance),
    }))
    .sort((a, b) => a.client_name.localeCompare(b.client_name));
}

/** The same client on the list, the statement and the ageing: place on the books, or the name on the invoices. */
export function clientKey(c: { store_id: string | null; client_name: string }): string {
  return `${c.store_id ?? ""}|${c.client_name}`;
}

/** The clients whose name contains what was typed, ignoring case and spaces at the ends. */
export function filterClients<T extends { client_name: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.client_name.toLowerCase().includes(q)) : rows;
}

/**
 * This client's row in the ageing. A client on the books is matched by place;
 * one known only by the name on the invoices has no place, so by name, the way
 * `client_statement` chooses them. No row means nothing is owed.
 */
export function ageingFor(
  rows: AgeingRow[],
  client: { store_id: string | null; client_name: string }
): AgeingRow | null {
  if (client.store_id) return rows.find((r) => r.store_id === client.store_id) ?? null;
  const name = client.client_name.trim().toLowerCase();
  return rows.find((r) => r.store_id === null && r.client_name.trim().toLowerCase() === name) ?? null;
}

/** A balance as it reads on the list: nothing owed is calm, a credit says so. */
export function balanceState(balance: number): "owing" | "settled" | "credit" {
  if (Math.abs(balance) < 0.005) return "settled";
  return balance > 0 ? "owing" : "credit";
}

export type PeriodPreset = "this_month" | "last_month" | "last_3_months" | "this_year";

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3_months", label: "Last 3 months" },
  { key: "this_year", label: "This year" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const day = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * The days a quick choice stands for, as "YYYY-MM-DD", given today's date.
 * Last 3 months is this month and the two before it, up to today. Months
 * count from 1; month 0 or less rolls back into the year before.
 */
export function periodFor(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const firstOf = (monthsBack: number) => {
    const idx = y * 12 + (m - 1) - monthsBack;
    return day(Math.floor(idx / 12), (idx % 12) + 1, 1);
  };
  switch (preset) {
    case "this_month":
      return { from: firstOf(0), to: today };
    case "last_month": {
      // Day 0 of this month is the last day of the one before.
      const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
      const [py, pm] = firstOf(1).split("-").map(Number);
      return { from: firstOf(1), to: day(py, pm, last) };
    }
    case "last_3_months":
      return { from: firstOf(2), to: today };
    case "this_year":
      return { from: day(y, 1, 1), to: today };
  }
}
