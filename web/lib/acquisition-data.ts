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

  const [applications, previousApplications, newNow, newBefore, freeNow, freeBefore] = await Promise.all([
    applicationsIn(p.current),
    count(admin.from("founding_applications").select("id", head).gte("created_at", p.previous.from).lt("created_at", p.previous.to)),
    count(admin.from("organizations").select("id", head).gte("created_at", p.current.from).lt("created_at", p.current.to)),
    count(admin.from("organizations").select("id", head).gte("created_at", p.previous.from).lt("created_at", p.previous.to)),
    freePeriodsStartedIn(p.current),
    freePeriodsStartedIn(p.previous),
  ]);

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

const PAGE = 1000;

/**
 * The period's applications, every one: read in pages, so the funnel never
 * stops silently at PostgREST's row limit. Until the company-link migration is
 * applied the column is missing (PostgREST 42703 / PGRST204); then they are
 * read without it, as not linked, rather than taking the pages down.
 */
async function applicationsIn(period: Period): Promise<ApplicationRow[]> {
  const admin = platformAdminClient();
  const read = async (columns: string) => {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("founding_applications")
        .select(columns)
        .gte("created_at", period.from)
        .lt("created_at", period.to)
        .order("created_at")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return { rows, error };
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if ((data ?? []).length < PAGE) return { rows, error: null };
    }
  };
  let result = await read("id, created_at, attribution, organization_id");
  if (result.error && ["42703", "PGRST204"].includes((result.error as { code?: string }).code ?? "")) {
    result = await read("id, created_at, attribution");
  }
  if (result.error) throw result.error;
  return result.rows.map((a) => ({
    id: String(a.id),
    created_at: String(a.created_at),
    attribution: checkAttribution(a.attribution),
    organization_id: typeof a.organization_id === "string" ? a.organization_id : null,
  }));
}

/**
 * Companies whose free period began in the period. It begins either when a
 * sign-up's company is made with a trial (its company_account row is created
 * with trial_ends_at), or when the operator first gives one ("trial.extend"
 * with no previous end, platform_audit_log). Each company counts once.
 */
async function freePeriodsStartedIn(period: Period): Promise<number> {
  const admin = platformAdminClient();
  const [{ data: accounts, error: accountError }, { data: audits, error: auditError }] = await Promise.all([
    admin
      .from("company_account")
      .select("org_id")
      .not("trial_ends_at", "is", null)
      .gte("created_at", period.from)
      .lt("created_at", period.to)
      .range(0, 9999),
    admin
      .from("platform_audit_log")
      .select("target_org_id")
      .eq("action", "trial.extend")
      .is("detail->>from", null)
      .gte("created_at", period.from)
      .lt("created_at", period.to)
      .range(0, 9999),
  ]);
  if (accountError) throw accountError;
  if (auditError) throw auditError;
  const ids = new Set<string>();
  for (const a of accounts ?? []) ids.add(a.org_id);
  for (const a of audits ?? []) if (a.target_org_id) ids.add(a.target_org_id);
  return ids.size;
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
  // GA has no row for a day nobody came, so every day of the period is laid
  // out and the missing ones are 0: the chart is spaced by day, not by row.
  const seen = new Map(r.rows.map((row) => [row.dimensions[0], row.metrics[0]]));
  return { ok: true, value: everyDay(p.current).map((date) => ({ date, visitors: seen.get(date.replaceAll("-", "")) ?? 0 })) };
}

/** Every date of a period, oldest first, as YYYY-MM-DD. */
export function everyDay(period: Period): string[] {
  const out: string[] = [];
  for (let t = Date.parse(period.startDate + "T00:00:00Z"); t <= Date.parse(period.endDate + "T00:00:00Z"); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
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
