/**
 * The operator's list of people: every login on the platform, with the
 * company and role it belongs to.
 *
 * Pure, so the tests can reach it: `lib/platform.ts` reads the rows with the
 * service role and hands them here. A login is the unit, not a profile,
 * because a login with no profile is worth seeing too: a sign-up that never
 * became a company, or what a deleted company left behind.
 */

import { STAFF_LOGIN_DOMAIN } from "@/lib/phone-login";

export type ProfileRow = {
  id: string;
  org_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  job_role_id: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};

export type LoginRow = {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
  created_at: string;
};

export type PlatformUser = {
  id: string;
  name: string | null;
  jobTitle: string | null;
  /** The email they sign in with, or the phone number for a staff phone login. */
  login: string | null;
  companyId: string | null;
  companyName: string | null;
  /** The job role's name, else the base role. */
  role: string | null;
  /** Null when there is no profile, so no company to be active in. */
  isActive: boolean | null;
  lastSignInAt: string | null;
  createdAt: string;
};

/** Staff without email sign in as "<digits>@staff.tickd.co.za"; show the number instead. */
export function loginLabel(email: string | null | undefined, phone: string | null | undefined): string | null {
  if (!email) return phone ?? null;
  const suffix = "@" + STAFF_LOGIN_DOMAIN;
  if (email.toLowerCase().endsWith(suffix)) return phone ?? "+" + email.slice(0, -suffix.length);
  return email;
}

export function toPlatformUsers(
  logins: LoginRow[],
  profiles: ProfileRow[],
  companies: { id: string; name: string }[],
  jobRoles: { id: string; name: string }[]
): PlatformUser[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const roleName = new Map(jobRoles.map((r) => [r.id, r.name]));
  const loginIds = new Set(logins.map((l) => l.id));

  const users: PlatformUser[] = logins.map((login) => {
    const profile = profileById.get(login.id);
    return {
      id: login.id,
      name: profile?.full_name ?? null,
      jobTitle: profile?.job_title ?? null,
      login: loginLabel(login.email ?? profile?.email, profile?.phone),
      companyId: profile?.org_id ?? null,
      companyName: profile ? companyName.get(profile.org_id) ?? null : null,
      role: profile ? (profile.job_role_id && roleName.get(profile.job_role_id)) || profile.role : null,
      isActive: profile ? profile.is_active : null,
      lastSignInAt: login.last_sign_in_at ?? null,
      createdAt: login.created_at,
    };
  });

  // A profile always has a login (profiles.id references auth.users), but if
  // one ever did not, it is still a person on the platform.
  for (const profile of profiles) {
    if (loginIds.has(profile.id)) continue;
    users.push({
      id: profile.id,
      name: profile.full_name,
      jobTitle: profile.job_title,
      login: loginLabel(profile.email, profile.phone),
      companyId: profile.org_id,
      companyName: companyName.get(profile.org_id) ?? null,
      role: (profile.job_role_id && roleName.get(profile.job_role_id)) || profile.role,
      isActive: profile.is_active,
      lastSignInAt: null,
      createdAt: profile.created_at,
    });
  }

  // The people using Tickd first: most recent sign-in, then never signed in
  // (newest login first).
  return users.sort((a, b) => {
    if (a.lastSignInAt && b.lastSignInAt) return b.lastSignInAt.localeCompare(a.lastSignInAt);
    if (a.lastSignInAt) return -1;
    if (b.lastSignInAt) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export type UserStatus = "active" | "inactive" | "no-company";
export type UserFilter = { q?: string; company?: string; status?: UserStatus };

export function readStatus(value: string | string[] | undefined): UserStatus | undefined {
  return value === "active" || value === "inactive" || value === "no-company" ? value : undefined;
}

export function filterUsers(users: PlatformUser[], filter: UserFilter): PlatformUser[] {
  const q = filter.q?.trim().toLowerCase();
  return users.filter((u) => {
    if (filter.company && u.companyId !== filter.company) return false;
    if (filter.status === "active" && u.isActive !== true) return false;
    if (filter.status === "inactive" && u.isActive !== false) return false;
    if (filter.status === "no-company" && u.companyId !== null) return false;
    if (q) {
      const haystack = [u.name, u.login, u.companyName, u.jobTitle, u.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function summarise(users: PlatformUser[], now: Date) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    people: users.filter((u) => u.companyId !== null).length,
    active: users.filter((u) => u.isActive === true).length,
    signedInThisWeek: users.filter((u) => u.lastSignInAt !== null && u.lastSignInAt >= weekAgo).length,
    noCompany: users.filter((u) => u.companyId === null).length,
  };
}
