import { addDays } from "@/lib/visit-plan";

/**
 * What "Add to schedule" may save, read from the request as if typed by hand:
 * the plan comes back from the browser, so nothing in it is trusted.
 *
 * Days that have started (today or earlier, company time) are dropped and
 * counted: the schedule never re-plans a day that has begun, and a draft
 * saved a day late keeps the days still ahead.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** At most a month of days, and a full day for anybody. */
export const MAX_PLAN_DAYS = 31;
export const MAX_SITES_A_DAY = 50;
/** How far ahead a saved day may be. */
export const MAX_DAYS_AHEAD = 100;

export type PlanSave = { staffId: string; days: { date: string; siteIds: string[] }[]; pastDays: number };

export function readPlanSave(body: unknown, today: string): { ok: true; save: PlanSave } | { ok: false; error: string } {
  const unreadable = { ok: false as const, error: "That plan could not be read." };
  const b = body as { staffId?: unknown; days?: unknown } | null;
  const staffId = typeof b?.staffId === "string" && UUID.test(b.staffId) ? b.staffId : null;
  const rawDays = Array.isArray(b?.days) ? b.days : null;
  if (!staffId || !rawDays || rawDays.length === 0 || rawDays.length > MAX_PLAN_DAYS) return unreadable;

  const latest = addDays(today, MAX_DAYS_AHEAD);
  const days: PlanSave["days"] = [];
  let pastDays = 0;
  for (const d of rawDays as { date?: unknown; siteIds?: unknown }[]) {
    const date = typeof d?.date === "string" && DAY.test(d.date) ? d.date : null;
    const siteIds = Array.isArray(d?.siteIds) ? d.siteIds : null;
    if (!date || !siteIds || siteIds.length === 0 || siteIds.length > MAX_SITES_A_DAY || date > latest) {
      return unreadable;
    }
    if (!siteIds.every((id): id is string => typeof id === "string" && UUID.test(id))) return unreadable;
    if (date <= today) {
      pastDays++;
      continue;
    }
    days.push({ date, siteIds: [...new Set(siteIds)] });
  }
  if (days.length === 0) return { ok: false, error: "Every day in this plan has passed. Ask for a new draft." };
  return { ok: true, save: { staffId, days, pastDays } };
}
