import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { parseCompanyConfig, type CompanyConfig } from "@/lib/company-config";
import { companyDefaultLayout } from "@/lib/dashboard-cards";
import { toPermissionSet } from "@/lib/permissions";
import { toolsFor, type ToolSpec } from "@/lib/assistant-tools";
import type { ToolEnv } from "@/lib/assistant-data";

/**
 * Who is asking, and what they may have the assistant do, from the database
 * with their own session.
 *
 * Shared by the chat (`/api/assistant`) and the card's button
 * (`/api/assistant/act`), so the button is held to exactly the rule that
 * offered the card: the same permissions, modules and role, read again at the
 * moment it is pressed rather than remembered from when it was drafted.
 */

export type Asker = { env: ToolEnv; tools: ToolSpec[]; config: CompanyConfig };

export async function readAsker(
  supabase: SupabaseClient<Database>
): Promise<{ ok: true; asker: Asker } | { ok: false; error: string; status: number }> {
  const [
    { data: perms, error: permsError },
    { data: rawConfig, error: configError },
    { data: role, error: roleError },
  ] = await Promise.all([
    supabase.rpc("my_permissions"),
    supabase.rpc("my_company_config"),
    // The function the write policies ask (see use-is-manager.ts).
    supabase.rpc("current_role"),
  ]);
  if (permsError || configError || roleError) {
    return { ok: false, error: "Your access could not be checked. Try again shortly.", status: 503 };
  }
  const config = parseCompanyConfig(rawConfig);
  if (!config) return { ok: false, error: "Your company could not be loaded. Try again shortly.", status: 503 };

  const permissions = toPermissionSet(perms as string[] | null);
  const isManager = role === "manager";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const env: ToolEnv = {
    supabase,
    terms: config.terms,
    timeZone: config.timezone,
    today,
    orgId: config.orgId,
    permissions,
    modules: config.modules,
    isManager,
    dashboardDefault: companyDefaultLayout(config.settings.dashboard_layout),
  };
  return { ok: true, asker: { env, tools: toolsFor(permissions, config.modules, isManager), config } };
}
