import type { Verdict } from "@/lib/activities";
import { lower, possessive, withArticle, type Terms } from "@/lib/terms";

/**
 * What a location verdict says, in the company's words: "At store" at Gold
 * Fortune, "At site" at a company that calls them sites. The codes
 * (`at_store`, …) are stored and compared as data, so only the wording
 * follows the terms.
 *
 * Pure and apart from the badge component, so the screen, the export and the
 * tests all read the same sentences.
 */
export type VerdictWords = {
  label: string;
  /** Shown on hover — says what the colour actually means. */
  hint: string;
};

export function verdictWords(t: Terms): Record<Verdict, VerdictWords> {
  const site = lower(t.site.one);
  return {
    at_store: {
      label: `At ${site}`,
      hint: `Inside the ${possessive(site)} geofence — location confirmed.`,
    },
    nearby: {
      label: "Nearby",
      hint: "Just outside the geofence. Normal for a large site or ordinary GPS drift.",
    },
    off_site: {
      label: "Off site",
      hint: `Further from the ${site} than your company's off-site distance — a genuine discrepancy worth checking.`,
    },
    invalid_gps: {
      label: "Invalid GPS",
      hint: "Further out than your company's implausible-GPS distance, so it cannot be true. Treated as a faulty fix, not as behaviour.",
    },
    unknown: {
      label: "No fix",
      hint: "No GPS position was recorded for this event, so location cannot be confirmed.",
    },
    // Not a failure to verify — there is simply nothing to verify against. A
    // prospect is not on the estate, so it has no geofence and no distance.
    prospect: {
      label: "Prospect",
      hint: `A sales call on a shop that is not ${withArticle(t, "client")} yet. Position recorded, but there is no ${site} geofence to measure it against.`,
    },
  };
}
