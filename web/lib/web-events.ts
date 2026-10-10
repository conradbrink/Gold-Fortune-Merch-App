/**
 * Website events counted by Tickd itself (web_events): the sales site sends
 * each page view and funnel event to /api/events, so the Control Centre's
 * website numbers are instant. Pure, so the tests reach every rule.
 *
 * Anonymous by design: a random id for the browser and one for the visit, the
 * page, the section, how the visit arrived (UTM tags, the other site's host,
 * the kind of ad click, never its id), the kind of device and the country.
 * Anything else the browser sends is dropped; anything odd is dropped too,
 * never an error, because the site must never break over counting.
 */

export type WebEventRow = {
  name: string;
  visitor_id: string;
  session_id: string;
  path: string;
  section: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  click_id: "gclid" | "fbclid" | "msclkid" | "ttclid" | null;
  device: "mobile" | "tablet" | "desktop" | null;
  country: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLICK_IDS = ["gclid", "fbclid", "msclkid", "ttclid"] as const;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max && !/[\u0000-\u001f\u007f]/.test(t) ? t : null;
};

/** The event the site sent, checked field by field; null when it can't be counted at all. */
export function checkWebEvent(body: unknown, device: WebEventRow["device"], country: string | null): WebEventRow | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const name = text(o.name, 40);
  const visitor = text(o.visitor_id, 36);
  const session = text(o.session_id, 36);
  const path = text(o.path, 200);
  if (!name || !/^[a-z][a-z0-9_]{1,39}$/.test(name)) return null;
  if (!visitor || !UUID.test(visitor) || !session || !UUID.test(session)) return null;
  if (!path || !/^\/[^\s?#]*$/.test(path)) return null;
  const section = text(o.section, 40);
  const referrer = text(o.referrer_host, 253)?.toLowerCase() ?? null;
  return {
    name,
    visitor_id: visitor.toLowerCase(),
    session_id: session.toLowerCase(),
    path,
    section: section && /^[a-z0-9_-]{1,40}$/.test(section) ? section : null,
    referrer_host: referrer && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(referrer) ? referrer : null,
    utm_source: text(o.utm_source, 100),
    utm_medium: text(o.utm_medium, 100),
    utm_campaign: text(o.utm_campaign, 100),
    click_id: (CLICK_IDS as readonly unknown[]).includes(o.click_id) ? (o.click_id as WebEventRow["click_id"]) : null,
    device,
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

/**
 * Robots and scripts: not visitors. Events are sent by the page's JavaScript,
 * so link previews (WhatsApp, Facebook) never send any; this catches crawlers
 * that run JavaScript, automated browsers, and scripts posting directly. Not
 * "WhatsApp" or "preview": people opening a link inside WhatsApp are real.
 */
export function isRobot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /bot\b|crawl|spider|slurp|headlesschrome|lighthouse|pingdom|uptime|curl\/|wget\/|python|axios|node-fetch|undici/i.test(userAgent);
}

/** The kind of device, from the user agent (which is not kept). */
export function deviceOf(userAgent: string | null): WebEventRow["device"] {
  if (!userAgent) return null;
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|windows phone/i.test(userAgent)) return "mobile";
  return "desktop";
}
