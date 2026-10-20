import { FOUNDING_OFFER } from "@/lib/founding-offer";
import { PRODUCT_NAME } from "@/lib/product";
import { count, type Terms } from "@/lib/terms";

/**
 * The three fixed plans by the number of reps (owner, 19 Oct 2026), as the
 * sales site shows them (`pricing` in the site's `lib/site.ts`; a test keeps
 * the two the same). Yearly is 2 months free, setup is free on yearly. Until
 * billing is built, choosing one is a message to our team, who set it up.
 */
export const PLANS = {
  plans: [
    { reps: 5, monthly: 1995 },
    { reps: 10, monthly: 3495 },
    { reps: 15, monthly: 5995 },
  ],
  /** The plan marked "Most popular". */
  popularReps: 10,
  /** A year costs this many months. */
  yearlyMonths: 10,
  setupValue: 2500,
} as const;

export type Plan = (typeof PLANS.plans)[number];

export const biggestPlan: Plan = PLANS.plans[PLANS.plans.length - 1];

/** The smallest plan that fits this many reps, or null above the biggest one. */
export function planFor(reps: number): Plan | null {
  return PLANS.plans.find((p) => reps <= p.reps) ?? null;
}

/** R1,995: whole rands, as the site writes them. */
export function rand(n: number): string {
  return `R${n.toLocaleString("en-US")}`;
}

/** A plan's founding price a month: `FOUNDING_OFFER.percentOff` off, in whole rands. */
export function foundingPrice(plan: Plan): number {
  return Math.round((plan.monthly * (100 - FOUNDING_OFFER.percentOff)) / 100);
}

/** The lowest founding price, the "from" price: the smallest plan's. */
export const foundingFrom = foundingPrice(PLANS.plans[0]);

/** "40% off your plan for 3 months, from R1,197 a month": the offer in one line. */
export const foundingLine = `${FOUNDING_OFFER.percentOff}% off your plan for ${FOUNDING_OFFER.priceMonths} months, from ${rand(foundingFrom)} a month`;

export type PlanChoice = { kind: "founding"; reps?: number | null } | { kind: "plan"; reps: number } | { kind: "bigger" };

/** The ready-written message a plan's button opens, naming the company and the plan. */
export function planMessage(choice: PlanChoice, company: string | null, t: Terms): string {
  const who = company?.trim() ? ` for ${company.trim()}` : "";
  const staff = (n: number) => count(t, "staff", n);
  switch (choice.kind) {
    case "founding": {
      // The plan that fits the team; a bigger team is priced by hand (the
      // site's "more than 15 reps" answer).
      const plan = choice.reps && choice.reps > 0 ? planFor(choice.reps) : null;
      if (choice.reps && !plan) {
        return `Hi, we'd like the founding price${who}. We have ${staff(choice.reps)}. What would it be for our whole team?`;
      }
      return plan
        ? `Hi, we'd like the founding price${who}: ${rand(foundingPrice(plan))} a month for ${FOUNDING_OFFER.priceMonths} months, on the plan for up to ${staff(plan.reps)}.`
        : `Hi, we'd like the founding price${who}: ${foundingLine}.`;
    }
    case "plan": {
      const plan = PLANS.plans.find((p) => p.reps === choice.reps);
      return `Hi, we'd like the plan for up to ${staff(choice.reps)}${who}${plan ? ` (${rand(plan.monthly)} a month)` : ""}.`;
    }
    case "bigger":
      return `Hi, ${company?.trim() ? `this is ${company.trim()}. We` : "we"} have more than ${staff(biggestPlan.reps)}. What would ${PRODUCT_NAME} cost us?`;
  }
}

/** Where a plan's button goes: WhatsApp when the number is set, else email, else nowhere. */
export function contactLink(
  contact: { email: string | null; whatsapp: string | null },
  message: string,
  subject: string
): string | null {
  const whatsapp = contact.whatsapp?.replace(/\D/g, "") || null;
  if (whatsapp) return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
  if (contact.email) {
    return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  }
  return null;
}
