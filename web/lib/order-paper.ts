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
 * one order or a ticked batch of them as one PDF. A ticked batch can also
 * print as one combined picking list, every product added up across the
 * orders, so the warehouse picks them all from a page or two.
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

/** Who picked the goods and who checked them, at the foot of every picking list. */
const PICKED_AND_CHECKED: PdfSpec["signOff"] = {
  title: "Picked and checked",
  rows: [
    {
      height: 46,
      boxes: [{ label: "Picked by (name and signature)" }, { label: "Checked by (name and signature)" }],
    },
  ],
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
    signOff: PICKED_AND_CHECKED,
  };
}

// ------------------------------------------------- combined picking list

export type CombinedPickingInput = {
  /** The ticked orders in the board's order, each with what is reserved for it. */
  orders: {
    order: Pick<OrderRow, "order_number" | "notes">;
    storeName: string | null;
    rows: PickingRow[];
  }[];
  skus: ReadonlyMap<string, string>;
};

/** One product batch at one place, with how much of it every ticked order together needs. */
export type CombinedPick = Pick<
  PickingRow,
  "product_id" | "product_name" | "brand" | "unit_barcode" | "batch_number" | "expiry_date" | "location_name"
> & { qty_to_pick: number; orders: number };

const byText = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0;

/** What is left to take of a batch: an order part-picked already has some of it in hand. */
const stillToPick = (r: Pick<PickingRow, "qty_to_pick" | "qty_picked">) => Number(r.qty_to_pick) - Number(r.qty_picked ?? 0);

/**
 * The orders' picking rows added together: one row per product, batch and
 * place, counting how many orders want it. Only what is still to pick
 * counts, so an order part-picked before it was ticked is not taken twice. Sorted by place, then product,
 * then oldest stock first, so the picker finds a product once on the sheet
 * and still takes the batch each order was given.
 */
export function combinePicks(orders: readonly { rows: readonly PickingRow[] }[]): CombinedPick[] {
  const out = new Map<string, CombinedPick & { from: Set<number> }>();
  orders.forEach(({ rows }, i) => {
    for (const r of rows) {
      const left = stillToPick(r);
      if (left <= 0) continue;
      const key = [r.location_name ?? "", r.product_id, r.batch_id ?? ""].join("|");
      const row = out.get(key) ?? {
        product_id: r.product_id,
        product_name: r.product_name,
        brand: r.brand,
        unit_barcode: r.unit_barcode,
        batch_number: r.batch_number,
        expiry_date: r.expiry_date,
        location_name: r.location_name,
        qty_to_pick: 0,
        orders: 0,
        from: new Set<number>(),
      };
      row.qty_to_pick += left;
      row.from.add(i);
      out.set(key, row);
    }
  });
  return [...out.values()]
    .map(({ from, ...row }) => ({ ...row, orders: from.size }))
    .sort(
      (a, b) =>
        byText(a.location_name, b.location_name) ||
        a.product_name.localeCompare(b.product_name) ||
        byText(a.brand, b.brand) ||
        byText(a.expiry_date, b.expiry_date) ||
        byText(a.batch_number, b.batch_number)
    );
}

/**
 * Order numbers as a short list: sorted, with a run of three or more in a
 * row written "SO-000353 to SO-000416", so a column of orders ticked
 * together takes a line or two at the top of the sheet rather than half of it.
 */
export function orderNumberRuns(numbers: readonly string[]): string {
  const parts = numbers.map((n) => {
    const m = /^(.*?)(\d+)$/.exec(n);
    return m ? { n, prefix: m[1], width: m[2].length, value: Number(m[2]) } : { n, prefix: n, width: 0, value: NaN };
  });
  parts.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.value - b.value || a.n.localeCompare(b.n));
  const runs: (typeof parts)[] = [];
  for (const p of parts) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (last && last.prefix === p.prefix && last.width === p.width && p.value === last.value + 1) run.push(p);
    else runs.push([p]);
  }
  return runs
    .flatMap((run) => (run.length >= 3 ? [`${run[0].n} to ${run[run.length - 1].n}`] : run.map((p) => p.n)))
    .join(", ");
}

/**
 * Several orders' picking lists as one sheet, so the warehouse walks the
 * shelves once: every product added up across the orders, how many orders
 * it goes to, and a box to tick. The orders it covers are named at the top
 * (`orderNumberRuns`), and their notes for the picker under the lines. An
 * order with nothing reserved yet, or picked already, is left off and named
 * in the notes, rather than stopping the whole sheet. Sorting the picked stock into each order is
 * done on its own picking screen.
 */
