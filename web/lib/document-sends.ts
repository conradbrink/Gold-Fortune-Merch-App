import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Sending an invoice, a quote, a client's statement or a payment reminder by
 * email (Stage 8.10). The database queues one email per address through the
 * outbox and writes down who it went to; this module is the app's side of it:
 * the calls, the people to send to, and the sentences the screens show.
 *
 * Everything that decides what is shown is a plain function so it can be
 * tested; the calls only wrap `supabase.rpc` and parse what comes back, as
 * the database returns Json.
 */

type Client = SupabaseClient<Database>;

/* ---------------------------------------------------------------- results */

export type SendResult = {
  linkId: string;
  /** Addresses an email was queued for. */
  queued: number;
  /** Addresses nothing was queued for: they asked us to stop, or it bounced. */
  suppressed: string[];
};

export type SendRow = {
  id: string;
  to: string;
  sentOn: string;
  /** The outbox row's status: queued, sending, sent, failed, suppressed or cancelled. */
  status: string | null;
  sentAt: string | null;
  error: string | null;
  openedAt: string | null;
  openCount: number;
};

/** The latest send of one document or client, for a column or a muted line. */
export type SendSummary = {
  relatedId: string | null;
  storeId: string | null;
  customerName: string | null;
  lastSentAt: string;
  lastStatus: string | null;
  lastOpenedAt: string | null;
  sends: number;
};

export type OverdueInvoice = {
  invoiceId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  total: number;
  /** What is still to pay on it. */
  outstanding: number;
  daysOverdue: number;
};

function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseSendResult(json: unknown): SendResult {
  const r = record(json);
  return {
    linkId: text(r.link_id) ?? "",
    queued: count(r.queued),
    suppressed: list(r.suppressed).filter((a): a is string => typeof a === "string"),
  };
}

export function parseSendRows(json: unknown): SendRow[] {
  return list(json).flatMap((x) => {
    const r = record(x);
    const id = text(r.id);
    const to = text(r.to);
    const sentOn = text(r.sent_on);
    if (!id || !to || !sentOn) return [];
    return [
      {
        id,
        to,
        sentOn,
        status: text(r.status),
        sentAt: text(r.sent_at),
        error: text(r.error),
        openedAt: text(r.opened_at),
        openCount: count(r.open_count),
      },
    ];
  });
}

export function parseSendSummaries(json: unknown): SendSummary[] {
  return list(json).flatMap((x) => {
    const r = record(x);
    const lastSentAt = text(r.last_sent_at);
    if (!lastSentAt) return [];
    return [
      {
        relatedId: text(r.related_id),
        storeId: text(r.store_id),
        customerName: text(r.customer_name),
        lastSentAt,
        lastStatus: text(r.last_status),
        lastOpenedAt: text(r.last_opened_at),
        sends: count(r.sends),
      },
    ];
  });
}

export function parseOverdueInvoices(json: unknown): OverdueInvoice[] {
  return list(json).flatMap((x) => {
    const r = record(x);
    const number = text(r.number);
    if (!number) return [];
    return [
      {
        invoiceId: text(r.invoice_id) ?? "",
        number,
        issueDate: text(r.issue_date) ?? "",
        dueDate: text(r.due_date) ?? "",
        total: count(r.total),
        outstanding: count(r.outstanding),
        daysOverdue: count(r.days_overdue),
      },
    ];
  });
}

/** What the database said, in words a person can act on. */
export function sendErrorText(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (!m) return "That did not work. Please try again.";
  if (/^permission denied/i.test(m)) return "You do not have permission to send documents.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "We could not reach the server. Check your connection and try again.";
  }
  return m;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(sendErrorText(error.message));
}

/* ------------------------------------------------------------------ sends */

export type SendOptions = { to: string[]; note?: string; copyMe?: boolean };

export async function sendInvoiceEmail(supabase: Client, invoiceId: string, o: SendOptions): Promise<SendResult> {
  const { data, error } = await supabase.rpc("send_invoice_email", {
    p_invoice_id: invoiceId,
    p_to: o.to,
    p_note: o.note?.trim() || null,
    p_copy_me: o.copyMe ?? false,
  });
  fail(error);
  return parseSendResult(data);
}

export async function sendQuoteEmail(supabase: Client, quoteId: string, o: SendOptions): Promise<SendResult> {
  const { data, error } = await supabase.rpc("send_quote_email", {
    p_quote_id: quoteId,
    p_to: o.to,
    p_note: o.note?.trim() || null,
    p_copy_me: o.copyMe ?? false,
  });
  fail(error);
  return parseSendResult(data);
}

/** A client: a place on the books, or the name on their invoices. */
export type SendClient = { storeId: string | null; name: string };

