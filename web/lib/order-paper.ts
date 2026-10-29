import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { paperDate, printMoneyPdf, type Paper, type PdfBatch, type PdfSeller, type PdfSpec } from "@/lib/money-pdf";
import { fetchOrderDetail, fetchPickingList, type OrderDetail, type OrderRow, type PickingRow } from "@/lib/orders";
import { fetchQuoteSeller, type QuoteSeller } from "@/lib/quotes";
import { customerPoText } from "@/lib/invoices";
import { formatQty } from "@/lib/money-docs";
import { todayIn } from "@/lib/client-document";

/**
 * The warehouse's paperwork for an order: the picking list the picker walks
 * the shelves with, and the delivery note that goes with the goods and comes
 * back signed. Both are drawn on the invoice's letterhead, in the company's
 * look (`lib/money-pdf.ts`), so what the customer signs reads as the same
 * company's paper as the invoice they pay.
 *
 * The specs are pure, so the tests pin what each sheet says; the print
 * functions at the bottom read the orders and hand the specs to the drawer,
 * one order or a ticked batch of them as one PDF.
 */

type Client = SupabaseClient<Database>;

/** The company's name, numbers and current logo at the top of the sheet, as on a quote. */
export function letterhead(c: QuoteSeller): PdfSeller {
  return {
    name: c.legal_name || c.name,
    address: c.address,
    registrationNumber: c.registration_number,
    taxNumber: c.tax_number,
    vatNumber: c.vat_number,
    phone: c.phone,
    email: c.support_email,
    logoPath: c.logo_path,
  };
}

/** The customer's own address with its town, as the order's invoice writes it. */
export function storeAddressLine(store: { address: string | null; city: string | null } | null): string | null {
  return [store?.address, store?.city].map((v) => v?.trim()).filter(Boolean).join(", ") || null;
}

/** Where the goods go: the address on the order, or the customer's own when the order names none. */
export function deliveryAddress(order: Pick<OrderRow, "delivery_address">, storeAddress: string | null): string | null {
  return order.delivery_address?.trim() || storeAddress?.trim() || null;
}

const productLabel = (name: string, brand: string | null | undefined) => (brand ? `${name} — ${brand}` : name);

/** Which sheet an order prints at its stage: the picking list until it is packed, then the delivery note. */
export function sheetFor(status: string): "picking" | "delivery" | null {
  if (status === "confirmed" || status === "picking") return "picking";
  if (status === "packed" || status === "dispatched" || status === "delivered") return "delivery";
  return null;
}

/** Ticked orders split by the sheet each prints, in the order given; one with nothing to print is left out. */
export function sheetsFor<T extends { id: string; status: string }>(orders: T[]): { picking: string[]; delivery: string[] } {
  const out = { picking: [] as string[], delivery: [] as string[] };
  for (const o of orders) {
    const sheet = sheetFor(o.status);
    if (sheet) out[sheet].push(o.id);
  }
  return out;
}

// ---------------------------------------------------------- picking list

export type PickingSheetInput = {
  order: Pick<OrderRow, "order_number" | "invoice_number" | "required_by" | "notes" | "delivery_address">;
  storeName: string | null;
  storeAddress: string | null;
  /** The warehouse the stock was reserved at. */
  fulfilLocationName: string | null;
  /** As `order_picking_list` returns them: oldest stock first, the order the shelves are walked in. */
  rows: PickingRow[];
  /** Product codes by product id; a product without one is left out. */
  skus: ReadonlyMap<string, string>;
};

/**
 * The picking list on paper: one row per batch to take, in the order the
 * screen lists them, each with an empty box for the picker to tick or write
 * what they took, and boxes for who picked it and who checked it.
 */
