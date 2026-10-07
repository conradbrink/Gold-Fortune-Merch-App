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

function adminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function listCompanies(): Promise<PlatformCompany[]> {
  const admin = adminClient();

  const [{ data: orgs, error: orgError }, { data: people, error: peopleError }] =
    await Promise.all([
      admin
        .from("organizations")
        .select("id, name, industry, timezone, created_at")
        .order("created_at"),
      admin.from("profiles").select("org_id, is_active"),
    ]);
  if (orgError) throw orgError;
  if (peopleError) throw peopleError;

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
    const mine = (people ?? []).filter((p) => p.org_id === org.id);
    return {
      id: org.id,
      name: org.name,
      industry: org.industry,
      timezone: org.timezone,
      createdAt: org.created_at,
      activeUsers: mine.filter((p) => p.is_active).length,
      inactiveUsers: mine.filter((p) => !p.is_active).length,
      lastWorkdayAt: last[i],
    };
  });
}
