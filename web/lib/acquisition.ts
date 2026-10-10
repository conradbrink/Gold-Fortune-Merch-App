/**
 * The operator's Acquisition pages: periods, changes, the funnel, and where
 * applicants came from. Pure, so the tests reach every rule.
 *
 * Two kinds of numbers meet here and stay labelled as such (spec section 26):
 *   - anonymous website numbers from Google Analytics (people are devices);
 *   - Tickd's own records from the Founding application on: applications,
 *     the companies made from them, their free period.
 * Applications carry how the applicant found us (founding_applications.attribution);
 * `channelOf` sorts that into Google's own channel names, so a row of the
 * Sources table can put GA's visitors next to Tickd's applications.
 */

import type { Attribution } from "@/lib/founding";

export const RANGES = {
  "7d": { days: 7, label: "7 days" },
  "30d": { days: 30, label: "30 days" },
  "90d": { days: 90, label: "90 days" },
  "12m": { days: 365, label: "12 months" },
} as const;
export type RangeKey = keyof typeof RANGES;

export function readRange(value: string | string[] | undefined): RangeKey {
  return typeof value === "string" && value in RANGES ? (value as RangeKey) : "30d";
}

export type Period = {
  /** Google Analytics dates (the property is on South African time). */
  startDate: string;
  endDate: string;
  /** The same days as instants, for Tickd's own rows: from inclusive, to exclusive. */
  from: string;
  to: string;
};

// South Africa has no daylight saving: always UTC+2.
const SAST_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function sastDay(ms: number): string {
  return new Date(ms + SAST_MS).toISOString().slice(0, 10);
}

/** The last N days up to today, and the N days before them. */
export function periods(range: RangeKey, now: Date): { current: Period; previous: Period } {
  const days = RANGES[range].days;
  // Midnight at the start of today, South African time, as an instant.
  const todayStart = Date.parse(sastDay(now.getTime()) + "T00:00:00Z") - SAST_MS;
  const make = (startMs: number, endExclusiveMs: number): Period => ({
    startDate: sastDay(startMs),
    endDate: sastDay(endExclusiveMs - 1),
    from: new Date(startMs).toISOString(),
    to: new Date(endExclusiveMs).toISOString(),
  });
  const currentStart = todayStart - (days - 1) * DAY_MS;
  const currentEnd = todayStart + DAY_MS;
  return {
    current: make(currentStart, currentEnd),
    previous: make(currentStart - days * DAY_MS, currentStart),
  };
}

/** The change against the previous period, or null when there is nothing to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export function formatChange(value: number | null): string | null {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "n/a";
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

// ------------------------------------------------------------ where they came from

export const CHANNELS = [
  "Direct",
  "Organic Search",
  "Paid Search",
  "Organic Social",
  "Paid Social",
  "Email",
  "Referral",
  "Unassigned",
] as const;
export type Channel = (typeof CHANNELS)[number];

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|t|twitter|x|tiktok|youtube|pinterest|whatsapp|wa|threads|reddit)\./;
const SEARCH_NAMES = /^(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex)$/;
const SOCIAL_NAMES = /^(facebook|fb|ig|instagram|linkedin|twitter|x|tiktok|youtube|pinterest|whatsapp|threads|reddit|meta)$/;

/** A source as one plain word: the utm_source, else the other site's name, else "direct". */
export function sourceOf(a: Attribution | null | undefined): string {
  if (a?.utm_source) return a.utm_source.toLowerCase();
  if (a?.referrer) {
    const host = a.referrer.replace(/^(www|m|l|lm|web|mobile)\./, "");
    const parts = host.split(".");
    // facebook.com → facebook; co.za style endings keep the name before them.
    const name = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
    return name ?? host;
  }
  if (a?.click_id === "gclid") return "google";
  if (a?.click_id === "fbclid") return "facebook";
  return "direct";
}

/**
 * Google's default channel for an application's first visit, close enough to
 * GA's own rules that the two line up on one row: paid when the link says so
 * (a cpc/paid medium, or a Google/Microsoft ad click), search or social by the
 * source, else referral, else direct.
 */
export function channelOf(a: Attribution | null | undefined): Channel {
  if (!a) return "Direct";
  const medium = a.utm_medium?.toLowerCase() ?? "";
  const source = sourceOf(a);
  const referrer = a.referrer ?? "";
  const isSearch = SEARCH_NAMES.test(source) || SEARCH.test(referrer + ".");
  const isSocial = SOCIAL_NAMES.test(source) || SOCIAL.test(referrer + ".");
  const isPaid = /^(cpc|ppc|paid.*|cpm|cpv|cpa|display|banner|ads?)$/.test(medium);
  if (medium === "email" || source === "email" || source === "newsletter") return "Email";
  if (a.click_id === "gclid" || a.click_id === "msclkid") return "Paid Search";
  if (isPaid) return isSocial ? "Paid Social" : "Paid Search";
  if (isSocial) return "Organic Social";
  if (isSearch) return "Organic Search";
  if (medium === "referral" || referrer) return "Referral";
  if (a.utm_source || a.utm_campaign) return "Unassigned";
  return "Direct";
}

