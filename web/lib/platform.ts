import "server-only";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { toPlatformUsers, type LoginRow, type PlatformUser } from "@/lib/platform-users";

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
  /** The primary industry template's name; the old free-text field for a company made before templates. */
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

  const [{ data: orgs, error: orgError }, { data: templates, error: templateError }] = await Promise.all([
    admin.from("organizations").select("id, name, industry, industries, timezone, created_at").order("created_at"),
    admin.from("industry_templates").select("code, name"),
  ]);
  if (orgError) throw orgError;
  if (templateError) throw templateError;
  const templateName = new Map((templates ?? []).map((t) => [t.code, t.name]));

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
      industry: (org.industries[0] && templateName.get(org.industries[0])) ?? org.industry,
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
  /** The templates it was created from, primary first, with the version of each. */
  industries: { code: string; name: string; version: number | null }[];
  modules: PlatformModule[];
  recentChanges: { action: string; detail: unknown; createdAt: string }[];
};

/** One company, with every module in the catalogue and whether it has it. */
export async function getCompany(orgId: string): Promise<PlatformCompanyDetail | null> {
  const admin = platformAdminClient();
  const [org, catalogue, deps, mine, log, templates] = await Promise.all([
    admin.from("organizations").select("id, name, industries, template_versions").eq("id", orgId).maybeSingle(),
    admin.from("modules").select("*").order("sort_order"),
    admin.from("module_dependencies").select("module_code, requires_code"),
    admin.from("company_modules").select("module_code, enabled").eq("org_id", orgId),
    admin
      .from("platform_audit_log")
      .select("action, detail, created_at")
      .eq("target_org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("industry_templates").select("code, name"),
  ]);
  for (const r of [org, catalogue, deps, mine, log, templates]) if (r.error) throw r.error;
  if (!org.data) return null;

  const templateName = new Map((templates.data ?? []).map((t) => [t.code, t.name]));
  const versions = org.data.template_versions;
  const versionOf = (code: string): number | null => {
    if (versions === null || typeof versions !== "object" || Array.isArray(versions)) return null;
    const v = versions[code];
    return typeof v === "number" ? v : null;
  };

  const on = new Map((mine.data ?? []).map((m) => [m.module_code, m.enabled]));
  return {
    id: org.data.id,
    name: org.data.name,
    industries: org.data.industries.map((code) => ({
      code,
      name: templateName.get(code) ?? code,
      version: versionOf(code),
    })),
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

// ------------------------------------------------------------ Add company

export type IndustryTemplate = { code: string; name: string; description: string };

/** The active industry templates, in display order. */
export async function listTemplates(): Promise<IndustryTemplate[]> {
  const { data, error } = await platformAdminClient()
    .from("industry_templates")
    .select("code, name, description")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

/** `template_defaults()`: the merged proposal for the chosen industries, unparsed. */
export async function templateDefaults(codes: string[]): Promise<unknown> {
  const { data, error } = await platformAdminClient().rpc("template_defaults", { p_templates: codes });
  if (error) throw error;
  return data;
}

/** Which module needs which switched on first. */
export async function moduleDependencies(): Promise<{ module: string; requires: string }[]> {
  const { data, error } = await platformAdminClient()
    .from("module_dependencies")
    .select("module_code, requires_code");
  if (error) throw error;
  return (data ?? []).map((d) => ({ module: d.module_code, requires: d.requires_code }));
}

export type SettingDefinition = {
  key: string;
  label: string;
  description: string;
  valueType: string;
  min: number | null;
  max: number | null;
};

/** The settings catalogue, for the defaults step. */
export async function settingDefinitions(): Promise<SettingDefinition[]> {
  const { data, error } = await platformAdminClient()
    .from("setting_definitions")
    .select("key, label, description, value_type, min_value, max_value")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    valueType: d.value_type,
    min: d.min_value,
    max: d.max_value,
  }));
}

/** One of Tickd's own settings, as it stands at one company. */
export type InternalSetting = SettingDefinition & {
  /** The company's value, or null when it uses the default. */
  value: Json | null;
  defaultValue: Json;
};

/**
 * The settings Tickd keeps for itself (`setting_definitions.audience =
 * 'internal'`): GPS timing, distance thresholds, report formulas. Customers
 * never see these and the database refuses their writes; the operator
 * changes them on the company's page.
 */
export async function companyInternalSettings(orgId: string): Promise<InternalSetting[]> {
  const admin = platformAdminClient();
  const [defs, values] = await Promise.all([
    admin
      .from("setting_definitions")
      .select("key, label, description, value_type, min_value, max_value, default_value")
      .eq("audience", "internal")
      .order("sort_order"),
    admin.from("company_settings").select("key, value").eq("org_id", orgId),
  ]);
  if (defs.error) throw defs.error;
  if (values.error) throw values.error;
  const mine = new Map((values.data ?? []).map((r) => [r.key, r.value]));
  return (defs.data ?? []).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    valueType: d.value_type,
    min: d.min_value,
    max: d.max_value,
    defaultValue: d.default_value,
    value: mine.has(d.key) ? (mine.get(d.key) as Json) : null,
  }));
}

