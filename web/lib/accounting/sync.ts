import { open } from "@/lib/accounting/secret";
import {
  SageError,
  matchCustomer,
  matchItem,
  officeMessage,
  pickTaxType,
  sageRequest,
  type SageAuth,
  type SageCall,
  type SageConfig,
  type SageCustomer,
  type SageDocument,
  type SageItem,
  type SagePage,
  type SageSignIn,
  type SageTaxType,
} from "@/lib/accounting/sage";
import {
  GENERIC_ITEM,
  allocationBody,
  customerBody,
  invoiceBody,
  itemBody,
  receiptBody,
  returnBody,
  type CreditNote,
  type Customer,
  type Invoice,
  type InvoiceLine,
  type LineIds,
  type Payment,
} from "@/lib/accounting/documents";

/**
 * Sends a company's queue to Sage (accounting_queue; the database decides
 * what is queued and when, `accounting_claim` hands out what is due, and
 * `accounting_finish` records how each went).
 *
 * One company's rows go one at a time, in order, at most one Sage call every
 * 0.7 seconds (Sage asks for no more than one a second on average, and blocks
 * a company for an hour past 100 a minute). Companies go side by side.
 *
 * Before a document, what it needs in Sage is found or made, and remembered
 * in accounting_links: the customer (matched by name, else created), an item
 * per product (matched by product code, else created; lines with no product
 * code use one "TICKD" item), and the tax type for the invoice's VAT rate.
 *
 * Every Sage record is linked the moment Sage returns its id, so a run that
 * dies between two calls (a return saved, its allocation not) carries on from
 * where it was. A second attempt at an invoice or credit note first looks
 * among Sage's latest documents for one with Tickd's id, in case the first
 * attempt got through and only its answer was lost.
 */

export type QueueRow = {
  id: string;
  org_id: string;
  kind: string;
  local_id: string;
  label: string;
  remote_id: number | null;
  attempts: number;
  send_after: string;
  created_at: string;
};

export type Connection = {
  org_id: string;
  company_id: number;
  bank_account_id: number | null;
};

export type LinkKind = "customer" | "item" | "invoice" | "credit_note" | "payment" | "allocation";

export type Outcome =
  | { ok: true; remoteId: number | null }
  | { wait: string }
  | { skip: string }
  | { fail: string; permanent: boolean };

export type FinishInput = Outcome & { calls: number };

/** What the sync reads and writes in Tickd's database (service role). */
export interface SyncDb {
  claim(): Promise<QueueRow[]>;
  requeueStale(olderThanMs: number): Promise<void>;
  connection(org: string): Promise<Connection | null>;
  sealedSignIn(org: string): Promise<string | null>;
  link(org: string, companyId: number, kind: LinkKind, localId: string): Promise<number | null>;
  setLink(org: string, companyId: number, kind: LinkKind, localId: string, remoteId: number): Promise<void>;
  invoice(id: string): Promise<Invoice | null>;
  creditNote(id: string): Promise<CreditNote | null>;
  payment(id: string): Promise<Payment | null>;
  customer(storeId: string): Promise<Customer | null>;
  products(ids: string[]): Promise<Map<string, { code: string | null; name: string }>>;
  invoiceQueueStatus(org: string, invoiceId: string): Promise<string | null>;
  finish(row: QueueRow, result: FinishInput): Promise<void>;
  pause(org: string, until: "infinity" | Date, message: string): Promise<void>;
}

