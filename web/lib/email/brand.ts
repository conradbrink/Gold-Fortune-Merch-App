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
  headline: "Know what your team got done today.",
  body: "Tickd is the app for businesses whose staff work out on site. See where your people are, get photo proof of every task, and send quotes and invoices, all in one place.",
  cta: "Try Tickd free for 14 days",
  /** The site's address with a tag that says where the visit came from. */
  url: `${TICKD_SITE_URL}/?utm_source=client-email&utm_medium=email&utm_campaign=sent-with-tickd`,
} as const;
