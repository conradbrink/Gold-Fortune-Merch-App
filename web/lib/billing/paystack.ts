import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack, used only to take the company's card and charge it (owner,
 * 22 Oct 2026, in place of Payfast).
 *
 * The first payment, a payment after a failed renewal and "Update card" are
 * made on Paystack's own page (`/transaction/initialize`): the card is
 * entered there, never here, and Paystack hands back an authorization that
 * can be charged again. Renewals and more reps are charged to it with
 * `/transaction/charge_authorization`. What to charge is always decided by
 * the database (`billing_*` functions); this file only speaks Paystack's
 * formats. Every call is made from the server with the secret key; the
 * browser only ever sees the page address Paystack returns.
 *
 * Amounts are whole cents (Paystack's "subunit"), in ZAR.
 *
 * Pure apart from `paystackRequest` and the four calls built on it.
 */

export const PAYSTACK_API = "https://api.paystack.co";
export const CURRENCY = "ZAR";

export type PaystackConfig = { secretKey: string; publicKey: string | null; test: boolean };

/** From the server's environment; null until the secret key is set. */
export function paystackConfig(env: Record<string, string | undefined> = process.env): PaystackConfig | null {
  const secretKey = env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) return null;
  const publicKey = env.PAYSTACK_PUBLIC_KEY?.trim() || null;
  return { secretKey, publicKey, test: secretKey.startsWith("sk_test_") };
}

// ---------------------------------------------------------------- references

const REFERENCE = /^TKD-([0-9a-f]{8})-([0-9a-f]{32})-([0-9]{10,16})$/;

/**
 * A new reference for one try at one charge: TKD-<company>-<charge>-<time>.
 * The charge is in it, so any answer from Paystack (the webhook, a verify, a
 * queued charge that lands later) leads back to the charge it pays.
 */
export function makeReference(orgId: string, chargeId: string, now: Date = new Date()): string {
  const org = orgId.replace(/-/g, "").toLowerCase().slice(0, 8);
  const charge = chargeId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(org) || !/^[0-9a-f]{32}$/.test(charge)) throw new Error("Not a company and charge id.");
  return `TKD-${org}-${charge}-${now.getTime()}`;
}

/** The charge a reference pays, or null when it is not one of ours. */
export function parseReference(reference: unknown): { orgPrefix: string; chargeId: string } | null {
  if (typeof reference !== "string") return null;
  const m = REFERENCE.exec(reference);
  if (!m) return null;
  const h = m[2];
  return {
    orgPrefix: m[1],
    chargeId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
  };
}

// ---------------------------------------------------------------- the webhook

/** Paystack signs the raw body with the secret key: HMAC SHA512, hex. */
export function webhookSignature(rawBody: string, secretKey: string): string {
  return createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex");
}

/** Whether `x-paystack-signature` is the body's signature, compared in constant time. */
export function signatureValid(rawBody: string, header: string | null | undefined, secretKey: string): boolean {
  const given = (header ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(given)) return false;
  const expected = Buffer.from(webhookSignature(rawBody, secretKey), "hex");
  return timingSafeEqual(Buffer.from(given, "hex"), expected);
}

// ---------------------------------------------------------------- what we send

/** Whole, positive cents, or it is not sent. */
export function assertCents(cents: unknown): number {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error(`Not an amount in cents: ${String(cents)}`);
  }
  return cents;
}

export type CheckoutPurpose = "subscribe" | "pay_due" | "card";

export type ChargeMetadata = {
  organization_id: string;
  charge_id: string;
  reason: string;
  reps: number | null;
  period: string;
  includes_setup_fee: boolean;
  /** "checkout" on Paystack's page; "saved_card" when we charged the card. */
  method: "checkout" | "saved_card";
  purpose?: CheckoutPurpose;
  cancel_action?: string;
};

/** The body of `/transaction/initialize`: card only, ZAR, our reference. */
export function initializeBody(input: {
  email: string;
  amountCents: number;
  reference: string;
  callbackUrl: string;
  metadata: ChargeMetadata;
}) {
  return {
    email: input.email,
    amount: assertCents(input.amountCents),
    currency: CURRENCY,
    channels: ["card"],
    reference: input.reference,
    callback_url: input.callbackUrl,
    metadata: input.metadata,
  };
}

/** The body of `/transaction/charge_authorization`, queued as Paystack asks of scheduled charges. */
export function chargeAuthorizationBody(input: {
  authorizationCode: string;
  email: string;
  amountCents: number;
  reference: string;
  metadata: ChargeMetadata;
}) {
  return {
    authorization_code: input.authorizationCode,
    email: input.email,
    amount: assertCents(input.amountCents),
    currency: CURRENCY,
    reference: input.reference,
    metadata: input.metadata,
    queue: true,
  };
}

// ---------------------------------------------------------------- what comes back

export type Card = {
  authorization_code: string;
  reusable: boolean;
  last4: string | null;
  exp_month: string | null;
  exp_year: string | null;
  brand: string | null;
  card_type: string | null;
  bank: string | null;
  country_code: string | null;
  signature: string | null;
  email: string | null;
  customer_code: string | null;
};

