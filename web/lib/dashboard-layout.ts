import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading and writing which dashboard cards a person keeps.
 *
 * The layout is an ordered list of widget ids and nothing else — see the comment
 * on `dashboard_layouts` for why it is not a saved-query table. Two rules make
 * the stored list safe to evolve against:
 *
 * - **An id the running code does not know is dropped.** Retiring a widget must
 *   not blank the dashboard of everyone who had it saved.
 * - **No row means the default**, so "reset" is a delete and the default lives in
 *   one place (the registry) rather than being copied into every row.
 */

/** No row for this user: they have never customised, so show the default. */
export const NO_SAVED_LAYOUT = null;

export async function fetchLayout(
  supabase: SupabaseClient
): Promise<string[] | typeof NO_SAVED_LAYOUT> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NO_SAVED_LAYOUT;

  const { data, error } = await supabase
    .from("dashboard_layouts")
    .select("widget_ids")
    .eq("user_id", userId)
    .maybeSingle();

  // A refused read must not masquerade as "never customised" — that would show
  // the default layout and then quietly overwrite the real one on the next save.
  if (error) throw new Error(error.message);
  if (!data) return NO_SAVED_LAYOUT;
  return (data as { widget_ids: string[] }).widget_ids;
}

export async function saveLayout(
  supabase: SupabaseClient,
  orgId: string,
  widgetIds: string[]
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You are not signed in.");

  // Upsert, because there may or may not already be a row and the caller should
  // not have to know which. `select` afterwards for the reason every write in
  // this codebase does: PostgREST answers a write that matched nothing with
  // success, and a silently refused save would look exactly like a saved one.
  const { data, error } = await supabase
    .from("dashboard_layouts")
    .upsert(
      {
        user_id: userId,
        org_id: orgId,
        widget_ids: widgetIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("user_id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("The layout was not saved.");
}

/** Resetting is deleting: no row means the registry's default. */
export async function resetLayout(supabase: SupabaseClient): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You are not signed in.");

  const { error } = await supabase
    .from("dashboard_layouts")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * The saved list narrowed to widgets that still exist, in the saved order.
 *
 * Duplicates are dropped too: the same card twice is never what was meant, and
 * React would warn about the repeated key.
 */
export function reconcileLayout(
  saved: string[] | typeof NO_SAVED_LAYOUT,
  known: string[],
  fallback: string[]
): string[] {
  if (saved === NO_SAVED_LAYOUT) return fallback;
  const seen = new Set<string>();
  const kept = saved.filter((id) => {
    if (!known.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // An empty dashboard is a legitimate choice — somebody who removed everything
  // meant it, and the Customise panel is still there to add cards back. Only a
  // layout whose every id has been retired falls back to the default.
  return saved.length > 0 && kept.length === 0 ? fallback : kept;
}
