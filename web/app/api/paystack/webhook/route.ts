import { platformAdminClient } from "@/lib/platform";
import { loggable, paystackConfig, parseReference, readTransaction, signatureValid } from "@/lib/billing/paystack";
import { logPaystack, settle } from "@/lib/billing/server";

/**
 * POST /api/paystack/webhook — Paystack's events.
 *
 * `/api` is outside the proxy, so this route does its own check before
 * anything is read: `x-paystack-signature` must be the HMAC SHA512 of the raw
 * body with our secret key, or the request is refused (401) and nothing is
 * recorded. Every genuine event is logged in `billing_payments`.
 *
 * `charge.success` is put to the database (`settle`), which records a payment
 * once, whatever the order and however often it arrives: the callback's
 * verify, our own charge and this webhook may all report the same reference.
 * Answers 200 once an event is dealt with (including "already recorded" and
 * "not ours"), so Paystack stops resending; a database error answers 500, so
 * it tries again later.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = paystackConfig();
  if (!config) return new Response("Payments are not configured.", { status: 503 });

  const raw = await request.text();
  if (!signatureValid(raw, request.headers.get("x-paystack-signature"), config.secretKey)) {
    console.warn("[paystack] webhook with a bad signature refused");
    return new Response("Bad signature.", { status: 401 });
  }

  let event: { event?: unknown; data?: unknown };
  try {
    event = JSON.parse(raw) as { event?: unknown; data?: unknown };
  } catch {
    return new Response("Not understood.", { status: 400 });
  }
  const name = typeof event.event === "string" ? event.event : "unknown";
  const data = (event.data ?? {}) as Record<string, unknown>;
  // A refund event names its transaction inside `transaction`.
  const reference =
    typeof data.reference === "string"
      ? data.reference
      : typeof (data.transaction as Record<string, unknown> | undefined)?.reference === "string"
        ? ((data.transaction as Record<string, unknown>).reference as string)
        : null;
  const ours = parseReference(reference);

  const admin = platformAdminClient();
  if (ours) {
    const { data: charge } = await admin.from("billing_charges").select("id, org_id").eq("id", ours.chargeId).maybeSingle();
    await logPaystack(admin, {
      chargeId: charge?.id ?? null,
      orgId: charge?.org_id ?? null,
      source: "webhook",
      outcome: "event",
      reference,
      amountCents: typeof data.amount === "number" ? data.amount : null,
      detail: name,
      payload: { event: name, data: loggable(data) },
    });
  } else {
    // Not a reference of ours (a payment made some other way on the same
    // account): logged without a company, and left alone.
    await logPaystack(admin, {
      chargeId: null, orgId: null, source: "webhook", outcome: "event", reference,
      detail: `${name} (not a Tickd reference)`, payload: { event: name },
    });
    return new Response("OK");
  }

  if (name === "charge.success") {
    const tx = readTransaction(data);
    const outcome = await settle(admin, config, tx, data, "webhook");
    if (outcome.kind === "error") return new Response("Not recorded.", { status: 500 });
  }
  return new Response("OK");
}
