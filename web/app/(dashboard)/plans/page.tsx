import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { salesContact } from "@/lib/platform";
import { onOrPastPilot, pilotState } from "@/lib/onboarding";
import { SELF_SERVE_SIGNUP_OPEN } from "@/lib/signup";
import { parseCompanyConfig } from "@/lib/company-config";
import { DEFAULT_TERMS } from "@/lib/terms";
import { PlansView } from "@/components/plans/plans-view";
import { paystackConfig } from "@/lib/billing/paystack";

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
 * shows to a distributor on, or past, its free pilot that has not paid yet,
 * while self-serve sign-up is closed, since the Founding application is then
 * the only way onto a pilot. Behind
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

  const [{ data: account }, { data: org }, { count: reps, error: repsError }, { data: config }, contact] = await Promise.all([
    supabase.from("company_account").select("status, trial_ends_at, period_end").maybeSingle(),
    supabase.from("organizations").select("name, industries, timezone").maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["rep", "driver"]).eq("is_active", true),
    supabase.rpc("my_company_config"),
    salesContact(),
  ]);
  const trial = pilotState(account);

  return (
    <PlansView
      trial={trial}
      trialEndsAt={account?.trial_ends_at ?? null}
      founding={!SELF_SERVE_SIGNUP_OPEN && onOrPastPilot(account) && (org?.industries ?? []).includes("distribution")}
      reps={repsError ? null : (reps ?? null)}
      terms={parseCompanyConfig(config)?.terms ?? DEFAULT_TERMS}
      company={org?.name ?? null}
      timezone={org?.timezone || "UTC"}
      contact={{ email: contact.email, whatsapp: contact.whatsapp }}
      payByCard={paystackConfig() !== null}
    />
  );
}
