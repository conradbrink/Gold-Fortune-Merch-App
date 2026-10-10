import "server-only";
import { checkAttribution } from "@/lib/founding";
import { platformAdminClient } from "@/lib/platform";
import { runReport, type GaResult } from "@/lib/ga4";
import { byNameAndPeriod, type ApplicationRow, type CompanyFacts, type Period } from "@/lib/acquisition";

/**
 * What the Acquisition pages read. Server-only, and only called by pages that
 * have already checked `is_platform_admin()` (see lib/platform.ts's header).
 * Google Analytics answers are `GaResult`s, so a page can say "not connected"
 * or "Google said …" instead of showing a made-up zero.
 */

export type TwoPeriods = { current: Period; previous: Period };

const ranges = (p: TwoPeriods) => [
  { startDate: p.current.startDate, endDate: p.current.endDate, name: "current" },
  { startDate: p.previous.startDate, endDate: p.previous.endDate, name: "previous" },
];

// ------------------------------------------------------------ Tickd's own records

export type FirstParty = {
  applications: ApplicationRow[];
  previousApplications: number;
  companies: Map<string, CompanyFacts>;
  newCompanies: { current: number; previous: number };
  freePeriodsStarted: { current: number; previous: number };
};

export async function loadFirstParty(p: TwoPeriods): Promise<FirstParty> {
  const admin = platformAdminClient();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  const head = { count: "exact" as const, head: true };

  const [{ data: apps, error: appError }, previousApplications, newNow, newBefore, freeNow, freeBefore] =
    await Promise.all([
      admin
        .from("founding_applications")
        .select("id, created_at, attribution, organization_id")
        .gte("created_at", p.current.from)
        .lt("created_at", p.current.to)
        .order("created_at")
        .range(0, 9999),
      count(admin.from("founding_applications").select("id", head).gte("created_at", p.previous.from).lt("created_at", p.previous.to)),
      count(admin.from("organizations").select("id", head).gte("created_at", p.current.from).lt("created_at", p.current.to)),
      count(admin.from("organizations").select("id", head).gte("created_at", p.previous.from).lt("created_at", p.previous.to)),
      count(admin.from("company_account").select("org_id", head).not("trial_ends_at", "is", null).gte("created_at", p.current.from).lt("created_at", p.current.to)),
      count(admin.from("company_account").select("org_id", head).not("trial_ends_at", "is", null).gte("created_at", p.previous.from).lt("created_at", p.previous.to)),
    ]);
  if (appError) throw appError;

  const applications: ApplicationRow[] = (apps ?? []).map((a) => ({
    id: a.id,
    created_at: a.created_at,
    attribution: checkAttribution(a.attribution),
    organization_id: a.organization_id,
  }));

  const orgIds = [...new Set(applications.map((a) => a.organization_id).filter((id): id is string => Boolean(id)))];
  const companies = new Map<string, CompanyFacts>();
  if (orgIds.length > 0) {
    const [{ data: orgs, error: orgError }, { data: accounts, error: accountError }] = await Promise.all([
      admin.from("organizations").select("id, name").in("id", orgIds),
      admin.from("company_account").select("org_id, trial_ends_at").in("org_id", orgIds),
    ]);
    if (orgError) throw orgError;
    if (accountError) throw accountError;
    const free = new Set((accounts ?? []).filter((a) => a.trial_ends_at !== null).map((a) => a.org_id));
    for (const o of orgs ?? []) companies.set(o.id, { id: o.id, name: o.name, freePeriod: free.has(o.id) });
  }

  return {
    applications,
    previousApplications,
    companies,
    newCompanies: { current: newNow, previous: newBefore },
    freePeriodsStarted: { current: freeNow, previous: freeBefore },
  };
}

// ------------------------------------------------------------ Google Analytics

export type Pair = { current: number; previous: number };
export type WebsiteTotals = {
  visitors: Pair;
  newVisitors: Pair;
  returningVisitors: Pair;
  sessions: Pair;
  views: Pair;
  engagementRate: Pair;
  bounceRate: Pair;
};

type Ga<T> = { ok: true; value: T } | Extract<GaResult, { ok: false }>;

const TOTAL_METRICS = ["totalUsers", "newUsers", "sessions", "screenPageViews", "engagementRate", "bounceRate"];

export async function websiteTotals(p: TwoPeriods, filter?: unknown): Promise<Ga<WebsiteTotals>> {
  const [totals, kinds] = await Promise.all([
    runReport({ dateRanges: ranges(p), metrics: TOTAL_METRICS, dimensionFilter: filter }),
    runReport({ dateRanges: ranges(p), dimensions: ["newVsReturning"], metrics: ["activeUsers"], dimensionFilter: filter }),
  ]);
  if (!totals.ok) return totals;
  if (!kinds.ok) return kinds;
  const pick = (i: number): Pair => {
    const m = byNameAndPeriod(totals.rows, i).get("") ?? { current: 0, previous: 0 };
    return m;
  };
  return {
    ok: true,
    value: {
      visitors: pick(0),
      newVisitors: pick(1),
      sessions: pick(2),
      views: pick(3),
      engagementRate: pick(4),
      bounceRate: pick(5),
      returningVisitors: byNameAndPeriod(kinds.rows).get("returning") ?? { current: 0, previous: 0 },
    },
  };
}

