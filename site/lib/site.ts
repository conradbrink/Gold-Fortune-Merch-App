// Everything the sales site says about the business lives here, so a price,
// a phone number or the company name changes in one place.

export const site = {
  name: "Tickd",
  tagline: "Proof, not promises.",
  headline: "Every job Tickd off. Except you.",
  // The plain answer to "what is this?", for anyone landing cold.
  whatItIs: "The app for teams that work on site.",
  trialDays: 14,
  url: "https://tickd.co.za",
  appUrl: "https://app.tickd.co.za",
  // Legal entity shown in the footer and named in the terms and privacy
  // pages. Confirm before launch.
  legalName: "Mobill Media",
  email: "hello@tickd.co.za",
  // International format without "+" or spaces, e.g. "27821234567".
  // Empty until the WhatsApp Business line exists; the buttons fall back to email.
  whatsapp: "",
  countries: "Southern Africa",
} as const;

// WhatsApp when the business line exists, email until then.
export function contactHref(message: string, subject = message): string {
  if (site.whatsapp) {
    return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
  }
  return `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

// Lines marked [CONFIRM] in ~/Downloads/site-copy-final-v7.md stay off the
// site until Conrad says yes. Flip one to true to show it.
export const confirmed = {
  // Card 1: only once the team can deliver it.
  doneForYou: false,
  // "The Tickd promise": once the exact rule is written down.
  promise: false,
  // "Is it legal?": once checked against POPIA.
  legalFaq: false,
} as const;

// Prices in rand. Not VAT registered yet (owner, 8 Oct 2026), so no VAT is
// added; ~/Downloads/pricing-implementation.md:
// yearly is 2 months free; setup is free on yearly and charged once on
// monthly; "Done for you" is the anchor plan.
export const pricing = {
  currency: "R",
  includedUsers: 3,
  monthly: { base: 1499, perExtra: 349 },
  yearly: { base: 14990, perExtra: 3490 },
  setupValue: 2500,
  doneForYou: 14990,
} as const;

export type Billing = "monthly" | "yearly";

// The details the legal pages need, in one place. Each must be the owner's
// real details before the site goes live; an empty one is left off the page.
export const legal = {
  // CIPC registration number, if the business is registered.
  registrationNumber: "",
  // Physical address for notices (POPIA asks for one).
  address: "",
  // POPIA information officer: the owner, unless someone else is registered.
  informationOfficer: "",
  // Where the app's data is hosted (Supabase, AWS eu-west-3).
  dataLocation: "Paris, France",
  lastUpdated: "8 October 2026",
} as const;

/** What a team of `users` pays per period on the given billing. */
export function planPrice(users: number, billing: Billing): number {
  const p = pricing[billing];
  return p.base + Math.max(0, users - pricing.includedUsers) * p.perExtra;
}

export function rand(amount: number): string {
  // en-US for "R1,499": en-ZA groups with a non-breaking space.
  return `${pricing.currency}${amount.toLocaleString("en-US")}`;
}