export async function sendStatementEmail(
  supabase: Client,
  client: SendClient,
  period: { from: string; to: string },
  o: SendOptions
): Promise<SendResult> {
  const { data, error } = await supabase.rpc("send_statement_email", {
    p_store_id: client.storeId,
    p_customer_name: client.storeId ? null : client.name,
    p_from: period.from,
    p_to: period.to,
    p_to_addrs: o.to,
    p_note: o.note?.trim() || null,
    p_copy_me: o.copyMe ?? false,
  });
  fail(error);
  return parseSendResult(data);
}

export type ReminderTone = "friendly" | "firm" | "final";

export async function sendPaymentReminder(
  supabase: Client,
  client: SendClient,
  o: { to: string[]; tone: ReminderTone; message: string; copyMe?: boolean }
): Promise<SendResult> {
  const { data, error } = await supabase.rpc("send_payment_reminder", {
    p_store_id: client.storeId,
    p_customer_name: client.storeId ? null : client.name,
    p_to_addrs: o.to,
    p_tone: o.tone,
    p_message: o.message,
    p_copy_me: o.copyMe ?? false,
  });
  fail(error);
  return parseSendResult(data);
}

export async function fetchOverdueInvoices(supabase: Client, client: SendClient): Promise<OverdueInvoice[]> {
  const { data, error } = await supabase.rpc("client_overdue_invoices", {
    p_store_id: client.storeId,
    p_customer_name: client.storeId ? null : client.name,
  });
  fail(error);
  return parseOverdueInvoices(data);
}

export async function fetchSendsFor(
  supabase: Client,
  kind: "invoice" | "quote",
  relatedId: string
): Promise<SendRow[]> {
  const { data, error } = await supabase.rpc("document_sends_for", { p_kind: kind, p_related_id: relatedId });
  fail(error);
  return parseSendRows(data);
}

export async function fetchSendSummary(
  supabase: Client,
  kind: "invoice" | "quote" | "statement" | "reminder"
): Promise<SendSummary[]> {
  const { data, error } = await supabase.rpc("document_send_summary", { p_kind: kind });
  fail(error);
  return parseSendSummaries(data);
}

/** The latest send of a document (by its id) or of a client (by place, else by lower case name). */
export type SendSummaries = { byDocument: Map<string, SendSummary>; byClient: Map<string, SendSummary> };

const clientKey = (c: SendClient) => (c.storeId ? `s:${c.storeId}` : `n:${c.name.trim().toLowerCase()}`);

export function indexSummaries(rows: SendSummary[]): SendSummaries {
  const byDocument = new Map<string, SendSummary>();
  const byClient = new Map<string, SendSummary>();
  for (const r of rows) {
    if (r.relatedId) byDocument.set(r.relatedId, r);
    else if (r.storeId) byClient.set(`s:${r.storeId}`, r);
    else if (r.customerName) byClient.set(`n:${r.customerName.trim().toLowerCase()}`, r);
  }
  return { byDocument, byClient };
}

export function summaryForClient(index: SendSummaries, client: SendClient): SendSummary | undefined {
  return index.byClient.get(clientKey(client));
}

/* -------------------------------------------------------------- addresses */

export const MAX_ADDRESSES = 5;
export const MAX_NOTE = 1000;
export const MAX_MESSAGE = 2000;

/** The database's own test of an address, so what the box accepts the database accepts. */
export function isEmailAddress(raw: string): boolean {
  const a = raw.trim();
  return a.length <= 254 && /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(a);
}

