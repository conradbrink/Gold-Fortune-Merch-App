import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { chargeToken, payfastConfig } from "@/lib/billing/payfast";

type Admin = SupabaseClient<Database>;

export type ChargeOutcome =
  | { kind: "paid"; invoiceId: string }
  | { kind: "failed"; message: string }
  | { kind: "not_configured" }
  | { kind: "no_card" }
  | { kind: "error"; message: string };

/**
 * Puts one pending charge to the company's saved card and records the answer
 * in the database (service role). Used by the daily run, by "add users" and by
 * "try again now". The database decides the amount and checks it again when
 * the payment is recorded; Payfast's own notification for the same payment
 * records nothing twice (`billing_record_payment` is idempotent).
 */
export async function chargeSaved(admin: Admin, chargeId: string): Promise<ChargeOutcome> {
  const config = payfastConfig();
  if (!config) return { kind: "not_configured" };

  const { data: charge, error: chargeError } = await admin
    .from("billing_charges")
    .select("id, org_id, total_cents, status")
    .eq("id", chargeId)
    .maybeSingle();
  if (chargeError || !charge?.org_id) return { kind: "error", message: chargeError?.message ?? "No such charge." };
  if (charge.status !== "pending") return { kind: "error", message: `This charge is ${charge.status}.` };

  const [{ data: account }, { data: itemName }] = await Promise.all([
    admin.from("company_account").select("provider_token").eq("org_id", charge.org_id).maybeSingle(),
    admin.from("platform_settings").select("value").eq("key", "billing_item_name").maybeSingle(),
  ]);
  const token = account?.provider_token;
  if (!token) return { kind: "no_card" };

  const result = await chargeToken(config, {
    token,
    chargeId: charge.id,
    totalCents: charge.total_cents,
    itemName: typeof itemName?.value === "string" ? itemName.value : "Subscription",
  });

  if (result.ok) {
    const { data, error } = await admin.rpc("billing_record_payment", {
      p_charge: charge.id,
      p_provider_payment_id: result.pfPaymentId,
      p_amount_cents: charge.total_cents,
      p_token: null,
      p_source: "charge",
      p_payload: (result.raw ?? null) as Database["public"]["Tables"]["billing_payments"]["Row"]["payload"],
    });
    if (error) {
      // The card was charged but the database refused to record it: loud, so
      // someone reconciles it by hand (Payfast's notification may still land).
      console.error("billing: charged but not recorded", charge.id, result.pfPaymentId, error.message);
      return { kind: "error", message: "The payment went through but could not be recorded. We will sort it out." };
    }
    return { kind: "paid", invoiceId: data as string };
  }

  const { error } = await admin.rpc("billing_record_failure", {
    p_charge: charge.id,
    p_outcome: "failed",
    p_detail: result.message.slice(0, 500),
    p_source: "charge",
    p_payload: (result.raw ?? null) as Database["public"]["Tables"]["billing_payments"]["Row"]["payload"],
  });
  if (error) console.error("billing: failure not recorded", charge.id, error.message);
  return { kind: "failed", message: result.message };
}

/** This deployment's own address, for Payfast's return and notify links. */
export function originFrom(h: Headers): string {
  const configured = process.env.BILLING_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Where Payfast posts its notification. A preview deployment sits behind
 * Vercel's protection, which would turn Payfast away; when "Protection Bypass
 * for Automation" is on, Vercel provides its secret and it rides along on
 * previews only (never production, which is not protected).
 */
export function notifyUrlFrom(origin: string): string {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const preview = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production";
  return `${origin}/api/payfast/notify${bypass && preview ? `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}` : ""}`;
}
