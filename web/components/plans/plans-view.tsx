import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { TrialState } from "@/lib/onboarding";
import { FOUNDING_OFFER } from "@/lib/founding-offer";
import { count, lower, type Terms } from "@/lib/terms";
import { PLANS, biggestPlan, contactLink, foundingFrom, foundingPrice, planFor, planMessage, rand, type PlanChoice } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type PlansViewProps = {
  trial: TrialState;
  trialEndsAt: string | null;
  /** Show the Founding price: the company came in through the Founding pilot. */
  founding: boolean;
  /** Active logins with the field role (`rep`), or null if they could not be counted. */
  reps: number | null;
  /** The company's own words: plans are priced by its `staff` term ("Reps" for a distributor). */
  terms: Terms;
  company: string | null;
  /** The company's time zone, so the end date is the day the day-10 email names. */
  timezone: string;
  contact: { email: string | null; whatsapp: string | null };
};

/**
 * The plans page: where the pilot stands, the Founding price for a company on
 * the pilot, the three plans, and a button on each that opens a ready-written
 * message to our team. Presentational, so it can be rendered without a session.
 */
export function PlansView({ trial, trialEndsAt, founding, reps, terms: t, company, timezone, contact }: PlansViewProps) {
  const staff = lower(t.staff.many);
  const fits = reps && reps > 0 ? planFor(reps) : null;
  const tooBig = reps !== null && reps > biggestPlan.reps;
  const link = (choice: PlanChoice, subject: string) => contactLink(contact, planMessage(choice, company, t), subject);
  const noContact = contactLink(contact, "", "") === null;
  const ends = trialEndsAt ? endDate(trialEndsAt, timezone) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Plans</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {trial.kind === "none"
              ? "Your plan"
              : trial.kind === "ended"
                ? "Your free pilot has ended"
                : `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left in your free pilot`}
          </CardTitle>
          <CardDescription className="text-pretty">
            {trial.kind === "none"
              ? "Talk to us about changing your plan."
              : trial.kind === "ended"
                ? `It ended on ${ends}. Everything still works. Choose a plan below and it carries on exactly as it is.`
                : `It ends on ${ends}. Choose a plan before then and everything carries on exactly as it is: your team, your ${lower(t.site.many)}, your orders and your reports.`}
          </CardDescription>
        </CardHeader>
      </Card>

      {founding && (
        <Card className="ring-2 ring-gold">
          <CardHeader>
            <Badge className="bg-gold text-gold-foreground">Founding distributor price</Badge>
            {fits ? (
              <CardTitle className="pt-1">
                <span className="text-3xl font-bold tabular-nums text-foreground">{rand(foundingPrice(fits))}</span>{" "}
                <span className="text-base font-medium text-muted-foreground">
                  a month for {FOUNDING_OFFER.priceMonths} months, on the plan for up to {count(t, "staff", fits.reps)}
                </span>
              </CardTitle>
            ) : (
              <CardTitle className="pt-1 text-xl font-bold text-foreground">
                {FOUNDING_OFFER.percentOff}% off your plan for {FOUNDING_OFFER.priceMonths} months
              </CardTitle>
            )}
            <CardDescription className="text-pretty">
              {fits
                ? `That is ${FOUNDING_OFFER.percentOff}% off the ${rand(fits.monthly)} plan, ${rand((fits.monthly - foundingPrice(fits)) * FOUNDING_OFFER.priceMonths)} less over the ${FOUNDING_OFFER.priceMonths} months`
                : `From ${rand(foundingFrom)} a month on the plan for up to ${count(t, "staff", PLANS.plans[0].reps)}`}
              . It is only for the first {FOUNDING_OFFER.spots} distributors on the pilot.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <ChooseButton href={link({ kind: "founding", reps }, "The founding price")} primary>
              Choose the founding price
            </ChooseButton>
            {fits && reps !== null && <FitsNote reps={reps} t={t} />}
            {tooBig && (
              <p className="text-sm text-foreground">
                You have {count(t, "staff", reps ?? 0)}. We&apos;ll give you a founding price for your whole team.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3" aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="text-base font-semibold text-foreground">
          {founding ? "Or one of our plans" : "Our plans"}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PLANS.plans.map((p) => {
            const popular = p.reps === PLANS.popularReps;
            const isFit = fits?.reps === p.reps;
            return (
              <li key={p.reps}>
                <Card className={`h-full ${isFit && !founding ? "ring-2 ring-primary" : ""}`}>
                  <CardHeader>
                    {/* Room for the badge on every card side by side, none on a phone. */}
                    <div className={popular ? "flex min-h-5" : "hidden min-h-5 sm:block"}>
                      {popular && <Badge variant="secondary">Most popular</Badge>}
                    </div>
                    <CardTitle className="text-base">Up to {p.reps} {staff}</CardTitle>
                    <p className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-2xl font-bold tabular-nums text-foreground">{rand(p.monthly)}</span>
                      <span className="text-sm text-muted-foreground">a month</span>
                    </p>
                  </CardHeader>
                  <CardContent className="mt-auto space-y-3">
                    {isFit && reps !== null && <FitsNote reps={reps} t={t} />}
                    <ChooseButton
                      href={link({ kind: "plan", reps: p.reps }, `The plan for up to ${count(t, "staff", p.reps)}`)}
                      primary={isFit && !founding}
                    >
                      Choose this plan
                    </ChooseButton>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
        <p className="text-sm font-medium text-foreground">
          No contract. Cancel any time. Pay yearly and you get 2 months free.
        </p>
      </section>

      <Card size="sm" className={tooBig ? "ring-2 ring-primary" : ""}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">
              More than {biggestPlan.reps} {staff}?
            </span>{" "}
            {tooBig ? `You have ${count(t, "staff", reps ?? 0)}. ` : ""}We&apos;ll give you a price for your team.
          </p>
          <ChooseButton href={link({ kind: "bigger" }, `More than ${count(t, "staff", biggestPlan.reps)}`)} primary={tooBig}>
            Ask us for a price
          </ChooseButton>
        </CardContent>
      </Card>

      {noContact ? (
        <p className="text-sm text-muted-foreground">The details for choosing a plan have not been added yet.</p>
      ) : (
        <ul className="space-y-2 text-sm text-foreground">
          <Point>
            The button opens a message to our team with your plan filled in. Send it and we set the plan up with you.
          </Point>
          <Point>
            Nothing changes in the app. Your team, {lower(t.site.many)}, orders and reports carry on as they are.
          </Point>
        </ul>
      )}
    </div>
  );
}

/** "24 October 2026" in the company's time zone; the server's (UTC) if that zone is not one the runtime knows. */
function endDate(iso: string, timezone: string): string {
  const options = { day: "numeric", month: "long", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(new Date(iso));
  }
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span className="text-pretty">{children}</span>
    </li>
  );
}

function FitsNote({ reps, t }: { reps: number; t: Terms }) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
      <Check className="size-4 text-primary" aria-hidden />
      Fits your {count(t, "staff", reps)}
    </p>
  );
}

function ChooseButton({ href, primary, children }: { href: string | null; primary?: boolean; children: ReactNode }) {
  if (!href) return null;
  const external = href.startsWith("https://");
  return (
    <Button
      variant={primary ? "default" : "outline"}
      nativeButton={false}
      render={<a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} />}
    >
      {children}
    </Button>
  );
}
