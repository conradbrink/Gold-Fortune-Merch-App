import "server-only";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The platform operator's view: every company on the service.
 *
 * Server-only. It reads across companies, which no signed-in user's session
 * can do — RLS scopes every table to the caller's own organisation, and that
 * is the point — so it uses the service role. The caller must already have
 * been checked with `is_platform_admin()` (see `app/platform/page.tsx`);
 * nothing in this file checks again, which is why it is not imported by any
 * client component and has no route handler of its own.
 */

export type PlatformCompany = {
  id: string;
  name: string;
  industry: string | null;
  timezone: string;
  createdAt: string;
  activeUsers: number;
  inactiveUsers: number;
  lastWorkdayAt: string | null;
};

/** The service-role client. Server-only; see the header. */
export function platformAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function listCompanies(): Promise<PlatformCompany[]> {
  const admin = platformAdminClient();

  const { data: orgs, error: orgError } = await admin
    .from("organizations")
    .select("id, name, industry, timezone, created_at")
    .order("created_at");
  if (orgError) throw orgError;

  // Counted in the database, one pair of `head` queries per company: a plain
  // select of every profile would be cut off silently at PostgREST's row
  // limit once the platform passes it, and ship every row to count it.
  const counts = await Promise.all(
    (orgs ?? []).map(async (org) => {
      const [active, inactive] = await Promise.all([
        admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("org_id", org.id)
          .eq("is_active", true),
        admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("org_id", org.id)
          .eq("is_active", false),
      ]);
      if (active.error) throw active.error;
      if (inactive.error) throw inactive.error;
      return { active: active.count ?? 0, inactive: inactive.count ?? 0 };
    })
  );

  // "Last activity" is the most recent workday start: the one event every
  // company produces whatever its industry, and one indexed row per company.
  const last = await Promise.all(
    (orgs ?? []).map(async (org) => {
      const { data, error } = await admin
        .from("workday_sessions")
        .select("started_at")
        .eq("org_id", org.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.started_at ?? null;
    })
  );

  return (orgs ?? []).map((org, i) => {
    return {
      id: org.id,
      name: org.name,
      industry: org.industry,
      timezone: org.timezone,
      createdAt: org.created_at,
      activeUsers: counts[i].active,
      inactiveUsers: counts[i].inactive,
      lastWorkdayAt: last[i],
    };
  });
}

export type PlatformModule = {
  code: string;
  name: string;
  description: string;
  planType: string;
  isBuilt: boolean;
  enabled: boolean;
  requires: string[];
};

export type PlatformCompanyDetail = {
  id: string;
  name: string;
  modules: PlatformModule[];
  recentChanges: { action: string; detail: unknown; createdAt: string }[];
};

/** One company, with every module in the catalogue and whether it has it. */
export async function getCompany(orgId: string): Promise<PlatformCompanyDetail | null> {
  const admin = platformAdminClient();
  const [org, catalogue, deps, mine, log] = await Promise.all([
    admin.from("organizations").select("id, name").eq("id", orgId).maybeSingle(),
    admin.from("modules").select("*").order("sort_order"),
    admin.from("module_dependencies").select("module_code, requires_code"),
    admin.from("company_modules").select("module_code, enabled").eq("org_id", orgId),
    admin
      .from("platform_audit_log")
      .select("action, detail, created_at")
      .eq("target_org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  for (const r of [org, catalogue, deps, mine, log]) if (r.error) throw r.error;
  if (!org.data) return null;

  const on = new Map((mine.data ?? []).map((m) => [m.module_code, m.enabled]));
  return {
    id: org.data.id,
    name: org.data.name,
    modules: (catalogue.data ?? []).map((m) => ({
      code: m.code,
      name: m.name,
      description: m.description,
      planType: m.plan_type,
      isBuilt: m.is_built,
      enabled: m.plan_type === "core" || on.get(m.code) === true,
      requires: (deps.data ?? [])
        .filter((d) => d.module_code === m.code)
        .map((d) => d.requires_code),
    })),
    recentChanges: (log.data ?? []).map((l) => ({
      action: l.action,
      detail: l.detail,
      createdAt: l.created_at,
    })),
  };
}
