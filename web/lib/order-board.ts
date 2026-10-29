/**
 * The orders board: which column an order sits in, and what dragging it to
 * another column does.
 *
 * Five columns, in the owner's words (19 Oct 2026): purchase orders, invoiced,
 * packed, dispatched, delivered. The order's own status has seven values; the
 * board folds them the way the warehouse talks. Confirmed and picking are one
 * column because both are "invoiced, not yet in a box" (picking only says a
 * clerk has started), and a delivered order leaves the board for the archive
 * once its signed proof of delivery is on file. A delivered order still waiting
 * for that proof stays in the last column, so the missing paper is in front of
 * somebody rather than filed away with the finished work.
 *
 * Moving a card is never just a label change. Each forward step moves stock or
 * issues an invoice in the database, so a drop asks for the step's details in a
 * dialog first (see `components/orders/order-step-dialog.tsx`). Nothing jumps
 * two steps, and the only step backwards is the one the database has a way
 * back for: a dispatched order that did not arrive goes back to packed.
 */

import { orderStatusesFromQuery } from "@/lib/dashboard-links";
import { moduleEnabled, type ModuleSet } from "@/lib/modules";
import { waitBand } from "@/lib/order-pipeline";
import { ORDER_STATUSES } from "@/lib/warehouse";

export const BOARD_COLUMNS = ["purchase_orders", "invoiced", "packed", "dispatched", "delivered"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** What a drop or a card's button asks the dialog to do. */
export type BoardStep = "confirm" | "pack" | "dispatch" | "deliver" | "pod" | "failed";

/** The few facts about an order the board's rules read. */
export type BoardFacts = {
  orderNumber: string;
  status: string;
  podStatus: string | null;
  onHold: boolean;
};

/** The column an order sits in, or null for one that is finished (the archive's). */
export function columnOf(o: Pick<BoardFacts, "status" | "podStatus">): BoardColumn | null {
  switch (o.status) {
    case "new":
      return "purchase_orders";
    case "confirmed":
    case "picking":
      return "invoiced";
    case "packed":
      return "packed";
    case "dispatched":
      return "dispatched";
    case "delivered":
      return o.podStatus === "outstanding" ? "delivered" : null;
    default:
      return null;
  }
}

/**
 * A column's name. "Invoiced" is only true for a company whose orders are
 * invoiced the moment they are confirmed (`money_invoice_orders`); anywhere
 * else the same column is "Confirmed".
 */
export function columnLabel(c: BoardColumn, invoices: boolean): string {
  switch (c) {
    case "purchase_orders":
      return "Purchase orders";
    case "invoiced":
      return invoices ? "Invoiced" : "Confirmed";
    case "packed":
      return "Packed";
    case "dispatched":
      return "Dispatched";
    case "delivered":
      return "Delivered";
  }
}

/** What an empty column says: how a card gets there, not just "nothing here". */
export function columnEmptyText(c: BoardColumn, invoices: boolean): string {
  switch (c) {
    case "purchase_orders":
      return "New orders from the phones, or keyed here, wait here.";
    case "invoiced":
      return invoices
        ? "Drag a purchase order here to reserve its stock and issue its invoice."
        : "Drag a purchase order here to confirm it and reserve its stock.";
    case "packed":
      return "Drag an order here once its box is packed.";
    case "dispatched":
      return "Drag a packed order here when it leaves on a vehicle.";
    case "delivered":
      return "Drag a dispatched order here when it arrives. With its signed POD it goes straight to the archive.";
  }
}

/** The next step for a card's own button, so the board works without dragging. */
export function nextStepOf(o: Pick<BoardFacts, "status" | "podStatus">): BoardStep | null {
  switch (o.status) {
    case "new":
      return "confirm";
    case "confirmed":
    case "picking":
      return "pack";
    case "packed":
      return "dispatch";
    case "dispatched":
      return "deliver";
    case "delivered":
      return o.podStatus === "outstanding" ? "pod" : null;
    default:
      return null;
  }
}

/** The card button and the dialog's main button, as a verb. */
export function stepLabel(step: BoardStep, invoices: boolean): string {
  switch (step) {
    case "confirm":
      return invoices ? "Confirm and invoice" : "Confirm";
    case "pack":
      return "Mark packed";
    case "dispatch":
      return "Dispatch";
    case "deliver":
      return "Record delivery";
    case "pod":
      return "Upload POD";
    case "failed":
      return "It did not arrive";
  }
}

/** The step a forward move into each column is. */
const STEP_INTO: Record<Exclude<BoardColumn, "purchase_orders">, BoardStep> = {
  invoiced: "confirm",
  packed: "pack",
  dispatched: "dispatch",
  delivered: "deliver",
};

/**
 * What dropping an order on a column means.
 *
 * `null` when it was dropped where it already is. Otherwise either the step to
 * open, or a sentence saying why not and what to do instead: a refused drop
 * that only snaps back teaches nobody anything.
 */
export function dropAnswer(
  o: BoardFacts,
  to: BoardColumn,
  invoices: boolean
): { step: BoardStep } | { refuse: string } | null {
  const from = columnOf(o);
  if (from === to) return null;
  const n = o.orderNumber;
  if (from === null) return { refuse: `${n} is finished, so it cannot be moved.` };

  const fromAt = BOARD_COLUMNS.indexOf(from);
  const toAt = BOARD_COLUMNS.indexOf(to);

  if (from === "delivered") {
    return { refuse: `${n} has been delivered. It goes to the archive once its signed POD is uploaded.` };
  }
  if (o.onHold) {
    return { refuse: `${n} is on hold. Open the order and release the hold first.` };
  }
  if (toAt === fromAt + 1) return { step: STEP_INTO[to as keyof typeof STEP_INTO] };
  if (toAt > fromAt + 1) {
    return {
      refuse: `${n} moves one step at a time. Next it goes to ${columnLabel(BOARD_COLUMNS[fromAt + 1], invoices)}.`,
    };
  }
  // Backwards. The one way back the database has is a delivery that did not
  // happen, which brings the stock back onto the shelf.
  if (from === "dispatched" && to === "packed") return { step: "failed" };
  if (from === "dispatched") {
    return { refuse: `${n} is on the road. If it did not arrive, drag it back to Packed.` };
  }
  return {
    refuse: `${n} cannot go back a step from the board. To undo it, open the order and cancel it or put it on hold.`,
  };
}

/**
 * When an order arrived in its board column. The pipeline's own stamp, except
 * for an order being picked: Invoiced holds confirmed and picking orders, so
 * starting the pick must not restart the clock on a week-old order.
 */
export function boardSince(o: { status: string; enteredAt: string; confirmedAt: string | null }): string {
  return o.status === "picking" ? (o.confirmedAt ?? o.enteredAt) : o.enteredAt;
}

/**
 * The calendar day a moment falls on in the company's time zone, as YYYY-MM-DD.
 *
 * The company's day, not the browser's: a delivery at 00:30 in Gaborone is the
 * 1st there, whatever clock the manager's laptop is set to.
 */
export function dayInZone(at: string | number | Date, timeZone: string): string {
  const d = at instanceof Date ? at : new Date(at);
  try {
    // en-CA writes dates as YYYY-MM-DD.
    return d.toLocaleDateString("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    // An unknown zone name: the browser's own day rather than nothing.
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  }
}

/**
 * Calendar days from one YYYY-MM-DD day to another: yesterday afternoon is 1,
 * whatever the hour now. Counting 24-hour blocks instead called a delivery made
 * at 16:00 yesterday "today" when the board was read at 08:00.
 */
export function daysBetween(fromDay: string, toDay: string): number {
  const ms = Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : 0;
}

/**
 * Days an order has waited, coloured with the pipeline's own bands (lib/order-pipeline.ts
 * `waitBand`): amber from 3 days, red over a week. One rule, so the board and the
 * Orders pipeline page never disagree about which orders are late.
 */
export function waitTone(days: number): "calm" | "amber" | "red" {
  const band = waitBand(days);
  if (band === "over_week") return "red";
  if (band === "three_seven") return "amber";
  return "calm";
}

/** "Arrived here today", "Waiting 3 days"; for a delivery, "Delivered yesterday". */
export function waitWords(days: number, delivered: boolean): string {
  if (delivered) {
    if (days === 0) return "Delivered today";
    return days === 1 ? "Delivered yesterday" : `Delivered ${days} days ago`;
  }
  if (days === 0) return "Arrived here today";
  return days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
}

/**
 * Whether confirming this company's orders issues an invoice: the setting AND
 * the invoicing module, which is what the database's `order_invoices_on()`
 * checks. Reading the setting alone said "Invoiced" for a company whose
 * invoicing had been switched off.
 */
export function invoicesOnConfirm(
  config: { settings: { money_invoice_orders: boolean }; modules: ModuleSet } | null
): boolean {
  return !!config && config.settings.money_invoice_orders && moduleEnabled(config.modules, "invoicing");
}

/**
 * Whether this company keeps stock: confirming reserves it, and picking,
 * packing, dispatching, holds and the stock-aware cancel are open to it.
 * True while the config is loading, so a company that keeps stock never sees
 * its buttons flicker away and back.
 */
export function keepsStock(config: { modules: ModuleSet } | null): boolean {
  return config ? moduleEnabled(config.modules, "warehouse") : true;
}

/**
 * Whether this company sends its orders out: dispatch, drivers, delivery on
 * the phone and its proof (the Deliveries module, in every distributor's plan
 * since 29 Oct 2026). True while the config is loading, as `keepsStock` is.
 */
export function deliversOrders(config: { modules: ModuleSet } | null): boolean {
  return config ? moduleEnabled(config.modules, "deliveries") : true;
}

/**
 * A company with orders and invoicing but no Stock control: a new order is
 * invoiced at the quantities ordered with no stock reserved or moved
 * (`order_invoice_without_stock`). With Deliveries it is then confirmed and
 * sent out (`sentWithoutStock`); without, it is finished in one step. Cancelled
 * by `order_cancel_without_stock`. False while the config is loading, so no
 * button is offered that the database might refuse.
 */
export function invoicesWithoutStock(config: { modules: ModuleSet } | null): boolean {
  return (
    !!config &&
    !keepsStock(config) &&
    moduleEnabled(config.modules, "distribution") &&
    moduleEnabled(config.modules, "invoicing")
  );
}

/**
 * An order finished by `order_invoice_without_stock`: delivered without ever
 * being dispatched, from no location. Read from the order itself, not from
 * the company's modules, so an order that went through the warehouse keeps
 * its stock figures after the company drops the add-on.
 */
export function finishedWithoutStock(o: {
  status: string;
  dispatched_at: string | null;
  fulfil_location_id: string | null;
}): boolean {
  return o.status === "delivered" && o.dispatched_at === null && o.fulfil_location_id === null;
}

/**
 * An order invoiced without stock and sent out from there: no location, past
 * new, not finished in one step. It goes confirmed -> dispatched -> delivered,
 * with no picking, packing or stock figures. Read from the order, like
 * `finishedWithoutStock`.
 */
export function sentWithoutStock(o: {
  status: string;
  dispatched_at: string | null;
  fulfil_location_id: string | null;
}): boolean {
  return (
    o.fulfil_location_id === null &&
    ["confirmed", "dispatched", "delivered"].includes(o.status) &&
    !finishedWithoutStock(o)
  );
}

/** An order's state in words for a sentence: "It is now being picked." */
export function statusWords(status: string, invoices: boolean): string {
  switch (status) {
    case "new":
      return "a purchase order";
    case "confirmed":
      return invoices ? "invoiced" : "confirmed";
    case "picking":
      return "being picked";
    case "packed":
      return "packed";
    case "dispatched":
      return "on the road";
    case "delivered":
      return "delivered";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

/** The fulfilment-docs bucket's limits (20260802170420_create_fulfilment_docs_bucket.sql). */
export const POD_MAX_BYTES = 15 * 1024 * 1024;
export const POD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/**
 * Why storage would refuse this file, or null when it will take it.
 *
 * Asked before a delivery is recorded, so a file that was never going to be
 * filed stops the dialog rather than leaving the order delivered with its POD
 * still outstanding. The type is the one the browser reports, which is what the
 * upload sends; an empty one goes up as "octet-stream" and is refused.
 */
export function podFileProblem(file: { size: number; type: string }): string | null {
  if (file.size > POD_MAX_BYTES) return "That file is bigger than 15 MB. Take a smaller photo, or scan it at a lower setting.";
  if (!POD_TYPES.includes(file.type)) return "That kind of file cannot be filed. Choose a PDF or a photo (JPEG, PNG, WebP or HEIC).";
  return null;
}

/**
 * Links that used to filter the orders list, read for the board.
 *
 * The warehouse dashboard's tiles send `?status=new`, `?status=confirmed`,
 * `?status=packed` and `?pod=outstanding`; a link can name several statuses
 * joined by commas. The statuses are read with the same parser the dashboard's
 * links are tested against (`orderStatusesFromQuery`), so a name the app does
 * not know is dropped rather than trusted. On the board each status lights up
 * its column, and "open" (everything not yet delivered) is the whole board.
 * Delivered and cancelled orders are not on the board at all, so a link asking
 * for only those goes to the archive instead (`archive`).
 */
export function boardViewFromQuery(q: URLSearchParams): {
  columns: BoardColumn[];
  archive: string | null;
} {
  const raw = q.get("status");
  const asked = raw === "open" ? [] : (orderStatusesFromQuery(raw, ORDER_STATUSES) ?? []);
  const columns = new Set<BoardColumn>();
  for (const s of asked) {
    const c = s === "delivered" ? null : columnOf({ status: s, podStatus: null });
    if (c) columns.add(c);
  }
  if (q.get("pod") === "outstanding") columns.add("delivered");

  let archive: string | null = null;
  if (asked.length > 0 && columns.size === 0) {
    archive = asked.includes("delivered") ? "/orders/archive" : "/orders/archive?show=cancelled";
  }
  const search = q.get("q");
  if (archive && search) archive += `${archive.includes("?") ? "&" : "?"}q=${encodeURIComponent(search)}`;

  return { columns: BOARD_COLUMNS.filter((c) => columns.has(c)), archive };
}

/**
 * Whether a card matches the board's search box: order, invoice, store, contact
 * or the customer's PO number, which is what a chain quotes when it rings.
 */
export function matchesSearch(
  o: {
    orderNumber: string;
    invoiceNumber: string | null;
    storeName: string | null;
    contactName: string | null;
    customerPoNumber?: string | null;
  },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [o.orderNumber, o.invoiceNumber, o.storeName, o.contactName, o.customerPoNumber].some((v) =>
    (v ?? "").toLowerCase().includes(q)
  );
}

/**
 * How close the customer's purchase order is to lapsing. A chain refuses a
 * delivery once its PO has expired (Choppies, 20 Oct 2026), so the last two
 * days are amber and a lapsed PO is red. `expiresOn` and `today` are
 * YYYY-MM-DD in the company's time zone; `day` is the expiry as people say it.
 */
export function poExpiry(expiresOn: string, today: string, day: string): { tone: "calm" | "amber" | "red"; words: string } {
  if (expiresOn < today) return { tone: "red", words: `PO expired on ${day}` };
  const left = daysBetween(today, expiresOn);
  if (left === 0) return { tone: "amber", words: "PO expires today" };
  if (left === 1) return { tone: "amber", words: "PO expires tomorrow" };
  if (left === 2) return { tone: "amber", words: `PO expires in 2 days, on ${day}` };
  return { tone: "calm", words: `PO valid until ${day}` };
}
