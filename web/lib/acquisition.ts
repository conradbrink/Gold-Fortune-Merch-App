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
// Meta's {{site_source_name}} sends short codes.
const SOURCE_ALIAS: Record<string, string> = { fb: "facebook", ig: "instagram", msg: "messenger", an: "audience network" };

export function sourceOf(a: Attribution | null | undefined): string {
  if (a?.utm_source) {
    const s = a.utm_source.toLowerCase();
    return SOURCE_ALIAS[s] ?? s;
  }
  if (a?.referrer) {
    const host = a.referrer.replace(/^(www|m|l|lm|web|mobile)\./, "");
    const parts = host.split(".");
    // facebook.com → facebook; google.co.za → google (co.za, com.au, org.uk… are
    // endings, not names); app.hey.com → hey.
    const secondLevel = /^(co|com|org|net|gov|ac|edu|nom|ltd|plc|web)$/;
    const ending = parts.length >= 3 && secondLevel.test(parts[parts.length - 2]) ? 2 : 1;
    return parts[parts.length - 1 - ending] ?? host;
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
  if (isSocial || /^(social|social-network|social-media|sm|social network|social media)$/.test(medium)) return "Organic Social";
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

export type CompanyFacts = {
  id: string;
  name: string;
  freePeriod: boolean;
  /** Its team has finished a job in Tickd; null while that can't be read yet. */
  activated: boolean | null;
};

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
    {
      key: "activated",
      label: "First job finished",
      count: linked.some((a) => input.companies.get(a.organization_id!)?.activated === null)
        ? null
        : linked.filter((a) => input.companies.get(a.organization_id!)?.activated).length,
      note: "Needs a database update that hasn't been applied yet.",
      from: "tickd",
      href: "/platform/onboarding",
    },
    { key: "paying", label: "Paying", count: null, note: "Billing isn't live yet.", from: "tickd" },
  ];
}

// ------------------------------------------------------------ Tickd's own count

export type OwnSource = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer: string | null;
  click_id: string | null;
  visitors: number;
  started: number;
  applied: number;
};

export type OwnStats = {
  visitors: number;
  newVisitors: number;
  sessions: number;
  pageViews: number;
  daily: { day: string; visitors: number; views: number }[];
  pages: { path: string; visitors: number; views: number; started: number }[];
  /** People who did each event: page_view, pricing_view, signup_started… */
  events: Record<string, number>;
  sources: OwnSource[];
  devices: string[];
  countries: string[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** platform_web_stats()'s JSON, read defensively into numbers and strings. */
export function parseOwnStats(json: unknown): OwnStats {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const events = (o.events && typeof o.events === "object" ? o.events : {}) as Record<string, unknown>;
  return {
    visitors: num(o.visitors),
    newVisitors: num(o.new_visitors),
    sessions: num(o.sessions),
    pageViews: num(o.page_views),
    daily: arr(o.daily).map((d) => ({ day: String(d.day ?? ""), visitors: num(d.visitors), views: num(d.views) })),
    pages: arr(o.pages).map((p) => ({ path: String(p.path ?? ""), visitors: num(p.visitors), views: num(p.views), started: num(p.started) })),
    events: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, num(v)])),
    sources: arr(o.sources).map((x) => ({
      utm_source: str(x.utm_source),
      utm_medium: str(x.utm_medium),
      utm_campaign: str(x.utm_campaign),
      referrer: str(x.referrer),
      click_id: str(x.click_id),
      visitors: num(x.visitors),
      started: num(x.started),
      applied: num(x.applied),
    })),
    devices: (Array.isArray(o.devices) ? o.devices : []).filter((d): d is string => typeof d === "string"),
    countries: (Array.isArray(o.countries) ? o.countries : []).filter((c): c is string => typeof c === "string"),
  };
}

/** Visitors and people who started applying, per channel or campaign, from the own count's sources. */
export function groupSources(sources: OwnSource[], key: (s: OwnSource) => string | null): Map<string, { visitors: number; started: number }> {
  const out = new Map<string, { visitors: number; started: number }>();
  for (const s of sources) {
    const k = key(s);
    if (k === null) continue;
    const t = out.get(k) ?? { visitors: 0, started: 0 };
    t.visitors += s.visitors;
    t.started += s.started;
    out.set(k, t);
  }
  return out;
}

/** An own-count source as the attribution shape channelOf() reads. */
export const asAttribution = (s: OwnSource): Attribution => ({
  ...(s.utm_source ? { utm_source: s.utm_source } : {}),
  ...(s.utm_medium ? { utm_medium: s.utm_medium } : {}),
  ...(s.utm_campaign ? { utm_campaign: s.utm_campaign } : {}),
  ...(s.referrer ? { referrer: s.referrer } : {}),
  ...(s.click_id ? { click_id: s.click_id as Attribution["click_id"] } : {}),
});

