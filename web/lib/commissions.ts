import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Commission rules and the commissions they produce.
 *
 * Commissions are only ever written by the database: one per delivered order,
 * worked out when it is delivered and again by "Recalculate", from the
 * highest-priority matching rule. This module reads them and moves them
 * between pending, approved and paid through `commissions_set_status`.
 */

type Client = SupabaseClient<Database>;

export type CommissionRule = Database["public"]["Tables"]["commission_rules"]["Row"];
export type Commission = Database["public"]["Tables"]["commissions"]["Row"];
export type Tier = { from: number; to: number | null; rate: number };

export const KIND_LABELS: Record<string, string> = {
  percentage: "Percentage",
  fixed: "Fixed amount",
  tiered: "Tiered by order value",
};

export const BASIS_LABELS: Record<string, string> = {
  revenue_excl_vat: "Order value excl. VAT",
  revenue_incl_vat: "Order value incl. VAT",
  gross_profit: "Gross profit",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function tiersOf(rule: Pick<CommissionRule, "tiers">): Tier[] {
  return Array.isArray(rule.tiers) ? (rule.tiers as unknown as Tier[]) : [];
}

/** One line a manager can read: "5% of order value excl. VAT". */
export function describeRule(rule: CommissionRule): string {
  const basis = BASIS_LABELS[rule.basis]?.toLowerCase() ?? rule.basis;
  if (rule.kind === "fixed") return `${Number(rule.fixed_amount).toFixed(2)} per order`;
  if (rule.kind === "tiered") {
    return (
      tiersOf(rule)
        .map((t) => `${t.rate}% from ${t.from}${t.to == null ? "+" : `–${t.to}`}`)
        .join(", ") + ` of ${basis}`
    );
  }
  return `${Number(rule.rate)}% of ${basis}`;
}

export async function fetchRules(supabase: Client) {
  const { data, error } = await supabase
    .from("commission_rules")
    .select("*")
    .order("active", { ascending: false })
    .order("priority", { ascending: false })
    .order("created_at");
  fail(error);
  return (data ?? []) as CommissionRule[];
}

export type RuleInput = {
  name: string;
  description: string | null;
  kind: "percentage" | "fixed" | "tiered";
  rate: number | null;
  fixedAmount: number | null;
  tiers: Tier[] | null;
  basis: string;
  appliesTo: "all" | "rep" | "store";
  repId: string | null;
  storeId: string | null;
  minOrderValue: number;
  priority: number;
  active: boolean;
};

function ruleRow(input: RuleInput) {
  return {
    name: input.name,
    description: input.description,
    kind: input.kind,
    rate: input.kind === "percentage" ? input.rate : null,
    fixed_amount: input.kind === "fixed" ? input.fixedAmount : null,
    tiers: input.kind === "tiered" ? (input.tiers as unknown as Json) : null,
    basis: input.basis,
    applies_to: input.appliesTo,
    rep_id: input.appliesTo === "rep" ? input.repId : null,
    store_id: input.appliesTo === "store" ? input.storeId : null,
    min_order_value: input.minOrderValue,
    priority: input.priority,
    active: input.active,
  };
}

export async function saveRule(
  supabase: Client,
  orgId: string,
  input: RuleInput,
  id?: string
) {
  if (id) {
    const { error } = await supabase.from("commission_rules").update(ruleRow(input)).eq("id", id);
    fail(error);
  } else {
    const { error } = await supabase
      .from("commission_rules")
      .insert({ org_id: orgId, ...ruleRow(input) });
    fail(error);
  }
}

export async function deleteRule(supabase: Client, id: string) {
  const { error } = await supabase.from("commission_rules").delete().eq("id", id);
  fail(error);
}

export type CommissionRow = Commission & {
  rep_name: string;
  order_number: string;
  store_name: string | null;
};

export async function fetchCommissions(
  supabase: Client,
  range: { from: Date; to: Date }
): Promise<CommissionRow[]> {
  // Paged to exhaustion: this feeds payroll, and a silent cap would pay
  // people less than they earned. Ordered by id as well so a page boundary
  // falling inside a run of equal delivery times cannot repeat or skip rows.
  const PAGE = 1000;
  const data: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from("commissions")
      .select(
        "*, profiles!commissions_rep_id_fkey(full_name), orders(order_number, stores(name))"
      )
      .gte("delivered_at", range.from.toISOString())
      .lt("delivered_at", range.to.toISOString())
      .order("delivered_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    fail(error);
    data.push(...(page ?? []));
    if ((page ?? []).length < PAGE) break;
  }
  type Raw = Commission & {
    profiles: { full_name: string } | null;
    orders: { order_number: string; stores: { name: string } | null } | null;
  };
  return ((data ?? []) as unknown as Raw[]).map(({ profiles, orders, ...c }) => ({
    ...c,
    rep_name: profiles?.full_name ?? "—",
    order_number: orders?.order_number ?? "—",
    store_name: orders?.stores?.name ?? null,
  }));
}

export async function recalculate(supabase: Client, range: { from: Date; to: Date }) {
  const { data, error } = await supabase.rpc("commissions_recalculate", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  fail(error);
  return data ?? 0;
}

export async function setStatus(
  supabase: Client,
  ids: string[],
  status: "pending" | "approved" | "paid"
) {
  const { data, error } = await supabase.rpc("commissions_set_status", {
    p_ids: ids,
    p_status: status,
  });
  fail(error);
  return data ?? 0;
}

/** Per-rep totals for the payroll view, in rep name order. */
export function byRep(rows: CommissionRow[]) {
  const map = new Map<
    string,
    { repId: string; repName: string; orders: number; orderValue: number; pending: number; approved: number; paid: number }
  >();
  for (const c of rows) {
    const r =
      map.get(c.rep_id) ??
      { repId: c.rep_id, repName: c.rep_name, orders: 0, orderValue: 0, pending: 0, approved: 0, paid: 0 };
    r.orders += 1;
    r.orderValue += Number(c.order_value);
    r[c.status as "pending" | "approved" | "paid"] += Number(c.amount);
    map.set(c.rep_id, r);
  }
  return [...map.values()].sort((a, b) => a.repName.localeCompare(b.repName));
}
