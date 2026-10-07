import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { salesContact } from "@/lib/platform";
import { trialState } from "@/lib/onboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "View plans" from the trial banner (Stage 5).
 *
 * Until billing exists (Stage 6) there is nothing to buy here: it says where
 * the trial stands and how to talk to us. The contact details and the price
 * list link are the service's own settings (`platform_settings`), so nothing
 * here is a price or an address written into the code; whatever is not set is
 * not shown. Behind `company_settings` in the proxy's permission map.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Plans" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default async function PlansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: account }, contact] = await Promise.all([
    supabase.from("company_account").select("trial_ends_at").maybeSingle(),
    salesContact(),
  ]);
  const trial = trialState(account?.trial_ends_at ?? null);
  const whatsapp = contact.whatsapp?.replace(/\D/g, "") || null;
  const nothingSet = !contact.email && !whatsapp && !contact.pricingUrl;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Plans</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {trial.kind === "none"
              ? "Your plan"
              : trial.kind === "ended"
                ? "Your free trial has ended"
                : `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left in your free trial`}
          </CardTitle>
          <CardDescription>
            {trial.kind !== "none" && account?.trial_ends_at
              ? `${trial.kind === "ended" ? "It ended" : "It ends"} on ${dateFormat.format(new Date(account.trial_ends_at))}. `
              : ""}
            {trial.kind === "none"
              ? "Talk to us about changing your plan."
              : "Everything keeps working while we sort out a plan with you. Talk to us about the plan that fits your team."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {contact.pricingUrl && (
            <a
              href={contact.pricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-secondary"
            >
              See plans and prices
            </a>
          )}
          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Talk to us on WhatsApp
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-secondary"
            >
              Email us
            </a>
          )}
          {nothingSet && (
            <p className="text-sm text-muted-foreground">
              The details for choosing a plan have not been added yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
