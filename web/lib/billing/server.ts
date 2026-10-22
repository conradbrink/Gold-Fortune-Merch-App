import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import {
  chargeAuthorization,
  chargeAuthorizationBody,
  loggable,
  makeReference,
  parseReference,
  readTransaction,
  refundTransaction,
  stillOpen,
  verifyTransaction,
  type ChargeMetadata,
  type PaystackConfig,
  type Transaction,
} from "@/lib/billing/paystack";

type Admin = SupabaseClient<Database>;
type Source = "checkout" | "webhook" | "verify" | "charge" | "refund";
type Outcome = "paid" | "failed" | "refused" | "duplicate" | "queued" | "event" | "refunded";

/**
 * How long a try at a charge is given before another may be made. Paystack
 * answers a saved-card charge within seconds or queues it; a payment page can
 * be finished a while after it was opened. Within this window a try that
 * Paystack cannot find yet, or a page left open, is not taken as dead.
 */
export const TRY_WINDOW_MS = 60 * 60 * 1000;

/**
 * What became of a Paystack transaction once it was put to the database.
 * `error` means the database could not be reached or refused for a reason a
 * later try may not have: the webhook answers 500 so Paystack sends it again.
 */
export type SettleOutcome =
  | { kind: "paid"; reason: string; invoiceId: string | null; cardSaved: boolean }
  | { kind: "duplicate"; reason: string }
  | { kind: "refunded"; why: string }
  | { kind: "refused" }
  | { kind: "failed"; message: string }
  | { kind: "open" }
  | { kind: "ignored"; why: string }
  | { kind: "error"; message: string };

export type ChargeOutcome =
  | { kind: "paid"; invoiceId: string | null }
  | { kind: "failed"; message: string }
  | { kind: "pending" }
  | { kind: "no_card" }
  | { kind: "error"; message: string };

/** One line in the payment log (`billing_payments`). Never throws: the log must not stop a payment. */
export async function logPaystack(
  admin: Admin,
  row: {
    chargeId: string | null;
    orgId: string | null;
    source: Source;
    outcome: Outcome;
    reference?: string | null;
    amountCents?: number | null;
    detail?: string | null;
    payload?: unknown;
  }
): Promise<void> {
  const { error } = await admin.from("billing_payments").insert({
    charge_id: row.chargeId,
    org_id: row.orgId,
    provider: "paystack",
    source: row.source,
    outcome: row.outcome,
    provider_payment_id: row.reference ?? null,
    amount_cents: row.amountCents ?? null,
    detail: row.detail ? row.detail.slice(0, 500) : null,
    payload: (row.payload ?? null) as Json,
  });
  if (error) console.error("[paystack] log not written", row.source, row.outcome, row.reference, error.message);
}

/**
 * Puts what Paystack says about one transaction to the database, from the
 * webhook, the callback's verify or our own charge. Safe to run any number of
 * times for the same reference: `billing_paystack_paid` records a payment
 * once, checks the amount and currency against the charge, and keeps the card
 * only when Paystack says it can be charged again. Money that bought nothing
 * (a second payment for one charge, a payment for a replaced charge, the
 * wrong amount) is refunded here, and a card check once the card is kept.
 */
