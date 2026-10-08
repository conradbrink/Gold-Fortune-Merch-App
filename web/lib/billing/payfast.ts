import { createHash } from "node:crypto";

/**
 * Payfast, used only to keep a company's card and charge it (Stage 6).
 *
 * The first payment is made on Payfast's own page with tokenization on
 * (`subscription_type=2`): the card is entered there, never here, and Payfast
 * hands back a token in its notification. Every later amount — renewals, more
 * seats — is charged to that token through the ad-hoc API. What to charge is
 * always decided by the database (`billing_*` functions); this file only speaks
 * Payfast's formats.
 *
 * The signing rules follow Payfast's developer documentation:
 *  - the payment form and notifications: the fields in their documented order
 *    (a notification: in the order received), empty ones left out, each value
 *    trimmed and URL-encoded the way PHP's `urlencode` does it (spaces as `+`,
 *    upper-case escapes), joined with `&`, then `&passphrase=…`, MD5 in hex;
 *  - the API: header and body fields plus the passphrase, sorted by name, the
 *    same encoding, MD5.
 *
 * ⚠️ Checked against the documented examples in tests/billing.test.ts, but not
 * yet against Payfast itself: the sandbox run is the first thing to do once the
 * sandbox keys are in Vercel (see the Stage 6 plan).
 *
 * Pure apart from `validateWithPayfast`, `isPayfastAddress` and `chargeToken`,
 * which talk to Payfast.
 */

export type PayfastConfig = {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  sandbox: boolean;
};

/** From the server's environment; null until all three keys are set. */
export function payfastConfig(env: Record<string, string | undefined> = process.env): PayfastConfig | null {
  const merchantId = env.PAYFAST_MERCHANT_ID?.trim();
  const merchantKey = env.PAYFAST_MERCHANT_KEY?.trim();
  const passphrase = env.PAYFAST_PASSPHRASE?.trim();
  if (!merchantId || !merchantKey || !passphrase) return null;
  return { merchantId, merchantKey, passphrase, sandbox: env.PAYFAST_MODE?.trim() !== "live" };
}

export function processUrl(config: PayfastConfig): string {
  return config.sandbox ? "https://sandbox.payfast.co.za/eng/process" : "https://www.payfast.co.za/eng/process";
}

export function validateUrl(config: PayfastConfig): string {
  return config.sandbox
    ? "https://sandbox.payfast.co.za/eng/query/validate"
    : "https://www.payfast.co.za/eng/query/validate";
}

/** Payfast's own page where the company replaces the card behind a token. */
export function cardUpdateUrl(config: PayfastConfig, token: string, returnUrl: string): string {
  const host = config.sandbox ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
  return `${host}/eng/recurring/update/${encodeURIComponent(token)}?return=${encodeURIComponent(returnUrl)}`;
}

/** PHP `urlencode`: everything but letters, digits and `-_.` escaped, spaces as `+`. */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

function md5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

/** The payment form's fields, in the order Payfast signs them. */
export const CHECKOUT_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "email_confirmation", "confirmation_address", "payment_method",
  "subscription_type", "billing_date", "recurring_amount", "frequency", "cycles",
  "subscription_notify_email", "subscription_notify_webhook", "subscription_notify_buyer",
] as const;

