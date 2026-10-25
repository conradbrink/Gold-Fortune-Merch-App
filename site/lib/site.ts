// Everything the sales site says about the business lives here, so a price,
// a phone number or the company name changes in one place.

export const site = {
  name: "Tickd",
  tagline: "Proof, not promises.",
  // The plain answer to "what is this?", for anyone landing cold. The site is
  // only for distributors with 3 to 30 reps since 19 Oct 2026 (owner); the
  // other trades are still in the app, for later.
  whatItIs: "The app for distributors and their reps.",
  url: "https://tickd.co.za",
  appUrl: "https://app.tickd.co.za",
  // Every "try it" button goes to the Founding offer (/founding), the only way
  // in for now: the self-serve free trial was taken off (owner, 10 Oct 2026).
  foundingPath: "/founding",
  // Legal entity shown in the footer and named in the terms and privacy
  // pages (owner, 22 Oct 2026: Demibuzz, the business Paystack pays; CIPC
  // certificate, reg. no. 2014/019073/07).
  legalName: "Demibuzz (Pty) Ltd",
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
// site until the owner says yes. Flip one to true to show it.
export const confirmed = {
  // Card 1: only once the team can deliver it.
  doneForYou: false,
  // "The Tickd promise": once the exact rule is written down.
  promise: false,
  // "Is it legal?": once checked against POPIA.
  legalFaq: false,
} as const;

// Prices in rand. Not VAT registered yet (owner, 8 Oct 2026), so no VAT is
// added. Three fixed plans by the number of reps (owner, 19 Oct 2026; it was
// R1,499 for 5 users and R349 for each extra one). Yearly is 2 months free,
// so a year costs 10 months; setup is free on yearly and charged once on
// monthly. "Done for you" is the anchor plan, off until it can be delivered.
export const pricing = {
  currency: "R",
  plans: [
    { reps: 5, monthly: 1995 },
    { reps: 10, monthly: 3495 },
    { reps: 15, monthly: 5995 },
  ],
  // The plan marked "Most popular": the middle one, and the cheapest per rep.
  popularReps: 10,
  yearlyMonths: 10,
  setupValue: 2500,
  // What the training day is worth, in the Founding stack.
  trainingValue: 2500,
  doneForYou: 14990,
} as const;

export type Plan = (typeof pricing.plans)[number];

/** The smallest plan that fits this many reps, or null above the biggest one. */
export function planFor(reps: number): Plan | null {
  return pricing.plans.find((p) => reps <= p.reps) ?? null;
}

/** The smallest plan, the "from" price. */
export const firstPlan: Plan = pricing.plans[0];
export const biggestPlan: Plan = pricing.plans[pricing.plans.length - 1];

// The Founding 10 for distributors (owner, 19 Oct 2026; it replaced the "60
// days free, then R749 a month" offer of 10 Oct): a free 14-day pilot, set up
// for them, then 40% off the plan that fits their team for their first 3
// months (owner, 20 Oct 2026: it was R2,097 a month for 12 months, 40% off the
// 10-rep plan, which cost a team of 5 more than its own plan). Only 10 spots,
// because our team onboards each one personally (the site never names a
// person: owner, 19 Oct 2026). The spots left are one setting in the database
// (platform_settings founding_spots_left) that only the owner changes; the
// page reads it from the app (GET {apiUrl}), and shows `spots` until that
// answer is in. The same numbers as FOUNDING_OFFER in the app's
// lib/founding-offer.ts.
export const founding = {
  spots: 10,
  pilotDays: 14,
  // Reps a company may have during the pilot (the app's trial_user_limit).
  pilotReps: 10,
  // After the pilot: this much off the plan that fits, for this many months.
  percentOff: 40,
  priceMonths: 3,
  // The guarantee: run it this many days; its conditions are on /terms#guarantee.
  guaranteeDays: 30,
  // Who calls each /founding applicant, usually within minutes, and from which
  // number (owner, 25 Oct 2026). Only /founding names him; the rest of the site
  // still says "our team" (owner, 19 Oct 2026). The same as FOUNDING_OFFER in
  // the app (its Telegram card drafts his first WhatsApp); a test checks.
  caller: "Conrad",
  callerNumber: "+267 76 642 259",
  // The app's endpoint. NEXT_PUBLIC_FOUNDING_API points a local site at a local app.
  apiUrl: process.env.NEXT_PUBLIC_FOUNDING_API || "https://app.tickd.co.za/api/founding",
} as const;

/** A plan's founding price a month: `founding.percentOff` off, in whole rands. */
export function foundingPrice(plan: Plan): number {
  return Math.round((plan.monthly * (100 - founding.percentOff)) / 100);
}

/** The lowest founding price, the "from" price: the smallest plan's. */
export const foundingFrom = foundingPrice(firstPlan);

// What a founder gets besides the discount, each with what it is worth (owner,
// 19 Oct 2026). Each bonus answers one doubt: the audit "I don't know if I
// have a problem", the templates "I don't know how to set up call cycles", the
// WhatsApp line "what if I get stuck?". The AI Manager is part of every plan
// (owner, 20 Oct 2026), so it is not listed as a bonus. The templates are
// Gold Fortune's, the owner's own family business, so the line says "the
// team we built Tickd with", never "a client".
export const foundingStack: { name: string; note: string; worth: number }[] = [
  { name: "Done-for-you setup", note: "Your stores, products and reps, loaded for you", worth: pricing.setupValue },
  { name: "A rep training day, by video call", note: "Your reps learn the app, and you learn the dashboard", worth: pricing.trainingValue },
  { name: "Bonus: the Rep Leak Audit", note: "A report on the store visits your reps miss", worth: 1500 },
  { name: "Bonus: call-cycle and route templates", note: "From the merchandising team we built Tickd with", worth: 1000 },
  { name: "Bonus: 60 days of WhatsApp support from our team", note: "A direct line if you get stuck", worth: 5000 },
];

export const foundingWorth = foundingStack.reduce((sum, b) => sum + b.worth, 0);

// The doubts an owner has at the point of signing up, answered just under the
// form (owner, 19 Oct 2026), on the main page and on /founding.
export const objections: [q: string, a: string][] = [
  [
    "Will my reps actually use it?",
    "Yes. It's less work than WhatsApp: one tap starts their day, and an order takes a minute. Reps learn it in 10 minutes, and we train them for you on a video call.",
  ],
  [
    "What happens in areas with no signal?",
    "It keeps working. Visits, photos and orders are saved on the phone, and sent once there's signal again.",
  ],
  [
    "Is there a contract?",
    `No. The founding price is yours for your first ${founding.priceMonths} months, and you can stop at the end of any month. The pilot is free, and we don't ask for a card.`,
  ],
  ["Can I see my data in Excel?", "Yes. Your sales, invoices and reports download to Excel or CSV whenever you want them."],
  [
    `What if I have more than ${biggestPlan.reps} reps?`,
    `The founding price covers our plans up to ${biggestPlan.reps} reps. Tell us on the form how many you have, and we'll give you a founding price for your whole team.`,
  ],
];

// Google Analytics 4 for the whole site. Paste the Measurement ID ("G-" and
// letters, from Admin > Data streams in Google Analytics) between the quotes;
// while it is empty, nothing loads and nothing is sent. The privacy page says
// so only while it is set.
export const gaMeasurementId: string = "G-7Q710H1MSW";

// The Meta (Facebook) Pixel, on every page. Paste the Pixel ID between the
// quotes; while it is empty, nothing loads and nothing is sent.
export const metaPixelId: string = "1009164142204684";

// The Gold Fortune result for the proof section: real numbers from Tickd's own
// data (read-only, 10 Oct 2026), the first two weeks of use against the two
// most recent full weeks without a public holiday, same 3 reps both times.
// Tickd has no "before Tickd" data, so this is early use against later use;
// the bars say "First 2 weeks" and "Mid September". The *N numbers only set
// the bar heights.
//   early  = 3 to 16 Aug 2026:  175 visits, 32 rep-days, 99 stores, 65.2% within 200 m
//   recent = 14 to 27 Sep 2026: 200 visits, 26 rep-days, 144 stores, 84.7% within 200 m
export const proof = {
  reps: 3,
  stores: 265,
  // One retailer's monthly sales in rand, as Gold Fortune reports them (the
  // owner, 10 Oct 2026: R184,000 to R340,000, 340 / 184 = up 85%). This is NOT
  // from the Tickd app, so the page credits Gold Fortune. The period it covers
  // is not known, so the bars say only "Before" and "After".
  retailer: {
    label: "Sales a month at one of their retailers",
    before: "R184,000",
    after: "R340,000",
    beforeN: 184000,
    afterN: 340000,
    up: "Up 85%.",
  },
  perRepDay: { label: "Visits per rep per day", before: "5.5", after: "7.7", beforeN: 5.47, afterN: 7.69, up: "Up 41%." },
  stores2w: { label: "Different stores visited in two weeks", before: "99", after: "144", beforeN: 99, afterN: 144, up: "Up 45%." },
  atDoor: { label: "Check-ins within 200 m of the store", before: "65%", after: "85%", beforeN: 65.2, afterN: 84.7, up: "" },
} as const;

// The details the legal pages need, in one place. Each must be the owner's
// real details before the site goes live; an empty one is left off the page.
export const legal = {
  // Registered in South Africa (CIPC). The company registration number.
  registeredIn: "South Africa",
  registrationNumber: "2014/019073/07",
  // Physical address for notices: the registered office (CIPC certificate).
  address: "109 Rosenheim, Serfontein Street, Fichardtpark, Bloemfontein, 9301, South Africa",
  // A telephone number for the business (ECTA s43).
  phone: "",
  // Who answers privacy requests (Botswana: data protection officer; POPIA:
  // information officer). Empty since 19 Oct 2026 (owner: the site says "our
  // team", never a person's name); put a name back here to show it.
  informationOfficer: "",
  // Where the app's data is hosted (Supabase, AWS eu-west-3).
  dataLocation: "Paris, France",
  lastUpdated: "22 October 2026",
} as const;

export function rand(amount: number): string {
  // en-US for "R1,499": en-ZA groups with a non-breaking space.
  return `${pricing.currency}${amount.toLocaleString("en-US")}`;
}