export function pickingListPdfSpec(input: PickingSheetInput, seller: QuoteSeller, paper: Paper): PdfSpec {
  const o = input.order;
  const meta: [string, string][] = [["Order no.", o.order_number]];
  if (o.invoice_number) meta.push(["Invoice no.", o.invoice_number]);
  if (o.required_by) meta.push(["Required by", paperDate(o.required_by)]);
  if (input.fulfilLocationName) meta.push(["Pick from", input.fulfilLocationName]);
  meta.push(["Printed", paperDate(paper.today)]);
  const units = input.rows.reduce((n, r) => n + Number(r.qty_to_pick), 0);
  return {
    heading: "PICKING LIST",
    fileName: `Picking list ${o.order_number}`,
    seller: letterhead(seller),
    metaTitle: "Order details",
    meta,
    billTo: {
      label: "Deliver to",
      name: input.storeName ?? "",
      address: deliveryAddress(o, input.storeAddress),
    },
    head: ["Product", "Barcode / SKU", "Batch", "Expiry", "Location", "To pick", "Picked"],
    rows: input.rows.map((r) => [
      productLabel(r.product_name, r.brand),
      [r.unit_barcode, input.skus.get(r.product_id)].filter(Boolean).join("\n"),
      r.batch_number ?? "Not batch-tracked",
      r.expiry_date ? paperDate(r.expiry_date) : "",
      r.location_name ?? "",
      formatQty(Number(r.qty_to_pick)),
      "",
    ]),
    numeric: [5],
    boxes: [6],
    numbered: true,
    totals: [["Units to pick", formatQty(units)]],
    notesTitle: "Notes for the picker",
    notes: o.notes?.trim() ? [o.notes.trim()] : [],
    signOff: {
      title: "Picked and checked",
      rows: [
        {
          height: 46,
          boxes: [{ label: "Picked by (name and signature)" }, { label: "Checked by (name and signature)" }],
        },
      ],
    },
  };
}

// --------------------------------------------------------- delivery note

type Dispatch = OrderDetail["dispatches"][number];

/**
 * The dispatch a delivery note is for: the one on the road, or the one that
 * was delivered. None while the order is packed, and none from an earlier
 * attempt that came back: its number and driver are not this delivery's.
 */
export function noteDispatch(status: string, dispatches: readonly Dispatch[]): Dispatch | null {
  const wanted = status === "dispatched" ? "in_transit" : status === "delivered" ? "delivered" : null;
  if (!wanted) return null;
  const matches = dispatches.filter((d) => d.status === wanted);
  return matches.reduce<Dispatch | null>((newest, d) => (!newest || d.dispatched_at > newest.dispatched_at ? d : newest), null);
}

type NoteLine = Pick<
  OrderDetail["lines"][number],
  "id" | "product_id" | "product_name" | "brand" | "line_status" | "qty_ordered" | "qty_picked" | "qty_dispatched"
>;

/** The lines in the order the invoice lists them: by product, then as they were added. */
export function noteLineOrder(a: NoteLine, b: NoteLine): number {
  return a.product_name.localeCompare(b.product_name) || a.id.localeCompare(b.id);
}

/** How many of a line are going: what was packed, and once it has left, what was dispatched. */
export function sentQty(status: string, line: Pick<NoteLine, "qty_picked" | "qty_dispatched">): number {
  return Number(status === "dispatched" || status === "delivered" ? line.qty_dispatched : line.qty_picked);
}

export type DeliveryNoteInput = {
  order: Pick<
    OrderRow,
    "order_number" | "invoice_number" | "status" | "customer_po_number" | "customer_po_date" | "delivery_address" | "contact_name" | "contact_phone"
  >;
  storeName: string | null;
  storeAddress: string | null;
  /** In the order to print them (`noteLineOrder`). */
  lines: NoteLine[];
  /** From `noteDispatch`. */
  dispatch: Dispatch | null;
  /** The day the goods left, on the company's clock; null before they have. */
  dispatchedOn: string | null;
  skus: ReadonlyMap<string, string>;
};