/** Signs fields in the order given; empty values are left out. */
export function signOrdered(pairs: [string, string][], passphrase: string | null): string {
  const parts = pairs
    .map(([k, v]) => [k, v.trim()] as const)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${phpUrlEncode(v)}`);
  if (passphrase) parts.push(`passphrase=${phpUrlEncode(passphrase.trim())}`);
  return md5(parts.join("&"));
}

/** Rands with two decimals, as Payfast's `amount` wants it: 399900 → "3999.00". */
export function centsToAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Not an amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "3999.00" → 399900; null when it is not an amount. */
export function amountToCents(amount: string | null | undefined): number | null {
  if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) return null;
  const [whole, frac = ""] = amount.trim().split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export type CheckoutInput = {
  chargeId: string;
  totalCents: number;
  itemName: string;
  itemDescription?: string;
  email: string;
  nameFirst?: string;
  nameLast?: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
};

/**
 * The fields of the form the browser posts to Payfast: the first payment, with
 * tokenization on so the card is kept for the next ones. Signed last.
 */
export function checkoutFields(config: PayfastConfig, input: CheckoutInput): [string, string][] {
  const values: Record<string, string> = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    notify_url: input.notifyUrl,
    name_first: input.nameFirst ?? "",
    name_last: input.nameLast ?? "",
    email_address: input.email,
    m_payment_id: input.chargeId,
    amount: centsToAmount(input.totalCents),
    item_name: input.itemName.slice(0, 100),
    item_description: (input.itemDescription ?? "").slice(0, 255),
    subscription_type: "2",
  };
  const ordered = CHECKOUT_FIELD_ORDER.filter((k) => (values[k] ?? "").trim() !== "").map(
    (k) => [k, values[k].trim()] as [string, string]
  );
  return [...ordered, ["signature", signOrdered(ordered, config.passphrase)]];
}

/** A notification's fields, in the order Payfast sent them. */
export function parseNotification(body: string): [string, string][] {
  return [...new URLSearchParams(body).entries()];
}

/** The string Payfast's validate endpoint expects: every field but the signature, in order. */
export function notificationParamString(pairs: [string, string][]): string {
  return pairs
    .filter(([k]) => k !== "signature")
    .map(([k, v]) => `${k}=${phpUrlEncode(v.trim())}`)
    .join("&");
}

/** Whether the notification carries a signature made with our passphrase. */
export function notificationSignatureValid(pairs: [string, string][], passphrase: string): boolean {
  const given = pairs.find(([k]) => k === "signature")?.[1];
  if (!given) return false;
  const unsigned = pairs.filter(([k]) => k !== "signature");
  // Payfast signs every field it sends, empty ones included.
  const parts = unsigned.map(([k, v]) => `${k}=${phpUrlEncode(v.trim())}`);
  parts.push(`passphrase=${phpUrlEncode(passphrase.trim())}`);
  return md5(parts.join("&")) === given.trim().toLowerCase();
}

export type Notification = {
  chargeId: string;
  pfPaymentId: string | null;
  status: "COMPLETE" | "FAILED" | "PENDING" | "CANCELLED" | string;
  amountCents: number | null;
  token: string | null;
  merchantId: string | null;
};

export function readNotification(pairs: [string, string][]): Notification | null {
  const get = (k: string) => pairs.find(([key]) => key === k)?.[1]?.trim() || null;
  const chargeId = get("m_payment_id");
  if (!chargeId || !/^[0-9a-f-]{36}$/i.test(chargeId)) return null;
  return {
    chargeId,
    pfPaymentId: get("pf_payment_id"),
    status: (get("payment_status") ?? "").toUpperCase(),
    amountCents: amountToCents(get("amount_gross")),
    token: get("token"),
    merchantId: get("merchant_id"),
  };
}

/** Payfast's notification hosts; a notification must come from one of them. */
export const PAYFAST_HOSTS = ["www.payfast.co.za", "sandbox.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"];

/** The caller's address as the platform saw it (first hop of x-forwarded-for). */
export function callerAddress(forwardedFor: string | null, realIp: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || realIp?.trim() || null;
}

/** Whether an address belongs to one of Payfast's hosts (looked up now). */
export async function isPayfastAddress(address: string | null): Promise<boolean> {
  if (!address) return false;
  const { resolve4 } = await import("node:dns/promises");
  const found = await Promise.all(PAYFAST_HOSTS.map((h) => resolve4(h).catch(() => [] as string[])));
  return found.flat().includes(address);
}

/** Payfast's own confirmation that it sent this notification. */
export async function validateWithPayfast(config: PayfastConfig, pairs: [string, string][]): Promise<boolean> {
  const res = await fetch(validateUrl(config), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: notificationParamString(pairs),
    cache: "no-store",
  });
  return res.ok && (await res.text()).trim() === "VALID";
}

/** The API's signature: header and body fields plus the passphrase, sorted by name. */
export function apiSignature(fields: Record<string, string | number>, passphrase: string): string {
  const all: Record<string, string> = { passphrase: passphrase.trim() };
  for (const [k, v] of Object.entries(fields)) all[k] = String(v).trim();
  return md5(
    Object.keys(all)
      .sort()
      .filter((k) => all[k] !== "")
      .map((k) => `${k}=${phpUrlEncode(all[k])}`)
      .join("&")
  );
}

/** ISO 8601 to the second, as the API's `timestamp` header wants it. */
export function apiTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export type ChargeResult =
  | { ok: true; pfPaymentId: string | null; message: string; raw: unknown }
  | { ok: false; message: string; raw: unknown };

/** Reads the ad-hoc API's answer. Only an explicit success counts as paid. */
export function readChargeResponse(status: number, json: unknown): ChargeResult {
  const body = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const message = typeof data.message === "string" ? data.message : typeof body.status === "string" ? body.status : `HTTP ${status}`;
  const success =
    status >= 200 && status < 300 &&
    (body.code === 200 || body.code === "200") &&
    body.status === "success" &&
    (data.response === true || data.response === "true");
  if (!success) return { ok: false, message, raw: json };
  const id = data.pf_payment_id;
  return { ok: true, pfPaymentId: typeof id === "string" || typeof id === "number" ? String(id) : null, message, raw: json };
}

/** Charges a saved card any amount (Payfast's ad-hoc API). */
export async function chargeToken(
  config: PayfastConfig,
  input: { token: string; chargeId: string; totalCents: number; itemName: string }
): Promise<ChargeResult> {
  const body = {
    amount: input.totalCents,
    item_name: input.itemName.slice(0, 100),
    m_payment_id: input.chargeId,
  };
  const headers = { "merchant-id": config.merchantId, version: "v1", timestamp: apiTimestamp() };
  const signature = apiSignature({ ...headers, ...body }, config.passphrase);
  const url = `https://api.payfast.co.za/subscriptions/${encodeURIComponent(input.token)}/adhoc${
    config.sandbox ? "?testing=true" : ""
  }`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, signature, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return readChargeResponse(res.status, json);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Payfast could not be reached", raw: null };
  }
}
