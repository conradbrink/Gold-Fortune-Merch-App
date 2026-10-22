"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient } from "@/lib/platform";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { paystackConfig } from "@/lib/billing/paystack";
import { chargeSaved } from "@/lib/billing/server";
import {
  billingErrorMessage,
  normalisePlan,
  parseChangePreview,
  parseQuote,
  type ChangePreview,
  type Period,
  type Quote,
} from "@/lib/billing";

/**
 * The Billing page's actions (Stage 6; Paystack since 22 Oct 2026).
 *
 * Who may do what is the database's call: every `billing_*` function the
 * company can reach checks the caller's own login for the company-settings
 * permission (`billing_my_org`), so these run with the caller's session. Only
 * the card itself is touched with the service role — its code is unreadable
 * through the API, and charging it is the server's job — and only for a charge
 * the caller's own call just created or reopened. Paying on Paystack's page
 * is /api/paystack/checkout.
 *
 * Plans are bought by reps only: add-ons are not sold here until the add-on
 * bundle is priced.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function period(p: string): Period | null {
  return p === "monthly" || p === "yearly" ? p : null;
}

export async function quoteAction(p: string, reps: number): Promise<Result<Quote>> {
  const per = period(p);
  if (!per) return { ok: false, error: "Choose monthly or yearly." };
  const plan = normalisePlan(reps, {});
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_quote", { p_period: per, p_seats: plan.seats, p_addons: {} });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "No price." };
  return { ok: true, value: parseQuote(data) };
}

export async function previewChangeAction(reps: number, addons: Record<string, number>): Promise<Result<ChangePreview>> {
  const plan = normalisePlan(reps, addons);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_preview_change", { p_seats: plan.seats, p_addons: plan.addons });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "No price." };
  return { ok: true, value: parseChangePreview(data) };
}

/** More reps: charged to the card now, for the rest of the period. Fewer: from the next renewal. */
export async function changePlanAction(
  reps: number,
  addons: Record<string, number>
): Promise<Result<{ charged: boolean; message: string }>> {
  const config = paystackConfig();
  const plan = normalisePlan(reps, addons);
  const supabase = await createClient();
  // Counted before the database writes a charge, so a refusal leaves nothing behind.
  const gate = await enforceRateLimit(supabase, LIMITS.billingCharge);
  if (!gate.ok) return { ok: false, error: "Too many tries for now. Wait a while, then try again." };
  const { data, error } = await supabase.rpc("billing_request_change", { p_seats: plan.seats, p_addons: plan.addons });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "The plan could not be changed." };
  revalidatePath("/billing");
  if (!data) return { ok: true, value: { charged: false, message: "Saved. The change applies from your next payment." } };
  if (!config) return { ok: false, error: "Card payments are not switched on yet. Talk to us to change your plan." };

  const outcome = await chargeSaved(platformAdminClient(), config, (data as { charge_id: string }).charge_id);
  revalidatePath("/billing");
  switch (outcome.kind) {
    case "paid":
      return { ok: true, value: { charged: true, message: "Paid. Your plan is updated." } };
    case "pending":
      return { ok: true, value: { charged: false, message: "A payment for this is already under way. Your plan changes once it is paid." } };
    case "failed":
      return { ok: false, error: `Your card was declined (${outcome.message}). Nothing changed; update your card and try again.` };
    case "no_card":
      return { ok: false, error: "There is no card on file. Use \"Update card\" first." };
    default:
      return { ok: false, error: outcome.message };
  }
}

export async function setCancelAction(cancel: boolean): Promise<Result<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_set_cancel", { p_cancel: cancel });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "Not saved." };
  revalidatePath("/billing");
  return { ok: true, value: null };
}

/** The unpaid renewal, to the card on file again, now. */
export async function retryNowAction(): Promise<Result<string>> {
  const config = paystackConfig();
  if (!config) return { ok: false, error: "Card payments are not switched on yet. Talk to us to pay." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_retry_now");
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "Not tried." };
  if (!data) return { ok: true, value: "There is nothing to pay." };
  const gate = await enforceRateLimit(supabase, LIMITS.billingCharge);
  if (!gate.ok) return { ok: false, error: "Too many tries for now. Wait a while, or pay with a card instead." };
  const outcome = await chargeSaved(platformAdminClient(), config, (data as { charge_id: string }).charge_id);
  revalidatePath("/billing");
  if (outcome.kind === "paid") return { ok: true, value: "Paid. Thank you." };
  if (outcome.kind === "pending") {
    return { ok: true, value: "A payment for this is already under way, on Paystack's page or from your card. If it does not go through, try again in an hour." };
  }
  if (outcome.kind === "failed") return { ok: false, error: `Your card was declined (${outcome.message}). Pay with another card instead.` };
  if (outcome.kind === "no_card") return { ok: false, error: "There is no card on file. Pay with a card instead." };
  return { ok: false, error: outcome.message };
}
