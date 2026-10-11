import "server-only";
import { closedCompanies, platformAdminClient } from "@/lib/platform";
import { fromRow, type CompanyActivation } from "@/lib/activation";

/**
 * Onboarding milestones for every company (or the ones asked for), in one call
 * (platform_company_activation(), service role only). Only called by pages
 * that have already checked is_platform_admin(). Until the function's
 * migration is applied the call fails with PGRST202, and the pages say so
 * instead of failing. "Every company" means every open one: a closed company
 * is left out. Asked for by id (the Acquisition funnel, which is history),
 * it is kept.
 */
export async function loadActivation(
  orgIds?: string[]
): Promise<{ ok: true; companies: CompanyActivation[] } | { ok: false; message: string }> {
  // Only the companies asked about (the Acquisition funnel's few), else all.
  const [{ data, error }, closed] = await Promise.all([
    platformAdminClient().rpc("platform_company_activation", orgIds ? { p_org_ids: orgIds } : {}),
    orgIds ? Promise.resolve(new Map<string, string>()) : closedCompanies(),
  ]);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, message: "The onboarding numbers need a database update that hasn't been applied yet." };
    }
    throw error;
  }
  return { ok: true, companies: (data ?? []).filter((r) => !closed.has(r.org_id)).map(fromRow) };
}
