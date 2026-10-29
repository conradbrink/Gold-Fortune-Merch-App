// The warehouse's paperwork (owner, 29 Oct: a warehouse manager prints at
// each step): the picking list, the delivery note the customer signs as proof
// of delivery, and the invoice's Print button, all on the invoice's letterhead.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMoneyPdf, buildMoneyPdfs, PRINT_AT_ONCE, tooManyToPrint } from "@/lib/money-pdf";
import { DOCUMENT_STYLES, type DocumentStyle } from "@/lib/document-style";
import {
  deliveryAddress,
  deliveryNotePdfSpec,
  letterhead,
  noteDispatch,
  noteLineOrder,
  pickingListPdfSpec,
  sentQty,
  sheetFor,
  sheetsFor,
  storeAddressLine,
  type DeliveryNoteInput,
  type PickingSheetInput,
} from "@/lib/order-paper";
import type { PickingRow } from "@/lib/orders";
import { permissionForPath } from "@/lib/permissions";
import type { QuoteSeller } from "@/lib/quotes";

const seller: QuoteSeller = {
  name: "Acme",
  legal_name: "Acme Distribution (Pty) Ltd",
  address: "1 Main Road\nBloemfontein",
  tax_number: null,
  vat_number: "4123456789",
  registration_number: "2014/000000/07",
  phone: "051 555 0142",
  support_email: "orders@acme.example",
  logo_path: "org/logo.png",
  bank_details: "Bank: First\nAccount 123",
};
const paper = { currency: "ZAR", today: "2026-10-29" };

const pick = (over: Partial<PickingRow>): PickingRow => ({
  allocation_id: "a1",
  allocation_status: "reserved",
  batch_id: "b1",
  batch_number: "B-100",
  brand: "Sunny",
  expiry_date: "2027-01-31",
  location_name: "Main warehouse",
  order_line_id: "l1",
  product_id: "p1",
  product_name: "Juice 1L",
  qty_picked: 0,
  qty_to_pick: 24,
  unit_barcode: "6001234567890",
  ...over,
});

const sheet: PickingSheetInput = {
  order: {
    order_number: "SO-000301",
    invoice_number: "INV-1957",
    required_by: "2026-10-31",
    notes: "  Pack the juice on top.  ",
    delivery_address: null,
  },
  storeName: "Bloem Corner Tuck Shop",
  storeAddress: "12 Church St, Bloemfontein",
  fulfilLocationName: "Main warehouse",
  rows: [
    pick({}),
    // Not batch-tracked: no batch and no expiry.
    pick({ allocation_id: "a2", product_id: "p2", product_name: "Chips 125g", brand: null as unknown as string, batch_number: null as unknown as string, expiry_date: null as unknown as string, unit_barcode: null as unknown as string, qty_to_pick: 6 }),
  ],
  skus: new Map([
    ["p1", "JUI-1"],
    ["p2", "CHP-125"],
  ]),
};

type Dispatch = NonNullable<DeliveryNoteInput["dispatch"]>;
const dispatch = (over: Partial<Dispatch>): Dispatch => ({
  id: "d1",
  dispatch_number: "DSP-000042",
  status: "in_transit",
  tracking_reference: null,
  carrier_name: null,
  driver_name: "Sipho Dlamini",
  vehicle_registration: "CA 123-456",
  dispatched_at: "2026-10-29T06:30:00Z",
  delivered_at: null,
  received_by_name: null,
  received_signature_path: null,
  assigned_rep_id: null,
  assigned_rep_name: null,
  ...over,
});