export function combinedPickingListPdfSpec(input: CombinedPickingInput, seller: QuoteSeller, paper: Paper): PdfSpec {
  const ready = input.orders.filter((o) => o.rows.some((r) => stillToPick(r) > 0));
  const waiting = input.orders.filter((o) => o.rows.length === 0);
  const done = input.orders.filter((o) => o.rows.length > 0 && !ready.includes(o));
  if (ready.length === 0) {
    throw new Error(
      done.length > 0
        ? "Everything on these orders has been picked already. Pack them from each order's picking list."
        : "Nothing is reserved for these orders, so there is nothing to pick yet. Confirm them first."
    );
  }
  const picks = combinePicks(ready);
  const places = [...new Set(picks.map((p) => p.location_name).filter(Boolean))];
  // One warehouse is named at the top; a column for it only when the stock is in more than one.
  const showPlace = places.length > 1;
  const count = ready.length === 1 ? "1 order" : `${ready.length} orders`;
  const meta: [string, string][] = [];
  if (places.length > 0) meta.push(["Pick from", places.join(", ")]);
  meta.push(["Printed", paperDate(paper.today)]);
  const notes: string[] = [];
  if (waiting.length > 0) {
    notes.push(
      `Not on this list, because nothing is reserved for ${waiting.length === 1 ? "it" : "them"} yet: ` +
        `${waiting.map((o) => o.order.order_number).join(", ")}.`
    );
  }
  if (done.length > 0) {
    notes.push(`Already picked, so not on this list: ${done.map((o) => o.order.order_number).join(", ")}.`);
  }
  for (const o of ready) {
    const note = o.order.notes?.trim();
    if (note) notes.push(`${o.order.order_number}${o.storeName ? ` (${o.storeName})` : ""}: ${note}`);
  }
  const units = picks.reduce((n, p) => n + p.qty_to_pick, 0);
  return {
    heading: "PICKING LIST",
    fileName: `Combined picking list (${count})`,
    seller: letterhead(seller),
    metaTitle: "Picking details",
    meta,
    billTo: {
      label: "Orders on this list",
      name: `Combined list for ${count}`,
      address: orderNumberRuns(ready.map((o) => o.order.order_number)),
    },
    head: ["Product", "Barcode / SKU", "Batch", "Expiry", ...(showPlace ? ["Location"] : []), "Orders", "To pick", "Picked"],
    rows: picks.map((p) => [
      productLabel(p.product_name, p.brand),
      [p.unit_barcode, input.skus.get(p.product_id)].filter(Boolean).join("\n"),
      p.batch_number ?? "Not batch-tracked",
      p.expiry_date ? paperDate(p.expiry_date) : "",
      ...(showPlace ? [p.location_name ?? ""] : []),
      String(p.orders),
      formatQty(p.qty_to_pick),
      "",
    ]),
    numeric: showPlace ? [5, 6] : [4, 5],
    boxes: [showPlace ? 7 : 6],
    numbered: true,
    totals: [["Units to pick", formatQty(units)]],
    notesTitle: "Notes for the picker",
    notes,
    signOff: PICKED_AND_CHECKED,
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

/** Product codes for these products, by id; read 100 at a time, as a combined picking list can name hundreds. */
async function fetchSkus(supabase: Client, productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("products").select("id, sku_code").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const p of data ?? []) if (p.sku_code?.trim()) out.set(p.id, p.sku_code.trim());
  }
  return out;
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

/** The most orders one combined picking list reads: each is a request of its own, and more keeps the tab waiting. */
export const COMBINE_AT_ONCE = 200;

type OrderBits = { id: string; order_number: string; notes: string | null; stores: { name: string } | { name: string }[] | null };

/** These orders' numbers, notes and customers, by id; read 100 at a time. */
async function fetchOrderBits(supabase: Client, orderIds: string[]): Promise<Map<string, OrderBits>> {
  const out = new Map<string, OrderBits>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, notes, stores(name)")
      .in("id", orderIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as unknown as OrderBits[]) out.set(o.id, o);
  }
  return out;
}

/** Print these orders' picking lists added up on one sheet: a new tab with it and the print box. */
export function printCombinedPickingList(supabase: Client, orderIds: string[]) {
  return printMoneyPdf(async () => {
    if (orderIds.length > COMBINE_AT_ONCE) {
      throw new Error(`That is ${orderIds.length} orders. Combine up to ${COMBINE_AT_ONCE} at a time: untick some, or filter the board.`);
    }
    const [seller, { paper }, bits, rows] = await Promise.all([
      fetchQuoteSeller(supabase),
      companyPaper(),
      fetchOrderBits(supabase, orderIds),
      inGroups(orderIds, 4, (id) => fetchPickingList(supabase, id)),
    ]);
    const orders = orderIds.flatMap((id, i) => {
      const o = bits.get(id);
      if (!o) return [];
      const store = Array.isArray(o.stores) ? o.stores[0] : o.stores;
      return [{ order: { order_number: o.order_number, notes: o.notes }, storeName: store?.name ?? null, rows: rows[i] }];
    });
    const skus = await fetchSkus(supabase, orders.flatMap((o) => o.rows.map((r) => r.product_id)));
    return combinedPickingListPdfSpec({ orders, skus }, seller, paper);
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
