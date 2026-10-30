import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient } from "@/lib/platform";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { billingErrorMessage, normalisePlan, parseAccount } from "@/lib/billing";
import {
  initializeBody,
  initializeTransaction,
  makeReference,
  paystackConfig,
  readTransaction,
  stillOpen,
  verifyTransaction,
  type ChargeMetadata,
  type CheckoutPurpose,
} from "@/lib/billing/paystack";
import { TRY_WINDOW_MS, failureRecorded, logPaystack, originFrom, settle } from "@/lib/billing/server";

/**
 * POST /api/paystack/checkout — pays on Paystack's page, by card.
 *
 * Body (JSON): `{ reps, period?, email?, addons? }`. The browser says only how
 * many reps, which add-ons (`{ warehouse: 1 }`: Stock control and HR) and
 * where receipts go; what is charged is worked out here, from the
 * signed-in company's own account, by the database:
 *   - no paid plan yet (pilot, ended, or a price agreed by us): the plan for
 *     that many reps and its add-ons from price_list, plus setup on the first
 *     monthly payment, or less the founding price for a founding company
 *     (`billing_start_checkout`);
 *   - behind on a renewal (past due or read-only): that renewal
 *     (`billing_retry_now`), so paying it also saves the new card; never while
 *     Paystack still holds a try at it on the saved card;
 *   - paid up ("Update card"): a small card check, refunded once the card is
 *     kept (`billing_start_card_check`).
 * Each `billing_*` call checks the caller manages the company settings.
 *
 * Answers `{ authorization_url, reference }`; the page sends the browser
 * there. Paystack sends it back to /billing/callback, and tells the webhook.
 */

export const runtime = "nodejs";

type Body = { reps?: unknown; period?: unknown; email?: unknown; addons?: unknown };

