import type { SupabaseClient } from "@supabase/supabase-js";
import { allPages } from "@/lib/all-pages";
import { orderTotals } from "@/lib/orders";
import { OPEN_ORDER_STATUSES } from "@/lib/dashboard-links";

/**
 * The orders behind the dashboard's Orders pipeline card.
 *
 * The card counts orders by status in `dashboard_business`: "To confirm" is new
 * and confirmed, then picking, packed and dispatched, and "proof of delivery
 * missing" is delivered with the POD outstanding. The page reads those same
 * orders, every one of them (paged, not the Orders list's newest 200), so its
 * tiles are the card's numbers.
 */

export const PIPELINE_STAGES = ["to_confirm", "picking", "packed", "dispatched", "no_pod"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The card's own words for each stage. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  to_confirm: "To confirm",
  picking: "Being picked",
  packed: "Packed, to dispatch",
  dispatched: "Out for delivery",
  no_pod: "Proof of delivery missing",
};

/** What somebody has to do next with an order in this stage. */
export const STAGE_NEXT: Record<PipelineStage, string> = {
  to_confirm: "Confirm it and start picking",
  picking: "Finish picking and pack it",
  packed: "Dispatch it",
  dispatched: "Record the delivery",
  no_pod: "Upload the signed proof of delivery",
};

export type PipelineOrder = {
  id: string;
  orderNumber: string;
  /** The invoice this sale was billed on, Tickd's or a QuickBooks number. */
  invoiceNumber: string | null;
  /** The person the order is for, as the orders board searches it. */
  contactName: string | null;
  status: string;
  podStatus: string | null;
  onHold: boolean;
  storeId: string | null;
  storeName: string | null;
  repId: string | null;
  repName: string | null;
  createdAt: string;
  /** When it was confirmed: the orders board's Invoiced column counts from here. */
  confirmedAt: string | null;
  /** When it reached the stage it is in now, which is how long it has waited. */
  enteredAt: string;
  /** The day the customer needs it, when the order says. */
  requiredBy: string | null;
  /** The customer's own purchase order number, and the last day it is valid. */
  customerPoNumber: string | null;
  customerPoExpiresOn: string | null;
  /** VAT included, as the Orders list shows it. */
  total: number;
  stage: PipelineStage;
  /**
   * It has a fulfilment location: it went through the warehouse, with stock.
   * False for a new order, and for one invoiced and sent out without stock.
   */
  fromStock: boolean;
};

type Row = {
  id: string;
  order_number: string;
  invoice_number: string | null;
  contact_name: string | null;
  status: string;
  pod_status: string | null;
  on_hold: boolean | null;
  store_id: string | null;
  rep_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  picking_started_at: string | null;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  required_by: string | null;
  customer_po_number: string | null;
  customer_po_expires_on: string | null;
  vat_rate: number | null;
  fulfil_location_id: string | null;
  stores: { name: string } | { name: string }[] | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  order_lines: { qty_ordered: number; unit_price: number | null }[] | null;
};

/** The stage an order is in, or null for one the pipeline does not count. */
export function stageOf(o: { status: string; pod_status?: string | null; podStatus?: string | null }): PipelineStage | null {
  switch (o.status) {
    case "new":
    case "confirmed":
      return "to_confirm";
    case "picking":
      return "picking";
    case "packed":
      return "packed";
    case "dispatched":
      return "dispatched";
    case "delivered":
      return (o.pod_status ?? o.podStatus) === "outstanding" ? "no_pod" : null;
    default:
      return null;
  }
}

/**
 * When the order reached its current status. Each step stamps its own time; an
 * older order missing a stamp falls back to the step before, never to now, so
 * it reads as waiting longer rather than as just arrived.
 */
export function enteredAtOf(r: Pick<Row, "status" | "created_at" | "confirmed_at" | "picking_started_at" | "packed_at" | "dispatched_at" | "delivered_at">): string {
  switch (r.status) {
    case "confirmed":
      return r.confirmed_at ?? r.created_at;
    case "picking":
      return r.picking_started_at ?? r.confirmed_at ?? r.created_at;
    case "packed":
      return r.packed_at ?? r.picking_started_at ?? r.confirmed_at ?? r.created_at;
    case "dispatched":
      return r.dispatched_at ?? r.packed_at ?? r.created_at;
    case "delivered":
      return r.delivered_at ?? r.dispatched_at ?? r.created_at;
    default:
      return r.created_at;
  }
}

