/**
 * Tickd's own words and picture at the foot of the emails it sends for a
 * company's clients. No server-only imports, so the templates stay testable.
 */

export const TICKD_SITE_URL = "https://tickd.co.za";

/** Where the picture lives: a file in the app's public folder, so the address must be absolute. */
export function emailAssetUrl(file: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "https://app.tickd.co.za").replace(/\/$/, "");
  return `${origin}/${file.replace(/^\//, "")}`;
}

/** The wordmark as a PNG (mail programs do not show SVG): `public/tickd-logo-email.png`, 420 x 152. */
export const TICKD_LOGO_FILE = "tickd-logo-email.png";

export const PROMO = {
  // For distributors only since 19 Oct 2026, like the sales site.
  headline: "Know which stores your reps visited today.",
  body: "Tickd is the app for distributors and their reps. See every store visit, take orders on the phone, and invoice every order, all in one place.",
  cta: "Start a free Tickd pilot",
  /** The Founding offer's page, with a tag that says where the visit came from. */
  url: `${TICKD_SITE_URL}/founding?utm_source=client-email&utm_medium=email&utm_campaign=sent-with-tickd`,
} as const;
