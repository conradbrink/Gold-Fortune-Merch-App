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

// The Founding 10 (owner, 10 Oct 2026): the first businesses run Tickd free for
// 60 days, set up for them, and apply on /founding so each one can be called.
// The spots left are one setting in the database (platform_settings
// founding_spots_left) that only the owner changes, when someone is picked;
// the page reads it from the app (GET {apiUrl}). `spots` is the 10 the offer
// is for, shown whenever that answer is not in.
export const founding = {
  spots: 10,
  days: 60,
  // What a Founding business pays after the free 60 days, for 12 months
  // (half the normal R1,499, so R9,000 saved over the year).
  price: 749,
  priceMonths: 12,
  // Dates are in words, as the owner gave them.
  closes: "Monday 19 October",
  tellsBy: "Friday 23 October",
  // The app's endpoint. NEXT_PUBLIC_FOUNDING_API points a local site at a local app.
  apiUrl: process.env.NEXT_PUBLIC_FOUNDING_API || "https://app.tickd.co.za/api/founding",
} as const;

// The demo video at the top of /founding. Paste the address of the video file
// (or leave it empty): until it is set the page shows a clearly marked space.
export const foundingVideoUrl: string = "";

// The Meta (Facebook) Pixel for /founding. Paste the Pixel ID between the
// quotes; while it is empty, nothing loads and nothing is sent.
export const metaPixelId: string = "";

// The Gold Fortune result for the proof section. Anything in [brackets] is a
// placeholder the owner has not confirmed yet and shows on the page as it is;
// replace it with the real figure. The *N numbers only set the bar heights.
export const proof = {
  stores: "[about 250]",
  months: "[months]",
  reps: "[__]",
  visits: { before: "[40]", after: "[78]", beforeN: 40, afterN: 78 },
  // Monthly sales, as a multiple of before: the owner's "up 1.5x".
  sales: { before: "1x", after: "1.5x", beforeN: 1, afterN: 1.5 },
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