const note = (over: Partial<DeliveryNoteInput> = {}): DeliveryNoteInput => ({
  order: {
    order_number: "SO-000301",
    invoice_number: "INV-1957",
    status: "dispatched",
    customer_po_number: "PO-778",
    customer_po_date: "2026-10-27",
    delivery_address: "Back door, 12 Church St",
    contact_name: "Thabo Mokoena",
    contact_phone: "082 555 0101",
  },
  storeName: "Bloem Corner Tuck Shop",
  storeAddress: "12 Church St, Bloemfontein",
  lines: [
    { id: "l1", product_id: "p1", product_name: "Juice 1L", brand: "Sunny", line_status: "open", qty_ordered: 24, qty_picked: 24, qty_dispatched: 24 },
    { id: "l2", product_id: "p2", product_name: "Chips 125g", brand: null, line_status: "open", qty_ordered: 10, qty_picked: 6, qty_dispatched: 6 },
  ],
  dispatch: dispatch({}),
  dispatchedOn: "2026-10-29",
  skus: new Map([["p1", "JUI-1"]]),
  ...over,
});

/** An amount as the paper prints one, "R1,500.00". */
const AMOUNT = /R\d|\d\.\d\d\b/;
const look = (style: DocumentStyle) => ({ style, primary: "#0F3D3E", accent: "#F5A524" });
const text = (doc: { output: (t: "arraybuffer") => ArrayBuffer }) => Buffer.from(doc.output("arraybuffer")).toString("latin1");
/** Words as a PDF string holds them: brackets are escaped. */
const inPdf = (words: string) => words.replace(/[()\\]/g, "\\$&");

test("the picking list carries the order, where it goes, and a row per batch to pick in the screen's order", () => {
  const spec = pickingListPdfSpec(sheet, seller, paper);
  assert.equal(spec.heading, "PICKING LIST");
  assert.deepEqual(spec.meta, [
    ["Order no.", "SO-000301"],
    ["Invoice no.", "INV-1957"],
    ["Required by", "31/10/2026"],
    ["Pick from", "Main warehouse"],
    ["Printed", "29/10/2026"],
  ]);
  // No address on the order: the customer's own.
  assert.deepEqual(spec.billTo, { label: "Deliver to", name: "Bloem Corner Tuck Shop", address: "12 Church St, Bloemfontein" });
  assert.deepEqual(spec.head, ["Product", "Barcode / SKU", "Batch", "Expiry", "Location", "To pick", "Picked"]);
  // Oldest stock first is the database's order; the sheet keeps it.
  assert.deepEqual(spec.rows, [
    ["Juice 1L — Sunny", "6001234567890\nJUI-1", "B-100", "31/01/2027", "Main warehouse", "24", ""],
    ["Chips 125g", "CHP-125", "Not batch-tracked", "", "Main warehouse", "6", ""],
  ]);
  // "Picked" is a box to tick, "To pick" a number.
  assert.deepEqual(spec.boxes, [6]);
  assert.deepEqual(spec.numeric, [5]);
  assert.deepEqual(spec.totals, [["Units to pick", "30"]]);
  assert.equal(spec.notesTitle, "Notes for the picker");
  assert.deepEqual(spec.notes, ["Pack the juice on top."]);
  assert.deepEqual(
    spec.signOff?.rows.flatMap((r) => r.boxes.map((b) => b.label)),
    ["Picked by (name and signature)", "Checked by (name and signature)"]
  );
  // Nothing on a picking list has a price.
  assert.doesNotMatch(JSON.stringify([spec.rows, spec.totals]), AMOUNT);
});

test("a picking list leaves out what the order does not have", () => {
  const spec = pickingListPdfSpec(
    { ...sheet, order: { ...sheet.order, invoice_number: null, required_by: null, notes: "   " }, fulfilLocationName: null },
    seller,
    paper
  );
  assert.deepEqual(spec.meta, [
    ["Order no.", "SO-000301"],
    ["Printed", "29/10/2026"],
  ]);
  assert.deepEqual(spec.notes, []);
});

