// Accounting sync with Sage (30 Oct 2026): sealing the sign-in, Sage's
// formats and errors, Tickd's documents as Sage wants them, and the sender
// against a fake Sage and a fake database. The database half — what is
// queued and when, claiming, finishing, retrying — is
// supabase/tests/accounting_sync.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { open, seal, secretKey } from "@/lib/accounting/secret";
import {
  SageError,
  errorKind,
  errorText,
  matchCustomer,
  matchItem,
  nameKey,
  officeMessage,
  pickBankAccount,
  pickTaxType,
  requestUrl,
  sageConfig,
  taxTypeProblem,
} from "@/lib/accounting/sage";
import {
  addressLines,
  customerBody,
  invoiceBody,
  receiptBody,
  returnBody,
  type CreditNote,
  type Invoice,
} from "@/lib/accounting/documents";
import {
  NO_PRODUCT,
  inOrder,
  runAccountingSync,
  type Connection,
  type FinishInput,
  type LinkKind,
  type QueueRow,
  type SyncDb,
} from "@/lib/accounting/sync";

const ORG = "11111111-1111-4111-8111-111111111111";
const KEY = randomBytes(32);
/** Made up: shaped like Sage's keys, not one of them. */
const FAKE_API_KEY = "00000000-1111-2222-3333-444444444444";

// ------------------------------------------------------------------ sealing

test("a sealed sign-in opens only for its own company and key", () => {
  const sealed = seal({ kind: "password", username: "a@b.co", password: "pw" }, ORG, KEY);
  assert.match(sealed, /^v1\./);
  assert.ok(!sealed.includes("pw"));
  assert.deepEqual(open(sealed, ORG, KEY), { kind: "password", username: "a@b.co", password: "pw" });
  assert.equal(open(sealed, "22222222-2222-4222-8222-222222222222", KEY), null);
  assert.equal(open(sealed, ORG, randomBytes(32)), null);
  assert.equal(open("v1.short", ORG, KEY), null);
  assert.equal(open("plain", ORG, KEY), null);
});

test("the sealing key must be 32 bytes", () => {
  assert.equal(secretKey({}), null);
  assert.equal(secretKey({ ACCOUNTING_SECRET_KEY: Buffer.alloc(16).toString("base64") }), null);
  assert.equal(secretKey({ ACCOUNTING_SECRET_KEY: KEY.toString("base64") })?.length, 32);
});

// ---------------------------------------------------------------- Sage's ways

test("the API key may come with Sage's braces; only Sage's own hosts are called", () => {
  assert.deepEqual(sageConfig({ SAGE_API_KEY: `{${FAKE_API_KEY}}` }), {
    baseUrl: "https://accounting.sageone.co.za/api/2.0.0",
    apiKey: FAKE_API_KEY,
  });
  assert.equal(
    sageConfig({ SAGE_API_KEY: FAKE_API_KEY, SAGE_API_URL: "https://resellers.accounting.sageone.co.za/api/2.0.0/" })?.baseUrl,
    "https://resellers.accounting.sageone.co.za/api/2.0.0",
  );
  assert.equal(sageConfig({ SAGE_API_KEY: FAKE_API_KEY, SAGE_API_URL: "https://evil.example.com/api" }), null);
  assert.equal(sageConfig({ SAGE_API_KEY: FAKE_API_KEY, SAGE_API_URL: "http://accounting.sageone.co.za/api/2.0.0" }), null);
  assert.equal(sageConfig({ SAGE_API_KEY: "" }), null);
});

test("every call carries the API key and the company", () => {
  const url = new URL(
    requestUrl({ baseUrl: "https://accounting.sageone.co.za/api/2.0.0", apiKey: "K" }, {
      method: "POST",
      path: "TaxInvoice/Save",
      companyId: 42,
      query: { useSystemDocumentNumber: false },
    }),
  );
  assert.equal(url.pathname, "/api/2.0.0/TaxInvoice/Save");
  assert.equal(url.searchParams.get("apikey"), "K");
  assert.equal(url.searchParams.get("companyid"), "42");
  assert.equal(url.searchParams.get("useSystemDocumentNumber"), "false");
});

