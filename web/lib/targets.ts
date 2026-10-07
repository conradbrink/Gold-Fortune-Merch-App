import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Monthly sales targets per rep.
 *
 * Progress comes from `sales_target_progress`, which counts a sale exactly as
 * the Sales page does — delivered, on the local delivery date, valued on what
 * arrived less returns, excluding VAT — so the two can never show a rep
 * different figures for the same month.
 */

type Client = SupabaseClient<Database>;

export type Measure = "revenue" | "gross_profit" | "units" | "orders";

export const MEASURES: { value: Measure; label: string; money: boolean }[] = [
  { value: "revenue", label: "Revenue (excl. VAT)", money: true },
  { value: "gross_profit", label: "Gross profit", money: true },
  { value: "units", label: "Units sold", money: false },
  { value: "orders", label: "Orders delivered", money: false },
];

export type TargetProgress =
  Database["public"]["Functions"]["sales_target_progress"]["Returns"][number];

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** First day of the month, as YYYY-MM-DD. */
export function monthStart(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** The achieved figure for whichever measure the target is set in. */
export function achievedFor(row: TargetProgress, measure: Measure): number {
  switch (measure) {
    case "gross_profit":
      return Number(row.gross_profit);
    case "units":
      return Number(row.units);
    case "orders":
      return Number(row.orders);
    default:
      return Number(row.revenue_excl_vat);
  }
}

export async function fetchTargetProgress(supabase: Client, month: string) {
  const { data, error } = await supabase.rpc("sales_target_progress", { p_month: month });
  fail(error);
  return data ?? [];
}

/**
 * Saves the month's targets. A blank target removes that rep's target for the
 * month rather than storing a zero, which would read as "expected to sell
 * nothing" and show every rep at 100%.
 */
export async function saveTargets(
  supabase: Client,
  input: {
    orgId: string;
    month: string;
    rows: { repId: string; measure: Measure; target: number | null }[];
  }
) {
  const set = input.rows.filter((r) => r.target != null && r.target > 0);
  const cleared = input.rows.filter((r) => r.target == null || r.target <= 0).map((r) => r.repId);

  if (set.length > 0) {
    const { error } = await supabase.from("sales_targets").upsert(
      set.map((r) => ({
        org_id: input.orgId,
        rep_id: r.repId,
        period_month: input.month,
        measure: r.measure,
        target: r.target as number,
      })),
      { onConflict: "org_id,rep_id,period_month" }
    );
    fail(error);
  }
  if (cleared.length > 0) {
    const { error } = await supabase
      .from("sales_targets")
      .delete()
      .eq("period_month", input.month)
      .in("rep_id", cleared);
    fail(error);
  }
}
