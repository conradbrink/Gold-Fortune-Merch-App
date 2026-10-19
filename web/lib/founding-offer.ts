/**
 * The Founding 10 for distributors (owner, 19 Oct 2026; it replaced the "60
 * days free, then R749 a month" offer of 10 Oct): a free 14-day pilot, set up
 * for them, then the founding price for 12 months, 40% off the plan for up to
 * 10 reps. The same numbers as `founding` in the site's `lib/site.ts`; change
 * them in both.
 */
export const FOUNDING_OFFER = {
  spots: 10,
  pilotDays: 14,
  /** After the pilot: the price a month, for this many months, for up to `reps` reps. */
  price: 2097,
  priceMonths: 12,
  reps: 10,
  /** The plan price the founding price is taken off, and how much off. */
  fullPrice: 3495,
  percentOff: 40,
  /** How soon we WhatsApp an applicant back, in work hours. */
  replyMinutes: 5,
  /** Where the application is. */
  applyUrl: "https://tickd.co.za/founding",
} as const;
