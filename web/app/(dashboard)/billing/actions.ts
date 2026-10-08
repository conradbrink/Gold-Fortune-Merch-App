"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient } from "@/lib/platform";
import { checkoutFields, payfastConfig, processUrl } from "@/lib/billing/payfast";
import { chargeSaved, notifyUrlFrom, originFrom } from "@/lib/billing/server";
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
 * The Billing page's actions (Stage 6).
 *
 * Who may do what is the database's call: every `billing_*` function the
 * company can reach checks the caller's own login for the company-settings
 * permission (`billing_my_org`), so these run with the caller's session. Only
 * the card itself is touched with the service role — the token is unreadable
 * through the API, and charging it is the server's job — and only for a charge
 * the caller's own call just created.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function period(p: string): Period | null {
  return p === "monthly" || p === "yearly" ? p : null;
}

export async function quoteAction(p: string, seats: number, addons: Record<string, number>): Promise<Result<Quote>> {
  const per = period(p);
  if (!per) return { ok: false, error: "Choose monthly or yearly." };
  const plan = normalisePlan(seats, addons);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_quote", { p_period: per, p_seats: plan.seats, p_addons: plan.addons });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "No price." };
  return { ok: true, value: parseQuote(data) };
}

export async function previewChangeAction(seats: number, addons: Record<string, number>): Promise<Result<ChangePreview>> {
  const plan = normalisePlan(seats, addons);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_preview_change", { p_seats: plan.seats, p_addons: plan.addons });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "No price." };
  return { ok: true, value: parseChangePreview(data) };
}

/**
 * Starts the first payment and returns the signed form for the browser to post
 * to Payfast. The card is entered on Payfast's page, never here.
 */
export async function startCheckoutAction(
  p: string,
  seats: number,
  addons: Record<string, number>,
  email: string
): Promise<Result<{ url: string; fields: [string, string][] }>> {
  const per = period(p);
  if (!per) return { ok: false, error: "Choose monthly or yearly." };
  const config = payfastConfig();
  if (!config) return { ok: false, error: "Card payments are not set up yet. Talk to us to pay." };

  const plan = normalisePlan(seats, addons);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_start_checkout", {
    p_period: per,
    p_seats: plan.seats,
    p_addons: plan.addons,
    p_email: email.trim(),
  });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "The payment could not be started." };
  const started = data as { charge_id: string; total_cents: number; item_name: string | null };

  const origin = originFrom(await headers());
  const fields = checkoutFields(config, {
    chargeId: started.charge_id,
    totalCents: started.total_cents,
    itemName: started.item_name ?? "Subscription",
    email: email.trim(),
    returnUrl: `${origin}/billing?checkout=done`,
    cancelUrl: `${origin}/billing?checkout=cancelled`,
    notifyUrl: notifyUrlFrom(origin),
  });
  return { ok: true, value: { url: processUrl(config), fields } };
}

/** More users or add-ons: charged now, pro-rata. Fewer: from the next renewal. */
export async function changePlanAction(
  seats: number,
  addons: Record<string, number>
): Promise<Result<{ charged: boolean; message: string }>> {
  const plan = normalisePlan(seats, addons);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_request_change", { p_seats: plan.seats, p_addons: plan.addons });
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "The plan could not be changed." };
  revalidatePath("/billing");
  if (!data) return { ok: true, value: { charged: false, message: "Saved. The change applies from your next renewal." } };

  const outcome = await chargeSaved(platformAdminClient(), (data as { charge_id: string }).charge_id);
  revalidatePath("/billing");
  switch (outcome.kind) {
    case "paid":
      return { ok: true, value: { charged: true, message: "Paid. Your plan is updated." } };
    case "failed":
      return { ok: false, error: `Your card was declined (${outcome.message}). Nothing changed; update your card and try again.` };
    case "no_card":
      return { ok: false, error: "There is no card on file. Talk to us to change your plan." };
    case "not_configured":
      return { ok: false, error: "Card payments are not set up yet. Talk to us to change your plan." };
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

/** After updating the card: try the unpaid renewal again now. */
export async function retryNowAction(): Promise<Result<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_retry_now");
  if (error) return { ok: false, error: billingErrorMessage(error) ?? "Not tried." };
  if (!data) return { ok: true, value: "There is nothing to pay." };
  const outcome = await chargeSaved(platformAdminClient(), (data as { charge_id: string }).charge_id);
  revalidatePath("/billing");
  if (outcome.kind === "paid") return { ok: true, value: "Paid. Thank you." };
  if (outcome.kind === "failed") return { ok: false, error: `Your card was declined (${outcome.message}).` };
  return { ok: false, error: outcome.kind === "error" ? outcome.message : "The payment could not be tried. Talk to us." };
}