/** The funnel's per-event people, in the shape acquisitionStages() reads. */
export const eventsMap = (s: OwnStats) => new Map(Object.entries(s.events).map(([k, v]) => [k, { current: v }]));

/** A campaign name as it should travel in a link: lower case, words joined by dashes. */
export function campaignSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ------------------------------------------------------------ the application form, box by box

/** The Founding form's boxes, top to bottom, as the site sends them (site/components/founding-form.tsx). */
export const FORM_FIELDS = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["business_name", "Business name"],
  // Asked from 19 Oct 2026. The email box came off the form that day and came
  // back on 20 Oct 2026, last, after WhatsApp.
  ["distributes", "What they distribute"],
  ["team_size", "How many reps"],
  ["whatsapp", "WhatsApp number"],
  ["email", "Email"],
] as const;

export type FormEventRow = { name: string; visitor_id: string; section: string | null; at: string };

export type FormReport = {
  started: number;
  sent: number;
  /** People who reached and who answered each box, in FORM_FIELDS order. */
  fields: { key: string; label: string; reached: number; filled: number }[];
  /** People who pressed Send at least once. */
  pressedSend: number;
  /** Where each person who started but never sent was last: most first. */
  stopped: { label: string; people: number }[];
  /** What stopped a Send, by box or cause: most first. */
  errors: { label: string; people: number }[];
};

const fieldLabel = (key: string | null) => FORM_FIELDS.find(([k]) => k === key)?.[1] ?? null;

function errorLabel(section: string | null): string {
  if (section === "network") return "No signal (the phone couldn't reach us)";
  if (section?.startsWith("server-")) return `Our server said no (${section.slice(7)})`;
  return fieldLabel(section) ?? "Something else";
}

/**
 * Where people stop on the application form, from the site's own events
 * (signup_started, signup_field, signup_filled, signup_submitted,
 * signup_error, signup_completed). People are browsers, as on the funnel.
 * Someone who started before the boxes were counted (11 Oct 2026) shows as
 * "Before boxes were counted".
 */
export function formReport(rows: FormEventRow[]): FormReport {
  // Each person's events, in time order; and who did each event (per box).
  const byVisitor = new Map<string, FormEventRow[]>();
  const did = new Map<string, Set<string>>();
  for (const r of [...rows].sort((a, b) => a.at.localeCompare(b.at))) {
    byVisitor.set(r.visitor_id, [...(byVisitor.get(r.visitor_id) ?? []), r]);
    for (const k of [r.name, `${r.name}:${r.section}`]) did.set(k, (did.get(k) ?? new Set()).add(r.visitor_id));
  }
  const people = (name: string, section?: string) => did.get(section === undefined ? name : `${name}:${section}`) ?? new Set<string>();
  const started = people("signup_started");
  const sent = people("signup_completed");

  const tally = (counts: Map<string, number>) =>
    [...counts].map(([label, n]) => ({ label, people: n })).sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));

  // Each person's last box: the latest focus or answer, and whether that box was answered.
  const stoppedAt = new Map<string, number>();
  for (const visitor of started) {
    if (sent.has(visitor)) continue;
    const own = (byVisitor.get(visitor) ?? []).filter((r) => (r.name === "signup_field" || r.name === "signup_filled") && fieldLabel(r.section));
    const last = own.at(-1);
    let label = "Before boxes were counted";
    if (last) {
      const answered = own.some((r) => r.name === "signup_filled" && r.section === last.section);
      label = `${answered ? "Answered" : "Left empty"}: ${fieldLabel(last.section)}`;
    }
    stoppedAt.set(label, (stoppedAt.get(label) ?? 0) + 1);
  }

  const errorPeople = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.name !== "signup_error") continue;
    const label = errorLabel(r.section);
    errorPeople.set(label, (errorPeople.get(label) ?? new Set()).add(r.visitor_id));
  }

  return {
    started: started.size,
    sent: sent.size,
    fields: FORM_FIELDS.map(([key, label]) => ({
      key,
      label,
      reached: people("signup_field", key).size,
      filled: people("signup_filled", key).size,
    })),
    pressedSend: new Set([...people("signup_submitted"), ...people("signup_error"), ...sent]).size,
    stopped: tally(stoppedAt),
    errors: tally(new Map([...errorPeople].map(([k, v]) => [k, v.size]))),
  };
}