export type SyncDeps = {
  db: SyncDb;
  config: SageConfig;
  secretKey: Buffer;
  fetchImpl?: typeof fetch;
  /** Stop starting rows after this (ms since epoch). */
  deadline: number;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** The generic item's link: there is no Tickd product behind it. */
export const NO_PRODUCT = "00000000-0000-0000-0000-000000000000";

const RANK: Record<string, number> = { invoice: 0, credit_note: 1, payment: 2, payment_removed: 3, invoice_voided: 4 };

/** Rows in the order they must reach Sage. */
export function inOrder(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort(
    (a, b) =>
      a.send_after.localeCompare(b.send_after) ||
      (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

class Wait extends Error {}

type Sealed = { kind: "password"; username: string; password: string };

class Company {
  private taxTypes: SageTaxType[] | null = null;
  private customers: SageCustomer[] | null = null;
  private items: SageItem[] | null = null;
  private lastCall = 0;
  readonly counter = { calls: 0 };
  readonly conn: Connection;
  private readonly auth: SageAuth;
  private readonly deps: SyncDeps;

  constructor(conn: Connection, auth: SageAuth, deps: SyncDeps) {
    this.conn = conn;
    this.auth = auth;
    this.deps = deps;
  }

  private get db() {
    return this.deps.db;
  }

  private get org() {
    return this.conn.org_id;
  }

  private get companyId() {
    return this.conn.company_id;
  }

  private async pace() {
    const now = this.deps.now ?? Date.now;
    const gap = this.deps.gapMs ?? 700;
    const wait = this.lastCall + gap - now();
    if (wait > 0) await (this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    this.lastCall = now();
  }

  async call<T>(call: Omit<SageCall, "companyId">): Promise<T> {
    await this.pace();
    return sageRequest<T>(this.auth, { ...call, companyId: this.companyId }, {
      fetchImpl: this.deps.fetchImpl,
      counter: this.counter,
    });
  }

  private async list<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 0; page < 50; page++) {
      const got = await this.call<SagePage<T>>({
        method: "GET",
        path,
        query: { $orderby: "ID", $top: 100, $skip: page * 100 },
      });
      const results = Array.isArray(got?.Results) ? got.Results : [];
      rows.push(...results);
      if (results.length < 100 || rows.length >= (got?.TotalResults ?? 0)) break;
    }
    return rows;
  }

  // --------------------------------------------------------- what documents need

  async taxTypeId(rate: number): Promise<number | null> {
    this.taxTypes ??= await this.list<SageTaxType>("TaxType/Get");
    const t = pickTaxType(Number(rate), this.taxTypes);
    if (t) return t.ID;
    if (Number(rate) === 0) return null;
    throw new SageError("refused", `Sage has no active tax type at ${Number(rate)}% VAT. Add one in Sage, then try again.`);
  }

  async customerId(inv: Invoice): Promise<number> {
    if (inv.store_id) {
      const linked = await this.db.link(this.org, this.companyId, "customer", inv.store_id);
      if (linked) return linked;
    }
    const details: Customer = (inv.store_id ? await this.db.customer(inv.store_id) : null) ?? {
      name: inv.customer_name,
      address: inv.customer_address,
      city: null,
      zip: null,
      contact_name: null,
      email: inv.customer_email,
      phone: null,
    };
    this.customers ??= await this.list<SageCustomer>("Customer/Get");
    const match = matchCustomer(details.name, this.customers);
    if (match === "several") {
      throw new SageError(
        "refused",
        `Sage has more than one customer called "${details.name}". Give one of them a different name in Sage, then try again.`,
      );
    }
    let id = match?.ID ?? null;
    if (!id) {
      const saved = await this.call<SageCustomer>({ method: "POST", path: "Customer/Save", body: customerBody(details) });
      if (!saved?.ID) throw new SageError("busy", "Sage did not say which customer it saved.");
      id = saved.ID;
      this.customers.push({ ID: id, Name: saved.Name ?? details.name, Active: true });
    }
    if (inv.store_id) await this.db.setLink(this.org, this.companyId, "customer", inv.store_id, id);
    return id;
  }

  private async itemId(localId: string, code: string, name: string, taxTypeId: number | null): Promise<number> {
    const linked = await this.db.link(this.org, this.companyId, "item", localId);
    if (linked) return linked;
    this.items ??= await this.list<SageItem>("Item/Get");
    let id = matchItem(code, this.items)?.ID ?? null;
    if (!id) {
      const saved = await this.call<SageItem>({ method: "POST", path: "Item/Save", body: itemBody(code, name, taxTypeId) });
      if (!saved?.ID) throw new SageError("busy", "Sage did not say which item it saved.");
      id = saved.ID;
      this.items.push({ ID: id, Code: code, Description: name, Active: true });
    }
    await this.db.setLink(this.org, this.companyId, "item", localId, id);
    return id;
  }

  /** Sage's item and tax type for each line of an invoice. */
  async lineIds(inv: Invoice): Promise<(line: InvoiceLine | null) => LineIds> {
    const taxTypeId = await this.taxTypeId(inv.vat_rate);
    const productIds = [...new Set(inv.lines.map((l) => l.product_id).filter((p): p is string => !!p))];
    const products = await this.db.products(productIds);
    const byProduct = new Map<string, number>();
    let generic: number | null = null;
    const genericId = async () =>
      (generic ??= await this.itemId(NO_PRODUCT, GENERIC_ITEM.code, GENERIC_ITEM.name, taxTypeId));
    for (const id of productIds) {
      const p = products.get(id);
      byProduct.set(id, p?.code ? await this.itemId(id, p.code, p.name, taxTypeId) : await genericId());
    }
    const fallback = await genericId();
    return (line) => ({
      itemId: (line?.product_id && byProduct.get(line.product_id)) || fallback,
      taxTypeId,
    });
  }

  /** A document Sage already has with Tickd's id or number, among its latest 100. */
  async findDocument(path: "TaxInvoice" | "CustomerReturn", localId: string, number: string): Promise<number | null> {
    const got = await this.call<SagePage<SageDocument>>({
      method: "GET",
      path: `${path}/Get`,
      query: { $orderby: "ID desc", $top: 100 },
    });
    const hit = (got?.Results ?? []).find((d) => d.ExternalReference === localId || d.DocumentNumber === number);
    return hit?.ID ?? null;
  }

  /** The invoice in Sage, or why a document on it cannot go yet. */
  async invoiceInSage(invoiceId: string, number: string): Promise<number> {
    const remote = await this.db.link(this.org, this.companyId, "invoice", invoiceId);
    if (remote) return remote;
    const status = await this.db.invoiceQueueStatus(this.org, invoiceId);
    if (status === "queued" || status === "sending") throw new Wait(`Waiting for ${number} to reach Sage.`);
    throw new SageError("refused", `Its invoice ${number} has not reached Sage. Send the invoice first.`);
  }

  // ------------------------------------------------------------------ the kinds

  async invoice(row: QueueRow): Promise<Outcome> {
    const done = await this.db.link(this.org, this.companyId, "invoice", row.local_id);
    if (done) return { ok: true, remoteId: done };
    const inv = await this.db.invoice(row.local_id);
    if (!inv) return { skip: "The invoice no longer exists." };
    if (inv.status === "void") return { skip: "Voided before it was sent." };
    const customerId = await this.customerId(inv);
    const ids = await this.lineIds(inv);
    let id = row.attempts > 1 ? await this.findDocument("TaxInvoice", inv.id, inv.invoice_number) : null;
    if (!id) {
      const saved = await this.call<SageDocument>({
        method: "POST",
        path: "TaxInvoice/Save",
        query: { useSystemDocumentNumber: false },
        body: invoiceBody(inv, customerId, ids),
      });
      if (!saved?.ID) throw new SageError("busy", "Sage did not say which invoice it saved.");
      id = saved.ID;
    }
    await this.db.setLink(this.org, this.companyId, "invoice", inv.id, id);
    return { ok: true, remoteId: id };
  }

  async creditNote(row: QueueRow): Promise<Outcome> {
    const cn = await this.db.creditNote(row.local_id);
    let returnId = await this.db.link(this.org, this.companyId, "credit_note", row.local_id);
    if (returnId && (await this.db.link(this.org, this.companyId, "allocation", row.local_id))) {
      return { ok: true, remoteId: returnId };
    }
    if (!cn) return { skip: "The credit note no longer exists." };
    const inv = await this.db.invoice(cn.invoice_id);
    if (!inv) return { skip: "Its invoice no longer exists." };
    const invoiceId = await this.invoiceInSage(inv.id, inv.invoice_number);
    if (!returnId) {
      const customerId = await this.customerId(inv);
      const ids = await this.lineIds(inv);
      returnId = row.attempts > 1 ? await this.findDocument("CustomerReturn", cn.id, cn.credit_number) : null;
      if (!returnId) {
        const saved = await this.call<SageDocument>({
          method: "POST",
          path: "CustomerReturn/Save",
          query: { useSystemDocumentNumber: false },
          body: returnBody(cn, inv, customerId, ids),
        });
        if (!saved?.ID) throw new SageError("busy", "Sage did not say which credit note it saved.");
        returnId = saved.ID;
      }
      await this.db.setLink(this.org, this.companyId, "credit_note", cn.id, returnId);
    }
    await this.allocate(cn.id, returnId, invoiceId, cn.total);
    return { ok: true, remoteId: returnId };
  }

  async payment(row: QueueRow): Promise<Outcome> {
    let receiptId = await this.db.link(this.org, this.companyId, "payment", row.local_id);
    if (receiptId && (await this.db.link(this.org, this.companyId, "allocation", row.local_id))) {
      return { ok: true, remoteId: receiptId };
    }
    const p = await this.db.payment(row.local_id);
    if (!p) return { skip: "Deleted before it was sent." };
    const inv = await this.db.invoice(p.invoice_id);
    if (!inv) return { skip: "Its invoice no longer exists." };
    const invoiceId = await this.invoiceInSage(inv.id, inv.invoice_number);
    if (!receiptId) {
      if (!this.conn.bank_account_id) {
        throw new SageError("refused", "Choose the bank account payments go into, on the Sage page in Settings.");
      }
      const customerId = await this.customerId(inv);
      const body = receiptBody(p, inv, customerId, this.conn.bank_account_id);
      receiptId = row.attempts > 1 ? await this.findReceipt(body) : null;
      if (!receiptId) {
        const saved = await this.call<SageDocument>({ method: "POST", path: "CustomerReceipt/Save", body });
        if (!saved?.ID) throw new SageError("busy", "Sage did not say which receipt it saved.");
        receiptId = saved.ID;
      }
      await this.db.setLink(this.org, this.companyId, "payment", p.id, receiptId);
    }
    await this.allocate(p.id, receiptId, invoiceId, p.amount);
    return { ok: true, remoteId: receiptId };
  }

  private async findReceipt(body: ReturnType<typeof receiptBody>): Promise<number | null> {
    type Receipt = { ID: number; CustomerId?: number; Date?: string; Total?: number; Description?: string };
    const got = await this.call<SagePage<Receipt>>({
      method: "GET",
      path: "CustomerReceipt/Get",
      query: { $orderby: "ID desc", $top: 100 },
    });
    const hit = (got?.Results ?? []).find(
      (r) =>
        r.CustomerId === body.CustomerId &&
        (r.Date ?? "").slice(0, 10) === body.Date &&
        Math.abs(Number(r.Total) - body.Total) < 0.005 &&
        r.Description === body.Description,
    );
    return hit?.ID ?? null;
  }

  private async allocate(localId: string, sourceId: number, invoiceId: number, total: number) {
    if (await this.db.link(this.org, this.companyId, "allocation", localId)) return;
    const saved = await this.call<{ ID?: number }>({
      method: "POST",
      path: "Allocation/Save",
      body: allocationBody(sourceId, invoiceId, total),
    });
    if (saved?.ID) await this.db.setLink(this.org, this.companyId, "allocation", localId, saved.ID);
  }

  async paymentRemoved(row: QueueRow): Promise<Outcome> {
    const receiptId = row.remote_id ?? (await this.db.link(this.org, this.companyId, "payment", row.local_id));
    if (!receiptId) return { skip: "It never reached Sage." };
    const allocationId = await this.db.link(this.org, this.companyId, "allocation", row.local_id);
    const gone = (err: unknown) => err instanceof SageError && err.status === 404;
    if (allocationId) {
      await this.call({ method: "DELETE", path: `Allocation/Delete/${allocationId}` }).catch((err) => {
        if (!gone(err)) throw err;
      });
    }
    await this.call({ method: "POST", path: `CustomerReceipt/Delete/${receiptId}` }).catch((err) => {
      if (!gone(err)) throw err;
    });
    return { ok: true, remoteId: receiptId };
  }

  async invoiceVoided(row: QueueRow): Promise<Outcome> {
    const remote = await this.db.link(this.org, this.companyId, "invoice", row.local_id);
    if (!remote) return { skip: "It never reached Sage." };
    return {
      fail: `${row.label} was voided in Tickd after it reached Sage. Sage cannot be told to void it, so void it in Sage too, then press Done.`,
      permanent: true,
    };
  }

  send(row: QueueRow): Promise<Outcome> {
    switch (row.kind) {
      case "invoice":
        return this.invoice(row);
      case "credit_note":
        return this.creditNote(row);
      case "payment":
        return this.payment(row);
      case "payment_removed":
        return this.paymentRemoved(row);
      case "invoice_voided":
        return this.invoiceVoided(row);
      default:
        return Promise.resolve({ skip: `Nothing to send for ${row.kind}.` });
    }
  }
}

/** The sign-in sealed for a company, as Sage takes it. */
export function signInFrom(sealed: string | null, org: string, key: Buffer): SageSignIn | null {
  if (!sealed) return null;
  const s = open<Sealed>(sealed, org, key);
  if (!s || s.kind !== "password" || !s.username || !s.password) return null;
  return { kind: "password", username: s.username, password: s.password };
}

/** One company's claimed rows, one at a time. Returns how many went. */
export async function sendCompany(org: string, rows: QueueRow[], deps: SyncDeps): Promise<{ sent: number; failed: number; waiting: number }> {
  const { db } = deps;
  const tally = { sent: 0, failed: 0, waiting: 0 };
  const ordered = inOrder(rows);
  const waitAll = async (from: number, message: string) => {
    for (const row of ordered.slice(from)) {
      await db.finish(row, { wait: message, calls: 0 });
      tally.waiting += 1;
    }
  };

  const conn = await db.connection(org);
  if (!conn) {
    for (const row of ordered) {
      await db.finish(row, { skip: "Sage is no longer connected.", calls: 0 });
    }
    return tally;
  }
  const signIn = signInFrom(await db.sealedSignIn(org), org, deps.secretKey);
  if (!signIn) {
    await db.pause(org, "infinity", "Tickd cannot read the Sage sign-in. Connect Sage again.");
    await waitAll(0, "Waiting for Sage to be connected again.");
    return tally;
  }

  const company = new Company(conn, { config: deps.config, signIn }, deps);
  const now = deps.now ?? Date.now;
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    if (now() > deps.deadline) {
      await waitAll(i, "Waiting for the next run.");
      break;
    }
    const before = company.counter.calls;
    let outcome: Outcome;
    let stop: { until: "infinity" | Date; message: string } | null = null;
    try {
      outcome = await company.send(row);
    } catch (err) {
      if (err instanceof Wait) {
        outcome = { wait: err.message };
      } else if (err instanceof SageError) {
        const message = officeMessage(err);
        if (err.kind === "sign_in" || err.kind === "expired") {
          stop = { until: "infinity", message };
        } else if (err.kind === "limit") {
          stop = { until: new Date(now() + 65 * 60 * 1000), message };
        }
        outcome = stop ? { wait: message } : { fail: message, permanent: err.kind === "refused" };
      } else {
        console.error("accounting: unexpected error", row.kind, row.id, err);
        outcome = { fail: "Something went wrong in Tickd while sending this. Tickd will try again.", permanent: false };
      }
    }
    await db.finish(row, { ...outcome, calls: company.counter.calls - before });
    if ("ok" in outcome) tally.sent += 1;
    else if ("fail" in outcome) tally.failed += 1;
    else if ("wait" in outcome) tally.waiting += 1;
    if (stop) {
      await db.pause(org, stop.until, stop.message);
      await waitAll(i + 1, stop.message);
      break;
    }
  }
  return tally;
}

/** One run: settle rows a dead run left "sending", claim what is due, send it. */
export async function runAccountingSync(deps: SyncDeps) {
  await deps.db.requeueStale(15 * 60 * 1000);
  const rows = await deps.db.claim();
  const byOrg = new Map<string, QueueRow[]>();
  for (const row of rows) byOrg.set(row.org_id, [...(byOrg.get(row.org_id) ?? []), row]);
  const results = await Promise.all([...byOrg].map(([org, list]) => sendCompany(org, list, deps)));
  const total = { claimed: rows.length, sent: 0, failed: 0, waiting: 0 };
  for (const r of results) {
    total.sent += r.sent;
    total.failed += r.failed;
    total.waiting += r.waiting;
  }
  return total;
}