export async function POST(request: Request) {
  const config = paystackConfig();
  if (!config) return Response.json({ error: "Card payments are not switched on yet. Talk to us to pay." }, { status: 503 });
  // JSON only, so another site's form cannot post here with the visitor's session.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send JSON." }, { status: 415 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Not understood." }, { status: 400 });
  }
  const reps = typeof body.reps === "number" && Number.isInteger(body.reps) ? body.reps : null;
  const period = body.period === "yearly" ? "yearly" : body.period === undefined || body.period === "monthly" ? "monthly" : null;
  if (!period) return Response.json({ error: "Choose monthly or yearly." }, { status: 400 });
  const offered = typeof body.email === "string" ? body.email.trim() : "";
  // Names and quantities only; the database prices them and refuses one that
  // cannot be bought.
  const asked = body.addons && typeof body.addons === "object" && !Array.isArray(body.addons) ? (body.addons as Record<string, number>) : {};
  const addons = normalisePlan(1, asked).addons;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });

  const [{ data: accountRaw, error: accountError }, { data: row }] = await Promise.all([
    supabase.rpc("my_account"),
    supabase.from("company_account").select("billing_email").maybeSingle(),
  ]);
  if (accountError) return Response.json({ error: accountError.message }, { status: 500 });
  const account = parseAccount(accountRaw);
  if (!account.canManage) {
    return Response.json({ error: "Only someone who manages the company settings can pay for the plan." }, { status: 403 });
  }
  // Counted before anything reaches Paystack.
  const gate = await enforceRateLimit(supabase, LIMITS.billingCheckout);
  if (!gate.ok) return gate.response;
  const email = offered || row?.billing_email || user.email || "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || /@staff\.tickd\.co\.za$/i.test(email)) {
    return Response.json({ error: "Enter the email address for receipts." }, { status: 400 });
  }

  // What is being paid for: decided from the account, never by the browser.
  let purpose: CheckoutPurpose = "subscribe";
  let chargeId: string | null = null;
  // Only a company that is behind pays a renewal here. A paid-up one's
  // renewal is the daily run's to charge, so "Update card" stays a card check.
  if (account.status === "past_due" || account.status === "read_only") {
    const { data, error } = await supabase.rpc("billing_retry_now");
    if (error) return Response.json({ error: billingErrorMessage(error) }, { status: 400 });
    if (data) {
      purpose = "pay_due";
      chargeId = (data as { charge_id: string }).charge_id;
    }
  }
  if (!chargeId && (account.status === "active" || account.status === "past_due")) {
    const { data, error } = await supabase.rpc("billing_start_card_check", { p_email: email });
    if (error) return Response.json({ error: billingErrorMessage(error) }, { status: 400 });
    purpose = "card";
    chargeId = (data as { charge_id: string }).charge_id;
  }
  if (!chargeId) {
    if (reps === null || reps < 1 || reps > 1000) return Response.json({ error: "Choose the size of your plan." }, { status: 400 });
    const { data, error } = await supabase.rpc("billing_start_checkout", {
      p_period: period,
      p_seats: reps,
      p_addons: addons,
      p_email: email,
    });
    if (error) return Response.json({ error: billingErrorMessage(error) }, { status: 400 });
    chargeId = (data as { charge_id: string }).charge_id;
  }

  // The amount is the charge's, as the database wrote it.
  const admin = platformAdminClient();
  const { data: charge, error: chargeError } = await admin
    .from("billing_charges")
    .select("id, org_id, reason, status, total_cents, period, plan_after, lines, provider_reference, provider_tried_at")
    .eq("id", chargeId)
    .maybeSingle();
  if (chargeError || !charge?.org_id || charge.status !== "pending") {
    return Response.json({ error: chargeError?.message ?? "The payment could not be started." }, { status: 500 });
  }

  // A renewal the daily run already put to the saved card: ask Paystack about
  // that try first, so paying here is never a second payment for it (and if
  // it is anyway, the second is refunded when it lands).
  if (purpose === "pay_due" && charge.provider_reference) {
    const recent = charge.provider_tried_at !== null && Date.now() - new Date(charge.provider_tried_at).getTime() < TRY_WINDOW_MS;
    const v = await verifyTransaction(config, charge.provider_reference);
    const busy = Response.json(
      { error: "Paystack is still processing a payment from your saved card. Try again in a few minutes." },
      { status: 409 }
    );
    if (v.ok) {
      const tx = readTransaction(v.data);
      if (tx.status === "success") {
        await settle(admin, config, tx, v.data, "verify");
        return Response.json({ error: "This payment has already gone through. Refresh the page." }, { status: 409 });
      }
      if (stillOpen(tx) && tx.metadata.method === "saved_card") return busy;
    } else if (v.status === 0 || v.status >= 500) {
      return Response.json({ error: "Paystack could not be reached. Try again in a few minutes." }, { status: 502 });
    } else if (recent && !(await failureRecorded(admin, charge.id, charge.provider_reference))) {
      // A try made moments ago that Paystack has not got on its books yet
      // (one it refused outright is already counted as failed).
      return busy;
    }
  }

  const reference = makeReference(charge.org_id, charge.id);
  // Swapped only from the reference just looked at: a try the daily run starts
  // meanwhile wins, and this page is not opened.
  const swap = admin
    .from("billing_charges")
    .update({ provider_reference: reference, provider_tried_at: new Date().toISOString() })
    .eq("id", charge.id)
    .eq("status", "pending");
  const { data: swapped, error: refError } = await (charge.provider_reference
    ? swap.eq("provider_reference", charge.provider_reference)
    : swap.is("provider_reference", null)
  ).select("id");
  if (refError) return Response.json({ error: refError.message }, { status: 500 });
  if (!swapped || swapped.length === 0) {
    return Response.json({ error: "A payment for this is already under way. Try again in a few minutes." }, { status: 409 });
  }

  const origin = originFrom(await headers());
  const plan = (charge.plan_after ?? {}) as { seats?: unknown };
  const metadata: ChargeMetadata = {
    organization_id: charge.org_id,
    charge_id: charge.id,
    reason: charge.reason,
    reps: typeof plan.seats === "number" ? plan.seats : null,
    period: charge.period,
    includes_setup_fee: Array.isArray(charge.lines) && charge.lines.some((l) => (l as { code?: unknown })?.code === "setup"),
    method: "checkout",
    purpose,
    cancel_action: `${origin}/settings/plan?checkout=cancelled`,
  };
  const started = await initializeTransaction(
    config,
    initializeBody({
      email,
      amountCents: charge.total_cents,
      reference,
      callbackUrl: `${origin}/billing/callback`,
      metadata,
    })
  );
  await logPaystack(admin, {
    chargeId: charge.id,
    orgId: charge.org_id,
    source: "checkout",
    outcome: "event",
    reference,
    amountCents: charge.total_cents,
    detail: started.ok ? `Checkout started (${purpose})` : `Checkout not started (${purpose}): ${started.message}`,
    payload: { purpose, by: user.id },
  });
  if (!started.ok) {
    console.error("[paystack] initialize failed", reference, started.message);
    return Response.json({ error: `Paystack did not open the payment page: ${started.message}` }, { status: 502 });
  }
  return Response.json({ authorization_url: started.authorizationUrl, reference });
}