export async function fetchPipelineOrders(supabase: SupabaseClient): Promise<PipelineOrder[]> {
  // Two reads rather than one `or()`: the open statuses, and the delivered
  // orders still waiting for their proof. Ordered by id so no page repeats or
  // skips a row.
  const base = () =>
    supabase
      .from("orders")
      .select(
        `id, order_number, invoice_number, contact_name, status, pod_status, on_hold, store_id, rep_id, created_at, confirmed_at,
         picking_started_at, packed_at, dispatched_at, delivered_at, required_by, customer_po_number, customer_po_expires_on, vat_rate,
         fulfil_location_id, stores(name), profiles!orders_rep_id_fkey(full_name), order_lines(qty_ordered, unit_price)`
      );
  type Page = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  const [open, unproven] = await Promise.all([
    allPages<Row>((from, to) => base().in("status", [...OPEN_ORDER_STATUSES]).order("id").range(from, to) as unknown as Page),
    allPages<Row>(
      (from, to) => base().eq("status", "delivered").eq("pod_status", "outstanding").order("id").range(from, to) as unknown as Page
    ),
  ]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return [...open, ...unproven].flatMap((r) => {
    const stage = stageOf(r);
    if (!stage) return [];
    const lines = r.order_lines ?? [];
    return [
      {
        id: r.id,
        orderNumber: r.order_number,
        invoiceNumber: r.invoice_number,
        contactName: r.contact_name,
        status: r.status,
        podStatus: r.pod_status,
        onHold: !!r.on_hold,
        storeId: r.store_id,
        storeName: one(r.stores)?.name ?? null,
        repId: r.rep_id,
        repName: one(r.profiles)?.full_name ?? null,
        createdAt: r.created_at,
        confirmedAt: r.confirmed_at,
        enteredAt: enteredAtOf(r),
        requiredBy: r.required_by,
        customerPoNumber: r.customer_po_number,
        customerPoExpiresOn: r.customer_po_expires_on,
        total: orderTotals(
          lines.map((l) => ({ qty: l.qty_ordered, unitPrice: l.unit_price == null ? 0 : Number(l.unit_price) })),
          Number(r.vat_rate ?? 0)
        ).total,
        stage,
        fromStock: r.fulfil_location_id !== null,
      },
    ];
  });
}

/** How long an order has sat in its stage, in four plain bands. */
export const WAIT_BANDS = ["today", "one_two", "three_seven", "over_week"] as const;
export type WaitBand = (typeof WAIT_BANDS)[number];

export const WAIT_LABELS: Record<WaitBand, string> = {
  today: "Under a day",
  one_two: "1 to 2 days",
  three_seven: "3 to 7 days",
  over_week: "Over a week",
};

/** Whole days between `iso` and `now`. */
export function daysWaiting(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

export function waitBand(days: number): WaitBand {
  if (days < 1) return "today";
  if (days <= 2) return "one_two";
  if (days <= 7) return "three_seven";
  return "over_week";
}

/** "Today", "1 day", "12 days". */
export function describeWait(days: number): string {
  if (days < 1) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** The stages a link asked for (`?stage=`), or null for everything not yet delivered. */
export function stageFromQuery(q: URLSearchParams): PipelineStage | null {
  const v = q.get("stage");
  return v !== null && (PIPELINE_STAGES as readonly string[]).includes(v) ? (v as PipelineStage) : null;
}

/**
 * The stages a view covers: one, or with none chosen the four the headline's
 * "Orders needing action" counts. A delivered order waiting for its proof has
 * gone out, so it is not in "not yet delivered".
 */
export function stagesInView(stage: PipelineStage | null): PipelineStage[] {
  return stage ? [stage] : ["to_confirm", "picking", "packed", "dispatched"];
}
