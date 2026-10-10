/**
 * The Control Centre's Product page (owner's spec section 27): for each built
 * module, how many companies have it switched on, how many actually used it
 * in the period, what share of active companies that is, and the trend
 * against the period before. "Used" is one plain signal per module, counted
 * by platform_module_usage(); USED_WHEN says what it is, in words.
 * Pure, so the tests reach every rule.
 */

export const USED_WHEN: Record<string, string> = {
  core: "a job is checked into",
  recurring_jobs: "jobs are planned",
  checklists_forms: "a form is submitted",
  reports: "a job report is made",
  owner_notifications: "an alert is raised",
  distribution: "an order is placed",
  warehouse: "stock moves",
  hr: "leave, a review or a document is added",
  vehicle_logbook: "a vehicle day is recorded",
  invoicing: "a quote or invoice is made",
};

export type UsageRow = { module_code: string; org_id: string; n: number };

export type ModuleRow = {
  code: string;
  name: string;
  usedWhen: string | null;
  switchedOn: number;
  usedBy: number;
  usedByBefore: number;
  /** Times used in the period, across companies. */
  uses: number;
  /** Share of active companies that used it; null when there are none. */
  ofActive: number | null;
  /** Companies with it on that didn't use it in the period. */
  idle: number;
};

export function moduleRows(input: {
  modules: { code: string; name: string; is_built: boolean }[];
  enabled: { org_id: string; module_code: string }[];
  now: UsageRow[];
  before: UsageRow[];
  activeOrgs: Set<string>;
}): ModuleRow[] {
  const on = new Map<string, Set<string>>();
  for (const e of input.enabled) on.set(e.module_code, (on.get(e.module_code) ?? new Set()).add(e.org_id));
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
      const switched = on.get(m.code) ?? new Set<string>();
      const activeUsers = [...used.keys()].filter((o) => input.activeOrgs.has(o)).length;
      return {
        code: m.code,
        name: m.name,
        usedWhen: USED_WHEN[m.code] ?? null,
        switchedOn: switched.size,
        usedBy: used.size,
        usedByBefore: beforeBy.get(m.code)?.size ?? 0,
        uses: [...used.values()].reduce((a, b) => a + b, 0),
        ofActive: input.activeOrgs.size > 0 ? activeUsers / input.activeOrgs.size : null,
        idle: [...switched].filter((o) => !used.has(o)).length,
      };
    })
    .sort((a, b) => b.usedBy - a.usedBy || b.uses - a.uses || a.name.localeCompare(b.name));
}

/** The companies behind one module's numbers: each with it on or using it, and how much. */
export function moduleCompanies(
  code: string,
  enabled: { org_id: string; module_code: string }[],
  now: UsageRow[],
  names: Map<string, string>
): { orgId: string; name: string; switchedOn: boolean; uses: number }[] {
  const on = new Set(enabled.filter((e) => e.module_code === code).map((e) => e.org_id));
  const uses = new Map<string, number>();
  for (const r of now) if (r.module_code === code) uses.set(r.org_id, (uses.get(r.org_id) ?? 0) + Number(r.n));
  const orgs = new Set([...on, ...uses.keys()]);
  return [...orgs]
    .map((orgId) => ({ orgId, name: names.get(orgId) ?? orgId, switchedOn: on.has(orgId), uses: uses.get(orgId) ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}