// ------------------------------------------------------------ Tickd's own rows

export type ApplicationRow = {
  id: string;
  created_at: string;
  attribution: Attribution | null;
  /** The company made from this application, once the operator links it. */
  organization_id: string | null;
};

export type CompanyFacts = { id: string; name: string; freePeriod: boolean };

export type Tally = { applications: number; companies: number; freePeriods: number };

/** Applications grouped by a key (channel, campaign, page…), with what came of them. */
export function tallyApplications(
  apps: ApplicationRow[],
  key: (a: ApplicationRow) => string | null,
  companies: Map<string, CompanyFacts>
): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const app of apps) {
    const k = key(app);
    if (k === null) continue;
    const t = out.get(k) ?? { applications: 0, companies: 0, freePeriods: 0 };
    t.applications += 1;
    const company = app.organization_id ? companies.get(app.organization_id) : undefined;
    if (company) {
      t.companies += 1;
      if (company.freePeriod) t.freePeriods += 1;
    }
    out.set(k, t);
  }
  return out;
}

// ------------------------------------------------------------ the funnel

export type FunnelStage = {
  key: string;
  label: string;
  /** Null when the step is not measured yet; `note` says why. */
  count: number | null;
  note?: string;
  href?: string;
  /** Who counts it: Google Analytics (devices) or Tickd's own records. */
  from: "website" | "tickd";
};

export type FunnelStep = FunnelStage & {
  /** Share of the step before that reached this one. */
  ofPrevious: number | null;
  dropOff: number | null;
};

export function buildFunnel(stages: FunnelStage[]): { steps: FunnelStep[]; leak: { from: string; to: string; lost: number; of: number } | null } {
  let worst: { from: string; to: string; lost: number; of: number; rate: number } | null = null;
  const steps = stages.map((stage, i) => {
    const prev = i > 0 ? stages[i - 1] : null;
    const measurable = prev && prev.count !== null && stage.count !== null && prev.count > 0;
    const ofPrevious = measurable ? Math.min(stage.count! / prev.count!, 1) : null;
    if (measurable && ofPrevious !== null && prev.count! - stage.count! > 0) {
      if (!worst || ofPrevious < worst.rate) {
        worst = { from: prev.label, to: stage.label, lost: prev.count! - stage.count!, of: prev.count!, rate: ofPrevious };
      }
    }
    return { ...stage, ofPrevious, dropOff: ofPrevious === null ? null : 1 - ofPrevious };
  });
  const leak = worst as { from: string; to: string; lost: number; of: number } | null;
  return { steps, leak: leak ? { from: leak.from, to: leak.to, lost: leak.lost, of: leak.of } : null };
}

// ------------------------------------------------------------ reading GA rows

/**
 * GA answers a two-period request with a "dateRange" column holding each
 * range's name. This reads one metric per name for both periods.
 */
export function byNameAndPeriod(
  rows: { dimensions: string[]; metrics: number[] }[],
  metric = 0
): Map<string, { current: number; previous: number }> {
  const out = new Map<string, { current: number; previous: number }>();
  for (const row of rows) {
    const period = row.dimensions.includes("previous") ? "previous" : "current";
    const name = row.dimensions.find((d) => d !== "current" && d !== "previous") ?? "";
    const entry = out.get(name) ?? { current: 0, previous: 0 };
    entry[period] += row.metrics[metric] ?? 0;
    out.set(name, entry);
  }
  return out;
}

/**
 * The whole funnel for a period, as stages. Website steps come from Google
 * Analytics (null with a reason while it isn't connected); the rest are
 * Tickd's own records. Steps Tickd does not measure yet say so instead of 0.
 */
export function acquisitionStages(input: {
  /** People (GA users) per event name, or null when GA did not answer. */
  events: Map<string, { current: number }> | null;
  gaMissing: string;
  applications: ApplicationRow[];
  companies: Map<string, CompanyFacts>;
  range: RangeKey;
}): FunnelStage[] {
  const ga = (name: string) => (input.events ? input.events.get(name)?.current ?? 0 : null);
  const linked = input.applications.filter((a) => a.organization_id && input.companies.has(a.organization_id));
  return [
    { key: "visitors", label: "Visited the website", count: ga("page_view"), note: input.gaMissing, from: "website", href: `/platform/acquisition/website?range=${input.range}` },
    { key: "pricing", label: "Saw the prices", count: ga("pricing_view"), note: input.gaMissing, from: "website" },
    { key: "started", label: "Started an application", count: ga("signup_started"), note: input.gaMissing, from: "website" },
    { key: "applied", label: "Applied", count: input.applications.length, from: "tickd", href: "/platform/founding" },
    { key: "company", label: "Company set up", count: linked.length, from: "tickd", href: "/platform/founding" },
    {
      key: "free",
      label: "Free period started",
      count: linked.filter((a) => input.companies.get(a.organization_id!)?.freePeriod).length,
      from: "tickd",
    },
    { key: "activated", label: "Activated", count: null, note: "Not measured yet (Control Centre step 3).", from: "tickd" },
    { key: "paying", label: "Paying", count: null, note: "Billing isn't live yet.", from: "tickd" },
  ];
}
