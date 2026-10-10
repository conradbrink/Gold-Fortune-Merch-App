/**
 * The Control Centre's Product page (owner's spec section 27): for each built
 * module, how many companies have it switched on, how many actually used it
 * in the period, what share of active companies that is, and the trend
 * against the period before. "Used" is one plain signal per module, counted
 * by platform_module_usage(); USED_WHEN says what it is, in words. A module
 * with no signal (Reports: reading isn't recorded) shows as not measured. The
 * core module is part of every company, so it is always on.
 * Pure, so the tests reach every rule.
 */

export const USED_WHEN: Record<string, string> = {
  core: "a job is checked into",
  recurring_jobs: "jobs are planned",
  checklists_forms: "a form is submitted",
  owner_notifications: "an alert is raised",
  distribution: "an order is placed",
  warehouse: "stock moves",
  hr: "leave, a review or a document is added",
  vehicle_logbook: "a vehicle day is recorded",
  invoicing: "a quote or invoice is made",
};

export type UsageRow = { module_code: string; org_id: string; n: number };

export type ModuleInfo = { code: string; name: string; is_built: boolean; plan_type?: string };

export type ModuleRow = {
  code: string;
  name: string;
  /** What counts as use; null when the module isn't measured. */
  usedWhen: string | null;
  switchedOn: number;
  usedBy: number;
  usedByBefore: number;
  /** Times used in the period, across companies. */
  uses: number;
  /** Share of active companies that used it; null when there are none. */
  ofActive: number | null;
  /** Companies with it on that didn't use it in the period; null when not measured. */
  idle: number | null;
};

/** The companies a module is on for: every company for the core module. */
export function switchedOnFor(m: ModuleInfo, enabled: { org_id: string; module_code: string }[], allOrgs: Set<string>): Set<string> {
  if (m.plan_type === "core") return new Set(allOrgs);
  return new Set(enabled.filter((e) => e.module_code === m.code).map((e) => e.org_id));
}

export function moduleRows(input: {
  modules: ModuleInfo[];
  enabled: { org_id: string; module_code: string }[];
  now: UsageRow[];
  before: UsageRow[];
  activeOrgs: Set<string>;
  allOrgs: Set<string>;
}): ModuleRow[] {
  const users = (rows: UsageRow[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const per = m.get(r.module_code) ?? new Map<string, number>();
      per.set(r.org_id, (per.get(r.org_id) ?? 0) + Number(r.n));
      m.set(r.module_code, per);
    }
    return m;
  };
  const nowBy = users(input.now);
  const beforeBy = users(input.before);
  return input.modules
    .filter((m) => m.is_built)
    .map((m) => {
      const used = nowBy.get(m.code) ?? new Map<string, number>();
      const switched = switchedOnFor(m, input.enabled, input.allOrgs);
      const activeUsers = [...used.keys()].filter((o) => input.activeOrgs.has(o)).length;
      const measured = m.code in USED_WHEN;
      return {
        code: m.code,
        name: m.name,
        usedWhen: measured ? USED_WHEN[m.code] : null,
        switchedOn: switched.size,
        usedBy: used.size,
        usedByBefore: beforeBy.get(m.code)?.size ?? 0,
        uses: [...used.values()].reduce((a, b) => a + b, 0),
        ofActive: measured && input.activeOrgs.size > 0 ? activeUsers / input.activeOrgs.size : null,
        idle: measured ? [...switched].filter((o) => !used.has(o)).length : null,
      };
    })
    .sort((a, b) => b.usedBy - a.usedBy || b.uses - a.uses || a.name.localeCompare(b.name));
}

/** The companies behind one module's numbers: each with it on or using it, and how much. */
export function moduleCompanies(
  m: ModuleInfo,
  enabled: { org_id: string; module_code: string }[],
  now: UsageRow[],
  names: Map<string, string>
): { orgId: string; name: string; switchedOn: boolean; uses: number }[] {
  const code = m.code;
  const on = switchedOnFor(m, enabled, new Set(names.keys()));
  const uses = new Map<string, number>();
  for (const r of now) if (r.module_code === code) uses.set(r.org_id, (uses.get(r.org_id) ?? 0) + Number(r.n));
  const orgs = new Set([...on, ...uses.keys()]);
  return [...orgs]
    .map((orgId) => ({ orgId, name: names.get(orgId) ?? orgId, switchedOn: on.has(orgId), uses: uses.get(orgId) ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}
