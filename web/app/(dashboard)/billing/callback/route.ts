import { NextResponse } from "next/server";
import { platformAdminClient } from "@/lib/platform";
import { paystackConfig, parseReference, readTransaction, verifyTransaction } from "@/lib/billing/paystack";
import { settle } from "@/lib/billing/server";

/**
 * Where Paystack sends the browser back after its page: `?reference=…`.
 *
 * Asks Paystack itself (`/transaction/verify/:reference`, server-side, with
 * the secret key) rather than believing the address: only status "success"
 * for the charge's exact amount, in ZAR, counts as paid (`settle`). The
 * webhook says the same thing, and whichever lands second is a duplicate.
 * Then back to Billing with a word on how it went. Behind `company_settings`
 * in the proxy (the /billing prefix), like the page it returns to.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/billing?${q}`, url), { status: 303 });
  const config = paystackConfig();
  const reference = url.searchParams.get("reference") ?? url.searchParams.get("trxref");
  if (!config || !reference || !parseReference(reference)) return back("checkout=unknown");

  const verified = await verifyTransaction(config, reference);
  if (!verified.ok) {
    console.warn("[paystack] verify failed", reference, verified.message);
    return back("checkout=pending");
  }
  const tx = readTransaction(verified.data);
  const outcome = await settle(platformAdminClient(), config, tx, verified.data, "verify");
  switch (outcome.kind) {
    case "paid":
      return back(outcome.reason === "card" ? "card=updated" : "checkout=paid");
    case "duplicate":
      return back(outcome.reason === "card" ? "card=updated" : "checkout=paid");
    case "failed":
      return back("checkout=failed");
    case "refused":
      return back("checkout=refused");
    default:
      return back("checkout=pending");
  }
}
