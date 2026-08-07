import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";

/**
 * Leads — the sales calls reps make on shops that are not customers yet.
 *
 * One row is both the call and the card: the rep records who and why on the way
 * in and what happened on the way out, and the manager then moves it through
 * the pipeline. Reps see their own; managers see the organisation's, which is
 * the RLS policy rather than anything filtered here.
 */

export type Lead = Tables<"leads"> & {
  /** Joined for the card. Null if the profile is gone. */
  rep_name?: string | null;
};

export const STAGES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "follow_up", label: "Follow-up" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];

export async function fetchLeads(supabase: SupabaseClient): Promise<Lead[]> {
  // profiles is embedded rather than joined by hand because a lead without a
  // readable rep still belongs on the board.
  const { data, error } = await supabase
    .from("leads")
    .select("*, profiles(full_name)")
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const r = row as Lead & {
      profiles: { full_name: string | null } | { full_name: string | null }[] | null;
    };
    // PostgREST returns an embed as an object or an array depending on the
    // cardinality it infers; normalise rather than guessing.
    const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return { ...r, rep_name: profile?.full_name ?? null };
  });
}

/**
 * Moves a card to another stage.
 *
 * Deliberately the only field this page writes. What the rep recorded on the
 * call is their account of it, and a pipeline board is not the place to edit
 * somebody else's notes.
 */
export async function setLeadStage(
  supabase: SupabaseClient,
  id: string,
  stage: Stage
): Promise<void> {
  const { data, error } = await supabase
    .from("leads")
    .update({ stage })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);

  // An update that matches nothing still reports success, so a zero-row result
  // has to be turned into a failure. Two very different things cause it — the
  // lead was deleted while this board sat open, or RLS refused the write — and
  // blaming permissions for a stale card sends you looking in the wrong place.
  if (!data || data.length === 0) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    throw new Error(
      count === 0
        ? "That lead no longer exists — the board has been refreshed."
        : "That lead could not be moved. You may not have permission."
    );
  }
}

/**
 * Deletes a lead outright. Manager-only, by RLS.
 *
 * For the card that should never have existed — a mistyped company, a
 * duplicate, a test row. A real call that went nowhere belongs in 'Lost'; this
 * is for the ones where no call happened at all.
 *
 * ⚠️ Deleting an `in_progress` lead can be undone by the rep's own phone, which
 * replays a sales call by upserting on `client_generated_id`, and can stall
 * that phone's outbox if the *completion* has not synced yet. The dialog warns
 * before this is called; see the migration for the full reasoning.
 */
export async function deleteLead(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);

  // Same trap as setLeadStage: a delete matching no row is a success to
  // PostgREST, so RLS refusing the write is indistinguishable from a card that
  // was already gone unless the two are told apart here.
  if (!data || data.length === 0) {
    const { count, error: countError } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    // Raised rather than folded into the count test below. A failed count
    // leaves `count` null, which reads as "the row is still there" and would
    // blame the manager's permissions for what is actually a network error.
    if (countError) throw new Error(countError.message);
    throw new Error(
      count === 0
        ? "That lead had already been deleted — the board has been refreshed."
        : "That lead could not be deleted. Only a manager can delete a lead."
    );
  }
}

/** Local date, because a follow-up due "today" is due in Botswana, not in UTC. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