test("Sage's answers sort into what the sync must do", () => {
  assert.equal(errorKind(401), "sign_in");
  assert.equal(errorKind(429), "limit");
  assert.equal(errorKind(402), "expired");
  assert.equal(errorKind(400), "refused");
  assert.equal(errorKind(409), "refused");
  assert.equal(errorKind(500), "busy");
  assert.equal(errorKind(503), "busy");
  assert.equal(errorText({ Message: "The request is invalid.", ModelState: { "x.Name": ["Name is required."] } }),
               "The request is invalid. Name is required.");
  assert.equal(errorText(["One", { Message: "Two" }]), "One Two");
  assert.equal(errorText(null), null);
  assert.match(officeMessage(new SageError("refused", "Customer is inactive.")), /did not accept it: Customer is inactive\./);
  assert.match(officeMessage(new SageError("sign_in", "x")), /Connect Sage again/);
});

test("customers match by name, whatever the case and the (Pty) Ltd", () => {
  assert.equal(nameKey("  Kopano Distributors (Pty) Ltd "), "kopano distributors");
  assert.equal(nameKey("Spar & Co"), "spar and co");
  const list = [
    { ID: 1, Name: "SPAR Philippi" },
    { ID: 2, Name: "Shoprite" },
    { ID: 3, Name: "shoprite " },
    { ID: 4, Name: "Old shop", Active: false },
  ];
  assert.equal((matchCustomer("Spar  Philippi", list) as { ID: number }).ID, 1);
  assert.equal(matchCustomer("Shoprite", list), "several");
  assert.equal(matchCustomer("Old shop", list), null);
  assert.equal(matchCustomer("Nobody", list), null);
  assert.equal(matchItem(" aq-500 ", [{ ID: 9, Code: "AQ-500" }])?.ID, 9);
  assert.equal(matchItem("", [{ ID: 9, Code: "" }]), null);
});

test("the tax type is the rate's default; 0% prefers zero-rated to exempt", () => {
  const types = [
    { ID: 1, Name: "Standard Rate", Percentage: 15, IsDefault: true, Active: true },
    { ID: 2, Name: "Standard Rate (old)", Percentage: 15, Active: true },
    { ID: 3, Name: "Exempt and Non-Supplies", Percentage: 0, Active: true },
    { ID: 4, Name: "Zero Rated", Percentage: 0, Active: true },
    { ID: 5, Name: "Manual", Percentage: 14, Active: true, IsManualTax: true },
  ];
  assert.equal(pickTaxType(15, types)?.ID, 1);
  assert.equal(pickTaxType(0, types)?.ID, 4);
  assert.equal(pickTaxType(14, types), null);
  assert.equal(taxTypeProblem(15, types), null);
  // Sage's API gives rates as fractions.
  assert.equal(pickTaxType(15, [{ ID: 6, Name: "Standard Rate", Percentage: 0.15, Active: true }])?.ID, 6);
  assert.equal(pickTaxType(12, [{ ID: 7, Name: "Standard", Percentage: 0.12, Active: true }])?.ID, 7);
  assert.equal(taxTypeProblem(0, []), null);
  assert.equal(
    taxTypeProblem(15, [{ ID: 9, Name: "Standard", Percentage: 0.14, Active: true }, { ID: 8, Name: "Zero", Percentage: 0 }]),
    "Sage has no active VAT type at 15%, the rate on Tickd's invoices (Sage has 14%, 0%). Check that the Sage company is set up for the same country.",
  );
  assert.equal(pickBankAccount([{ ID: 7, Name: "Cheque", Active: true }, { ID: 8, Name: "FNB", Default: true }])?.ID, 8);
  assert.equal(pickBankAccount([{ ID: 7, Name: "Old", Active: false }]), null);
});

// ------------------------------------------------------------- the documents

const invoice: Invoice = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  invoice_number: "INV-000123",
  status: "issued",
  store_id: "bbbbbbbb-0000-4000-8000-000000000001",
  customer_name: "Spar Philippi",
  customer_address: "12 Main Road, Philippi",
  customer_email: "accounts@spar.example",
  issue_date: "2026-10-30",
  due_date: "2026-11-29T00:00:00",
  vat_rate: 15,
  prices_include_vat: false,
  subtotal: 290,
  total: 333.5,
  reference: null,
  customer_po_number: "PO 4411",
  lines: [
    { id: "l2", position: 2, product_id: null, description: "Delivery", qty: 1, unit_price: 50, line_total: 50, unit: null },
    { id: "l1", position: 1, product_id: "p1", description: "Still 500ml x24", qty: 2, unit_price: 120, line_total: 240, unit: "case" },
  ],
};

