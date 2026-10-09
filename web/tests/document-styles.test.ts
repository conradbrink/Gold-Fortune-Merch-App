import test from "node:test";
import assert from "node:assert/strict";
import { buildMoneyPdf, type PdfSpec } from "@/lib/money-pdf";
import {
  DOCUMENT_STYLES,
  hexToRgb,
  isDocumentStyle,
  lookFrom,
  luminance,
  mix,
  onWhite,
  readableOn,
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
  meta: [
    ["Invoice no", "INV-0001"],
    ["Date", "2026-10-09"],
    ["Due", "2026-11-08"],
  ],
  billTo: { name: "Sandton Office Park", address: "5 Rivonia Rd\nSandton", email: "accounts@park.example" },
  head: ["Description", "Qty", "Price", "Total"],
  rows: [["Sample line", "1", "100.00", "100.00"]],
  numeric: [1, 2, 3],
  totals: [
    ["Subtotal", "100.00"],
    ["VAT 15%", "15.00"],
    ["Total due", "115.00"],
  ],
  notes: ["Thank you."],
  payTo: "Bank: First\nAccount 123",
  footer: "Terms apply.",
};
const long: PdfSpec = {
  ...base,
  rows: Array.from({ length: 70 }, (_, i) => [`Sample line ${i + 1}`, "1", "100.00", "100.00"]),
};
const look = (style: (typeof DOCUMENT_STYLES)[number]) => ({ style, primary: "#0F3D3E", accent: "#F5A524" });

test("every style draws a one-page and a multi-page document, with and without a statement's long rows", async () => {
  for (const style of DOCUMENT_STYLES) {
    const one = await buildMoneyPdf(base, look(style), null);
    assert.equal(one.getNumberOfPages(), 1, style);
    const many = await buildMoneyPdf(long, look(style), null);
    assert.ok(many.getNumberOfPages() >= 2, style);
  }
});

test("the three styles are three different documents", async () => {
  const out = new Set<string>();
  for (const style of DOCUMENT_STYLES) {
    const doc = await buildMoneyPdf(base, look(style), null);
    out.add(Buffer.from(doc.output("arraybuffer")).toString("latin1").replace(/\/CreationDate \(D:[^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, ""));
  }
  assert.equal(out.size, 3);
});

test("a very light brand colour still draws, and reads", async () => {
  const doc = await buildMoneyPdf(base, { style: "clean", primary: "#FFF200", accent: "#FFFFFF" }, null);
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(luminance(onWhite(hexToRgb("#FFF200"))) <= 0.3);
});

test("text colour on a colour: white on dark, near-black on light", () => {
  assert.deepEqual(readableOn(hexToRgb("#0F3D3E")), [255, 255, 255]);
  assert.deepEqual(readableOn(hexToRgb("#F5A524")), [20, 20, 20]);
  assert.deepEqual(mix([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25]);
});

test("an unknown style is classic", () => {
  assert.ok(isDocumentStyle("bold"));
  assert.ok(!isDocumentStyle("fancy"));
  assert.equal(lookFrom({ document_style: "fancy" }, { primary: "#000000", accent: "#111111" }).style, "classic");
  assert.equal(lookFrom({ document_style: "clean" }, { primary: "#000000", accent: "#111111" }).style, "clean");
});

test("the company's configuration carries the style, classic when absent or wrong", () => {
  const raw = (settings: Record<string, unknown>) => ({ org_id: "o", modules: {}, settings, branding: {} });
  assert.equal(parseCompanyConfig(raw({ document_style: "bold" }))?.settings.document_style, "bold");
  assert.equal(parseCompanyConfig(raw({}))?.settings.document_style, "classic");
  assert.equal(parseCompanyConfig(raw({ document_style: 5 }))?.settings.document_style, "classic");
});
