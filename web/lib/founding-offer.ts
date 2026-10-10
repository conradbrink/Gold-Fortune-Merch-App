/**
 * The Founding 10, as the sign-up page says it (owner, 10 Oct 2026): the first
 * businesses run Tickd free for 60 days, set up for them, and apply on the sales
 * site. The same numbers as `founding` in the site's `lib/site.ts`; change them
 * in both.
 */
export const FOUNDING_OFFER = {
  spots: 10,
  days: 60,
  /** After the free days: the price a month, for this many months. */
  price: 749,
  priceMonths: 12,
  closes: "Monday 19 October",
  /** The days we call every applicant. */
  callsBetween: "20 and 22 October",
  /** When every applicant hears back. */
  tellsBy: "Friday 23 October",
  /** When the picked businesses are set up, and when their free days start. */
  setupFrom: "26 October",
  startsOn: "Monday 2 November",
  /** Where the application is. */
  applyUrl: "https://tickd.co.za/founding",
} as const;
