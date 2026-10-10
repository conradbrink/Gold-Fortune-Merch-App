import "server-only";
import { platformAdminClient } from "@/lib/platform";
import { parseHealth, type Health } from "@/lib/control-dashboard";

/**
 * The dashboard's own reads (the rest come from lib/activation-data.ts and
 * lib/acquisition-data.ts). Only called by pages that have already checked
 * is_platform_admin().
 */

/** Tickd's machinery: scheduled jobs, email and the website count (platform_system_health()). */
export async function loadHealth(): Promise<{ ok: true; value: Health } | { ok: false; message: string }> {
  const { data, error } = await platformAdminClient().rpc("platform_system_health");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, message: "System checks need a database update that hasn't been applied yet." };
    }
    return { ok: false, message: `System checks couldn't be read: ${error.message}` };
  }
  return { ok: true, value: parseHealth(data) };
}

/** The module catalogue and which companies have each switched on. */
export async function loadModuleUse(): Promise<{
  modules: { code: string; name: string; is_built: boolean }[];
  enabled: { org_id: string; module_code: string }[];
}> {
  const admin = platformAdminClient();
  const [{ data: modules, error: moduleError }, { data: enabled, error: enabledError }] = await Promise.all([
    admin.from("modules").select("code, name, is_built").order("sort_order"),
    admin.from("company_modules").select("org_id, module_code").eq("enabled", true).range(0, 9999),
  ]);
  if (moduleError) throw moduleError;
  if (enabledError) throw enabledError;
  return { modules: modules ?? [], enabled: enabled ?? [] };
}
