import type { SupabaseClient } from "@supabase/supabase-js";
import type { HrNotification } from "@/lib/hr/types";

/**
 * In-app notices.
 *
 * There was no notification system to reuse — checked before building one:
 * nothing in the schema stored a notice, the web app had no bell, and the only
 * `notification` in the Flutter app is the Android foreground-service notice
 * that keeps location tracking alive. So this is deliberately the smallest
 * thing that works: a row per recipient, written by database triggers, read by
 * the person it names.
 *
 * Nothing here can create one. `hr_notifications` has no INSERT policy and
 * `insert` is revoked from `authenticated`; rows appear only through
 * security-definer helpers called from triggers. That is what stops a user
 * telling their manager that their own leave was approved.
 */

export async function fetchNotifications(
  supabase: SupabaseClient,
  limit = 30
): Promise<HrNotification[]> {
  const { data, error } = await supabase
    .from("hr_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as HrNotification[];
}

export async function unreadCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("hr_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Mark one read. The database trigger refuses any other edit to the row, so
 * this is the only update the table accepts.
 */
export async function markRead(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("hr_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

export async function markAllRead(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from("hr_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/** "2 minutes ago", "yesterday", "14 Aug". */
export function relativeTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