export async function settle(
  admin: Admin,
  config: PaystackConfig,
  tx: Transaction,
  raw: unknown,
  source: "webhook" | "verify" | "charge"
): Promise<SettleOutcome> {
  const ref = parseReference(tx.reference);
  if (!ref) return { kind: "ignored", why: "not one of our references" };

  const { data: charge, error: chargeError } = await admin
    .from("billing_charges")
    .select("id, org_id, reason, status, total_cents, provider_reference")
    .eq("id", ref.chargeId)
    .maybeSingle();
  if (chargeError) return { kind: "error", message: chargeError.message };
  if (!charge) {
    await logPaystack(admin, {
      chargeId: null, orgId: null, source, outcome: "event", reference: tx.reference,
      amountCents: tx.amountCents, detail: `No charge for this reference (${tx.status})`, payload: loggable(raw),
    });
    return { kind: "ignored", why: "no such charge" };
  }

  if (tx.status === "success") {
    // Paystack always sends both; without them nothing is decided (and above
    // all nothing is refunded): the webhook is sent again, the page waits.
    if (tx.amountCents === null || !tx.currency) {
      console.error("[paystack] success without an amount or currency", tx.reference);
      return { kind: "error", message: "The payment's amount could not be read." };
    }
    const { data, error } = await admin.rpc("billing_paystack_paid", {
      p_charge: charge.id,
      p_reference: tx.reference!,
      p_amount_cents: tx.amountCents,
      p_currency: tx.currency,
      p_card: (tx.card?.reusable ? tx.card : null) as Json,
      p_source: source,
      p_payload: loggable(raw) as Json,
    });
    if (error) {
      // 22023: refused on its merits (not this charge's reference). Sending
      // it again changes nothing, so it is not an error to retry.
      if (error.code === "22023") {
        console.warn("[paystack] payment refused", tx.reference, error.message);
        return { kind: "refused" };
      }
      console.error("[paystack] payment not recorded", tx.reference, error.message);
      return { kind: "error", message: error.message };
    }
    const r = (data ?? {}) as { outcome?: string; reason?: string; why?: string; invoice_id?: string | null; card_saved?: boolean };
    if (r.outcome === "refund") {
      const why = r.why ?? "Not owed.";
      console.warn("[paystack] payment not owed, refunding", tx.reference, why);
      await refundPayment(admin, config, charge, tx.reference!, tx.amountCents, why);
      return { kind: "refunded", why };
    }
    if (r.outcome === "duplicate") return { kind: "duplicate", reason: r.reason ?? charge.reason };
    if (r.reason === "card") await refundPayment(admin, config, charge, tx.reference!, tx.amountCents, "Card check");
    return { kind: "paid", reason: r.reason ?? charge.reason, invoiceId: r.invoice_id ?? null, cardSaved: r.card_saved === true };
  }

  if (stillOpen(tx)) return { kind: "open" };

  // Failed, abandoned or reversed. Only our own charge of the saved card
  // counts as a failed try (retry days, grace period, an email), and only
  // for the try the charge is waiting on; a reload of the callback or a try
  // on Paystack's page is logged and nothing more.
  const message = tx.gatewayResponse ?? tx.status ?? "Not paid";
  if (source === "charge" && tx.metadata.method === "saved_card" && charge.status === "pending" && tx.reference === charge.provider_reference) {
    const { error } = await admin.rpc("billing_record_failure", {
      p_charge: charge.id,
      p_outcome: "failed",
      p_detail: `Paystack: ${message}`.slice(0, 500),
      p_source: source,
      p_payload: loggable(raw) as Json,
    });
    if (error) return { kind: "error", message: error.message };
  } else {
    await logPaystack(admin, {
      chargeId: charge.id, orgId: charge.org_id, source, outcome: "event", reference: tx.reference,
      amountCents: tx.amountCents, detail: `Not paid: ${message}`, payload: loggable(raw),
    });
  }
  return { kind: "failed", message };
}

/**
 * Gives back money that bought nothing: a card check once the card is kept,
 * or a payment the database refused. A refund Paystack refuses is logged
 * loudly for someone to do by hand; nothing else waits on it.
 */
async function refundPayment(
  admin: Admin,
  config: PaystackConfig,
  charge: { id: string; org_id: string | null },
  reference: string,
  amountCents: number | null,
  why: string
): Promise<void> {
  const r = await refundTransaction(config, reference);
  await logPaystack(admin, {
    chargeId: charge.id, orgId: charge.org_id, source: "refund", outcome: r.ok ? "refunded" : "event",
    reference, amountCents,
    detail: r.ok ? `Refunded (${why}): ${r.message}` : `NOT refunded, refund by hand (${why}): ${r.message}`,
    payload: loggable(r.data),
  });
  if (!r.ok) console.error("[paystack] refund failed, refund by hand", reference, why, r.message);
}

