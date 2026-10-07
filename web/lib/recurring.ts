import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Standing orders a store receives on a schedule.
 *
 * The daily job (`/api/orders/recurring`) places every one that is due as an
 * ordinary new order; the warehouse confirms it like any other, which is the
 * review step. "Place now" does the same for one, today.
 */

type Client = SupabaseClient<Database>;

export type RecurringOrder = Database["public"]["Tables"]["recurring_orders"]["Row"];
export type RecurringLine = Database["public"]["Tables"]["recurring_order_lines"]["Row"];
export type RecurringRun = Database["public"]["Tables"]["recurring_order_runs"]["Row"];

export const FREQUENCIES: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  bimonthly: "Every 2 months",
  quarterly: "Quarterly",
};

export const RECURRING_STATUS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export type RecurringListRow = RecurringOrder & { store_name: string | null; line_count: number };

export async function fetchRecurringOrders(supabase: Client): Promise<RecurringListRow[]> {
  const { data, error } = await supabase
    .from("recurring_orders")
    .select("*, stores(name), recurring_order_lines(id)")
    .order("status")
    .order("next_run");
  fail(error);
  type Raw = RecurringOrder & { stores: { name: string } | null; recurring_order_lines: { id: string }[] };
  return ((data ?? []) as unknown as Raw[]).map(({ stores, recurring_order_lines, ...r }) => ({
    ...r,
    store_name: stores?.name ?? null,
    line_count: recurring_order_lines?.length ?? 0,
  }));
}

export type RecurringDetail = {
  recurring: RecurringOrder;
  lines: RecurringLine[];
  runs: (RecurringRun & { order_number: string | null })[];
};

export async function fetchRecurringOrder(supabase: Client, id: string): Promise<RecurringDetail> {
  const [r, l, runs] = await Promise.all([
    supabase.from("recurring_orders").select("*").eq("id", id).single(),
    supabase.from("recurring_order_lines").select("*").eq("recurring_order_id", id),
    supabase
      .from("recurring_order_runs")
      .select("*, orders(order_number)")
      .eq("recurring_order_id", id)
      .order("run_date", { ascending: false })
      .limit(50),
  ]);
  fail(r.error);
  fail(l.error);
  fail(runs.error);
  return {
    recurring: r.data as RecurringOrder,
    lines: (l.data ?? []) as RecurringLine[],
    runs: ((runs.data ?? []) as unknown as (RecurringRun & { orders: { order_number: string } | null })[]).map(
      ({ orders, ...run }) => ({ ...run, order_number: orders?.order_number ?? null })
    ),
  };
}

export type RecurringInput = {
  name: string;
  storeId: string;
  repId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  frequency: string;
  nextRun: string;
  maxRuns: number | null;
  notes: string | null;
  lines: { productId: string; qty: number; unitPrice: number | null; discountPct: number }[];
};

/**
 * Creates or replaces a recurring order and its lines. The lines are replaced
 * wholesale — a standing order is short, and diffing it buys nothing.
 */
export async function saveRecurringOrder(
  supabase: Client,
  orgId: string,
  input: RecurringInput,
  id?: string
): Promise<string> {
  if (input.lines.length === 0) throw new Error("Add at least one product.");
  const row = {
    name: input.name,
    store_id: input.storeId,
    rep_id: input.repId,
    contact_name: input.contactName,
    contact_phone: input.contactPhone,
    frequency: input.frequency,
    next_run: input.nextRun,
    max_runs: input.maxRuns,
    notes: input.notes,
  };
  let recurringId = id;
  if (id) {
    const { error } = await supabase
      .from("recurring_orders")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id);
    fail(error);
    const { error: delError } = await supabase.from("recurring_order_lines").delete().eq("recurring_order_id", id);
    fail(delError);
  } else {
    const { data, error } = await supabase
      .from("recurring_orders")
      .insert({ org_id: orgId, ...row })
      .select("id")
      .single();
    fail(error);
    recurringId = (data as { id: string }).id;
  }
  const { error: linesError } = await supabase.from("recurring_order_lines").insert(
    input.lines.map((l) => ({
      recurring_order_id: recurringId as string,
      product_id: l.productId,
      qty: l.qty,
      unit_price: l.unitPrice,
      discount_pct: l.discountPct,
    }))
  );
  fail(linesError);
  return recurringId as string;
}

export async function setRecurringStatus(supabase: Client, id: string, status: "active" | "paused" | "ended") {
  const { error } = await supabase
    .from("recurring_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  fail(error);
}

export async function deleteRecurringOrder(supabase: Client, id: string) {
  const { error } = await supabase.from("recurring_orders").delete().eq("id", id);
  fail(error);
}

export async function placeNow(supabase: Client, id: string): Promise<string> {
  const { data, error } = await supabase.rpc("recurring_order_run_now", { p_id: id });
  fail(error);
  return data as string;
}
