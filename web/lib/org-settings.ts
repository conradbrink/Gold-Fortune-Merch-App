import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisitFrequency } from "@/lib/schedule";

/**
 * Per-organisation planning capacity.
 *
 * These were constants (`FULL_DAY_STORES = 6`, `AVG_VISIT_MINUTES = 49`).
 * Hard-coding them makes the app fit exactly one customer: a rep covering
 * kiosks makes far more calls in a day than one covering hypermarkets, and an
 * estate that works Saturdays has a different week entirely.
 *
 * `AVG_VISIT_MINUTES` is deliberately *not* replaced by a setting. It was
 * measured from seeded demo visits that no longer exist, so any figure shown
 * today would be invented. Once real visits accumulate it can be derived from
 * `avg(duration_seconds)`; until then the UI talks about stores per day, which
 * is a number the manager actually chose.
 */

export type OrgSettings = {
  storesPerDay: number;
  /** ISO weekdays the team works: 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  defaultVisitFrequency: VisitFrequency;
};

/**
 * Used before the fetch resolves and if the row cannot be read.
 *
 * Matches the column defaults in `20260728170616_add_org_capacity_settings`.
 * Keeping the two in step matters: a mismatch would show one capacity while
 * the database plans against another.
 */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  storesPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  defaultVisitFrequency: "monthly",
};

/**
 * The company's own name, for the chrome that displays it.
 *
 * Null when it has not loaded or is not set, and callers are expected to render
 * nothing rather than a placeholder: the sidebar carried the literal string
 * "Gold Fortune Inc." for months, which is a different company's name the moment
 * this is deployed for anyone else, and was never what Settings → Company said.
 *
 * `name` and not `legal_name` — the settings screen treats the first as what the
 * business is called and the second as what it is registered as.
 */
export async function fetchOrgName(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("name")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { name: string | null }).name?.trim() || null;
}

/** RLS scopes `organizations` to the caller's own org, so no filter is needed. */
export async function fetchOrgSettings(
  supabase: SupabaseClient
): Promise<OrgSettings> {
  const { data, error } = await supabase
    .from("organizations")
    .select("stores_per_day, working_days, default_visit_frequency")
    .limit(1)
    .maybeSingle();

  if (error || !data) return DEFAULT_ORG_SETTINGS;

  const row = data as {
    stores_per_day: number | null;
    working_days: number[] | null;
    default_visit_frequency: string | null;
  };

  return {
    storesPerDay: row.stores_per_day ?? DEFAULT_ORG_SETTINGS.storesPerDay,
    // An empty array would mean nothing can ever be scheduled; the check
    // constraint forbids it, but falling back is cheaper than trusting it.
    workingDays:
      row.working_days && row.working_days.length > 0
        ? [...row.working_days].sort((a, b) => a - b)
        : DEFAULT_ORG_SETTINGS.workingDays,
    defaultVisitFrequency:
      (row.default_visit_frequency as VisitFrequency | null) ??
      DEFAULT_ORG_SETTINGS.defaultVisitFrequency,
  };
}

export async function updateOrgSettings(
  supabase: SupabaseClient,
  orgId: string,
  settings: OrgSettings
): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({
      stores_per_day: settings.storesPerDay,
      working_days: settings.workingDays,
      default_visit_frequency: settings.defaultVisitFrequency,
    })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
}

/**
 * Visits one store generates per four-week cycle.
 *
 * The cycle is four weeks because that is the longest frequency offered; every
 * capacity figure in the app is expressed against it so the three frequencies
 * are directly comparable.
 */
export function visitsPerCycle(frequency: VisitFrequency): number {
  switch (frequency) {
    case "weekly":
      return 4;
    case "biweekly":
      return 2;
    case "monthly":
      return 1;
  }
}

export type Capacity = {
  /** Visit-slots the team can deliver in one four-week cycle. */
  total: number;
  /** Visit-slots the current plan consumes. */
  planned: number;
  /** planned / total, as a percentage. Can exceed 100. */
  loadPct: number;
  perRepPerCycle: number;
};

export function computeCapacity(
  settings: OrgSettings,
  repCount: number,
  plannedVisits: number
): Capacity {
  const perRepPerCycle =
    settings.workingDays.length * settings.storesPerDay * 4;
  const total = perRepPerCycle * repCount;
  return {
    total,
    planned: plannedVisits,
    loadPct: total === 0 ? 0 : Math.round((plannedVisits / total) * 100),
    perRepPerCycle,
  };
}
