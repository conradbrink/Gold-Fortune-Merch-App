import "server-only";
import { checkAttribution } from "@/lib/founding";
import { platformAdminClient } from "@/lib/platform";
import { runReport, type GaResult } from "@/lib/ga4";
import { loadActivation } from "@/lib/activation-data";
import { isActivated } from "@/lib/activation";
import { byNameAndPeriod, parseOwnStats, type ApplicationRow, type CompanyFacts, type OwnStats, type Period } from "@/lib/acquisition";

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

export async function loadFirstParty(
  p: TwoPeriods,
  /** Every company's activation, when the caller has already started reading it (the dashboard). */
  activationRead?: ReturnType<typeof loadActivation>
): Promise<FirstParty> {
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
    const [{ data: orgs, error: orgError }, { data: accounts, error: accountError }, activation] = await Promise.all([
      admin.from("organizations").select("id, name").in("id", orgIds),
      admin.from("company_account").select("org_id, trial_ends_at").in("org_id", orgIds),
      activationRead ?? loadActivation(orgIds),
    ]);
    if (orgError) throw orgError;
    if (accountError) throw accountError;
    const free = new Set((accounts ?? []).filter((a) => a.trial_ends_at !== null).map((a) => a.org_id));
    const activated = activation.ok ? new Set(activation.companies.filter(isActivated).map((c) => c.orgId)) : null;
    for (const o of orgs ?? []) {
      companies.set(o.id, { id: o.id, name: o.name, freePeriod: free.has(o.id), activated: activated ? activated.has(o.id) : null });
    }
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

/** Every date of a period, oldest first, as YYYY-MM-DD. */
export function everyDay(period: Period): string[] {
  const out: string[] = [];
  for (let t = Date.parse(period.startDate + "T00:00:00Z"); t <= Date.parse(period.endDate + "T00:00:00Z"); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
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

// ------------------------------------------------------------ Tickd's own count

/**
 * The website's numbers from Tickd's own count (web_events, through
 * platform_web_stats()): instant, for any period. Until its migration is
 * applied the call fails (PGRST202), and the pages say so instead of failing.
 */
export async function ownStats(
  period: Period,
  filter: { device?: string; country?: string } = {}
): Promise<{ ok: true; value: OwnStats } | { ok: false; message: string }> {
  const { data, error } = await platformAdminClient().rpc("platform_web_stats", {
    p_from: period.from,
    p_to: period.to,
    p_tz: "Africa/Johannesburg",
    ...(filter.device ? { p_device: filter.device } : {}),
    ...(filter.country ? { p_country: filter.country } : {}),
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, message: "Tickd's own count of the website needs a database update that hasn't been applied yet." };
    }
    throw error;
  }
  return { ok: true, value: parseOwnStats(data) };
}