/** Every module a company can have (not `core`, which is always on). */
export async function moduleCatalogue(): Promise<{ code: string; name: string; built: boolean; planType: string }[]> {
  const { data, error } = await platformAdminClient()
    .from("modules")
    .select("code, name, is_built, plan_type")
    .neq("plan_type", "core")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((m) => ({ code: m.code, name: m.name, built: m.is_built, planType: m.plan_type }));
}

export type TermLabel = { key: string; label: string; description: string };

/** The terminology catalogue, for the words step: each term named by its neutral default. */
export async function termDefinitions(): Promise<TermLabel[]> {
  const { data, error } = await platformAdminClient()
    .from("term_definitions")
    .select("key, singular, description")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((d) => ({ key: d.key, label: d.singular, description: d.description }));
}

// ------------------------------------------------------------ Trials (Stage 5)

/** One of the service's own settings (`platform_settings`), or null when unset. */
export async function platformSetting(key: string): Promise<Json | null> {
  const { data, error } = await platformAdminClient()
    .from("platform_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

/** The trial length in days. Throws when it is not set: a trial must never start with a made-up length. */
export async function trialDays(): Promise<number> {
  const v = await platformSetting("trial_days");
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error("platform_settings.trial_days is not set.");
  return n;
}

export type SalesContact = { email: string | null; whatsapp: string | null; pricingUrl: string | null };

/** Where "Talk to us" and "View plans" point; each null when not set. */
export async function salesContact(): Promise<SalesContact> {
  const [email, whatsapp, pricingUrl] = await Promise.all([
    platformSetting("sales_email"),
    platformSetting("sales_whatsapp"),
    platformSetting("pricing_url"),
  ]);
  const text = (v: Json | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { email: text(email), whatsapp: text(whatsapp), pricingUrl: text(pricingUrl) };
}

/** A company's trial end, or null when it is not on a trial. */
export async function companyTrialEnd(orgId: string): Promise<string | null> {
  const { data, error } = await platformAdminClient()
    .from("company_account")
    .select("trial_ends_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data?.trial_ends_at ?? null;
}

/**
 * Every login on the platform, with its company and role (`/platform/users`).
 *
 * Read in pages of 1000: PostgREST and the Auth admin API both cap a single
 * read, and a list cut off at the cap would look complete.
 */
export async function listPlatformUsers(): Promise<PlatformUser[]> {
  const admin = platformAdminClient();
  const pageSize = 1000;

  async function allRows<T>(
    read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await read(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < pageSize) return rows;
    }
  }

  async function allLogins(): Promise<LoginRow[]> {
    const logins: LoginRow[] = [];
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: pageSize });
      if (error) throw error;
      logins.push(...data.users);
      if (data.users.length < pageSize) return logins;
    }
  }

  const [logins, profiles, companies, jobRoles] = await Promise.all([
    allLogins(),
    allRows((from, to) =>
      admin
        .from("profiles")
        .select("id, org_id, full_name, email, phone, job_title, job_role_id, role, is_active, created_at")
        .order("id")
        .range(from, to)
    ),
    allRows((from, to) => admin.from("organizations").select("id, name").order("id").range(from, to)),
    allRows((from, to) => admin.from("job_roles").select("id, name").order("id").range(from, to)),
  ]);

  return toPlatformUsers(logins, profiles, companies, jobRoles);
}