/**
 * The delivery note: who the goods are for and where they go, the order's
 * numbers and, once it has left, the dispatch's number, driver and vehicle;
 * the lines with what was ordered and what was sent, and no prices. At the
 * foot, boxes for the customer to print their name, sign, date and stamp:
 * the signed note is the proof of delivery the driver photographs.
 */
export function deliveryNotePdfSpec(input: DeliveryNoteInput, seller: QuoteSeller, paper: Paper): PdfSpec {
  const o = input.order;
  const d = input.dispatch;
  const meta: [string, string][] = [];
  if (d) meta.push(["Delivery note no.", d.dispatch_number]);
  meta.push(["Order no.", o.order_number]);
  if (o.invoice_number) meta.push(["Invoice no.", o.invoice_number]);
  const po = customerPoText(o, paperDate);
  if (po) meta.push(["Your PO", po]);
  meta.push(["Date", paperDate(input.dispatchedOn ?? paper.today)]);
  if (d) {
    // The driver on the dispatch; failing that, whoever the delivery was given to in the app.
    if (d.driver_name) meta.push(["Driver", d.driver_name]);
    else if (d.assigned_rep_name) meta.push(["Delivered by", d.assigned_rep_name]);
    if (d.vehicle_registration) meta.push(["Vehicle", d.vehicle_registration]);
    if (d.carrier_name) meta.push(["Carrier", d.carrier_name]);
    if (d.tracking_reference) meta.push(["Tracking no.", d.tracking_reference]);
  }
  const contact = [o.contact_name, o.contact_phone].map((v) => v?.trim()).filter(Boolean).join("\n");
  // A cancelled line is off the invoice too; on the note it would read as goods the driver forgot.
  const lines = input.lines.filter((l) => l.line_status !== "cancelled");
  const coded = lines.some((l) => input.skus.has(l.product_id));
  const sent = lines.map((l) => sentQty(o.status, l));
  return {
    heading: "DELIVERY NOTE",
    fileName: `Delivery note ${d ? d.dispatch_number : o.order_number}`,
    seller: letterhead(seller),
    metaTitle: "Delivery details",
    meta,
    billTo: {
      label: "Deliver to",
      name: input.storeName ?? "",
      address: deliveryAddress(o, input.storeAddress),
    },
    shipTo: contact ? { label: "Contact", address: contact } : null,
    head: [...(coded ? ["Code"] : []), "Product", "Ordered", "Sent"],
    rows: lines.map((l, i) => [
      ...(coded ? [input.skus.get(l.product_id) ?? ""] : []),
      productLabel(l.product_name, l.brand),
      formatQty(Number(l.qty_ordered)),
      formatQty(sent[i]),
    ]),
    numeric: coded ? [2, 3] : [1, 2],
    strong: coded ? [0] : [],
    numbered: true,
    totals: [["Units sent", formatQty(sent.reduce((n, v) => n + v, 0))]],
    signOff: {
      title: "Received in good order",
      text:
        "Please check the goods against this note before you sign. Print your name, sign, date and stamp below. " +
        "This signed note is our proof of delivery (POD): the driver photographs it, or we scan it, and we keep it with your order.",
      // One row, so a short note keeps its sign-off on the first page in every look.
      rows: [
        {
          height: 72,
          boxes: [
            { label: "Name (print)", share: 3 },
            { label: "Signature", share: 3 },
            { label: "Date", share: 2 },
            { label: "Stamp", share: 3 },
          ],
        },
      ],
    },
  };
}

// ----------------------------------------------------------------- print

/** Product codes for these products, by id. */
async function fetchSkus(supabase: Client, productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("products").select("id, sku_code").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).filter((p) => p.sku_code?.trim()).map((p) => [p.id, (p.sku_code as string).trim()]));
}

/** The customer's address with its town (the order's own read leaves the town out). */
async function fetchStoreAddress(supabase: Client, storeId: string): Promise<string | null> {
  const { data, error } = await supabase.from("stores").select("address, city").eq("id", storeId).maybeSingle();
  if (error) throw new Error(error.message);
  return storeAddressLine(data);
}