test("an address becomes at most five lines, town and code kept", () => {
  assert.deepEqual(addressLines("12 Main Road, Philippi", "Cape Town", "7785"), ["12 Main Road", "Philippi", "Cape Town", "7785"]);
  assert.deepEqual(addressLines("Unit 4, Block B, Park, 12 Main Road, Philippi", "Cape Town", "7785"),
                   ["Unit 4", "Block B", "Park, 12 Main Road, Philippi", "Cape Town", "7785"]);
  assert.deepEqual(addressLines("Philippi", "Philippi", null), ["Philippi"]);
  assert.deepEqual(addressLines(null), []);
});

test("a new Sage customer carries the contact, with a cellphone as Mobile", () => {
  const body = customerBody({ name: "Spar Philippi", address: "12 Main Road", city: "Cape Town", zip: null,
                              contact_name: "Thandi", email: "t@spar.example", phone: "+27 82 555 0142" });
  assert.equal(body.Name, "Spar Philippi");
  assert.equal(body.Mobile, "+27 82 555 0142");
  assert.equal("Telephone" in body, false);
  assert.equal(body.Email, "t@spar.example");
  assert.equal(body.PostalAddress01, "12 Main Road");
  assert.equal(body.DeliveryAddress02, "Cape Town");
  const landline = customerBody({ name: "X", address: null, city: null, zip: null, contact_name: null, email: null, phone: "021 555 0000" });
  assert.equal(landline.Telephone, "021 555 0000");
});

test("an invoice keeps Tickd's number, id, basis and line order", () => {
  const body = invoiceBody(invoice, 77, (l) => ({ itemId: l.product_id ? 501 : 500, taxTypeId: 1 }));
  assert.equal(body.CustomerId, 77);
  assert.equal(body.DocumentNumber, "INV-000123");
  assert.equal(body.ExternalReference, invoice.id);
  assert.equal(body.Reference, "PO 4411");
  assert.equal(body.Date, "2026-10-30");
  assert.equal(body.DueDate, "2026-11-29");
  assert.equal(body.Inclusive, false);
  assert.deepEqual(body.Lines.map((l) => [l.SelectionId, l.Quantity, l.UnitPriceExclusive, l.TaxTypeId]),
                   [[501, 2, 120, 1], [500, 1, 50, 1]]);
  const incl = invoiceBody({ ...invoice, prices_include_vat: true }, 77, () => ({ itemId: 500, taxTypeId: null }));
  assert.equal(incl.Lines[0].UnitPriceInclusive, 120);
  assert.equal("TaxTypeId" in incl.Lines[0], false);
});

test("a credit note takes back its invoice lines; a rebate is one line", () => {
  const cn: CreditNote = { id: "cn1", credit_number: "CN-000009", invoice_id: invoice.id, reason: "Short delivery",
                           issue_date: "2026-10-31", subtotal: 120, total: 138,
                           lines: [{ invoice_line_id: "l1", qty: 1, unit_price: 120, line_total: 120 }] };
  const body = returnBody(cn, invoice, 77, (l) => ({ itemId: l?.product_id ? 501 : 500, taxTypeId: 1 }));
  assert.equal(body.DocumentNumber, "CN-000009");
  assert.equal(body.Reference, "INV-000123");
  assert.deepEqual(body.Lines.map((l) => [l.SelectionId, l.Description, l.Quantity, l.UnitPriceExclusive]),
                   [[501, "Still 500ml x24", 1, 120]]);
  const rebate = returnBody({ ...cn, reason: "Rebate 5%", lines: [] }, invoice, 77, () => ({ itemId: 500, taxTypeId: 1 }));
  assert.deepEqual(rebate.Lines.map((l) => [l.SelectionId, l.Description, l.Quantity, l.UnitPriceExclusive]),
                   [[500, "Rebate 5%", 1, 120]]);
});