test("the delivery note: numbers, who it goes to, the driver and vehicle from the dispatch, and no prices", () => {
  const spec = deliveryNotePdfSpec(note(), seller, paper);
  assert.equal(spec.heading, "DELIVERY NOTE");
  assert.equal(spec.fileName, "Delivery note DSP-000042");
  assert.deepEqual(spec.meta, [
    ["Delivery note no.", "DSP-000042"],
    ["Order no.", "SO-000301"],
    ["Invoice no.", "INV-1957"],
    ["Your PO", "PO-778 of 27/10/2026"],
    ["Date", "29/10/2026"],
    ["Driver", "Sipho Dlamini"],
    ["Vehicle", "CA 123-456"],
  ]);
  // The order's own delivery address wins over the customer's.
  assert.deepEqual(spec.billTo, { label: "Deliver to", name: "Bloem Corner Tuck Shop", address: "Back door, 12 Church St" });
  assert.deepEqual(spec.shipTo, { label: "Contact", address: "Thabo Mokoena\n082 555 0101" });
  assert.deepEqual(spec.head, ["Code", "Product", "Ordered", "Sent"]);
  assert.deepEqual(spec.rows, [
    ["JUI-1", "Juice 1L — Sunny", "24", "24"],
    ["", "Chips 125g", "10", "6"],
  ]);
  assert.deepEqual(spec.numeric, [2, 3]);
  assert.deepEqual(spec.totals, [["Units sent", "30"]]);
  assert.doesNotMatch(JSON.stringify([spec.rows, spec.totals]), AMOUNT);
  assert.equal(spec.payTo, undefined);
  assert.equal(spec.status, undefined);
  assert.equal(spec.seller.name, "Acme Distribution (Pty) Ltd");
  assert.equal(spec.seller.logoPath, "org/logo.png");
});

test("the delivery note is worded as the proof of delivery, with room to print a name, sign, date and stamp", () => {
  const s = deliveryNotePdfSpec(note(), seller, paper).signOff;
  assert.ok(s);
  assert.equal(s.title, "Received in good order");
  assert.match(s.text ?? "", /proof of delivery \(POD\)/);
  assert.match(s.text ?? "", /photographs it, or we scan it/);
  assert.deepEqual(
    s.rows.flatMap((r) => r.boxes.map((b) => b.label)),
    ["Name (print)", "Signature", "Date", "Stamp"]
  );
});

test("before it leaves, a delivery note has no dispatch number or driver and counts what was packed", () => {
  const spec = deliveryNotePdfSpec(
    note({ order: { ...note().order, status: "packed", customer_po_number: null }, dispatch: null, dispatchedOn: null, skus: new Map() }),
    seller,
    paper
  );
  assert.equal(spec.fileName, "Delivery note SO-000301");
  assert.deepEqual(spec.meta, [
    ["Order no.", "SO-000301"],
    ["Invoice no.", "INV-1957"],
    ["Date", "29/10/2026"],
  ]);
  // No product codes: no Code column.
  assert.deepEqual(spec.head, ["Product", "Ordered", "Sent"]);
  assert.deepEqual(spec.numeric, [1, 2]);
  assert.deepEqual(spec.rows[1], ["Chips 125g", "10", "6"]);
});

test("a cancelled line is left off the delivery note, as it is off the invoice", () => {
  const base = note();
  const spec = deliveryNotePdfSpec(
    note({ lines: [...base.lines, { ...base.lines[1], id: "l3", product_name: "Gone 1L", line_status: "cancelled", qty_picked: 0, qty_dispatched: 0 }] }),
    seller,
    paper
  );
  assert.equal(spec.rows.length, 2);
  assert.ok(!JSON.stringify(spec.rows).includes("Gone 1L"));
  assert.deepEqual(spec.totals, [["Units sent", "30"]]);
});

test("a delivery given to someone in the app, with no driver on the dispatch, names them; a courier's details print too", () => {
  const spec = deliveryNotePdfSpec(
    note({
      dispatch: dispatch({ driver_name: null, vehicle_registration: null, assigned_rep_name: "Lerato Khumalo", carrier_name: "Courier Guy", tracking_reference: "TCG123" }),
    }),
    seller,
    paper
  );
  const meta = Object.fromEntries(spec.meta);
  assert.equal(meta["Delivered by"], "Lerato Khumalo");
  assert.equal(meta["Driver"], undefined);
  assert.equal(meta["Carrier"], "Courier Guy");
  assert.equal(meta["Tracking no."], "TCG123");
});

