import "server-only";
import { platformAdminClient } from "@/lib/platform";
import { fromRow, type CompanyActivation } from "@/lib/activation";

/**
 * Every company's onboarding milestones, in one call
 * (platform_company_activation(), service role only). Only called by pages
 * that have already checked is_platform_admin(). Until the function's
 * migration is applied the call fails with PGRST202, and the pages say so
 * instead of failing.
 */
export async function loadActivation(): Promise<{ ok: true; companies: CompanyActivation[] } | { ok: false; message: string }> {
  const { data, error } = await platformAdminClient().rpc("platform_company_activation");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, message: "The onboarding numbers need a database update that hasn't been applied yet." };
    }
    throw error;
  }
  return { ok: true, companies: (data ?? []).map(fromRow) };
}
