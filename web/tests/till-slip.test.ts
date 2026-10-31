// An invoice as an 80 mm till slip (owner, 31 Oct): for a company that prints
// its invoices on a receipt printer at the counter, chosen in Settings > Business.
import test from "node:test";
import assert from "node:assert/strict";
import { paperLines, type PdfSpec } from "@/lib/money-pdf";
import { buildTillSlips, paginate, SLIP_MAX_PAGE, SLIP_WIDTH, testSlipSpec } from "@/lib/till-slip";
import { DEFAULT_INVOICE_PAPER, isInvoicePaper } from "@/lib/document-style";
import { parseCompanyConfig } from "@/lib/company-config";

const invoice = (lines: number): PdfSpec => ({
  heading: "TAX INVOICE",
  fileName: "INV-000123",
  seller: {
    name: "Smiling Fish (Pty) Ltd t/a Aqua Blast",
    address: "1 Sample Road\nPhilippi\nCape Town",
    vatNumber: "4123456789",
    registrationNumber: "2016/480769/07",
    phone: "021 555 0142",
    email: "orders@aquablast.example",
  },
  metaTitle: "Invoice details",
  meta: [
    ["Invoice no.", "INV-000123"],
    ["Invoice date", "31/10/2026"],
    ["Due date", "31/10/2026"],
    ["Order no.", "SO-000045"],
  ],
  billTo: { label: "Bill to", name: "Corner Superette", address: "12 Main Road\nMitchells Plain" },
  shipTo: { label: "Deliver to", address: "Back door, 12 Main Road" },
  ...paperLines(
    Array.from({ length: lines }, (_, i) => ({
      code: i % 2 ? null : `AQ-${i}`,
      description: i === 0 ? "Still water 500ml, a case of 24 bottles, with a name long enough to wrap" : `Product ${i + 1}`,
      qty: "2",
      rate: "R140.00",
      amount: "R280.00",
    })),
    true
  ),
  totals: [
    ["Includes VAT @ 15% on R280.00", "R36.52"],
    ["Total", "R280.00", true],
    ["Paid", "-R280.00"],
    ["Amount due", "R0.00"],
  ],
  status: { label: "Paid", tone: "paid" },
  notes: ["Thank you for your order."],
  payTo: "FNB, Smiling Fish (Pty) Ltd\nAccount 123456789\nReference: your invoice number",
  footer: null,
});

type Doc = Awaited<ReturnType<typeof buildTillSlips>>;
const text = (doc: Doc) => Buffer.from(doc.output("arraybuffer")).toString("latin1");
const sizes = (doc: Doc) =>
  Array.from({ length: doc.getNumberOfPages() }, (_, i) => {
    doc.setPage(i + 1);
    return { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight() };
  });

test("a short invoice is one 80 mm slip, only as long as it needs", async () => {
  const doc = await buildTillSlips([{ spec: invoice(3), logo: null }]);
  const [page, ...more] = sizes(doc);
  assert.equal(more.length, 0);
  assert.ok(Math.abs(page.width - (80 * 72) / 25.4) < 0.01, String(page.width));
  assert.ok(page.height > SLIP_WIDTH && page.height <= SLIP_MAX_PAGE, String(page.height));
  assert.doesNotMatch(text(doc), /Page 1 of/);
});

test("the slip carries the invoice: who it is from, the heading, who it is for, the lines, the totals and how to pay", async () => {
  const pdf = text(await buildTillSlips([{ spec: invoice(3), logo: null }]));
  // A long name wraps (and the PDF escapes its brackets), so its two ends are looked for.
  for (const words of [
    "Smiling Fish",
    "Aqua Blast",
    "VAT no: 4123456789",
    "TAX INVOICE",
    "INV-000123",
    "SO-000045",
    "Corner Superette",
    "Deliver to",
    "AQ-0",
    "2 x R140.00",
    "R280.00",
    "Amount due",
    "PAID",
    "Thank you for your order.",
    "How to pay",
    "Reference: your invoice number",
  ]) {
    assert.ok(pdf.includes(words), words);
  }
});

test("a long invoice runs onto more 80 mm pages, none longer than a roll page, numbered", async () => {
  const doc = await buildTillSlips([{ spec: invoice(70), logo: null }]);
  const pages = sizes(doc);
  assert.ok(pages.length >= 2);
  for (const p of pages) {
    assert.ok(Math.abs(p.width - SLIP_WIDTH) < 0.01);
    assert.ok(p.height <= SLIP_MAX_PAGE, String(p.height));
  }
  assert.match(text(doc), new RegExp(`Page ${pages.length} of ${pages.length}`));
});

