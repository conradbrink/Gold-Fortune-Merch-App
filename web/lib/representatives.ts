import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";

/**
 * Representatives and store ownership.
 *
 * `store_assignments` already existed with correct RLS (managers read and write
 * org-wide, reps read their own) but had no UI at all, so nobody could say who
 * owns which store.
 */

export type RepSummary = {
  rep_id: string;
  rep_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  /** Soft delete — deactivated reps keep their visit history. */
  is_active: boolean;
  joined_at: string | null;
  assigned_stores: number;
  /** Comma-joined store names, so the list shows the patch not just a count. */
  store_names: string | null;
  last_active_at: string | null;
  visits_30d: number;
};

export type Assignment = {
  id: string;
  store_id: string;
  rep_id: string;
  is_primary: boolean;
};

export type StoreOption = {
  id: string;
  name: string;
  city: string | null;
  group_id: string | null;
  group_name: string | null;
};

export type InviteResult = { id: string; email: string; full_name: string };

/**
 * Creates a rep with a starting password via `/api/reps/invite`.
 *
 * Creating an auth user needs the service-role key, so this cannot be done from
 * the browser — the Route Handler holds the key and verifies the caller is a
 * manager before using it. The password is posted once and never stored
 * anywhere client-side.
 */
export async function createRep(
  email: string,
  fullName: string,
  password: string
): Promise<InviteResult> {
  const res = await fetch("/api/reps/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password }),
  });
  // Read as text first — an error page is HTML, and .json() on it throws a
  // parse error that hides the real status.
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Unexpected ${res.status} response from the invite endpoint.`);
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return body as InviteResult;
}

export async function fetchRepDirectory(
  supabase: SupabaseClient
): Promise<RepSummary[]> {
  const res = await callRpc(supabase, "rep_directory", {});
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as RepSummary[];
}

export async function fetchStores(
  supabase: SupabaseClient
): Promise<StoreOption[]> {
  // Single string literal — a concatenated .select() degrades to
  // GenericStringError in postgrest-js.
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, city, store_group_id, store_groups(name)")
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    city: string | null;
    store_group_id: string | null;
    store_groups: { name: string } | { name: string }[] | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    group_id: r.store_group_id,
    // postgrest returns an embedded relation as an object or array depending on
    // the inferred cardinality; normalise rather than guessing.
    group_name: Array.isArray(r.store_groups)
      ? r.store_groups[0]?.name ?? null
      : r.store_groups?.name ?? null,
  }));
}

/** Every assignment in the org — small enough to fetch whole (21 rows today). */
export async function fetchAssignments(
  supabase: SupabaseClient
): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("store_assignments")
    .select("id, store_id, rep_id, is_primary");
  if (error) throw new Error(error.message);
  return (data ?? []) as Assignment[];
}

export async function assignStore(
  supabase: SupabaseClient,
  orgId: string,
  storeId: string,
  repId: string
): Promise<void> {
  const { error } = await supabase
    .from("store_assignments")
    .insert({ org_id: orgId, store_id: storeId, rep_id: repId, is_primary: false });
  // unique(store_id, rep_id) — a double-click is a no-op, not an error worth
  // showing the user.
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function unassignStore(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<void> {
  const { error } = await supabase
    .from("store_assignments")
    .delete()
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
}

/**
 * Promotes one assignment to primary for its store.
 *
 * `store_assignments_one_primary_idx` is a partial unique index on
 * (store_id) where is_primary, so the previous holder MUST be demoted first —
 * writing the new one straight in violates the index. Demote-then-promote is
 * two statements rather than one, but the index is what guarantees a store
 * never ends up with two primaries even if this races.
 */
export async function setPrimary(
  supabase: SupabaseClient,
  storeId: string,
  assignmentId: string
): Promise<void> {
  const demote = await supabase
    .from("store_assignments")
    .update({ is_primary: false })
    .eq("store_id", storeId)
    .eq("is_primary", true);
  if (demote.error) throw new Error(demote.error.message);

  const promote = await supabase
    .from("store_assignments")
    .update({ is_primary: true })
    .eq("id", assignmentId);
  if (promote.error) throw new Error(promote.error.message);
}

export async function clearPrimary(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<void> {
  const { error } = await supabase
    .from("store_assignments")
    .update({ is_primary: false })
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
}

/** The signed-in manager's org, needed as `org_id` on inserts for RLS. */
export async function fetchOrgId(supabase: SupabaseClient): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", auth.user.id)
    .single();
  if (error) throw new Error(error.message);
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/** Edits the mutable profile fields. Email and role are deliberately not here. */
export async function updateRep(
  supabase: SupabaseClient,
  repId: string,
  patch: { full_name?: string; phone?: string | null; job_title?: string | null }
): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", repId);
  if (error) throw new Error(error.message);
}

/**
 * Soft delete. Their visits, photos and form submissions reference this profile,
 * so deleting the row would orphan history — deactivating keeps the record.
 *
 * Goes through the API rather than writing profiles directly, because two
 * things must change together: `is_active` gates RLS (no data), and banning the
 * auth user refuses the sign-in itself. Setting only the flag would leave a
 * "deactivated" rep still able to log in to an empty app.
 */
export async function setRepActive(
  repId: string,
  isActive: boolean
): Promise<void> {
  const res = await fetch(`/api/reps/${repId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Unexpected ${res.status} response from the rep endpoint.`);
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }
}

export type DeleteImpact = {
  rep_name: string | null;
  visits: number;
  submissions: number;
  photos: number;
  workdays: number;
  routes: number;
  assignments: number;
};

/** What a hard delete would destroy — shown before asking to confirm. */
export async function fetchDeleteImpact(
  supabase: SupabaseClient,
  repId: string
): Promise<DeleteImpact | null> {
  const res = await callRpc(supabase, "rep_delete_impact", { p_rep_id: repId });
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as DeleteImpact[];
  return rows[0] ?? null;
}

/**
 * Permanently deletes a rep and everything that cascades from them.
 *
 * Irreversible. `setRepActive(false)` is the right call in almost every real
 * case — this is for genuine mistakes, such as an invite to the wrong address.
 */
export async function deleteRep(repId: string): Promise<void> {
  const res = await fetch(`/api/reps/${repId}`, { method: "DELETE" });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Unexpected ${res.status} response from the delete endpoint.`);
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }
}

export function formatLastActive(iso: string | null): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