test("a payment becomes a receipt into the chosen bank account", () => {
  const body = receiptBody({ id: "p1", invoice_id: invoice.id, amount: 100.005, paid_on: "2026-10-31", method: "cash", reference: null },
                           invoice, 77, 8);
  assert.deepEqual(body, { CustomerId: 77, Date: "2026-10-31", Total: 100.01, BankAccountId: 8, PaymentMethod: 1,
                           Reference: "INV-000123", Description: "Payment on INV-000123" });
  assert.equal(receiptBody({ id: "p", invoice_id: "i", amount: 1, paid_on: "2026-10-31", method: "eft", reference: "R1" },
                           invoice, 77, 8).PaymentMethod, 4);
});

// ------------------------------------------------------------------ the sender

type Call = { method: string; path: string; body: unknown; companyid: string | null };

function fakeSage(script: (call: Call) => { status?: number; body?: unknown } | undefined) {
  const calls: Call[] = [];
  let nextId = 1000;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/api/2.0.0/", ""),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      companyid: url.searchParams.get("companyid"),
    };
    calls.push(call);
    const scripted = script(call);
    if (scripted) return new Response(JSON.stringify(scripted.body ?? {}), { status: scripted.status ?? 200 });
    if (call.method === "GET") {
      const results =
        call.path === "TaxType/Get"
          ? [{ ID: 1, Name: "Standard Rate", Percentage: 15, IsDefault: true, Active: true }]
          : [];
      return new Response(JSON.stringify({ TotalResults: results.length, ReturnedResults: results.length, Results: results }));
    }
    return new Response(JSON.stringify({ ID: nextId++ }), { status: 201 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function fakeDb(rows: QueueRow[], extra: Partial<{ conn: Connection | null; sealed: string | null }> = {}) {
  const links = new Map<string, number>();
  const finished: { row: QueueRow; result: FinishInput }[] = [];
  const paused: { until: "infinity" | Date; message: string }[] = [];
  const key = (k: LinkKind, id: string) => `${k}:${id}`;
  const conn = extra.conn === undefined ? { org_id: ORG, company_id: 42, bank_account_id: 8 } : extra.conn;
  const sealed = extra.sealed === undefined ? seal({ kind: "password", username: "u", password: "p" }, ORG, KEY) : extra.sealed;
  const queueStatus = new Map<string, string>();
  const db: SyncDb = {
    claim: async () => rows,
    requeueStale: async () => {},
    connection: async () => conn,
    sealedSignIn: async () => sealed,
    link: async (_o, _c, k, id) => links.get(key(k, id)) ?? null,
    setLink: async (_o, _c, k, id, remote) => {
      links.set(key(k, id), remote);
    },
    invoice: async (id) => (id === invoice.id ? invoice : null),
    creditNote: async (id) =>
      id === "cn1"
        ? { id: "cn1", credit_number: "CN-1", invoice_id: invoice.id, reason: "Short", issue_date: "2026-10-30",
            subtotal: 120, total: 138, lines: [{ invoice_line_id: "l1", qty: 1, unit_price: 120, line_total: 120 }] }
        : null,
    payment: async (id) =>
      id === "pay1" ? { id: "pay1", invoice_id: invoice.id, amount: 100, paid_on: "2026-10-31", method: "eft", reference: null } : null,
    customer: async () => ({ name: "Spar Philippi", address: "12 Main Road", city: "Cape Town", zip: null,
                             contact_name: null, email: null, phone: null }),
    products: async () => new Map([["p1", { code: "AQ-500", name: "Still 500ml x24" }]]),
    queueStatus: async (_o, kind, id) => queueStatus.get(`${kind}:${id}`) ?? null,
    finish: async (row, result) => {
      finished.push({ row, result });
    },
    pause: async (_o, until, message) => {
      paused.push({ until, message });
    },
  };
  return { db, links, finished, paused, queueStatus, key };
}

const row = (kind: string, local: string, extra: Partial<QueueRow> = {}): QueueRow => ({
  id: `${kind}-${local}`,
  org_id: ORG,
  kind,
  local_id: local,
  label: kind,
  remote_id: null,
  attempts: 1,
  send_after: "2026-10-30T10:00:00Z",
  created_at: "2026-10-30T10:00:00Z",
  ...extra,
});

const deps = (db: SyncDb, fetchImpl: typeof fetch) => ({
  db,
  config: { baseUrl: "https://resellers.accounting.sageone.co.za/api/2.0.0", apiKey: "K" },
  secretKey: KEY,
  fetchImpl,
  deadline: Date.now() + 60_000,
  gapMs: 0,
});

test("an invoice, its credit note and a payment reach Sage in order, each linked", async () => {
  const sage = fakeSage(() => undefined);
  const rows = [row("payment", "pay1"), row("credit_note", "cn1"), row("invoice", invoice.id)];
  const f = fakeDb(rows);
  const result = await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.deepEqual(result, { claimed: 3, sent: 3, failed: 0, waiting: 0 });
  assert.deepEqual(f.finished.map((x) => x.row.kind), ["invoice", "credit_note", "payment"]);
  const posts = sage.calls.filter((c) => c.method === "POST").map((c) => c.path);
  assert.deepEqual(posts, ["Customer/Save", "Item/Save", "Item/Save", "TaxInvoice/Save", "CustomerReturn/Save",
                           "Allocation/Save", "CustomerReceipt/Save", "Allocation/Save"]);
  assert.ok(sage.calls.every((c) => c.companyid === "42"));
  assert.ok(f.links.get(f.key("customer", invoice.store_id!)));
  assert.ok(f.links.get(f.key("item", "p1")));
  assert.ok(f.links.get(f.key("item", NO_PRODUCT)));
  assert.ok(f.links.get(f.key("allocation", "cn1")));
  assert.ok(f.links.get(f.key("allocation", "pay1")));
  const inv = sage.calls.find((c) => c.path === "TaxInvoice/Save")!.body as { CustomerId: number; Lines: { SelectionId: number }[] };
  assert.equal(inv.CustomerId, f.links.get(f.key("customer", invoice.store_id!)));
  assert.equal(inv.Lines[0].SelectionId, f.links.get(f.key("item", "p1")));
  // The first finish counted every call it made (customers, items, tax types, saves).
  assert.ok(f.finished[0].result.calls >= 6);
});

test("what is already in Sage is not sent again", async () => {
  const sage = fakeSage(() => undefined);
  const f = fakeDb([row("invoice", invoice.id)]);
  f.links.set(f.key("invoice", invoice.id), 555);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.equal(sage.calls.length, 0);
  assert.deepEqual(f.finished[0].result, { ok: true, remoteId: 555, calls: 0 });
});

test("a second attempt finds the invoice the first one saved", async () => {
  const sage = fakeSage((c) =>
    c.path === "TaxInvoice/Get" ? { body: { TotalResults: 1, ReturnedResults: 1, Results: [{ ID: 777, ExternalReference: invoice.id }] } } : undefined,
  );
  const f = fakeDb([row("invoice", invoice.id, { attempts: 2 })]);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.equal(sage.calls.some((c) => c.path === "TaxInvoice/Save"), false);
  assert.equal(f.links.get(f.key("invoice", invoice.id)), 777);
});

test("a customer already in Sage is used, not made again; two of them is the office's question", async () => {
  const sage = fakeSage((c) =>
    c.path === "Customer/Get" ? { body: { TotalResults: 1, ReturnedResults: 1, Results: [{ ID: 31, Name: "SPAR PHILIPPI" }] } } : undefined,
  );
  const f = fakeDb([row("invoice", invoice.id)]);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.equal(sage.calls.some((c) => c.path === "Customer/Save"), false);
  assert.equal(f.links.get(f.key("customer", invoice.store_id!)), 31);

  const twice = fakeSage((c) =>
    c.path === "Customer/Get"
      ? { body: { TotalResults: 2, ReturnedResults: 2, Results: [{ ID: 31, Name: "Spar Philippi" }, { ID: 32, Name: "spar philippi" }] } }
      : undefined,
  );
  const g = fakeDb([row("invoice", invoice.id)]);
  await runAccountingSync(deps(g.db, twice.fetchImpl));
  const r = g.finished[0].result as { fail: string; permanent: boolean };
  assert.equal(r.permanent, true);
  assert.match(r.fail, /more than one customer called "Spar Philippi"/);
});

test("a credit note waits for its invoice, also while the invoice waits for the office", async () => {
  const sage = fakeSage(() => undefined);
  for (const status of ["queued", "sending", "failed"]) {
    const f = fakeDb([row("credit_note", "cn1")]);
    f.queueStatus.set(`invoice:${invoice.id}`, status);
    await runAccountingSync(deps(f.db, sage.fetchImpl));
    assert.match((f.finished[0].result as { wait: string }).wait, /Waiting for INV-000123/, status);
  }
  assert.equal(sage.calls.length, 0);

  const g = fakeDb([row("credit_note", "cn1")]);
  g.queueStatus.set(`invoice:${invoice.id}`, "skipped");
  await runAccountingSync(deps(g.db, sage.fetchImpl));
  assert.match((g.finished[0].result as { fail: string }).fail, /not being sent to Sage/);
});

test("a payment deleted mid-send waits for that send; a disconnect mid-run loses nothing", async () => {
  const sage = fakeSage(() => undefined);
  const f = fakeDb([row("payment_removed", "pay1")]);
  f.queueStatus.set("payment:pay1", "sending");
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.ok("wait" in f.finished[0].result);
  const g = fakeDb([row("payment_removed", "pay1")]);
  g.queueStatus.set("payment:pay1", "skipped");
  await runAccountingSync(deps(g.db, sage.fetchImpl));
  assert.ok("skip" in g.finished[0].result);

  const h = fakeDb([row("invoice", invoice.id), row("payment", "pay1")], { conn: null });
  await runAccountingSync(deps(h.db, sage.fetchImpl));
  assert.ok(h.finished.every((x) => "wait" in x.result));
  assert.equal(sage.calls.length, 0);
});

test("lists are read to the last short page; an active item is preferred", async () => {
  const pages: number[] = [];
  const sage = fakeSage((c) => {
    if (c.path !== "Customer/Get") return undefined;
    const n = pages.length;
    pages.push(n);
    const results = Array.from({ length: n === 0 ? 100 : 3 }, (_, i) => ({ ID: n * 100 + i + 1, Name: `C${n * 100 + i}` }));
    return { body: { Results: results } };
  });
  const f = fakeDb([row("invoice", invoice.id)]);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.equal(pages.length, 2);
  assert.equal(matchItem("A1", [{ ID: 1, Code: "A1", Active: false }, { ID: 2, Code: "a1", Active: true }])?.ID, 2);
  assert.equal(matchItem("A1", [{ ID: 1, Code: "A1", Active: false }])?.ID, 1);
});

test("a refused sign-in stops the company at once, for good, and nothing else is tried", async () => {
  const sage = fakeSage(() => ({ status: 401, body: { Message: "Authorization has been denied." } }));
  const rows = [row("invoice", invoice.id), row("payment", "pay1")];
  const f = fakeDb(rows);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.equal(sage.calls.length, 1);
  assert.equal(f.paused.length, 1);
  assert.equal(f.paused[0].until, "infinity");
  assert.ok(f.finished.every((x) => "wait" in x.result));
});

test("Sage's rate limit pauses the company for over an hour", async () => {
  const sage = fakeSage(() => ({ status: 429, body: "blocked" }));
  const f = fakeDb([row("invoice", invoice.id)]);
  const before = Date.now();
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  const until = f.paused[0].until as Date;
  assert.ok(until.getTime() - before >= 60 * 60 * 1000);
});

test("rejected data fails for good with Sage's words; a server error is tried again", async () => {
  const bad = fakeSage((c) => (c.path === "TaxInvoice/Save" ? { status: 400, body: { Message: "Document number exists." } } : undefined));
  const f = fakeDb([row("invoice", invoice.id)]);
  await runAccountingSync(deps(f.db, bad.fetchImpl));
  assert.deepEqual(f.finished[0].result, { fail: "Sage did not accept it: Document number exists.", permanent: true,
                                           calls: f.finished[0].result.calls });
  const down = fakeSage(() => ({ status: 503 }));
  const g = fakeDb([row("invoice", invoice.id)]);
  await runAccountingSync(deps(g.db, down.fetchImpl));
  assert.equal((g.finished[0].result as { permanent: boolean }).permanent, false);
});

test("a removed payment takes its allocation and receipt out of Sage", async () => {
  const sage = fakeSage(() => undefined);
  const f = fakeDb([row("payment_removed", "gone", { remote_id: 900 })]);
  f.links.set(f.key("allocation", "gone"), 901);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.deepEqual(sage.calls.map((c) => `${c.method} ${c.path}`), ["DELETE Allocation/Delete/901", "POST CustomerReceipt/Delete/900"]);
  assert.deepEqual(f.finished[0].result, { ok: true, remoteId: 900, calls: 2 });
});

test("an invoice voided after it reached Sage asks the office to void it there", async () => {
  const sage = fakeSage(() => undefined);
  const f = fakeDb([row("invoice_voided", invoice.id, { label: "INV-000123" })]);
  f.links.set(f.key("invoice", invoice.id), 555);
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  const r = f.finished[0].result as { fail: string; permanent: boolean };
  assert.equal(r.permanent, true);
  assert.match(r.fail, /INV-000123 was voided in Tickd after it reached Sage/);
  const g = fakeDb([row("invoice_voided", invoice.id)]);
  await runAccountingSync(deps(g.db, sage.fetchImpl));
  assert.ok("skip" in g.finished[0].result);
});

test("an unreadable sign-in pauses the company; nothing past the deadline starts", async () => {
  const sage = fakeSage(() => undefined);
  const f = fakeDb([row("invoice", invoice.id)], { sealed: "v1.nonsense-that-will-not-open" });
  await runAccountingSync(deps(f.db, sage.fetchImpl));
  assert.equal(sage.calls.length, 0);
  assert.equal(f.paused[0].until, "infinity");

  const g = fakeDb([row("invoice", invoice.id)]);
  await runAccountingSync({ ...deps(g.db, sage.fetchImpl), deadline: Date.now() - 1 });
  assert.equal(sage.calls.length, 0);
  assert.ok("wait" in g.finished[0].result);
});

test("rows go invoice first when they fall due together", () => {
  const rows = [row("payment", "a"), row("invoice_voided", "b"), row("credit_note", "c"), row("invoice", "d")];
  assert.deepEqual(inOrder(rows).map((r) => r.kind), ["invoice", "credit_note", "payment", "invoice_voided"]);
});

// -------------------------------------------------------------- connecting

import { dayIn, readSageInput, sendFromDay } from "@/lib/accounting/connect";

test("the send-from day is within the last year and not after today", () => {
  assert.equal(sendFromDay("2026-10-01", "2026-10-30"), "2026-10-01");
  assert.equal(sendFromDay("2026-10-30", "2026-10-30"), "2026-10-30");
  assert.equal(sendFromDay("2026-10-31", "2026-10-30"), null);
  assert.equal(sendFromDay("2025-10-29", "2026-10-30"), null);
  assert.equal(sendFromDay("2026-02-30", "2026-10-30"), null);
  assert.equal(sendFromDay(20261001, "2026-10-30"), null);
  assert.equal(dayIn("Africa/Johannesburg", new Date("2026-10-30T22:30:00Z")), "2026-10-31");
});

test("what the Sage tab sends is checked before Sage is asked", () => {
  assert.deepEqual(readSageInput({ step: "disconnect" }, "2026-10-30"), { step: "disconnect" });
  assert.deepEqual(readSageInput({ step: "check", username: " a@b.co ", password: "pw" }, "2026-10-30"),
                   { step: "check", username: "a@b.co", password: "pw" });
  assert.match((readSageInput({ step: "check", username: "", password: "pw" }, "2026-10-30") as { error: string }).error, /email/);
  assert.match((readSageInput({ step: "check", username: "a", password: "" }, "2026-10-30") as { error: string }).error, /password/);
  const ok = { step: "connect", username: "a", password: "p", companyId: 5, bankAccountId: 7, syncFrom: "2026-10-30" };
  assert.deepEqual(readSageInput(ok, "2026-10-30"), ok);
  assert.match((readSageInput({ ...ok, companyId: "5" }, "2026-10-30") as { error: string }).error, /company/);
  assert.match((readSageInput({ ...ok, bankAccountId: 0 }, "2026-10-30") as { error: string }).error, /bank account/);
  assert.match((readSageInput({ ...ok, syncFrom: "2027-01-01" }, "2026-10-30") as { error: string }).error, /day/);
  assert.deepEqual(readSageInput({ step: "delete" }, "2026-10-30"), { error: "Unknown step." });
  assert.deepEqual(readSageInput(null, "2026-10-30"), { error: "Nothing was sent." });
});
