// Where a visitor first came from, kept in their own browser.
//
// On the first page of the first visit the site notes the link's UTM tags, the
// other site's host name, the first page, and which kind of ad click it was
// (never the click's ID). Nothing leaves the browser until the visitor applies:
// the application sends it, and the app checks it again (lib/founding.ts
// checkAttribution in the app). No cookie, nothing that names anyone.
//
// localStorage can be missing or refuse (a private window, blocked site data),
// so every touch is wrapped and the site works the same without it.

const KEY = "tickd_first_visit";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const CLICK_IDS = ["gclid", "fbclid", "msclkid", "ttclid"] as const;

export type FirstVisit = Partial<Record<(typeof UTM_KEYS)[number], string>> & {
  referrer?: string;
  landing_page?: string;
  click_id?: (typeof CLICK_IDS)[number];
  first_seen_at?: string;
};

/** What this page view says about where the visitor came from. */
export function describeVisit(href: string, referrer: string, now: Date): FirstVisit {
  const url = new URL(href);
  const visit: FirstVisit = { landing_page: url.pathname, first_seen_at: now.toISOString() };
  for (const key of UTM_KEYS) {
    const v = url.searchParams.get(key)?.trim();
    if (v) visit[key] = v.slice(0, 100);
  }
  const click = CLICK_IDS.find((k) => url.searchParams.has(k));
  if (click) visit.click_id = click;
  try {
    const from = referrer ? new URL(referrer).hostname.toLowerCase() : "";
    if (from && from !== url.hostname.toLowerCase()) visit.referrer = from;
  } catch {
    /* not an address: no referrer */
  }
  return visit;
}

/** Notes the first visit, once. Later visits never overwrite it. */
export function rememberFirstVisit(): void {
  try {
    if (window.localStorage.getItem(KEY)) return;
    const visit = describeVisit(window.location.href, document.referrer, new Date());
    window.localStorage.setItem(KEY, JSON.stringify(visit));
  } catch {
    /* storage refused: nothing is remembered */
  }
}

/** The first visit, for an application; this visit's details when nothing was remembered. */
export function firstVisit(): FirstVisit | null {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as FirstVisit;
    }
  } catch {
    /* storage refused or the value is damaged: fall through */
  }
  try {
    return describeVisit(window.location.href, document.referrer, new Date());
  } catch {
    return null;
  }
}
