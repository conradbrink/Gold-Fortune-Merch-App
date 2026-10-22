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
 * What became of a Paystack transaction once it was put to the database.
 * `error` means the database could not be reached or refused for a reason a
 * later try may not have: the webhook answers 500 so Paystack sends it again.
 */
export type SettleOutcome =
  | { kind: "paid"; reason: string; invoiceId: string | null; cardSaved: boolean }
  | { kind: "duplicate"; reason: string }
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
 * only when Paystack says it can be charged again.
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
    .select("id, org_id, reason, status, total_cents")
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
    const { data, error } = await admin.rpc("billing_paystack_paid", {
      p_charge: charge.id,
      p_reference: tx.reference!,
      p_amount_cents: tx.amountCents ?? -1,
      p_currency: tx.currency ?? "",
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
    const r = (data ?? {}) as { outcome?: string; reason?: string; invoice_id?: string | null; card_saved?: boolean };
    if (r.outcome === "refused") {
      console.warn("[paystack] amount or currency is not the charge's", tx.reference, tx.amountCents, tx.currency);
      return { kind: "refused" };
    }
    if (r.outcome === "duplicate") return { kind: "duplicate", reason: r.reason ?? charge.reason };
    if (r.reason === "card") await refundCardCheck(admin, config, charge, tx.reference!);
    return { kind: "paid", reason: r.reason ?? charge.reason, invoiceId: r.invoice_id ?? null, cardSaved: r.card_saved === true };
  }

  if (stillOpen(tx)) return { kind: "open" };

  // Failed, abandoned or reversed. A charge we put to the saved card counts
  // as a failed try (retry days, grace period, an email); a try on Paystack's
  // page is only logged, since the customer can simply try again there.
  const message = tx.gatewayResponse ?? tx.status ?? "Not paid";
  if (tx.metadata.method === "saved_card" && charge.status === "pending") {
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
 * A card check (`billing_start_card_check`) has done its job once the card is
 * kept: give the money back at once. A refund Paystack refuses is logged for
 * someone to do by hand; the card is kept either way.
 */
async function refundCardCheck(
  admin: Admin,
  config: PaystackConfig,
  charge: { id: string; org_id: string | null; total_cents: number },
  reference: string
): Promise<void> {
  const r = await refundTransaction(config, reference);
  await logPaystack(admin, {
    chargeId: charge.id, orgId: charge.org_id, source: "refund", outcome: r.ok ? "refunded" : "event",
    reference, amountCents: charge.total_cents,
    detail: r.ok ? `Card check refunded: ${r.message}` : `Card check NOT refunded, refund by hand: ${r.message}`,
    payload: loggable(r.data),
  });
  if (!r.ok) console.error("[paystack] card check not refunded", reference, r.message);
}

/**
 * Puts one pending charge to the company's saved card: the daily renewal,
 * more reps, "Try again now". The amount is the charge's, from the database.
 *
 * Never charges twice for one charge: an earlier try that Paystack still
 * holds (queued) is looked up first, and a new try is only made by whoever
 * swaps the charge's reference (two runs at once: one charges, the other
 * waits).
 */
export async function chargeSaved(admin: Admin, config: PaystackConfig, chargeId: string): Promise<ChargeOutcome> {
  const { data: charge, error: chargeError } = await admin
    .from("billing_charges")
    .select("id, org_id, reason, status, total_cents, period, plan_after, lines, provider_reference")
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

  // The last try first: paid without us hearing, or still queued.
  if (charge.provider_reference) {
    const v = await verifyTransaction(config, charge.provider_reference);
    if (v.ok) {
      const tx = readTransaction(v.data);
      if (tx.status === "success") {
        const s = await settle(admin, config, tx, v.data, "verify");
        return s.kind === "paid" || s.kind === "duplicate"
          ? { kind: "paid", invoiceId: s.kind === "paid" ? s.invoiceId : null }
          : s.kind === "error"
            ? { kind: "error", message: s.message }
            : { kind: "error", message: "The last payment could not be recorded." };
      }
      if (stillOpen(tx)) return { kind: "pending" };
    } else if (v.status === 0 || v.status >= 500) {
      // Paystack cannot say: never risk a second charge.
      return { kind: "error", message: `Paystack could not be asked about the last try: ${v.message}` };
    }
    // Not found, failed or abandoned: a new try.
  }

  const reference = makeReference(charge.org_id, charge.id);
  const claim = admin.from("billing_charges").update({ provider_reference: reference }).eq("id", charge.id).eq("status", "pending");
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

/** This deployment's own address, for Paystack's callback and the cancel link. */
export function originFrom(h: Headers): string {
  const configured = process.env.BILLING_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
