// Stage 8.10: sending an invoice, a quote, a statement or a payment reminder.
// The four emails, the words on the client's page, and the PDF built from what
// the page was given. The database side is supabase/tests/send_documents.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_TEMPLATES, DOCUMENT_TEMPLATES, REPORT_TEMPLATES, renderEmail } from "@/lib/email/templates";
import {
  ageingParts,
  amountText,
  daysBetween,
  documentLook,
  invoiceBanner,
  periodText,
  quoteBanner,
  statementBanner,
  statementParts,
  todayIn,
  type InvoiceView,
  type QuoteView,
  type StatementView,
} from "@/lib/client-document";
import { documentPdfSpec, invoiceViewPdfSpec, quoteViewPdfSpec, statementViewPdfSpec } from "@/lib/client-document-pdf";
import { buildMoneyPdf } from "@/lib/money-pdf";
import { invoicePdfSpec, type Invoice, type InvoiceLine } from "@/lib/invoices";
import type { StatementRow } from "@/lib/owed";
import type { QuoteRow } from "@/lib/quotes";

const ctx = { companyName: "Acme Cleaning", unsubscribeUrl: "https://app.test/c/unsubscribe/tok" };
const url = "https://app.test/c/doc/abc.def";
const render = (template: string, payload: Record<string, unknown>) =>
  renderEmail(template, { url, ...payload }, ctx)!;

// ---------------------------------------------------------------- the emails

test("the four document emails are client emails with a stop link, and the sender looks their links up", () => {
  for (const t of ["invoice", "quote", "statement", "payment_reminder"]) {
    assert.ok(DOCUMENT_TEMPLATES.has(t), t);
    assert.ok(CLIENT_TEMPLATES.has(t), t);
    assert.ok(!REPORT_TEMPLATES.has(t), t);
  }
  assert.ok(!DOCUMENT_TEMPLATES.has("job_report"));
  assert.ok(CLIENT_TEMPLATES.has("job_report"));
});

const invoicePayload = {
  link_id: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4",
  number: "INV-0042",
  customer_name: "Sandton Office Park",
  total: 1200,
  issue_date: "2026-10-09",
  due_date: "2026-11-08",
  reference: "PO 5521",
  currency: "ZAR",
  company_name: "Acme Cleaning (Pty) Ltd",
  note: null,
};

test("an invoice email names the invoice, the amount and the dates, and links to the page", () => {
  const e = render("invoice", invoicePayload);
  assert.equal(e.subject, "Invoice INV-0042 from Acme Cleaning (Pty) Ltd");
  assert.match(e.html, /Invoice INV-0042/);
  assert.match(e.html, /R1,200\.00/);
  assert.match(e.html, /9 Oct 2026/);
  assert.match(e.html, /8 Nov 2026/);
  assert.match(e.html, /PO 5521/);
  assert.match(e.html, /href="https:\/\/app\.test\/c\/doc\/abc\.def"[^>]*>View invoice</);
  assert.match(e.text, /View invoice: https:\/\/app\.test\/c\/doc\/abc\.def/);
  assert.match(e.text, /Invoice total: R1,200\.00/);
  assert.match(e.html, /Stop these emails/);
  assert.match(e.text, /Stop these emails: https:\/\/app\.test\/c\/unsubscribe\/tok/);
  assert.doesNotMatch(e.html + e.text, /[–—]/);
});