export type Transaction = {
  id: number | null;
  reference: string | null;
  /** success, failed, abandoned, ongoing, pending, processing, queued, reversed… */
  status: string;
  amountCents: number | null;
  currency: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  metadata: Record<string, unknown>;
  card: Card | null;
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Paystack sends metadata back as an object, or as the JSON string it was given. */
function metadataOf(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      return obj(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return obj(v);
}

/** A transaction as Paystack describes it (webhook `data`, verify `data`, charge `data`), field by field. */
export function readTransaction(raw: unknown): Transaction {
  const d = obj(raw);
  const auth = obj(d.authorization);
  const customer = obj(d.customer);
  const code = str(auth.authorization_code);
  const amount = d.amount;
  return {
    id: typeof d.id === "number" ? d.id : null,
    reference: str(d.reference),
    status: (str(d.status) ?? "").toLowerCase(),
    amountCents: typeof amount === "number" && Number.isSafeInteger(amount) ? amount : null,
    currency: str(d.currency)?.toUpperCase() ?? null,
    gatewayResponse: str(d.gateway_response),
    paidAt: str(d.paid_at ?? d.paidAt),
    metadata: metadataOf(d.metadata),
    card: code
      ? {
          authorization_code: code,
          reusable: auth.reusable === true,
          last4: str(auth.last4),
          exp_month: str(auth.exp_month),
          exp_year: str(auth.exp_year),
          brand: str(auth.brand),
          card_type: str(auth.card_type),
          bank: str(auth.bank),
          country_code: str(auth.country_code),
          signature: str(auth.signature),
          email: str(customer.email),
          customer_code: str(customer.customer_code),
        }
      : null,
  };
}

/**
 * Whether a transaction is paid in full for a charge: status success, our
 * currency, the charge's amount to the cent. The database checks the amount
 * and currency again when it records the payment.
 */
export function paidInFull(tx: Transaction, chargeCents: number): boolean {
  return tx.status === "success" && tx.currency === CURRENCY && tx.amountCents === chargeCents;
}

/** Still in Paystack's hands: neither paid nor failed yet. */
export function stillOpen(tx: Transaction): boolean {
  return ["ongoing", "pending", "processing", "queued", "send_otp", "send_pin", "send_birthday", "send_phone", "open_url"].includes(
    tx.status
  );
}

/**
 * The transaction to keep in the payment log: what Paystack said, without the
 * authorization code (it charges the card) and without anything a log has no
 * use for.
 */
export function loggable(raw: unknown): Record<string, unknown> {
  const d = obj(raw);
  const auth = obj(d.authorization);
  const customer = obj(d.customer);
  return {
    id: d.id ?? null,
    reference: d.reference ?? null,
    status: d.status ?? null,
    amount: d.amount ?? null,
    currency: d.currency ?? null,
    gateway_response: d.gateway_response ?? null,
    paid_at: d.paid_at ?? d.paidAt ?? null,
    channel: d.channel ?? null,
    metadata: metadataOf(d.metadata),
    authorization: Object.keys(auth).length
      ? {
          last4: auth.last4 ?? null,
          exp_month: auth.exp_month ?? null,
          exp_year: auth.exp_year ?? null,
          brand: auth.brand ?? null,
          card_type: auth.card_type ?? null,
          bank: auth.bank ?? null,
          country_code: auth.country_code ?? null,
          reusable: auth.reusable ?? null,
        }
      : null,
    customer_code: customer.customer_code ?? null,
  };
}

// ---------------------------------------------------------------- the API

export type ApiResult = { ok: true; data: unknown; message: string } | { ok: false; status: number; message: string; data: unknown };

/** One call to Paystack with the secret key. Never throws: a network failure is an answer too. */
export async function paystackRequest(
  config: PaystackConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }
): Promise<ApiResult> {
  try {
    const res = await fetch(`${PAYSTACK_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = obj(await res.json().catch(() => null));
    const message = typeof json.message === "string" ? json.message : `HTTP ${res.status}`;
    if (res.ok && json.status === true) return { ok: true, data: json.data ?? null, message };
    return { ok: false, status: res.status, message, data: json.data ?? null };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Paystack could not be reached", data: null };
  }
}

export async function initializeTransaction(config: PaystackConfig, body: ReturnType<typeof initializeBody>) {
  const r = await paystackRequest(config, "/transaction/initialize", { method: "POST", body });
  if (!r.ok) return r;
  const url = str(obj(r.data).authorization_url);
  return url?.startsWith("https://")
    ? { ...r, authorizationUrl: url }
    : { ok: false as const, status: 502, message: "Paystack gave no payment page.", data: r.data };
}

export async function verifyTransaction(config: PaystackConfig, reference: string) {
  if (!parseReference(reference)) return { ok: false as const, status: 400, message: "Not one of our references.", data: null };
  return paystackRequest(config, `/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function chargeAuthorization(config: PaystackConfig, body: ReturnType<typeof chargeAuthorizationBody>) {
  return paystackRequest(config, "/transaction/charge_authorization", { method: "POST", body });
}

export async function refundTransaction(config: PaystackConfig, reference: string) {
  return paystackRequest(config, "/refund", { method: "POST", body: { transaction: reference } });
}
