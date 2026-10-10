/**
 * The Control Centre's home: "how is Tickd doing?" in one screen (owner's
 * spec sections 4, 5, 48 and 49). Pure, so the tests reach every rule; the
 * reads are in lib/control-dashboard-data.ts. (lib/dashboard.ts is the
 * customer app's dashboard, a different thing.)
 */

import type { CompanyActivation } from "@/lib/activation";
import type { Period } from "@/lib/acquisition";

const DAY = 24 * 60 * 60 * 1000;

/** Active: something was done in Tickd (a workday or a job) in the last 14 days. */
export const ACTIVE_DAYS = 14;

export function isActive(c: CompanyActivation, now: Date): boolean {
  return c.lastActivityAt !== null && now.getTime() - Date.parse(c.lastActivityAt) <= ACTIVE_DAYS * DAY;
}

export function inFreePeriod(c: CompanyActivation, now: Date): boolean {
  return c.trialEndsAt !== null && Date.parse(c.trialEndsAt) > now.getTime();
}

export function madeIn(c: CompanyActivation, p: Period): boolean {
  const t = Date.parse(c.createdAt);
  return t >= Date.parse(p.from) && t < Date.parse(p.to);
}

/** New companies per month for the last 12 months (South African months), oldest first. */
export function newPerMonth(companies: CompanyActivation[], now: Date): { month: string; label: string; count: number }[] {
  const sast = (ms: number) => new Date(ms + 2 * 60 * 60 * 1000);
  const here = sast(now.getTime());
  const months: { month: string; label: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(here.getUTCFullYear(), here.getUTCMonth() - i, 1));
    months.push({
      month: d.toISOString().slice(0, 7),
      label: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
      count: 0,
    });
  }
  const index = new Map(months.map((m, i) => [m.month, i]));
  for (const c of companies) {
    const i = index.get(sast(Date.parse(c.createdAt)).toISOString().slice(0, 7));
    if (i !== undefined) months[i].count += 1;
  }
  return months;
}

export type ModuleUse = { code: string; name: string; companies: number; share: number };

/** How many companies have each built module switched on, most used first. */
export function moduleAdoption(
  modules: { code: string; name: string; is_built: boolean }[],
  enabled: { org_id: string; module_code: string }[],
  companyCount: number
): ModuleUse[] {
  const per = new Map<string, Set<string>>();
  for (const e of enabled) {
    const set = per.get(e.module_code) ?? new Set<string>();
    set.add(e.org_id);
    per.set(e.module_code, set);
  }
  return modules
    .filter((m) => m.is_built)
    .map((m) => {
      const n = per.get(m.code)?.size ?? 0;
      return { code: m.code, name: m.name, companies: n, share: companyCount > 0 ? n / companyCount : 0 };
    })
    .sort((a, b) => b.companies - a.companies || a.name.localeCompare(b.name));
}

export type Health = {
  jobs: { name: string; active: boolean; lastRun: string | null; lastStatus: string | null; failed24h: number; lastError: string | null }[];
  emailsFailed24h: number;
  emailsWaiting: number;
  webEvents24h: number;
  webLastEvent: string | null;
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** platform_system_health()'s JSON, read defensively. */
export function parseHealth(json: unknown): Health {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const jobs = Array.isArray(o.jobs) ? (o.jobs as Record<string, unknown>[]) : [];
  return {
    jobs: jobs.map((j) => ({
      name: String(j.name ?? ""),
      active: j.active === true,
      lastRun: str(j.last_run),
      lastStatus: str(j.last_status),
      failed24h: num(j.failed_24h),
      lastError: str(j.last_error),
    })),
    emailsFailed24h: num(o.emails_failed_24h),
    emailsWaiting: num(o.emails_waiting),
    webEvents24h: num(o.web_events_24h),
    webLastEvent: str(o.web_last_event),
  };
}

/** What's wrong with Tickd's machinery right now, in plain words; empty when all is well. */
export function healthProblems(h: Health): string[] {
  const out: string[] = [];
  for (const j of h.jobs) {
    if (!j.active) continue;
    if (j.failed24h > 0) {
      out.push(`The scheduled job "${j.name}" failed ${j.failed24h === 1 ? "once" : `${j.failed24h} times`} in the last 24 hours.`);
    } else if (j.lastStatus === "failed") {
      out.push(`The scheduled job "${j.name}" failed the last time it ran.`);
    }
  }
  if (h.emailsFailed24h > 0) {
    out.push(`${h.emailsFailed24h} ${h.emailsFailed24h === 1 ? "email" : "emails"} couldn't be sent in the last 24 hours.`);
  }
  if (h.emailsWaiting > 0) {
    out.push(`${h.emailsWaiting} ${h.emailsWaiting === 1 ? "email has" : "emails have"} been waiting to go out for over 30 minutes.`);
  }
  return out;
}
