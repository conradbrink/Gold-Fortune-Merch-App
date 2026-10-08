import { platformAdminClient } from "@/lib/platform";
import type { Json } from "@/lib/supabase/types";
import {
  callerAddress,
  isPayfastAddress,
  notificationSignatureValid,
  parseNotification,
  payfastConfig,
  readNotification,
  validateWithPayfast,
} from "@/lib/billing/payfast";

/**
 * Payfast's notification (ITN) that a payment on its page went through,
 * failed or was cancelled (Stage 6).
 *
 * `/api` is outside the proxy, so this route does its own checks, all of them,
 * before anything is recorded — the four Payfast asks for:
 *   1. the signature, made with our passphrase;
 *   2. the sender is one of Payfast's hosts;
 *   3. Payfast's validate endpoint confirms it sent this;
 *   4. the amount is the charge's total — checked by `billing_record_payment`
 *      itself, which refuses any other amount and records the refusal.
 * The merchant id must be ours too.
 *
 * Answers 200 once a notification is genuine and dealt with (including "already
 * recorded"), so Payfast stops resending; a database error answers 500, so it
 * tries again later.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = payfastConfig();
  if (!config) return new Response("Payments are not configured.", { status: 503 });

  const body = await request.text();
  const pairs = parseNotification(body);
  const note = readNotification(pairs);
  if (!note) return new Response("Not understood.", { status: 400 });

  if (note.merchantId !== config.merchantId) {
    console.warn("[payfast] notification for another merchant", note.chargeId);
    return new Response("Wrong merchant.", { status: 400 });
  }
  if (!notificationSignatureValid(pairs, config.passphrase)) {
    console.warn("[payfast] bad signature", note.chargeId);
    return new Response("Bad signature.", { status: 400 });
  }
  const address = callerAddress(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
  if (!(await isPayfastAddress(address))) {
    console.warn("[payfast] notification from a non-Payfast address", address, note.chargeId);
    return new Response("Not from Payfast.", { status: 403 });
  }
  if (!(await validateWithPayfast(config, pairs))) {
    console.warn("[payfast] Payfast did not confirm the notification", note.chargeId);
    return new Response("Not confirmed.", { status: 400 });
  }

  const admin = platformAdminClient();
  const payload = Object.fromEntries(pairs.filter(([k]) => k !== "signature")) as Json;

  if (note.status === "COMPLETE") {
    if (note.amountCents === null) return new Response("No amount.", { status: 400 });
    const { error } = await admin.rpc("billing_record_payment", {
      p_charge: note.chargeId,
      p_provider_payment_id: note.pfPaymentId,
      p_amount_cents: note.amountCents,
      p_token: note.token,
      p_source: "notify",
      p_payload: payload,
    });
    if (error) {
      // 22023: refused on its merits (wrong amount, unknown charge) — recorded,
      // and resending will not change it. Anything else: let Payfast retry.
      console.error("[payfast] payment not recorded", note.chargeId, note.pfPaymentId, error.message);
      return new Response("Not recorded.", { status: error.code === "22023" ? 200 : 500 });
    }
    return new Response("OK");
  }

  if (note.status === "FAILED" || note.status === "CANCELLED") {
    const { error } = await admin.rpc("billing_record_failure", {
      p_charge: note.chargeId,
      p_outcome: note.status === "FAILED" ? "failed" : "cancelled",
      p_detail: `Payfast: ${note.status}`,
      p_source: "notify",
      p_payload: payload,
    });
    if (error) {
      console.error("[payfast] failure not recorded", note.chargeId, error.message);
      return new Response("Not recorded.", { status: error.code === "22023" ? 200 : 500 });
    }
    return new Response("OK");
  }

  // PENDING and anything new: nothing to record yet; Payfast notifies again.
  return new Response("OK");
}