/** The company's currency and today, and its timezone for the day a dispatch left. */
async function companyPaper(): Promise<{ paper: Paper; timeZone: string }> {
  const [{ loadPaper }, { getCompanyConfig }] = await Promise.all([import("@/lib/document-look"), import("@/lib/use-company-config")]);
  const [paper, config] = await Promise.all([loadPaper(), getCompanyConfig().catch(() => null)]);
  return { paper, timeZone: config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** `fn` over the items a few at a time, answers in the items' order: a batch of orders reads without flooding the API. */
async function inGroups<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** One order's picking list, read from the database. */
async function pickingListFor(supabase: Client, orderId: string, seller: QuoteSeller, paper: Paper): Promise<PdfSpec> {
  const [detail, rows] = await Promise.all([fetchOrderDetail(supabase, orderId), fetchPickingList(supabase, orderId)]);
  if (rows.length === 0) {
    throw new Error(`Nothing is reserved for ${detail.order.order_number}, so there is nothing to pick yet. Confirm it first.`);
  }
  const [skus, storeAddress] = await Promise.all([
    fetchSkus(supabase, rows.map((r) => r.product_id)),
    fetchStoreAddress(supabase, detail.order.store_id),
  ]);
  return pickingListPdfSpec(
    {
      order: detail.order,
      storeName: detail.storeName,
      storeAddress,
      fulfilLocationName: detail.fulfilLocationName,
      rows,
      skus,
    },
    seller,
    paper
  );
}

/** One order's delivery note, read from the database. */
async function deliveryNoteFor(supabase: Client, orderId: string, seller: QuoteSeller, paper: Paper, timeZone: string): Promise<PdfSpec> {
  const detail = await fetchOrderDetail(supabase, orderId);
  const dispatch = noteDispatch(detail.order.status, detail.dispatches);
  const [skus, storeAddress] = await Promise.all([
    fetchSkus(supabase, detail.lines.map((l) => l.product_id)),
    fetchStoreAddress(supabase, detail.order.store_id),
  ]);
  return deliveryNotePdfSpec(
    {
      order: detail.order,
      storeName: detail.storeName,
      storeAddress,
      lines: [...detail.lines].sort(noteLineOrder),
      dispatch,
      dispatchedOn: dispatch ? todayIn(timeZone, new Date(dispatch.dispatched_at)) : null,
      skus,
    },
    seller,
    paper
  );
}

/** One sheet as itself; several as one PDF, named for what is in it. */
const asBatch = (specs: PdfSpec[], many: string): PdfSpec | PdfBatch =>
  specs.length === 1 ? specs[0] : { title: `${many} (${specs.length})`, specs };

/** Print these orders' picking lists, in this order: a new tab with the sheets and the print box. */
export function printPickingLists(supabase: Client, orderIds: string[]) {
  return printMoneyPdf(async () => {
    const [seller, { paper }] = await Promise.all([fetchQuoteSeller(supabase), companyPaper()]);
    const specs = await inGroups(orderIds, 4, (id) => pickingListFor(supabase, id, seller, paper));
    return asBatch(specs, "Picking lists");
  });
}

/** Print these orders' delivery notes, in this order: a new tab with the notes and the print box. */
export function printDeliveryNotes(supabase: Client, orderIds: string[]) {
  return printMoneyPdf(async () => {
    const [seller, { paper, timeZone }] = await Promise.all([fetchQuoteSeller(supabase), companyPaper()]);
    const specs = await inGroups(orderIds, 4, (id) => deliveryNoteFor(supabase, id, seller, paper, timeZone));
    return asBatch(specs, "Delivery notes");
  });
}

/** Print one order's picking list. */
export const printPickingList = (supabase: Client, orderId: string) => printPickingLists(supabase, [orderId]);

/** Print one order's delivery note. */
export const printDeliveryNote = (supabase: Client, orderId: string) => printDeliveryNotes(supabase, [orderId]);
