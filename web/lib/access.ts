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
  /** Permission codes per job role, so the editor opens with them filled in. */
  jobRolePermissions: Map<string, string[]>;
};

/** How many people are on a role — the number that decides what may be deleted. */
export function peopleOnRole(directory: AccessDirectory, jobRoleId: string): number {
  return directory.users.filter((u) => u.job_role_id === jobRoleId).length;
}

export async function fetchAccessDirectory(
  supabase: SupabaseClient
): Promise<AccessDirectory> {
  const [perms, roles, profiles, grants, roleGrants] = await Promise.all([
    supabase.from("app_permissions").select("*").order("sort_order"),
    // Disabled roles are listed too. The People tab filters them out of the
    // dropdown; the Job roles tab has to show one in order to re-enable it.
    supabase.from("job_roles").select("*").order("sort_order").order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active, job_role_id")
      .order("full_name"),
    supabase.from("profile_permissions").select("profile_id, permission_code"),
    supabase.from("job_role_permissions").select("job_role_id, permission_code"),
  ]);

  const failed = [perms, roles, profiles, grants, roleGrants].find((r) => r.error);
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

  const byRole = new Map<string, string[]>();
  for (const g of (roleGrants.data ?? []) as {
    job_role_id: string;
    permission_code: string;
  }[]) {
    const list = byRole.get(g.job_role_id) ?? [];
    list.push(g.permission_code);
    byRole.set(g.job_role_id, list);
  }

  return {
    permissions: (perms.data ?? []) as AppPermission[],
    jobRoles: (roles.data ?? []) as JobRole[],
    jobRolePermissions: byRole,
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

/**
 * Create or update a job role and replace its permission set.
 *
 * ⚠️ This does **not** change the people already on the role. `profile_permissions`
 * is a copy, so an administrator's individual adjustments survive a template
 * edit — which is the model working as intended and surprising enough that the
 * screen says so. `reapplyJobRole` is the deliberate way to push it to everyone.
 */
export async function saveJobRole(
  supabase: SupabaseClient,
  input: {
    id: string | null;
    name: string;
    description: string | null;
    baseRole: string;
    active: boolean;
    permissions: string[];
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("save_job_role", {
    p_id: input.id,
    p_name: input.name,
    p_description: input.description,
    p_base_role: input.baseRole,
    p_active: input.active,
    p_permissions: input.permissions,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteJobRole(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.rpc("delete_job_role", { p_id: id });
  if (error) throw new Error(error.message);
}

/** Push the template onto everybody on it, discarding their individual edits. */
export async function reapplyJobRole(
  supabase: SupabaseClient,
  id: string
): Promise<number> {
  const { data, error } = await supabase.rpc("reapply_job_role", { p_id: id });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * What a base role means, said in terms of what somebody can actually do.
 *
 * The base role is not a permission and is not shown as one, but it decides two
 * things the tick boxes cannot: whether the Android app lets the person in, and
 * what they can read in the modules that have not been converted to permissions
 * yet. Choosing one blind would be a coin flip, so the editor says this.
 */
export const BASE_ROLE_NOTES: Record<string, string> = {
  rep: "Signs in to the Android app. In the modules not yet on permissions, sees only their own records.",
  manager:
    "No Android app. In the modules not yet on permissions — sales, stores, visits, leads, forms, files — sees everything, whatever the tick boxes below say.",
  warehouse:
    "No Android app. In the modules not yet on permissions, sees nothing. The safest base for a role built out of tick boxes.",
  hr_manager:
    "No Android app. In the modules not yet on permissions, sees nothing.",
};
