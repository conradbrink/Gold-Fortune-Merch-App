// The layout of the company's invoices, credit notes, quotes and statements
// (owner, 20 Oct: like the QuickBooks invoice their clients know), the three
// looks a company picks for it, and the words and colours it is drawn with.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMoneyPdf,
  invoiceStatus,
  statementStatus,
  paperDate,
  paperLines,
  paperMoney,
  termsText,
  vatRows,
  type PdfSpec,
} from "@/lib/money-pdf";
import {
  brandText,
  DOCUMENT_STYLES,
  hexToRgb,
  isDocumentStyle,
  lookFrom,
  luminance,
  mix,
  readableOn,
  wash,
  type DocumentStyle,
} from "@/lib/document-style";
import { parseCompanyConfig } from "@/lib/company-config";

const base: PdfSpec = {
  heading: "TAX INVOICE",
  fileName: "x",
  seller: {
    name: "Acme Cleaning (Pty) Ltd",
    address: "1 Main Road\nSandton\n2196",
    registrationNumber: "2020/123456/07",
    taxNumber: "9876543210",
    vatNumber: "4123456789",
    phone: "011 555 0142",
    email: "hello@acme.example",
  },
  metaTitle: "Invoice details",
  meta: [
    ["Invoice no.", "INV-0001"],
    ["Terms", "Net 30"],
    ["Invoice date", "09/10/2026"],
    ["Due date", "08/11/2026"],
  ],
  billTo: { label: "Bill to", name: "Sandton Office Park", address: "5 Rivonia Rd\nSandton", email: "accounts@park.example" },
  shipTo: { address: "Gate 3, 5 Rivonia Rd" },
  ...paperLines([{ code: "CLN-1", description: "Office clean", qty: "1", rate: "R100.00", amount: "R100.00" }], true),
  totals: [
    ["Subtotal", "R100.00"],
    ["VAT @ 15% on R100.00", "R15.00"],
    ["Total", "R115.00"],
  ],
  status: { label: "Overdue", tone: "overdue", detail: "08/11/2026" },
  notes: ["Thank you."],
  payTo: "Bank: First\nAccount 123",
  footer: "Terms apply.",
};
const long: PdfSpec = {
  ...base,
  ...paperLines(
    Array.from({ length: 70 }, (_, i) => ({ description: `Sample line ${i + 1}`, qty: "1", rate: "R100.00", amount: "R100.00" })),
    true
  ),
};
const look = (style: DocumentStyle) => ({ style, primary: "#0F3D3E", accent: "#F5A524" });
const text = (doc: { output: (t: "arraybuffer") => ArrayBuffer }) => Buffer.from(doc.output("arraybuffer")).toString("latin1");
const stripDates = (pdf: string) => pdf.replace(/\/CreationDate \(D:[^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, "");

test("every look draws a one-page and a multi-page document, numbering the pages only when there are several", async () => {
  for (const style of DOCUMENT_STYLES) {
    const one = await buildMoneyPdf(base, look(style), null);
    assert.equal(one.getNumberOfPages(), 1, style);
    assert.doesNotMatch(text(one), /Page 1 of/, style);
    const many = await buildMoneyPdf(long, look(style), null);
    const pages = many.getNumberOfPages();
    assert.ok(pages >= 2, style);
    assert.match(text(many), new RegExp(`Page ${pages} of ${pages}`), style);
  }
});

test("every look carries the same layout: the heading, the band's details, the lines, the note and whether it is paid", async () => {
  for (const style of DOCUMENT_STYLES) {
    const pdf = text(await buildMoneyPdf(base, look(style), null));
    for (const words of ["TAX INVOICE", "Invoice details", "Invoice no.: INV-0001", "Terms: Net 30", "Bill to", "Ship to", "Product or service", "CLN-1", "Note to customer", "How to pay", "Overdue"]) {
      assert.ok(pdf.includes(words), `${style}: ${words}`);
    }
    // A document with nothing to say leaves the headings out rather than printing them empty.
    const bare = text(await buildMoneyPdf({ ...base, notes: [], footer: null, payTo: null, status: null, shipTo: null }, look(style), null));
    for (const words of ["Note to customer", "How to pay", "Ship to", "Overdue"]) assert.ok(!bare.includes(words), `${style}: ${words}`);
  }
});

test("the three looks are three different documents", async () => {
  const out = new Set<string>();
  for (const style of DOCUMENT_STYLES) out.add(stripDates(text(await buildMoneyPdf(base, look(style), null))));
  assert.equal(out.size, 3);
});

test("a statement's ageing draws in every look", async () => {
  const statement: PdfSpec = {
    ...base,
    heading: "STATEMENT",
    ageing: [
      ["Not yet due", "R835.00"],
      ["1–30 days overdue", "R0.00"],
    ],
  };
  for (const style of DOCUMENT_STYLES) {
    const pdf = text(await buildMoneyPdf(statement, look(style), null));
    assert.ok(pdf.includes("Not yet due"), style);
  }
});

test("a very light brand colour still draws in every look, and its text reads on the band", async () => {
  for (const style of DOCUMENT_STYLES) {
    const doc = await buildMoneyPdf(base, { style, primary: "#FFF200", accent: "#FFFFFF" }, null);
    assert.equal(doc.getNumberOfPages(), 1, style);
  }
  // Body text needs 4.5:1 against the band.
  for (const hex of ["#FFF200", "#16224F", "#0F3D3E", "#F5A524", "#E0B84B", "#FFFFFF"]) {
    const ink = luminance(brandText(hexToRgb(hex)));
    assert.ok((luminance(wash(hexToRgb(hex))) + 0.05) / (ink + 0.05) >= 4.5, hex);
  }
});

test("the band keeps the brand's hue: navy washes blue, not grey", () => {
  const [r, g, b] = wash(hexToRgb("#16224F"));
  assert.ok(b - r >= 8, `${r} ${g} ${b}`);
  assert.ok(luminance([r, g, b]) > 0.85);
  // A grey brand stays grey.
  const grey = wash(hexToRgb("#555555"));
  assert.equal(grey[0], grey[2]);
});

test("text colour on a colour: white on dark, near-black on light", () => {
  assert.deepEqual(readableOn(hexToRgb("#0F3D3E")), [255, 255, 255]);
  assert.deepEqual(readableOn(hexToRgb("#F5A524")), [20, 20, 20]);
  assert.deepEqual(mix([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25]);
});

test("an unknown style is classic, and the company's configuration carries the style", () => {
  assert.ok(isDocumentStyle("bold"));
  assert.ok(!isDocumentStyle("fancy"));
  assert.deepEqual(lookFrom({ document_style: "fancy" }, { primary: "#000000", accent: "#111111" }), { style: "classic", primary: "#000000", accent: "#111111" });
  assert.equal(lookFrom({ document_style: "clean" }, { primary: "#000000", accent: "#111111" }).style, "clean");
  const raw = (settings: Record<string, unknown>) => ({ org_id: "o", modules: {}, settings, branding: {} });
  assert.equal(parseCompanyConfig(raw({ document_style: "bold" }))?.settings.document_style, "bold");
  assert.equal(parseCompanyConfig(raw({}))?.settings.document_style, "classic");
  assert.equal(parseCompanyConfig(raw({ document_style: 5 }))?.settings.document_style, "classic");
});

test("dates, terms and amounts as the paper prints them", () => {
  assert.equal(paperDate("2026-08-21"), "21/08/2026");
  assert.equal(paperDate("2026-10-09T08:15:00Z"), "09/10/2026");
  assert.equal(paperDate("soon"), "soon");
  assert.equal(termsText("2026-07-22", "2026-08-21"), "Net 30");
  assert.equal(termsText("2026-07-22", "2026-07-22"), "Due on receipt");
  const bwp = paperMoney({ currency: "BWP", today: "2026-10-20" });
  assert.equal(bwp(5686.89), "P5,686.89");
  assert.equal(bwp(-100), "-P100.00");
  assert.equal(paperMoney({ currency: null, today: "2026-10-20" })(12), "12.00");
  // A symbol the PDF font cannot draw is written as the code.
  assert.equal(paperMoney({ currency: "NGN", today: "2026-10-20" })(1500), "1,500.00 NGN");
});

test("VAT is one line when prices include it, and a subtotal and a line when they do not", () => {
  const fmt = paperMoney({ currency: "BWP", today: "2026-10-20" });
  assert.deepEqual(vatRows(14, true, 4988.5, 698.39, fmt), [["Includes VAT @ 14% on P4,988.50", "P698.39"]]);
  assert.deepEqual(vatRows(14, false, 1798.5, 251.79, fmt), [
    ["Subtotal", "P1,798.50"],
    ["VAT @ 14% on P1,798.50", "P251.79"],
  ]);
  assert.deepEqual(vatRows(0, false, 100, 0, fmt), []);
});

test("an invoice's last line: void, paid, credited, overdue or due on its date", () => {
  const inv = { status: "issued", due_date: "2026-08-21" };
  assert.deepEqual(invoiceStatus(inv, { outstanding: 5686.89, paid: 0 }, "2026-10-20"), { label: "Overdue", tone: "overdue", detail: "21/08/2026" });
  assert.deepEqual(invoiceStatus(inv, { outstanding: 5686.89, paid: 0 }, "2026-08-21"), { label: "Due", tone: "due", detail: "21/08/2026" });
  assert.equal(invoiceStatus(inv, { outstanding: 0, paid: 5686.89 }, "2026-10-20").label, "Paid");
  assert.equal(invoiceStatus(inv, { outstanding: 0.004, paid: 0, credited: 1150 }, "2026-10-20").label, "Fully credited");
  assert.equal(invoiceStatus({ ...inv, status: "void" }, { outstanding: 100, paid: 0 }, "2026-10-20").label, "Void");
});

test("a statement's last line: overdue and by how much, not yet due, nothing to pay, or in credit", () => {
  const fmt = paperMoney({ currency: "BWP", today: "2026-10-20" });
  assert.deepEqual(statementStatus(2050.29, 1200, fmt), { label: "Overdue", tone: "overdue", detail: "P1,200.00" });
  assert.deepEqual(statementStatus(2050.29, 0, fmt), { label: "Not yet due", tone: "due" });
  assert.deepEqual(statementStatus(0, 0, fmt), { label: "Nothing to pay", tone: "paid" });
  assert.deepEqual(statementStatus(-20, null, fmt), { label: "In credit", tone: "paid", detail: "P20.00" });
  // Without the ageing it does not guess whether anything is late.
  assert.equal(statementStatus(2050.29, null, fmt), null);
  // Money on account leaves less owed than the ageing calls overdue: no more than the balance is overdue.
  assert.deepEqual(statementStatus(200, 1200, fmt), { label: "Overdue", tone: "overdue", detail: "P200.00" });
});

test("nothing owed and nothing paid or credited is not \"fully credited\"", () => {
  const inv = { status: "issued", due_date: "2026-08-21" };
  assert.equal(invoiceStatus(inv, { outstanding: 0, paid: 0, credited: 0 }, "2026-10-20").label, "Nothing to pay");
  assert.equal(invoiceStatus(inv, { outstanding: 0, paid: 0, credited: 115 }, "2026-10-20").label, "Fully credited");
});

test("a long detail in the band wraps rather than running off the page", async () => {
  const reference = "PO 88213 for the October restock of all the Gaborone stores, the two in Mochudi, the one in Molepolole and the new forecourt shop in Phakalane";
  const spec: PdfSpec = { ...base, meta: [...base.meta, ["Reference", reference]] };
  for (const style of DOCUMENT_STYLES) {
    const pdf = text(await buildMoneyPdf(spec, look(style), null));
    assert.ok(!pdf.includes(`(Reference: ${reference})`), style);
    assert.ok(pdf.includes("Reference: PO 88213"), style);
  }
});

test("the lines are numbered; a product code column and the tax column appear only when there is something to put in them", () => {
  const coded = paperLines([{ code: "6970125031132", description: "Grape ice", qty: "1", rate: "P683.43", amount: "P683.43" }], true);
  assert.deepEqual(coded.head, ["Product or service", "Description", "Qty", "Rate", "Amount", "Tax"]);
  assert.deepEqual(coded.rows[0], ["6970125031132", "Grape ice", "1", "P683.43", "P683.43", "VAT"]);
  assert.deepEqual(coded.numeric, [2, 3, 4, 5]);
  assert.deepEqual(coded.strong, [0]);
  assert.equal(coded.numbered, true);
  const plain = paperLines([{ code: null, description: "Office clean", qty: "2 visits", rate: "R300.00", amount: "R600.00" }], false);
  assert.deepEqual(plain.head, ["Product or service", "Qty", "Rate", "Amount"]);
  assert.deepEqual(plain.rows[0], ["Office clean", "2 visits", "R300.00", "R600.00"]);
  assert.deepEqual(plain.numeric, [1, 2, 3]);
  assert.deepEqual(plain.strong, []);
});

// The special invoices: a rebate, a deposit and the final balance of a quote.

import { creditNotePdfSpec, invoicePdfSpec, type Invoice, type InvoiceLine } from "@/lib/invoices";

const paper = { currency: "ZAR", today: "2026-10-20" };
const invoice = {
  invoice_number: "INV-0050",
  customer_name: "Sandton Office Park",
  customer_address: null,
  customer_email: null,
  seller_name: "Acme Cleaning (Pty) Ltd",
  issue_date: "2026-10-01",
  due_date: "2026-10-31",
  vat_rate: 15,
  subtotal: 1000,
  vat: 150,
  total: 1150,
  status: "issued",
  source: "quote",
  kind: "deposit",
  prices_include_vat: false,
  reference: "QU-0007",
  order_number: null,
  period_start: null,
  period_end: null,
} as unknown as Invoice;
const lines = [{ id: "l1", description: "Deposit (50%) on quote QU-0007", sku: null, qty: 1, unit: null, unit_price: 1000, line_total: 1000 }] as unknown as InvoiceLine[];

test("a deposit and the final balance of a quote say which part of the quote they are", () => {
  const meta = (kind: string) => invoicePdfSpec({ invoice: { ...invoice, kind }, lines, visits: [] }, paper).meta.at(-1);
  assert.deepEqual(meta("deposit"), ["Deposit on quote", "QU-0007"]);
  assert.deepEqual(meta("final"), ["Balance of quote", "QU-0007"]);
  assert.deepEqual(meta("standard"), ["Quote no.", "QU-0007"]);
});

test("an overpaid invoice has nothing due, not a negative amount", () => {
  const spec = invoicePdfSpec({ invoice: { ...invoice, source: "direct", reference: null }, lines, visits: [], balance: { credited: 0, paid: 1200, outstanding: -50 } }, paper);
  assert.deepEqual(spec.totals.at(-1), ["Amount due", "R0.00"]);
  assert.equal(spec.status?.label, "Paid");
});

test("a rebate, a credit note with no lines, prints one line saying what it is for", () => {
  const rebate = { credit_number: "CN-0009", issue_date: "2026-10-19", reason: "Rebate: quarterly", subtotal: 86.96, vat: 13.04, total: 100, lines: [] };
  const spec = creditNotePdfSpec({ invoice, lines }, rebate as never, paper);
  assert.deepEqual(spec.rows, [["Rebate: quarterly", "1", "R86.96", "R86.96", "VAT"]]);
  assert.deepEqual(spec.totals.at(-1), ["Total credited", "R100.00"]);
  // Prices that include VAT show the rebate as the client saw it.
  const incl = creditNotePdfSpec({ invoice: { ...invoice, prices_include_vat: true }, lines }, rebate as never, paper);
  assert.deepEqual(incl.rows[0].slice(2, 4), ["R100.00", "R100.00"]);
});

test("an invoice for many days of work names the first and last rather than every one", () => {
  const visits = Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, checkin_at: `2026-10-${String(i + 1).padStart(2, "0")}T08:00:00Z`, checkout_at: null, staff_name: null }));
  const many = invoicePdfSpec({ invoice: { ...invoice, source: "jobs", kind: "standard" }, lines, visits }, paper);
  assert.ok(many.notes?.includes("For the work done on 9 days, 01/10/2026 to 09/10/2026."));
  const few = invoicePdfSpec({ invoice: { ...invoice, source: "jobs", kind: "standard" }, lines, visits: visits.slice(0, 2) }, paper);
  assert.ok(few.notes?.includes("For the work done on 01/10/2026, 02/10/2026."));
});

test("an order's invoice states the customer's PO, dated as the paper dates things", () => {
  const withPo = { ...invoice, source: "order", order_number: "SO-000188", reference: null, customer_po_number: "1001160022257", customer_po_date: "2026-10-16" } as unknown as Invoice;
  const meta = invoicePdfSpec({ invoice: withPo, lines, visits: [] }, paper).meta;
  assert.deepEqual(meta.slice(-2), [
    ["Order no.", "SO-000188"],
    ["Your PO", "1001160022257 of 16/10/2026"],
  ]);
});