/** People (GA users) who did each funnel event, in both periods. */
export async function funnelEvents(p: TwoPeriods): Promise<Ga<Map<string, Pair>>> {
  const r = await runReport({
    dateRanges: ranges(p),
    dimensions: ["eventName"],
    metrics: ["totalUsers"],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: ["page_view", "pricing_view", "feature_view", "signup_started", "signup_completed"] },
      },
    },
  });
  return r.ok ? { ok: true, value: byNameAndPeriod(r.rows) } : r;
}

/** Visitors per day in the current period. */
export async function dailyVisitors(p: TwoPeriods, filter?: unknown): Promise<Ga<{ date: string; visitors: number }[]>> {
  const r = await runReport({
    dateRanges: [{ startDate: p.current.startDate, endDate: p.current.endDate }],
    dimensions: ["date"],
    metrics: ["totalUsers"],
    dimensionFilter: filter,
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 400,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    value: r.rows.map((row) => {
      const d = row.dimensions[0];
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, visitors: row.metrics[0] };
    }),
  };
}

export type PageRow = {
  path: string;
  visitors: number;
  views: number;
  engagementRate: number;
  bounceRate: number;
  startedApplying: number;
};

export async function pages(p: TwoPeriods, filter?: unknown): Promise<Ga<PageRow[]>> {
  const signupFilter = {
    andGroup: {
      expressions: [
        { filter: { fieldName: "eventName", stringFilter: { value: "signup_started" } } },
        ...(filter ? [filter] : []),
      ],
    },
  };
  const range = [{ startDate: p.current.startDate, endDate: p.current.endDate }];
  const [all, started] = await Promise.all([
    runReport({
      dateRanges: range,
      dimensions: ["pagePath"],
      metrics: ["totalUsers", "screenPageViews", "engagementRate", "bounceRate"],
      dimensionFilter: filter,
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 100,
    }),
    runReport({ dateRanges: range, dimensions: ["pagePath"], metrics: ["totalUsers"], dimensionFilter: signupFilter, limit: 100 }),
  ]);
  if (!all.ok) return all;
  if (!started.ok) return started;
  const startedBy = new Map(started.rows.map((r) => [r.dimensions[0], r.metrics[0]]));
  return {
    ok: true,
    value: all.rows.map((r) => ({
      path: r.dimensions[0],
      visitors: r.metrics[0],
      views: r.metrics[1],
      engagementRate: r.metrics[2],
      bounceRate: r.metrics[3],
      startedApplying: startedBy.get(r.dimensions[0]) ?? 0,
    })),
  };
}

export type ByGroup = Map<string, { visitors: number; startedApplying: number; applied: number }>;

/** Per channel or campaign: visitors, people who started applying, and GA's count of sent applications. */
export async function byGroup(p: TwoPeriods, dimension: "sessionDefaultChannelGroup" | "sessionCampaignName"): Promise<Ga<ByGroup>> {
  const r = await runReport({
    dateRanges: [{ startDate: p.current.startDate, endDate: p.current.endDate }],
    dimensions: [dimension, "eventName"],
    metrics: ["totalUsers"],
    dimensionFilter: {
      filter: { fieldName: "eventName", inListFilter: { values: ["page_view", "signup_started", "signup_completed"] } },
    },
    limit: 500,
  });
  if (!r.ok) return r;
  const out: ByGroup = new Map();
  for (const row of r.rows) {
    const [group, event] = row.dimensions;
    const entry = out.get(group) ?? { visitors: 0, startedApplying: 0, applied: 0 };
    if (event === "page_view") entry.visitors += row.metrics[0];
    if (event === "signup_started") entry.startedApplying += row.metrics[0];
    if (event === "signup_completed") entry.applied += row.metrics[0];
    out.set(group, entry);
  }
  return { ok: true, value: out };
}

/** The devices and countries seen, for the Website page's filters. */
export async function filterChoices(p: TwoPeriods): Promise<{ devices: string[]; countries: string[] }> {
  const range = [{ startDate: p.current.startDate, endDate: p.current.endDate }];
  const [d, c] = await Promise.all([
    runReport({ dateRanges: range, dimensions: ["deviceCategory"], metrics: ["totalUsers"], limit: 10 }),
    runReport({
      dateRanges: range,
      dimensions: ["country"],
      metrics: ["totalUsers"],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 30,
    }),
  ]);
  return {
    devices: d.ok ? d.rows.map((r) => r.dimensions[0]).filter(Boolean) : [],
    countries: c.ok ? c.rows.map((r) => r.dimensions[0]).filter((x) => x && x !== "(not set)") : [],
  };
}

/** A GA filter for the Website page's device and country choices, or undefined. */
export function websiteFilter(device: string, country: string): unknown {
  const parts = [
    device ? { filter: { fieldName: "deviceCategory", stringFilter: { value: device } } } : null,
    country ? { filter: { fieldName: "country", stringFilter: { value: country } } } : null,
  ].filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : { andGroup: { expressions: parts } };
}
