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
  // Every "try it" button goes straight to the app's sign-up (the trial
  // onboarding); the trade picker at the bottom adds ?industry=<code>.
  signupUrl: "https://app.tickd.co.za/signup",
  // Legal entity shown in the footer and named in the terms and privacy
  // pages (owner, 8 Oct 2026; CIPA extract BW00005187820).
  legalName: "Mobill Media (Pty) Ltd",
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
  // 5 users for the base price (owner, 10 Oct 2026; was 3).
  includedUsers: 5,
  monthly: { base: 1499, perExtra: 349 },
  yearly: { base: 14990, perExtra: 3490 },
  setupValue: 2500,
  // Free bonuses with every plan (owner, 9 Oct 2026): a hands-on training
  // day, and one-on-one support for the first months.
  trainingValue: 2500,
  supportMonths: 2,
  supportValue: 10000,
  doneForYou: 14990,
} as const;

// The Founding 10 (owner, 10 Oct 2026): the first businesses get Tickd free
// for 60 days, set up for them, and apply by form so each one can be phoned.
// The spots left come from the app (GET {apiUrl}), the same table the form
// posts to; `spots` is only what the page shows before that answer arrives or
// when it cannot be had. The founding price is promised but its amount is not
// on the site until the owner names it.
export const founding = {
  spots: 10,
  days: 60,
  // How soon someone answers an application, in words.
  replyWithin: "a few hours",
  // How soon a business that says yes is running, in words.
  runningIn: "48 hours",
  // The app's endpoint. NEXT_PUBLIC_FOUNDING_API points a local site at a local app.
  apiUrl: process.env.NEXT_PUBLIC_FOUNDING_API || "https://app.tickd.co.za/api/founding",
} as const;

export type Billing = "monthly" | "yearly";

// The details the legal pages need, in one place. Each must be the owner's
// real details before the site goes live; an empty one is left off the page.
export const legal = {
  // Registered in Botswana (CIPA). Unique identification number.
  registeredIn: "Botswana",
  registrationNumber: "BW00005187820",
  // Physical address for notices (owner, 8 Oct 2026).
  address: "Plot 51572, Phakalane, Gaborone, Botswana",
  // A telephone number for the business (ECTA s43).
  phone: "",
  // Who answers privacy requests (Botswana: data protection officer; POPIA:
  // information officer). The sole director, unless someone else is named.
  informationOfficer: "Conrad Brink",
  // Where the app's data is hosted (Supabase, AWS eu-west-3).
  dataLocation: "Paris, France",
  lastUpdated: "8 October 2026",
} as const;

/** What a team of `users` pays per period on the given billing. */
export function planPrice(users: number, billing: Billing): number {
  const p = pricing[billing];
  return p.base + Math.max(0, users - pricing.includedUsers) * p.perExtra;
}

/** The monthly starting price as a week, rounded up to the next R10, for
 *  the hero's "R350/week" (R1,499 × 12 ÷ 52 = R345.92). */
export function weeklyCeiling(): number {
  return Math.ceil((pricing.monthly.base * 12) / 52 / 10) * 10;
}

/** A yearly price as a month, rounded to the rand, for "R1,249 a month, paid yearly". */
export function perMonth(yearly: number): number {
  return Math.round(yearly / 12);
}

/** The base price per person per day (calendar days), for "about R10 a person a day". */
export function perPersonPerDay(): number {
  return Math.round(pricing.monthly.base / pricing.includedUsers / 30);
}

export function rand(amount: number): string {
  // en-US for "R1,499": en-ZA groups with a non-breaking space.
  return `${pricing.currency}${amount.toLocaleString("en-US")}`;
}
