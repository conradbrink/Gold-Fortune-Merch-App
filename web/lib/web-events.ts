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
  return /bot\b|crawl|spider|slurp|facebookexternalhit|meta-external|headlesschrome|lighthouse|pingdom|uptime|curl\/|wget\/|python|axios|node-fetch|undici/i.test(userAgent);
}

/**
 * Meta's own network (AS32934, from its published routes, collapsed). When an
 * advert is published, Meta's review opens every link many times over, in an
 * ordinary-looking phone or tablet browser that carries the advert's tags, an
 * fbclid and a facebook.com referrer: on 11 Oct 2026, 810 of the first 842
 * events. Only the address gives it away. People on Facebook or Instagram open
 * links from their own phone's address, never from these. To refresh:
 * `whois -h whois.radb.net -- '-i origin AS32934'`, then collapse the routes.
 */
const META_NETWORKS = [
  "31.13.24.0/21", "31.13.64.0/18", "45.64.40.0/22", "57.141.0.0/20", "57.141.16.0/21", "57.141.24.0/22",
  "57.141.28.0/23", "57.144.0.0/14", "66.220.144.0/20", "69.63.176.0/20", "69.171.224.0/19", "74.119.76.0/22",
  "102.132.96.0/20", "103.4.96.0/22", "129.134.0.0/16", "147.75.208.0/20", "157.240.0.0/16", "163.70.128.0/17",
  "163.77.128.0/17", "173.252.64.0/18", "179.60.192.0/22", "185.60.216.0/22", "185.89.216.0/22", "204.15.20.0/22",
  "2401:db00::/32", "2620:0:1c00::/40", "2803:6080::/29", "2a03:2880::/31", "2a03:2887:ff2c::/47", "2a03:83e0::/32",
  "2a10:f781:10:cee0::/64",
];

/** An address as a number and its width in bits; null when it isn't one. */
function addressBits(address: string): { value: bigint; bits: 32 | 128 } | null {
  // Tolerate "[v6]:port", "v4:port" and a zone id; then unwrap ::ffff:v4.
  const a = address
    .trim()
    .replace(/^\[([^\]]+)\](:\d+)?$/, "$1")
    .replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1")
    .replace(/%.*$/, "")
    .replace(/^::ffff:(?=\d+\.)/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
    const parts = a.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { value: parts.reduce((n, p) => (n << BigInt(8)) | BigInt(p), BigInt(0)), bits: 32 };
  }
  if (!/^[0-9a-f:]+$/i.test(a) || (a.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = a.includes("::") ? a.split("::") : [a, null];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(tail === null ? 0 : missing).fill("0"), ...right];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { value: groups.reduce((n, g) => (n << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0)), bits: 128 };
}

const META = META_NETWORKS.map((cidr) => {
  const [base, len] = cidr.split("/");
  const b = addressBits(base)!;
  const shift = BigInt(b.bits - Number(len));
  return { bits: b.bits, shift, prefix: b.value >> shift };
});

/** Whether the address belongs to Meta's network (its advert review, not a person). */
export function isMetaAddress(address: string | null): boolean {
  const b = address ? addressBits(address) : null;
  return !!b && META.some((m) => m.bits === b.bits && b.value >> m.shift === m.prefix);
}

/** The kind of device, from the user agent (which is not kept). */
export function deviceOf(userAgent: string | null): WebEventRow["device"] {
  if (!userAgent) return null;
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|windows phone/i.test(userAgent)) return "mobile";
  return "desktop";
}