test("the sender's note is a quoted line, escaped, with its line breaks kept", () => {
  const e = render("invoice", { ...invoicePayload, note: "Thanks for <b>Friday</b>.\nPay by the 8th & we're square." });
  assert.match(e.html, /A note from Acme Cleaning/);
  assert.match(e.html, /Thanks for &lt;b&gt;Friday&lt;\/b&gt;\.<br>Pay by the 8th &amp; we&#39;re square\./);
  assert.doesNotMatch(e.html, /<b>Friday/);
  assert.match(e.text, /> Thanks for <b>Friday<\/b>\.\n> Pay by the 8th & we're square\./);
  const none = render("invoice", invoicePayload);
  assert.doesNotMatch(none.html, /A note from/);
  assert.doesNotMatch(none.text, /^> /m);
});

test("what a company typed is escaped in every email", () => {
  const e = render("invoice", { ...invoicePayload, company_name: "A&B <Cleaners>", customer_name: "<i>Park</i>", reference: "<script>x</script>" });
  assert.doesNotMatch(e.html, /<script>|<i>Park|<Cleaners>/);
  assert.match(e.html, /A&amp;B &lt;Cleaners&gt;/);
  assert.equal(e.subject, "Invoice INV-0042 from A&B <Cleaners>");
});

test("a missing or odd currency never throws and never guesses a symbol", () => {
  assert.match(render("invoice", { ...invoicePayload, currency: "XYZ" }).html, /1,200\.00 XYZ/);
  assert.match(render("invoice", { ...invoicePayload, currency: null }).html, /1,200\.00/);
  assert.doesNotMatch(render("invoice", { ...invoicePayload, currency: null }).html, /null|undefined|NaN/);
  assert.match(render("invoice", { ...invoicePayload, currency: "bwp" }).html, /P1,200\.00/);
  assert.match(render("invoice", { ...invoicePayload, currency: "not a code" }).html, /Invoice total<\/p><p[^>]*>1,200\.00</);
  assert.equal(amountText(-5, "ZAR"), "-R5.00");
  assert.equal(amountText("12.5", "ZAR"), "R12.50");
  assert.equal(amountText(undefined, "ZAR"), "R0.00");
});

test("an email without its link or its number cannot be rendered", () => {
  assert.throws(() => renderEmail("invoice", invoicePayload, ctx), /link/);
  assert.throws(() => render("invoice", { ...invoicePayload, number: "" }), /invoice number/);
  assert.throws(() => render("quote", { number: " " }), /quote number/);
});

test("a quote email shows the total and how long it holds", () => {
  const e = render("quote", {
    link_id: invoicePayload.link_id,
    number: "QU-0007",
    customer_name: "Sandton Office Park",
    total: 3450.5,
    valid_until: "2026-11-15",
    currency: "ZAR",
    company_name: "Acme Cleaning",
    note: "Prices hold for the month.",
  });
  assert.equal(e.subject, "Quote QU-0007 from Acme Cleaning");
  assert.match(e.html, /R3,450\.50/);
  assert.match(e.html, /Valid until/);
  assert.match(e.html, /15 Nov 2026/);
  assert.match(e.html, /Prices hold for the month\./);
  assert.match(e.html, />View quote</);
  assert.match(e.text, /View quote: https:\/\/app\.test\/c\/doc\/abc\.def/);
});

test("a statement email shows the balance and only the ages that hold something", () => {
  const e = render("statement", {
    link_id: invoicePayload.link_id,
    client_name: "Sandton Office Park",
    from: "2026-10-01",
    to: "2026-10-31",
    balance: 1800,
    ageing: { not_due: 600, days_1_30: 1200, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 1800 },
    currency: "ZAR",
    company_name: "Acme Cleaning",
    note: null,
  });
  assert.equal(e.subject, "Statement from Acme Cleaning, 1 Oct to 31 Oct 2026");
  assert.match(e.html, /Balance at 31 Oct 2026/);
  assert.match(e.html, /R1,800\.00/);
  assert.match(e.html, /Not yet due/);
  assert.match(e.html, /1 to 30 days overdue/);
  assert.doesNotMatch(e.html, /31 to 60 days/);
  assert.match(e.html, />View statement</);
  assert.doesNotMatch(e.html, /View statement and pay/);
  // A statement across a year end says both years.
  assert.equal(
    render("statement", { from: "2025-11-01", to: "2026-01-31", balance: 0, company_name: "Acme", currency: "ZAR" }).subject,
    "Statement from Acme, 1 Nov 2025 to 31 Jan 2026"
  );
});

const reminder = {
  link_id: invoicePayload.link_id,
  client_name: "Sandton Office Park",
  tone: "firm",
  message: "Hello,\nThese invoices are overdue <please> pay.\n\nThank you.",
  total_overdue: 4300,
  today: "2026-10-09",
  invoices: [
    { number: "INV-0031", due_date: "2026-08-30", outstanding: 1500, days_overdue: 40 },
    { number: "INV-0038", due_date: "2026-09-30", outstanding: 1600, days_overdue: 9 },
    { number: "INV-0040", due_date: "2026-10-08", outstanding: 1200, days_overdue: 1 },
  ],
  currency: "ZAR",
  company_name: "Acme Cleaning",
};

test("a payment reminder shows the sender's own words, each overdue invoice, the total and the button", () => {
  const e = render("payment_reminder", reminder);
  assert.equal(e.subject, "Payment reminder from Acme Cleaning: R4,300.00 overdue");
  assert.match(e.html, /Hello,<br>These invoices are overdue &lt;please&gt; pay\.<br><br>Thank you\./);
  for (const n of ["INV-0031", "INV-0038", "INV-0040"]) assert.match(e.html, new RegExp(n));
  assert.match(e.html, /Due 30 Aug 2026, 40 days overdue/);
  assert.match(e.html, /Due 8 Oct 2026, 1 day overdue/);
  assert.match(e.html, /R1,500\.00/);
  assert.match(e.html, /Total overdue at 9 Oct 2026/);
  assert.match(e.html, /R4,300\.00/);
  assert.match(e.html, />View statement and pay</);
  assert.match(e.text, /- INV-0038: due 30 Sep 2026, 9 days overdue, R1,600\.00/);
  assert.match(e.text, /Total overdue at 9 Oct 2026: R4,300\.00/);
  assert.match(e.text, /View statement and pay: https:\/\/app\.test\/c\/doc\/abc\.def/);
  assert.match(e.html, /Stop these emails/);
  assert.doesNotMatch(e.html + e.text, /[–—]/);
});

test("a final notice says so in the subject and the heading; a friendly one does not", () => {
  const final = render("payment_reminder", { ...reminder, tone: "final" });
  assert.equal(final.subject, "Final notice from Acme Cleaning: R4,300.00 overdue");
  assert.match(final.html, /<h1[^>]*>Final notice<\/h1>/);
  const friendly = render("payment_reminder", { ...reminder, tone: "friendly" });
  assert.match(friendly.subject, /^Payment reminder from Acme Cleaning/);
  assert.match(friendly.html, /A friendly reminder/);
  assert.throws(() => render("payment_reminder", { ...reminder, invoices: [] }), /overdue invoices/);
});

// ------------------------------------------------------ the words on the page

const money = (n: number) => amountText(n, "ZAR");

test("an invoice banner says paid, what is still to pay and when, or how late it is", () => {
  const today = "2026-11-05";
  assert.deepEqual(invoiceBanner({ outstanding: 0, due_date: "2026-11-08" }, today, money), { tone: "paid", headline: "Paid", note: null });
  assert.deepEqual(invoiceBanner({ outstanding: 1200, due_date: "2026-11-08" }, today, money), {
    tone: "due",
    headline: "R1,200.00 still to pay, due 8 Nov",
    note: "In 3 days",
  });
  assert.deepEqual(invoiceBanner({ outstanding: 1200, due_date: "2026-10-31" }, today, money), {
    tone: "overdue",
    headline: "R1,200.00 still to pay, was due 31 Oct",
    note: "5 days overdue",
  });
  assert.equal(invoiceBanner({ outstanding: 1200, due_date: "2026-11-04" }, today, money).note, "1 day overdue");
  assert.equal(invoiceBanner({ outstanding: 99.5, due_date: "2026-11-05" }, today, money).headline, "R99.50 still to pay, due today");
  assert.equal(invoiceBanner({ outstanding: 1200, due_date: "2026-11-06" }, today, money).note, "In 1 day");
  // Another year than today's shows its year; a cent-fraction of nothing is paid.
  assert.equal(invoiceBanner({ outstanding: 10, due_date: "2027-01-05" }, today, money).headline, "R10.00 still to pay, due 5 Jan 2027");
  assert.equal(invoiceBanner({ outstanding: 0.004, due_date: "2026-11-08" }, today, money).tone, "paid");
  assert.match(invoiceBanner({ outstanding: -50, due_date: "2026-11-08" }, today, money).note ?? "", /credit of R50\.00/);
});

test("a quote banner: open until a date, expired, accepted or declined", () => {
  const today = "2026-11-05";
  assert.deepEqual(quoteBanner({ status: "sent", valid_until: "2026-11-15" }, today), { tone: "info", headline: "Valid until 15 Nov", note: "10 days left" });
  assert.equal(quoteBanner({ status: "sent", valid_until: "2026-11-05" }, today)?.headline, "Valid until today");
  assert.equal(quoteBanner({ status: "sent", valid_until: "2026-10-31" }, today)?.headline, "This quote expired on 31 Oct");
  assert.equal(quoteBanner({ status: "accepted", valid_until: "2026-10-31" }, today)?.headline, "This quote was accepted");
  assert.equal(quoteBanner({ status: "converted", valid_until: null }, today)?.tone, "paid");
  assert.equal(quoteBanner({ status: "declined", valid_until: "2026-12-01" }, today)?.headline, "This quote was declined");
  assert.equal(quoteBanner({ status: "draft", valid_until: null }, today), null);
});

test("dates are the company's days", () => {
  assert.equal(daysBetween("2026-11-05", "2026-11-08"), 3);
  assert.equal(daysBetween("2026-11-05", "2026-10-31"), -5);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  // 22:30 UTC on the 4th is already the 5th in Johannesburg.
  const instant = new Date("2026-11-04T22:30:00Z");
  assert.equal(todayIn("Africa/Johannesburg", instant), "2026-11-05");
  assert.equal(todayIn("UTC", instant), "2026-11-04");
  assert.equal(todayIn("Not/AZone", instant), "2026-11-04");
  assert.equal(periodText("2026-10-01", "2026-10-31"), "1 Oct to 31 Oct 2026");
  assert.equal(periodText("2025-12-01", "2026-01-31"), "1 Dec 2025 to 31 Jan 2026");
});

test("a statement banner and its ageing", () => {
  assert.equal(statementBanner(1800, "2026-10-31", money).headline, "R1,800.00 to pay at 31 Oct 2026");
  assert.equal(statementBanner(0, "2026-10-31", money).headline, "Nothing to pay");
  assert.match(statementBanner(-20, "2026-10-31", money).note ?? "", /credit of R20\.00/);
  assert.deepEqual(
    ageingParts({ not_due: 0, days_1_30: 5, days_31_60: 0, days_61_90: 0, days_over_90: 7, total: 12 }).map((p) => p.label),
    ["1 to 30 days overdue", "Over 90 days overdue"]
  );
  assert.deepEqual(ageingParts(null), []);
});

test("the look is the company's, or classic in the product's colours when it is unknown", () => {
  assert.deepEqual(documentLook({ style: "bold", primary: "#112233", accent: "#ffaa00", currency: "ZAR" }), { style: "bold", primary: "#112233", accent: "#FFAA00" });
  const unknown = documentLook({ style: "gothic", primary: "red; background:url(x)", accent: null, currency: null });
  assert.equal(unknown.style, "classic");
  assert.match(unknown.primary, /^#[0-9A-F]{6}$/);
  assert.match(unknown.accent, /^#[0-9A-F]{6}$/);
});

// -------------------------------------------------- the PDF from the page's data

const seller = {
  name: "Acme Cleaning (Pty) Ltd",
  address: "1 Main Road\nSandton",
  phone: "011 555 0142",
  email: "hello@acme.example",
  vat_number: "4123456789",
  tax_number: "9876543210",
  registration_number: "2020/123456/07",
  logo_path: null,
  bank_details: "First National Bank\nAccount 123456",
};
const look = { style: "bold", primary: "#0F3D3E", accent: "#F5A524", currency: "ZAR" };
const common = { link_id: invoicePayload.link_id, company: seller, look, timezone: "Africa/Johannesburg" };

const invoice = {
  id: "i1",
  invoice_number: "INV-0042",
  customer_name: "Sandton Office Park",
  customer_address: "5 Rivonia Rd",
  customer_email: "accounts@park.example",
  seller_name: seller.name,
  seller_address: seller.address,
  seller_phone: seller.phone,
  seller_email: seller.email,
  seller_vat_number: seller.vat_number,
  seller_tax_number: seller.tax_number,
  seller_registration_number: seller.registration_number,
  seller_logo_path: null,
  bank_details: seller.bank_details,
  footer: "Thank you.",
  issue_date: "2026-10-09",
  due_date: "2026-11-08",
  vat_rate: 15,
  subtotal: 1000,
  vat: 150,
  total: 1150,
  status: "issued",
  source: "direct",
  prices_include_vat: false,
  reference: "PO 5521",
  order_number: null,
  period_start: null,
  period_end: null,
} as unknown as Invoice;
const invoiceLines = [
  { id: "l1", description: "Office clean", sku: null, qty: 2, unit: "visits", unit_price: 300, line_total: 600 },
  { id: "l2", description: "Window clean", sku: "WIN", qty: 1, unit: null, unit_price: 400, line_total: 400 },
] as unknown as InvoiceLine[];

const invoiceView = {
  ...common,
  kind: "invoice",
  invoice,
  lines: invoiceLines,
  credit_notes: [{ id: "c1", credit_number: "CN-0001", issue_date: "2026-10-12", reason: "Missed a window", total: 115 }],
  payments: [{ id: "p1", paid_on: "2026-10-20", method: "eft", reference: "FNB 88", amount: 500 }],
  paid: 500,
  credited: 115,
  outstanding: 535,
} as unknown as InvoiceView;

test("the invoice's PDF is the signed-in one, then the credit and payment taken off it", () => {
  const spec = invoiceViewPdfSpec(invoiceView);
  const plain = invoicePdfSpec({ invoice, lines: invoiceLines, visits: [] });
  assert.equal(spec.heading, "TAX INVOICE");
  assert.equal(spec.fileName, "INV-0042");
  assert.deepEqual(spec.rows, plain.rows);
  assert.deepEqual(spec.meta, plain.meta);
  assert.equal(spec.payTo, "First National Bank\nAccount 123456");
  assert.deepEqual(spec.look, { style: "bold", primary: "#0F3D3E", accent: "#F5A524" });
  assert.deepEqual(spec.totals.slice(0, plain.totals.length), plain.totals);
  assert.deepEqual(
    spec.totals.slice(plain.totals.length).map(([k]) => k),
    ["Credit notes", "Paid", "Amount due"]
  );
  assert.match(spec.totals.at(-1)![1], /535\.00$/);
  assert.match(spec.totals.at(-3)![1], /^-.*115\.00$/);
  assert.match(spec.totals.at(-2)![1], /^-.*500\.00$/);
  // Nothing taken off: the totals are the invoice's own.
  const fresh = invoiceViewPdfSpec({ ...invoiceView, credit_notes: [], payments: [], paid: 0, credited: 0, outstanding: 1150 });
  assert.deepEqual(fresh.totals, plain.totals);
});

const quoteView = {
  ...common,
  kind: "quote",
  quote: {
    quote_number: "QU-0007",
    created_at: "2026-10-09T08:15:00Z",
    valid_until: "2026-11-15",
    status: "sent",
    customer_name: "Sandton Office Park",
    customer_address: null,
    delivery_address: "ignored",
    contact_email: "accounts@park.example",
    vat_rate: 15,
    prices_include_vat: false,
    notes: "Prices hold for the month.",
  } as unknown as QuoteRow,
  customer_name: "Sandton Office Park",
  customer_address: "5 Rivonia Rd",
  lines: [
    { position: 1, description: "Deep clean", sku: null, unit: "visit", qty: 3, list_price: 400, discount_pct: 0, discount_amount: 60, unit_price: 380 },
    { position: 2, description: "Carpets", sku: null, unit: null, qty: 1, list_price: 250, discount_pct: 0, discount_amount: 0, unit_price: 250 },
  ],
  subtotal: 1390,
  vat: 208.5,
  total: 1598.5,
} as unknown as QuoteView;

test("a quote's PDF has the amount-discounted unit price, the page's own client address and the company's bank", () => {
  const spec = quoteViewPdfSpec(quoteView);
  assert.equal(spec.heading, "QUOTE");
  assert.equal(spec.fileName, "QU-0007");
  assert.deepEqual(spec.meta, [
    ["Quote no", "QU-0007"],
    ["Date", "2026-10-09"],
    ["Valid until", "2026-11-15"],
  ]);
  assert.equal(spec.billTo.name, "Sandton Office Park");
  assert.equal(spec.billTo.address, "5 Rivonia Rd");
  assert.deepEqual(spec.rows[0], ["Deep clean", "3 visit", "380.00", "1,140.00"]);
  assert.deepEqual(spec.rows[1], ["Carpets", "1", "250.00", "250.00"]);
  assert.deepEqual(spec.totals.map(([k]) => k), ["Subtotal (excl. VAT)", "VAT 15%", "Total"]);
  assert.equal(spec.totals[2][1], "1,598.50");
  assert.deepEqual(spec.notes, ["Prices hold for the month."]);
  assert.equal(spec.payTo, seller.bank_details);
});

const row = (r: Partial<StatementRow>): StatementRow =>
  ({ entry_date: "2026-10-01", entry_kind: "invoice", document_number: null, detail: null, debit: null, credit: null, balance: 0, document_id: null, ...r }) as StatementRow;
const statementView = {
  ...common,
  kind: "statement",
  statement: {
    client_name: "Sandton Office Park",
    client_address: "5 Rivonia Rd",
    from: "2026-10-01",
    to: "2026-10-31",
    rows: [
      row({ entry_kind: "opening", balance: 300 }),
      row({ entry_date: "2026-10-09", entry_kind: "invoice", document_number: "INV-0042", detail: "PO 5521", debit: 1150, balance: 1450 }),
      row({ entry_date: "2026-10-12", entry_kind: "credit_note", document_number: "CN-0001", detail: "Missed a window", credit: 115, balance: 1335 }),
      row({ entry_date: "2026-10-20", entry_kind: "payment", document_number: "INV-0042", detail: "eft · FNB 88", credit: 500, balance: 835 }),
    ],
    ageing: { not_due: 835, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 835 },
  },
} as unknown as StatementView;

test("a statement's PDF has every row, the closing balance and what is owed by age", () => {
  const spec = statementViewPdfSpec(statementView);
  assert.equal(spec.heading, "STATEMENT");
  assert.equal(spec.fileName, "Statement Sandton Office Park 2026-10-31");
  assert.equal(spec.rows.length, 4);
  assert.deepEqual(spec.rows[3], ["2026-10-20", "Payment", "INV-0042", "EFT · FNB 88", "", "500.00", "835.00"]);
  assert.deepEqual(spec.totals, [["Balance due", "835.00"]]);
  assert.match(spec.notes?.[0] ?? "", /Not yet due 835\.00/);
  assert.equal(spec.look?.style, "bold");
  assert.deepEqual(statementParts(statementView.statement.rows).opening, 300);
  assert.equal(statementParts(statementView.statement.rows).moves.length, 3);
});

test("each kind of page draws its PDF in every look, with no login and no logo", async () => {
  for (const style of ["classic", "bold", "clean"]) {
    for (const view of [invoiceView, quoteView, statementView]) {
      const v = { ...view, look: { ...look, style } };
      const spec = documentPdfSpec(v);
      assert.equal(spec.look?.style, style);
      const doc = await buildMoneyPdf(spec, spec.look!, null);
      assert.ok(doc.getNumberOfPages() >= 1, `${view.kind} ${style}`);
    }
  }
});

// The PDF that goes with the email.

import { documentPdfAttachment, imageDimensions, loadLogoServer, safeFileName } from "@/lib/email/attachment";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
// A 1x1 baseline JPEG.
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64"
);

test("a logo's format and size are read from its first bytes: PNG and JPEG, nothing else", () => {
  assert.deepEqual(imageDimensions(PNG_1X1), { format: "PNG", width: 1, height: 1 });
  assert.deepEqual(imageDimensions(JPEG_1X1), { format: "JPEG", width: 1, height: 1 });
  assert.equal(imageDimensions(Buffer.from("RIFF....WEBPVP8 ")), null);
  assert.equal(imageDimensions(Buffer.alloc(0)), null);
  assert.equal(imageDimensions(Buffer.from("<svg></svg>")), null);
});

test("the server loads a PNG or JPEG logo and leaves off anything it cannot use", async () => {
  const serve = (body: Buffer, status = 200) => (async () => new Response(new Uint8Array(body), { status })) as unknown as typeof fetch;
  const png = await loadLogoServer("https://x/logo.png", serve(PNG_1X1));
  assert.equal(png?.format, "PNG");
  assert.match(png?.dataUrl ?? "", /^data:image\/png;base64,/);
  assert.equal((await loadLogoServer("https://x/logo.jpg", serve(JPEG_1X1)))?.format, "JPEG");
  assert.equal(await loadLogoServer("https://x/logo.webp", serve(Buffer.from("RIFF....WEBPVP8 "))), null);
  assert.equal(await loadLogoServer("https://x/missing.png", serve(PNG_1X1, 404)), null);
  assert.equal(await loadLogoServer(null), null);
  assert.equal(await loadLogoServer("https://x/slow.png", (async () => { throw new Error("offline"); }) as unknown as typeof fetch), null);
});

test("attachment names are safe for mail systems", () => {
  assert.equal(safeFileName("Invoice INV-0042"), "Invoice INV-0042.pdf");
  assert.equal(safeFileName('Statement: A/B "Co" <x>'), "Statement A B Co x.pdf");
  assert.equal(safeFileName("   "), "Document.pdf");
  assert.ok(safeFileName("x".repeat(300)).length <= 84);
});

test("each document email gets its PDF as an attachment that is a real PDF", async () => {
  for (const view of [invoiceView, quoteView, statementView]) {
    const a = await documentPdfAttachment(view, undefined);
    assert.ok(a, view.kind);
    assert.match(a.name, /\.pdf$/);
    const bytes = Buffer.from(a.content, "base64");
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(bytes.length > 1000 && bytes.length < 3_000_000);
  }
});

test("the email says the PDF is attached only when it is", () => {
  const payload = { link_id: "x", url, number: "INV-0042", customer_name: "A", total: 100, issue_date: "2026-10-09", due_date: "2026-11-08", currency: "ZAR", company_name: "Acme" };
  const without = renderEmail("invoice", payload, ctx)!;
  assert.doesNotMatch(without.html + without.text, /attached/);
  const withPdf = renderEmail("invoice", payload, { ...ctx, attached: true })!;
  assert.match(withPdf.html, /The PDF is attached to this email\./);
  assert.match(withPdf.text, /The PDF is attached to this email\./);
});

test("a PNG or a JPEG logo embeds in every look", async () => {
  const spec = documentPdfSpec(invoiceView);
  for (const img of [PNG_1X1, JPEG_1X1]) {
    const logo = await loadLogoServer("https://x/l", (async () => new Response(new Uint8Array(img))) as unknown as typeof fetch);
    assert.ok(logo);
    for (const style of ["classic", "bold", "clean"] as const) {
      const doc = await buildMoneyPdf(spec, { style, primary: "#0F3D3E", accent: "#F5A524" }, logo);
      assert.equal(doc.getNumberOfPages(), 1);
    }
  }
});


// The look and the advert.

import { PROMO, TICKD_LOGO_FILE, emailAssetUrl } from "@/lib/email/brand";

test("an email to a company's clients ends with Tickd's logo and a short advert; one to its own people does not", () => {
  const toClient = render("invoice", invoicePayload);
  assert.match(toClient.html, new RegExp(`<img src="https://app\\.tickd\\.co\\.za/${TICKD_LOGO_FILE.replace(".", "\\.")}"[^>]*alt="Tickd"`));
  assert.ok(toClient.html.includes(PROMO.headline) && toClient.html.includes(PROMO.cta));
  assert.ok(toClient.text.includes(PROMO.headline) && toClient.text.includes(PROMO.url));
  const own = renderEmail("test", {}, { companyName: "Acme", unsubscribeUrl: null })!;
  assert.ok(!own.html.includes("Tickd is the app") && !own.html.includes("<img"));
  assert.ok(!own.text.includes(PROMO.headline));
  assert.equal(emailAssetUrl("/x.png"), "https://app.tickd.co.za/x.png");
});

test("the advert makes no claim the product cannot keep and no clipped phrasing", () => {
  const all = `${PROMO.headline} ${PROMO.body} ${PROMO.cta}`;
  assert.doesNotMatch(all, /[–—]/);
  assert.doesNotMatch(all, /\b(AI|revolution|seamless|leverage|synergy)\b/i);
});

test("the email can be read in its preview line, and says replies reach the company only when they do", () => {
  const e = render("invoice", invoicePayload);
  assert.match(e.html, /display:none[^>]*>R1,200\.00, due 8 Nov 2026/);
  assert.doesNotMatch(e.html + e.text, /Questions\? Just reply/);
  const canReply = renderEmail("invoice", { ...invoicePayload, url }, { ...ctx, canReply: true })!;
  assert.match(canReply.html, /Questions\? Just reply to this email and it will reach/);
  assert.match(canReply.text, /Questions\? Just reply to this email/);
});

test("the sign-off comes after the button, and the quote says what to do next", () => {
  const e = render("invoice", invoicePayload);
  assert.ok(e.text.indexOf("View invoice:") < e.text.indexOf("Thank you,"));
  const q = renderEmail("quote", { link_id: invoicePayload.link_id, url, number: "QU-1", total: 100, currency: "ZAR", company_name: "Acme" }, { ...ctx, canReply: true })!;
  assert.match(q.text, /just reply to this email and we will get things going/);
  assert.ok(q.text.indexOf("View quote:") < q.text.indexOf("Kind regards,"));
});

import { existsSync, readFileSync } from "node:fs";

test("the picture the emails point at is in the app's public folder and is a PNG", () => {
  const file = `public/${TICKD_LOGO_FILE}`;
  assert.ok(existsSync(file), file);
  assert.equal(readFileSync(file).subarray(1, 4).toString("latin1"), "PNG");
});

test("a company's own logo is the picture at the top of its emails, and its name when it has none", () => {
  const payload = { link_id: "x", url, number: "INV-1", total: 100, currency: "ZAR", company_name: "Acme" };
  const logo = "https://x.supabase.co/storage/v1/object/public/branding/o/logo-a1.png";
  const withLogo = renderEmail("invoice", payload, { ...ctx, companyLogoUrl: logo })!;
  assert.match(withLogo.html, new RegExp(`<td[^>]*><img src="${logo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" alt="Acme Cleaning"[^>]*max-height:56px`));
  assert.ok(!withLogo.html.includes(">Acme Cleaning</td></tr>"));
  const without = renderEmail("invoice", payload, ctx)!;
  assert.ok(without.html.includes(">Acme Cleaning</td></tr>"));
  const own = renderEmail("test", {}, { companyName: "A & <B>", unsubscribeUrl: null, companyLogoUrl: logo })!;
  assert.match(own.html, /alt="A &amp; &lt;B&gt;"/);
});