test("whatever the number of lines, every page is 80 mm wide, even a short last page", async () => {
  for (let n = 1; n <= 60; n++) {
    const doc = await buildTillSlips([{ spec: invoice(n), logo: null }]);
    for (const p of sizes(doc)) {
      assert.ok(Math.abs(p.width - SLIP_WIDTH) < 0.01, `${n} lines: a page ${p.width} wide`);
      assert.ok(p.height <= SLIP_MAX_PAGE, `${n} lines: a page ${p.height} long`);
    }
  }
});

test("several invoices print as one PDF, each starting a slip of its own", async () => {
  const doc = await buildTillSlips([
    { spec: invoice(2), logo: null },
    { spec: { ...invoice(2), fileName: "INV-000124" }, logo: null },
  ]);
  assert.equal(doc.getNumberOfPages(), 2);
});

test("the slip is black on white: a thermal printer prints no colour or grey", async () => {
  const pdf = text(await buildTillSlips([{ spec: invoice(3), logo: null }]));
  const colours = [...pdf.matchAll(/(?:^|\s)([\d.]+) ([\d.]+) ([\d.]+) (rg|RG)\b/g)].filter((m) => [m[1], m[2], m[3]].some((v) => Number(v) !== 0));
  assert.deepEqual(colours.map((m) => m[0].trim()), []);
  const greys = [...pdf.matchAll(/(?:^|\s)([\d.]+) (g|G)\b/g)].filter((m) => Number(m[1]) !== 0 && Number(m[1]) !== 1);
  assert.deepEqual(greys.map((m) => m[0].trim()), []);
});

test("a document made before the lines were carried prints its table cells instead", async () => {
  const { items: _items, ...old } = invoice(2);
  void _items;
  const pdf = text(await buildTillSlips([{ spec: old, logo: null }]));
  assert.ok(pdf.includes("Product 2"));
});

test("pages are cut between blocks, never inside one, and a block taller than a page gets a page of its own", () => {
  const pages = paginate([{ height: 400 }, { height: 300 }, { height: 300 }, { height: 900 }, { height: 10 }]);
  assert.deepEqual(
    pages.map((p) => [p.start, p.end]),
    [
      [0, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]
  );
  assert.deepEqual(paginate([]), []);
});

test("the test slip is headed so nobody takes it for an invoice", async () => {
  const spec = testSlipSpec({ name: "Corner Superette" }, { currency: "ZAR", today: "2026-10-31" });
  assert.equal(spec.heading, "TEST SLIP");
  const pdf = text(await buildTillSlips([{ spec, logo: null }]));
  assert.ok(pdf.includes("TEST SLIP"));
  assert.ok(pdf.includes("R294.90"));
});

test("the company's invoice printer: A4 unless it chose the till slip", () => {
  assert.equal(DEFAULT_INVOICE_PAPER, "a4");
  assert.ok(isInvoicePaper("slip_80"));
  assert.ok(!isInvoicePaper("slip_58"));
  const raw = (settings: Record<string, unknown>) => ({ org_id: "o", modules: {}, settings, branding: {} });
  assert.equal(parseCompanyConfig(raw({ invoice_paper: "slip_80" }))?.settings.invoice_paper, "slip_80");
  assert.equal(parseCompanyConfig(raw({}))?.settings.invoice_paper, "a4");
  assert.equal(parseCompanyConfig(raw({ invoice_paper: "thermal" }))?.settings.invoice_paper, "a4");
});

test("a long note or long bank details runs onto the next page instead of making a page too long", async () => {
  const terms = Array.from({ length: 120 }, (_, i) => `Term ${i + 1}: goods stay ours until paid in full.`).join("\n");
  const doc = await buildTillSlips([{ spec: { ...invoice(3), footer: terms, payTo: terms }, logo: null }]);
  const pages = sizes(doc);
  assert.ok(pages.length >= 3);
  for (const p of pages) assert.ok(p.height <= SLIP_MAX_PAGE, String(p.height));
});

test("the status line names a due date only when it is one", async () => {
  const due = text(await buildTillSlips([{ spec: { ...invoice(1), status: { label: "Due", tone: "due", detail: "29/11/2026" } }, logo: null }]));
  assert.ok(due.includes("Due date 29/11/2026"));
  const statement = text(await buildTillSlips([{ spec: { ...invoice(1), status: { label: "Overdue", tone: "overdue", detail: "P1,200.00" } }, logo: null }]));
  assert.ok(statement.includes("(P1,200.00)"));
  assert.ok(!statement.includes("Due date P1,200.00"));
});

test("the test slip is dated the company's today, as the paper writes dates", () => {
  const spec = testSlipSpec({ name: "X" }, { currency: "ZAR", today: "2026-10-31" });
  assert.deepEqual(spec.meta[1], ["Invoice date", "31/10/2026"]);
});
