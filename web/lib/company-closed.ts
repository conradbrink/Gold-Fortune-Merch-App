import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Whether the company behind a client's link (a job report or a document) has
 * been closed from the Control Centre. Those pages are public and read with
 * the service role, so the database's lock on a closed company's people does
 * not cover them; while it is closed, its links stop working like a
 * withdrawn one. Before the migration that adds `closed_at`, nothing is
 * closed.
 */
export async function linkCompanyClosed(
  db: SupabaseClient<Database>,
  table: "job_reports" | "document_links",
  id: string
): Promise<boolean> {
  const { data: row } = await db.from(table).select("org_id").eq("id", id).maybeSingle();
  if (!row?.org_id) return false;
  const { data: account, error } = await db
    .from("company_account")
    .select("closed_at")
    .eq("org_id", row.org_id)
    .maybeSingle();
  if (error) return false;
  return !!account?.closed_at;
}