/** What was typed, split at commas, semicolons and spaces, in lower case. */
export function splitAddresses(typed: string): string[] {
  return typed
    .split(/[\s,;]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Adds what was typed (one address, or several pasted together) to the
 * addresses already chosen. Nothing is added if any piece is not an email
 * address or there would be too many: the person fixes it and tries again.
 */
export function addAddresses(
  current: string[],
  typed: string
): { addresses: string[]; error: string | null } {
  const pieces = splitAddresses(typed);
  const bad = pieces.find((p) => !isEmailAddress(p));
  if (bad) return { addresses: current, error: `${bad} is not an email address.` };
  const next = [...current];
  for (const p of pieces) if (!next.includes(p)) next.push(p);
  if (next.length > MAX_ADDRESSES) {
    return { addresses: current, error: `Send to at most ${MAX_ADDRESSES} addresses at a time.` };
  }
  return { addresses: next, error: null };
}

/**
 * Who a document goes to unless the person changes it: the address on the
 * document itself, else the people at the place who get the accounts. `known`
 * is every address the place already has on file, to tell which ones are new.
 */
export function recipientDefaults(
  documentEmail: string | null | undefined,
  contacts: { email: string | null; receives_accounts: boolean }[]
): { addresses: string[]; known: string[] } {
  const known = unique(contacts.map((c) => (c.email ?? "").trim().toLowerCase()).filter(isEmailAddress));
  const own = (documentEmail ?? "").trim().toLowerCase();
  if (isEmailAddress(own)) return { addresses: [own], known };
  const accounts = contacts
    .filter((c) => c.receives_accounts)
    .map((c) => (c.email ?? "").trim().toLowerCase())
    .filter(isEmailAddress);
  return { addresses: unique(accounts).slice(0, MAX_ADDRESSES), known };
}

/** The addresses worth offering to remember: a place is known and the address is not on file for it. */
export function newAddresses(storeId: string | null, addresses: string[], known: string[]): string[] {
  return storeId ? addresses.filter((a) => !known.includes(a)) : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export async function defaultRecipients(
  supabase: Client,
  where: { email?: string | null; storeId: string | null }
): Promise<{ addresses: string[]; known: string[] }> {
  let contacts: { email: string | null; receives_accounts: boolean }[] = [];
  if (where.storeId) {
    // The contacts only save typing: a failed read leaves the box empty.
    const { data } = await supabase.from("site_contacts").select("email, receives_accounts").eq("store_id", where.storeId);
    contacts = data ?? [];
  }
  return recipientDefaults(where.email, contacts);
}

/**
 * Keeps addresses on file for a place as its accounts contacts, so the next
 * document finds them. Failing is never the send's failure: the answer says
 * what to tell the person.
 */
export async function rememberAccountsContact(
  supabase: Client,
  where: { orgId: string; storeId: string; emails: string[] }
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (where.emails.length === 0) return { ok: true };
  const { data, error } = await supabase
    .from("site_contacts")
    .insert(
      where.emails.map((email) => ({
        org_id: where.orgId,
        store_id: where.storeId,
        name: "Accounts",
        email,
        receives_accounts: true,
        receives_reports: false,
      }))
    )
    .select("id");
  if (error) {
    return {
      ok: false,
      message: /row-level security/i.test(error.message) ? "Only a manager can change contacts." : error.message,
    };
  }
  if (!data?.length) return { ok: false, message: "Only a manager can change contacts." };
  return { ok: true };
}

/* --------------------------------------------------------------- sentences */

const addressWord = (n: number) => (n === 1 ? "address" : "addresses");

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What happened to a send, for the dialog once it is done. */
export function sendResultSentence(r: Pick<SendResult, "queued" | "suppressed">): string {
  const blocked = r.suppressed.length
    ? `${joinAnd(r.suppressed)} can't be emailed (they asked us to stop, or it bounced).`
    : "";
  if (r.queued === 0) return blocked ? `Nothing was sent. ${blocked}` : "Nothing was sent.";
  const sent = `Sent to ${r.queued} ${addressWord(r.queued)}.`;
  return blocked ? `${sent} ${blocked}` : sent;
}

/** What remembering the addresses came to, to follow the result sentence. */
export function rememberedSentence(
  emails: string[],
  clientName: string,
  outcome: { ok: true } | { ok: false; message: string }
): string {
  const these = emails.length === 1 ? "that address" : "those addresses";
  return outcome.ok
    ? `We will remember ${joinAnd(emails)} for ${clientName}.`
    : `We could not remember ${these} for ${clientName}. ${outcome.message}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct", and the year too when it is not this year's. In the reader's own timezone. */
export function shortDate(when: string | Date, now: Date = new Date()): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Whole calendar days from `then` to `now` in the reader's own timezone. */
function daysBetween(then: Date, now: Date): number {
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** "today", "yesterday", "3 days ago", and from a week on, the date. */
export function relativeTime(when: string | Date, now: Date = new Date()): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const days = daysBetween(d, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return shortDate(d, now);
}

/** One send, as the "Sent" line on an invoice or quote reads. */
export function sendLine(row: SendRow, now: Date = new Date()): { text: string; problem: boolean } {
  switch (row.status) {
    case "queued":
    case "sending":
      return { text: `Waiting to send to ${row.to}`, problem: false };
    case "failed": {
      const why = (row.error ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      return { text: why ? `Couldn't be delivered to ${row.to}: ${why}` : `Couldn't be delivered to ${row.to}`, problem: true };
    }
    case "suppressed":
      return { text: `Blocked address: ${row.to}`, problem: true };
    case "cancelled":
      return { text: `Cancelled, not sent to ${row.to}`, problem: true };
    default: {
      const on = shortDate(row.sentAt ?? row.sentOn, now);
      const opened = row.openedAt ? `Opened ${shortDate(row.openedAt, now)}` : "Not opened yet";
      return { text: `Sent to ${row.to} on ${on} · ${opened}`, problem: false };
    }
  }
}

/** The "Sent" column's cell: when it last went, whether it was opened, whether the last email never arrived. */
export function sentCell(
  s: SendSummary | undefined,
  now: Date = new Date()
): { date: string; opened: boolean; problem: boolean } | null {
  if (!s) return null;
  return {
    date: shortDate(s.lastSentAt, now),
    opened: s.lastOpenedAt !== null,
    problem: s.lastStatus === "failed" || s.lastStatus === "suppressed" || s.lastStatus === "cancelled",
  };
}

/* ----------------------------------------------------------------- email */

export type DocumentKind = "invoice" | "quote" | "statement" | "reminder";

/**
 * The subject line the client will see, for the preview in the dialog. The
 * email templates (lib/email/templates.ts) write the real one; this follows
 * them.
 */
export function documentSubject(
  kind: DocumentKind,
  a: { number?: string; company: string; period?: string; total?: string; final?: boolean }
): string {
  const from = a.company.trim() ? ` from ${a.company.trim()}` : "";
  switch (kind) {
    case "invoice":
      return `Invoice ${a.number ?? ""}`.trim() + from;
    case "quote":
      return `Quote ${a.number ?? ""}`.trim() + from;
    case "statement":
      return `Statement${from}${a.period ? `, ${a.period}` : ""}`;
    case "reminder":
      return `${a.final ? "Final notice" : "Payment reminder"}${from}${a.total ? `: ${a.total} overdue` : ""}`;
  }
}

/* --------------------------------------------------------------- reminders */

export const REMINDER_TONES: { key: ReminderTone; label: string; hint: string }[] = [
  { key: "friendly", label: "Friendly", hint: "A gentle nudge" },
  { key: "firm", label: "Firm", hint: "Asks for payment this week" },
  { key: "final", label: "Final notice", hint: "Seven days to pay or call" },
];

export const toneLabel = (tone: ReminderTone) => REMINDER_TONES.find((t) => t.key === tone)?.label ?? tone;

export type ReminderInvoice = { number: string; daysOverdue: number };

const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Longer lists end "and 4 more": the email lists every invoice itself. */
function invoiceList(invoices: ReminderInvoice[]): string {
  const shown = invoices.slice(0, 6).map((i) => `${i.number} (${dayCount(i.daysOverdue)})`);
  const more = invoices.length - shown.length;
  return joinAnd(more > 0 ? [...shown, `${more} more`] : shown);
}

function overdueSentence(invoices: ReminderInvoice[]): string {
  if (invoices.length === 1) {
    const [i] = invoices;
    return `Invoice ${i.number} is ${dayCount(i.daysOverdue)} overdue.`;
  }
  return `These invoices on your account are overdue: ${invoiceList(invoices)}.`;
}

/** Starts with a friendly nudge unless the oldest invoice is well past due. */
export function suggestedTone(oldestDaysOverdue: number): ReminderTone {
  return oldestDaysOverdue > 30 ? "firm" : "friendly";
}

/**
 * The message a reminder starts with, for the person to read and change. It
 * names the client, says which invoices are overdue and the total, and asks
 * them to pay or get in touch, a little firmer with each tone. Plain text,
 * with line breaks; it says "you" and "your account" so it reads the same for
 * any trade.
 */
export function reminderMessage(
  tone: ReminderTone,
  a: { client: string; invoices: ReminderInvoice[]; total: string }
): string {
  const oldest = Math.max(0, ...a.invoices.map((i) => i.daysOverdue));
  const overdue = overdueSentence(a.invoices);
  const age = a.invoices.length > 1 ? ` The oldest has been overdue for ${dayCount(oldest)}.` : "";
  const greeting = `Hi ${a.client},`;
  switch (tone) {
    case "friendly":
      return [
        greeting,
        `I hope you are well. This is a friendly reminder about your account. ${overdue}`,
        `The total still to pay is ${a.total}. If you have already paid, thank you, and please ignore this message. If not, please pay when you can, or get in touch if something is holding it up.`,
        "Thank you.",
      ].join("\n\n");
    case "firm":
      return [
        greeting,
        `Your account is overdue and we have not yet received payment. ${overdue}${age}`,
        `The total still to pay is ${a.total}. Please pay it this week. If there is a problem, please get in touch with us today so that we can sort it out. If you have already paid, please send us your proof of payment.`,
        "Thank you.",
      ].join("\n\n");
    case "final":
      return [
        greeting,
        `This is a final notice about your overdue account. ${overdue}${age}`,
        `The total still to pay is ${a.total}. Please pay it within 7 days of this message, or call us before then so that we can talk about it. If you have already paid, please send us your proof of payment right away.`,
        "Thank you.",
      ].join("\n\n");
  }
}