test("which dispatch the note is for: the one on the road or delivered, never one that came back", () => {
  const back = dispatch({ id: "old", dispatch_number: "DSP-000040", status: "returned", dispatched_at: "2026-10-27T08:00:00Z" });
  const road = dispatch({ id: "new", dispatch_number: "DSP-000042", status: "in_transit" });
  assert.equal(noteDispatch("dispatched", [back, road])?.dispatch_number, "DSP-000042");
  assert.equal(noteDispatch("packed", [back]), null);
  const done = dispatch({ status: "delivered", dispatch_number: "DSP-000043", dispatched_at: "2026-10-30T07:00:00Z" });
  assert.equal(noteDispatch("delivered", [back, road, done])?.dispatch_number, "DSP-000043");
  // Two delivered (a part delivery, then the rest): the newest.
  const first = dispatch({ status: "delivered", dispatch_number: "DSP-000041", dispatched_at: "2026-10-28T07:00:00Z" });
  assert.equal(noteDispatch("delivered", [first, done])?.dispatch_number, "DSP-000043");
});

test("what a line sends: what was packed, then once it has left, what was dispatched", () => {
  const line = { qty_picked: 6, qty_dispatched: 5 };
  assert.equal(sentQty("packed", line), 6);
  assert.equal(sentQty("dispatched", line), 5);
  assert.equal(sentQty("delivered", line), 5);
});

test("addresses and line order follow the order's invoice", () => {
  assert.equal(storeAddressLine({ address: "12 Church St", city: "Bloemfontein" }), "12 Church St, Bloemfontein");
  assert.equal(storeAddressLine({ address: " ", city: "Bloemfontein" }), "Bloemfontein");
  assert.equal(storeAddressLine(null), null);
  assert.equal(deliveryAddress({ delivery_address: "  " }, "12 Church St"), "12 Church St");
  assert.equal(deliveryAddress({ delivery_address: null }, null), null);
  const line = (id: string, product_name: string) => ({ id, product_id: id, product_name, brand: null, line_status: "open", qty_ordered: 1, qty_picked: 1, qty_dispatched: 1 });
  const sorted = [line("b", "Juice"), line("c", "Chips"), line("a", "Juice")].sort(noteLineOrder);
  assert.deepEqual(sorted.map((l) => l.id), ["c", "a", "b"]);
  assert.deepEqual(letterhead({ ...seller, legal_name: null }).name, "Acme");
});

test("both sheets draw in every look, with their boxes and the words that say what signing means", async () => {
  for (const style of DOCUMENT_STYLES) {
    const picking = text(await buildMoneyPdf(pickingListPdfSpec(sheet, seller, paper), look(style), null));
    for (const words of ["PICKING LIST", "Order details", "Notes for the picker", "Picked by (name and signature)", "Checked by (name and signature)", "Not batch-tracked"]) {
      assert.ok(picking.includes(inPdf(words)), `${style}: ${words}`);
    }
    assert.ok(!picking.includes("Note to customer"), style);
    const delivery = text(await buildMoneyPdf(deliveryNotePdfSpec(note(), seller, paper), look(style), null));
    for (const words of ["DELIVERY NOTE", "Delivery note no.: DSP-000042", "Driver: Sipho Dlamini", "Received in good order", "Name (print)", "Signature", "Stamp"]) {
      assert.ok(delivery.includes(inPdf(words)), `${style}: ${words}`);
    }
  }
});

test("the boxes are drawn: one to tick per picking line, and the ones to sign", async () => {
  // A stroked rectangle is "x y w h re" then "S"; the invoice's layout draws none.
  const boxes = (pdf: string) => (pdf.match(/ re\nS\n/g) ?? []).length;
  for (const style of DOCUMENT_STYLES) {
    assert.equal(boxes(text(await buildMoneyPdf(pickingListPdfSpec(sheet, seller, paper), look(style), null))), 2 + 2, style);
    assert.equal(boxes(text(await buildMoneyPdf(deliveryNotePdfSpec(note(), seller, paper), look(style), null))), 4, style);
  }
});

