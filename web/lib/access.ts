import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";

/**
 * Reading and changing who may do what.
 *
 * Nothing here writes `profile_permissions` directly, and it could not: the
 * table has no write policy and the privilege is revoked. Every change goes
 * through `set_job_role` or `set_profile_permission`, which check the caller,
 * refuse to remove the last administrator, refuse to grant `admin` at all, and
 * write the audit trail. That is deliberate — a permission table a client can
 * INSERT into is not a permission system.
 */

export type AppPermission = Tables<"app_permissions">;
export type JobRole = Tables<"job_roles">;

export type OrgUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  job_role_id: string | null;
  permissions: string[];
};

export type AccessDirectory = {
  permissions: AppPermission[];
  jobRoles: JobRole[];
  users: OrgUser[];
};

export async function fetchAccessDirectory(
  supabase: SupabaseClient
): Promise<AccessDirectory> {
  const [perms, roles, profiles, grants] = await Promise.all([
    supabase.from("app_permissions").select("*").order("sort_order"),
    supabase
      .from("job_roles")
      .select("*")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active, job_role_id")
      .order("full_name"),
    supabase.from("profile_permissions").select("profile_id, permission_code"),
  ]);

  const failed = [perms, roles, profiles, grants].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const byProfile = new Map<string, string[]>();
  for (const g of (grants.data ?? []) as {
    profile_id: string;
    permission_code: string;
  }[]) {
    const list = byProfile.get(g.profile_id) ?? [];
    list.push(g.permission_code);
    byProfile.set(g.profile_id, list);
  }

  return {
    permissions: (perms.data ?? []) as AppPermission[],
    jobRoles: (roles.data ?? []) as JobRole[],
    users: ((profiles.data ?? []) as Omit<OrgUser, "permissions">[]).map((p) => ({
      ...p,
      permissions: (byProfile.get(p.id) ?? []).sort(),
    })),
  };
}

/**
 * Put somebody on a job role.
 *
 * Replaces their grants with the template's rather than merging — a template is
 * what this person's access should now be, and merging would leave whatever was
 * ticked before hiding under a role name that says otherwise.
 */
export async function applyJobRole(
  supabase: SupabaseClient,
  profileId: string,
  jobRoleId: string
): Promise<void> {
  const { error } = await supabase.rpc("set_job_role", {
    p_profile: profileId,
    p_job_role: jobRoleId,
  });
  if (error) throw new Error(error.message);
}

export async function setPermission(
  supabase: SupabaseClient,
  profileId: string,
  code: string,
  granted: boolean
): Promise<void> {
  const { error } = await supabase.rpc("set_profile_permission", {
    p_profile: profileId,
    p_code: code,
    p_granted: granted,
  });
  if (error) throw new Error(error.message);
}

/**
 * Create a login on a job role.
 *
 * Goes through `/api/reps/invite` because creating an auth user needs the
 * service-role key, which must never reach a browser bundle. The route resolves
 * the job role's `base_role` itself rather than trusting a role from the body,
 * and the database trigger copies the template's permissions onto the new
 * profile.
 */
export async function createUser(input: {
  email: string;
  fullName: string;
  password: string;
  jobRoleId: string;
}): Promise<void> {
  const res = await fetch("/api/reps/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      full_name: input.fullName,
      password: input.password,
      job_role_id: input.jobRoleId,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `The account was not created (${res.status}).`;
    throw new Error(message);
  }
}

/** Permissions grouped by the area they light up, for the tick-box grid. */
export function groupByArea(
  permissions: AppPermission[]
): { area: string; permissions: AppPermission[] }[] {
  const out: { area: string; permissions: AppPermission[] }[] = [];
  for (const p of permissions) {
    const existing = out.find((g) => g.area === p.area);
    if (existing) existing.permissions.push(p);
    else out.push({ area: p.area, permissions: [p] });
  }
  return out;
}