/**
 * Whether a failed try at a charge is already counted (`billing_record_failure`
 * logs it once). A counted try is over, even one Paystack has no record of
 * (refused outright, say), so it never holds up the next.
 */
export async function failureRecorded(admin: Admin, chargeId: string, reference: string): Promise<boolean> {
  const { data } = await admin
    .from("billing_payments")
    .select("id")
    .eq("charge_id", chargeId)
    .eq("provider_payment_id", reference)
    .in("outcome", ["failed", "cancelled"])
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Puts one pending charge to the company's saved card: the daily renewal,
 * more reps, "Try again now". The amount is the charge's, from the database.
 *
 * Never charges twice for one charge. The last try is looked up first: paid
 * (recorded now), still with Paystack, a payment page opened within the hour,
 * or a try Paystack cannot find yet within the hour all mean "wait". A queued
 * try that failed is counted as that day's failed try, and the next waits for
 * its retry day. A new try is only made by whoever swaps the charge's
 * reference (two runs at once: one charges, the other waits), and anything
 * paid twice regardless is refunded by `settle`.
 */
export async function chargeSaved(
  admin: Admin,
  config: PaystackConfig,
  chargeId: string,
  now: Date = new Date()
): Promise<ChargeOutcome> {
  const { data: charge, error: chargeError } = await admin
    .from("billing_charges")
    .select("id, org_id, reason, status, total_cents, period, plan_after, lines, provider_reference, provider_tried_at")
    .eq("id", chargeId)
    .maybeSingle();
  if (chargeError || !charge?.org_id) return { kind: "error", message: chargeError?.message ?? "No such charge." };
  if (charge.status !== "pending") return { kind: "error", message: `This charge is ${charge.status}.` };

  const { data: card, error: cardError } = await admin
    .from("billing_cards")
    .select("authorization_code, email")
    .eq("org_id", charge.org_id)
    .maybeSingle();
  if (cardError) return { kind: "error", message: cardError.message };
  if (!card) return { kind: "no_card" };

  const recent = charge.provider_tried_at !== null && now.getTime() - new Date(charge.provider_tried_at).getTime() < TRY_WINDOW_MS;
  if (charge.provider_reference) {
    const v = await verifyTransaction(config, charge.provider_reference);
    if (v.ok) {
      const tx = readTransaction(v.data);
      if (tx.status === "success") {
        const s = await settle(admin, config, tx, v.data, "verify");
        if (s.kind === "paid" || s.kind === "duplicate") return { kind: "paid", invoiceId: s.kind === "paid" ? s.invoiceId : null };
        return { kind: "error", message: s.kind === "error" ? s.message : "The last payment could not be recorded." };
      }
      // Our own queued charge is waited for. A payment page (left at the
      // bank's check, or just open) is waited for within the hour only; after
      // that it counts as abandoned, and if it is finished later anyway the
      // second payment is refunded.
      const page = tx.metadata.method !== "saved_card";
      if (stillOpen(tx) && (!page || recent)) return { kind: "pending" };
      if (page && tx.status === "abandoned" && recent) return { kind: "pending" };
      // Our own queued try that failed: that is this round's failed try.
      if (tx.metadata.method === "saved_card" && !(await failureRecorded(admin, charge.id, charge.provider_reference))) {
        const { error } = await admin.rpc("billing_record_failure", {
          p_charge: charge.id,
          p_outcome: "failed",
          p_detail: `Paystack: ${tx.gatewayResponse ?? tx.status}`.slice(0, 500),
          p_source: "verify",
          p_payload: loggable(v.data) as Json,
        });
        if (error) return { kind: "error", message: error.message };
        return { kind: "failed", message: tx.gatewayResponse ?? tx.status };
      }
    } else if (v.status === 0 || v.status >= 500) {
      // Paystack cannot say: never risk a second charge.
      return { kind: "error", message: `Paystack could not be asked about the last try: ${v.message}` };
    } else if (recent && !(await failureRecorded(admin, charge.id, charge.provider_reference))) {
      // Not on Paystack's books yet, and not known to have failed: wait.
      return { kind: "pending" };
    }
    // Failed, abandoned long ago, or never reached Paystack: a new try.
  }

  const reference = makeReference(charge.org_id, charge.id, now);
  const claim = admin
    .from("billing_charges")
    .update({ provider_reference: reference, provider_tried_at: now.toISOString() })
    .eq("id", charge.id)
    .eq("status", "pending");
  const { data: claimed, error: claimError } = await (charge.provider_reference
    ? claim.eq("provider_reference", charge.provider_reference)
    : claim.is("provider_reference", null)
  ).select("id");
  if (claimError) return { kind: "error", message: claimError.message };
  if (!claimed || claimed.length === 0) return { kind: "pending" };

  const plan = (charge.plan_after ?? {}) as { seats?: unknown };
  const metadata: ChargeMetadata = {
    organization_id: charge.org_id,
    charge_id: charge.id,
    reason: charge.reason,
    reps: typeof plan.seats === "number" ? plan.seats : null,
    period: charge.period,
    includes_setup_fee: Array.isArray(charge.lines) && charge.lines.some((l) => (l as { code?: unknown })?.code === "setup"),
    method: "saved_card",
  };
  const r = await chargeAuthorization(
    config,
    chargeAuthorizationBody({
      authorizationCode: card.authorization_code,
      email: card.email,
      amountCents: charge.total_cents,
      reference,
      metadata,
    })
  );

  if (!r.ok && (r.status === 0 || r.status >= 500)) {
    // We cannot know whether it charged: the reference is kept, and the next
    // try looks it up before charging again.
    await logPaystack(admin, {
      chargeId: charge.id, orgId: charge.org_id, source: "charge", outcome: "event", reference,
      amountCents: charge.total_cents, detail: `No answer from Paystack: ${r.message}`, payload: loggable(r.data),
    });
    return { kind: "error", message: r.message };
  }

  const tx = r.ok ? readTransaction(r.data) : null;
  if (tx && tx.status === "success") {
    const s = await settle(admin, config, tx, r.data, "charge");
    if (s.kind === "paid") return { kind: "paid", invoiceId: s.invoiceId };
    if (s.kind === "duplicate") return { kind: "paid", invoiceId: null };
    // The card was charged but the database would not record it: loud, so
    // someone reconciles it by hand (the webhook may still land).
    console.error("[paystack] charged but not recorded", charge.id, reference, s);
    return { kind: "error", message: "The payment went through but could not be recorded. We will sort it out." };
  }
  if (tx && stillOpen(tx)) {
    await logPaystack(admin, {
      chargeId: charge.id, orgId: charge.org_id, source: "charge", outcome: "queued", reference,
      amountCents: charge.total_cents, detail: `Paystack: ${tx.status}`, payload: loggable(r.data),
    });
    return { kind: "pending" };
  }

  const message = (tx?.gatewayResponse ?? r.message) || "Declined";
  const { error } = await admin.rpc("billing_record_failure", {
    p_charge: charge.id,
    p_outcome: "failed",
    p_detail: `Paystack: ${message}`.slice(0, 500),
    p_source: "charge",
    p_payload: loggable(r.data) as Json,
  });
  if (error) console.error("[paystack] failure not recorded", charge.id, error.message);
  return { kind: "failed", message };
}

/**
 * This deployment's own address, for Paystack's callback and the cancel link:
 * BILLING_PUBLIC_URL, else the app's address (NEXT_PUBLIC_APP_URL); the
 * request's host only when neither is set (a developer's machine).
 */
export function originFrom(h: Headers, env: Record<string, string | undefined> = process.env): string {
  const configured = (env.BILLING_PUBLIC_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