test("a long delivery note runs over pages, numbered, and signs off once, at the end", async () => {
  const lines = Array.from({ length: 60 }, (_, i) => ({
    id: `l${i}`,
    product_id: `p${i}`,
    product_name: `Product ${String(i + 1).padStart(2, "0")}`,
    brand: null,
    line_status: "open",
    qty_ordered: 12,
    qty_picked: 12,
    qty_dispatched: 12,
  }));
  for (const style of DOCUMENT_STYLES) {
    const doc = await buildMoneyPdf(deliveryNotePdfSpec(note({ lines }), seller, paper), look(style), null);
    const pages = doc.getNumberOfPages();
    assert.ok(pages >= 2, style);
    const pdf = text(doc);
    assert.match(pdf, new RegExp(`Page ${pages} of ${pages}`), style);
    assert.equal(pdf.split("Received in good order").length - 1, 1, style);
  }
});

test("the print buttons sit on pages only the warehouse permission opens; the invoice's beside its PDF button", () => {
  // The order page, its picking list and the board.
  assert.equal(permissionForPath("/orders/1f0c/pick"), "warehouse");
  assert.equal(permissionForPath("/orders/1f0c"), "warehouse");
  assert.equal(permissionForPath("/orders"), "warehouse");
  // Printing an invoice is downloading it: whoever invoices.
  assert.equal(permissionForPath("/invoices/9a2b"), "invoicing");
});

test("which sheet an order prints at its stage, and ticked orders split by it in the board's order", () => {
  assert.equal(sheetFor("new"), null);
  assert.equal(sheetFor("confirmed"), "picking");
  assert.equal(sheetFor("picking"), "picking");
  for (const status of ["packed", "dispatched", "delivered"]) assert.equal(sheetFor(status), "delivery", status);
  assert.equal(sheetFor("cancelled"), null);
  assert.deepEqual(
    sheetsFor([
      { id: "a", status: "packed" },
      { id: "b", status: "confirmed" },
      { id: "c", status: "new" },
      { id: "d", status: "dispatched" },
      { id: "e", status: "picking" },
    ]),
    { picking: ["b", "e"], delivery: ["a", "d"] }
  );
});

test("a batch is one PDF: each document on a page of its own, numbering only its own pages", async () => {
  const long = deliveryNotePdfSpec(
    note({
      lines: Array.from({ length: 60 }, (_, i) => ({
        id: `l${i}`,
        product_id: `p${i}`,
        product_name: `Product ${i}`,
        brand: null,
        line_status: "open",
        qty_ordered: 1,
        qty_picked: 1,
        qty_dispatched: 1,
      })),
    }),
    seller,
    paper
  );
  const short = pickingListPdfSpec(sheet, seller, paper);
  for (const style of DOCUMENT_STYLES) {
    const longPages = (await buildMoneyPdf(long, look(style), null)).getNumberOfPages();
    const doc = await buildMoneyPdfs([{ spec: long, logo: null }, { spec: short, logo: null }, { spec: long, logo: null }], look(style));
    // The short one takes one page, between the two long ones.
    assert.equal(doc.getNumberOfPages(), longPages * 2 + 1, style);
    const pdf = text(doc);
    // Each long note counts its own pages; the short one has no number; nothing counts the whole batch.
    assert.equal(pdf.split(`Page ${longPages} of ${longPages}`).length - 1, 2, style);
    assert.doesNotMatch(pdf, new RegExp(`of ${longPages * 2 + 1}\\)`), style);
    assert.equal(pdf.split("PICKING LIST").length - 1, 1, style);
    assert.equal(pdf.split("Received in good order").length - 1, 2, style);
  }
  await assert.rejects(buildMoneyPdfs([], look("classic")), /nothing to print/);
});

test("a batch prints up to a hundred at a time, and says so beyond that", () => {
  assert.equal(tooManyToPrint(1), null);
  assert.equal(tooManyToPrint(PRINT_AT_ONCE), null);
  assert.match(tooManyToPrint(PRINT_AT_ONCE + 1) ?? "", /^That is 101 documents\. Print up to 100 at a time/);
});
