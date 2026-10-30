import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { salesContact } from "@/lib/platform";
import { onOrPastPilot, pilotState } from "@/lib/onboarding";
import { SELF_SERVE_SIGNUP_OPEN } from "@/lib/signup";
import { parseCompanyConfig } from "@/lib/company-config";
import { DEFAULT_TERMS } from "@/lib/terms";
import { PlansView } from "@/components/plans/plans-view";
import { paystackConfig } from "@/lib/billing/paystack";
import { parseFounding } from "@/lib/billing";

/**
 * "View plans" from the pilot banner, and where the day-10 email's "Choose
 * your plan" lands.
 *
 * Each plan's button opens Settings > Plan, to pay by card (Paystack), once
 * PAYSTACK_SECRET_KEY is set; until then a ready-written message to our team
 * (`sales_whatsapp`, else `sales_email`, the service's own settings), who set
 * the plan up. The plans
 * are the site's three (lib/plans.ts), in the company's own word for its
 * people (its `staff` term: "Reps" for a distributor). The Founding price
 * shows to a founding company with founding months left (`billing_founding()`,
 * 20261030200000), and is paid by card like the plans: the database prices
 * it. Where that function is not there yet, it shows as before, to a
 * distributor on or past its free pilot while self-serve sign-up is closed,
 * with the message to our team. Behind
 * `company_settings` in the proxy's permission map.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Plans" };

export default async function PlansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: account }, { data: org }, { count: reps, error: repsError }, { data: config }, contact, foundingRes] = await Promise.all([
    supabase.from("company_account").select("status, trial_ends_at, period_end").maybeSingle(),
    supabase.from("organizations").select("name, industries, timezone").maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["rep", "driver"]).eq("is_active", true),
    supabase.rpc("my_company_config"),
    salesContact(),
    supabase.rpc("billing_founding"),
  ]);
  const trial = pilotState(account);
  const foundingTerms = foundingRes.error ? null : parseFounding(foundingRes.data);
  const founding = foundingRes.error
    ? !SELF_SERVE_SIGNUP_OPEN && onOrPastPilot(account) && (org?.industries ?? []).includes("distribution")
    : // Not to a company already paying: its founding months run on its renewals.
      foundingTerms !== null && foundingTerms.monthsLeft > 0 && onOrPastPilot(account);

  return (
    <PlansView
      trial={trial}
      trialEndsAt={account?.trial_ends_at ?? null}
      founding={founding}
      foundingTerms={foundingTerms}
      reps={repsError ? null : (reps ?? null)}
      terms={parseCompanyConfig(config)?.terms ?? DEFAULT_TERMS}
      company={org?.name ?? null}
      timezone={org?.timezone || "UTC"}
      contact={{ email: contact.email, whatsapp: contact.whatsapp }}
      payByCard={paystackConfig() !== null}
    />
  );
}
