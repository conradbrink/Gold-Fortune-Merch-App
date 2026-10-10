// Tickd's own count of visits: each page view and funnel event goes to the
// app (POST /api/events) as well as to Google Analytics, so the Control
// Centre's numbers are instant.
//
// Anonymous: a random id for this browser (localStorage, not a cookie) and one
// for this visit (sessionStorage; a new visit after 30 minutes without a page,
// or when an advert link brings the visitor back). With them go the page, how
// the visit arrived (UTM tags, the other site's host, the kind of ad click,
// never its id) and, for some events, which section. The app adds the kind of
// device and the country; it keeps no IP address and no user agent.
//
// Storage can be missing or refuse (a private window, blocked site data): then
// the ids live for this page only. Counting must never break the site, so
// every step is wrapped.

export const eventsUrl = process.env.NEXT_PUBLIC_EVENTS_API || "https://app.tickd.co.za/api/events";

const VISIT_GAP_MS = 30 * 60 * 1000;
const CLICK_IDS = ["gclid", "fbclid", "msclkid", "ttclid"] as const;

type Visit = {
  id: string;
  last: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer_host?: string;
  click_id?: string;
};

let pageVisitor: string | null = null;
let pageVisit: Visit | null = null;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)
      );

function visitorId(): string {
  try {
    const saved = window.localStorage.getItem("tickd_vid");
    if (saved) return saved;
    const id = newId();
    window.localStorage.setItem("tickd_vid", id);
    return id;
  } catch {
    return (pageVisitor ??= newId());
  }
}

/** How this page view arrived: the link's UTM tags, the other site, the kind of ad click. */
export function arrival(href: string, referrer: string): Omit<Visit, "id" | "last"> {
  const url = new URL(href);
  const a: Omit<Visit, "id" | "last"> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign"] as const) {
    const v = url.searchParams.get(key)?.trim();
    if (v) a[key] = v.slice(0, 100);
  }
  const click = CLICK_IDS.find((k) => url.searchParams.has(k));
  if (click) a.click_id = click;
  try {
    const from = referrer ? new URL(referrer).hostname.toLowerCase() : "";
    if (from && from !== url.hostname.toLowerCase()) a.referrer_host = from;
  } catch {
    /* not an address */
  }
  return a;
}

/**
 * This visit, carried on: the same one while pages keep coming, a new one after
 * 30 minutes without any, or when the visitor arrives by a new advert link.
 */
export function currentVisit(saved: Visit | null, now: number, came: Omit<Visit, "id" | "last">): Visit {
  const advert = Boolean(came.utm_source || came.utm_campaign || came.click_id);
  // Every event on a page whose address still carries the advert's tags
  // arrives with them; only a different advert is a new arrival.
  const sameAdvert =
    saved !== null &&
    came.utm_source === saved.utm_source &&
    came.utm_medium === saved.utm_medium &&
    came.utm_campaign === saved.utm_campaign &&
    came.click_id === saved.click_id;
  const fresh = !saved || now - saved.last > VISIT_GAP_MS || (advert && !sameAdvert);
  return fresh ? { ...came, id: newId(), last: now } : { ...saved, last: now };
}

function visit(): Visit {
  const came = arrival(window.location.href, document.referrer);
  let saved: Visit | null = null;
  try {
    const raw = window.sessionStorage.getItem("tickd_visit");
    saved = raw ? (JSON.parse(raw) as Visit) : null;
  } catch {
    saved = pageVisit;
  }
  // A new page within the visit isn't a new arrival: only the first page's
  // link and referrer say how the visit came.
  const v = currentVisit(saved, Date.now(), saved && Date.now() - saved.last <= VISIT_GAP_MS ? keepOnly(came) : came);
  pageVisit = v;
  try {
    window.sessionStorage.setItem("tickd_visit", JSON.stringify(v));
  } catch {
    /* kept for this page only */
  }
  return v;
}

/** Within a visit, only a new advert link starts a new one; a referrer from our own pages doesn't. */
function keepOnly(came: Omit<Visit, "id" | "last">): Omit<Visit, "id" | "last"> {
  return came.utm_source || came.utm_campaign || came.click_id ? came : {};
}

/** Counts one event. Never throws, never waits. */
export function countEvent(name: string, section?: string): void {
  try {
    const v = visit();
    const body = JSON.stringify({
      name,
      visitor_id: visitorId(),
      session_id: v.id,
      path: window.location.pathname,
      section,
      utm_source: v.utm_source,
      utm_medium: v.utm_medium,
      utm_campaign: v.utm_campaign,
      referrer_host: v.referrer_host,
      click_id: v.click_id,
    });
    // text/plain keeps it a "simple" request: no preflight, and sendBeacon
    // still delivers when the visitor leaves the page.
    const blob = new Blob([body], { type: "text/plain" });
    if (!navigator.sendBeacon?.(eventsUrl, blob)) {
      void fetch(eventsUrl, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(
        () => {}
      );
    }
  } catch {
    /* counting must never break the page */
  }
}
