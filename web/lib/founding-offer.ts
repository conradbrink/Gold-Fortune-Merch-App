/**
 * The Founding 10 for distributors (owner, 19 Oct 2026; it replaced the "60
 * days free, then R749 a month" offer of 10 Oct): a free 14-day pilot, set up
 * for them, then 40% off the plan that fits their team for their first 3
 * months (owner, 20 Oct 2026; it was R2,097 a month for 12 months, 40% off the
 * 10-rep plan). The founding price of each plan is `foundingPrice` in
 * lib/plans.ts. The same numbers as `founding` in the site's `lib/site.ts`;
 * change them in both (tests/plans.test.ts checks).
 */
export const FOUNDING_OFFER = {
  spots: 10,
  pilotDays: 14,
  /** Reps a company may have during the pilot (platform_settings trial_user_limit). */
  pilotReps: 10,
  /** After the pilot: this much off the plan that fits, for this many months. */
  percentOff: 40,
  priceMonths: 3,
  /** Where the application is. */
  applyUrl: "https://tickd.co.za/founding",
  /** Who calls each /founding applicant, and from which number (owner, 25 Oct 2026). */
  caller: "Conrad",
  callerNumber: "+267 76 642 259",
} as const;
