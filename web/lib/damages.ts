import type { SupabaseClient } from "@supabase/supabase-js";
import { allPages } from "@/lib/all-pages";
import { signPhotos } from "@/lib/photos";

/**
 * Damaged stock the reps found at stores (`damage_reports`, owner 15 Oct
 * 2026): what, how many single items, what is wrong, a photo. The manager
 * marks each one sorted once it is replaced or credited; the database stamps
 * who and when.
 *
 * The photos are in their own private bucket, `damage-photos`, readable by
 * exactly the people who may read the reports (20261015300000).
 */
export type DamageReport = {
  id: string;
  store_id: string;
  store_name: string;
  city: string | null;
  rep_id: string | null;
  product_name: string | null;
  item: string | null;
  qty: number;
  problem: string | null;
  status: "open" | "sorted";
  sorted_at: string | null;
  sorted_by: string | null;
  created_at: string;
  /** A signed URL for the photo, or null when there is none (or it would not sign). */
  photo_url: string | null;
};

export type DamageGroup = "open" | "sorted";

export const DAMAGE_PHOTOS_BUCKET = "damage-photos";

/** How far back the list shows reports sorted; open ones are always shown, however old. */
export const SORTED_DAYS = 90;

/** How long a photo link lasts; the page signs again when it reloads. */
const PHOTO_LINK_SECONDS = 4 * 3600;

type Row = {
  id: string;
  store_id: string;
  rep_id: string | null;
  item: string | null;
  qty: number;
  problem: string | null;
  status: "open" | "sorted";
  sorted_at: string | null;
  sorted_by: string | null;
  created_at: string;
  photo_path: string | null;
  stores: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
  products: { name: string } | { name: string }[] | null;
};

/** postgrest returns an embedded row as an object or an array depending on what it infers. */
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Every open report, and those sorted in the last SORTED_DAYS (by when they
 * were sorted, not when they were reported), newest first, with photos signed.
 * Paged: a response stops at 1,000 rows without saying so.
 */
export async function fetchDamages(supabase: SupabaseClient, now = Date.now()): Promise<DamageReport[]> {
  const since = new Date(now - SORTED_DAYS * 86_400_000).toISOString();
  const rows = await allPages<Row>((from, to) =>
    supabase
      .from("damage_reports")
      .select(
        "id, store_id, rep_id, item, qty, problem, status, sorted_at, sorted_by, created_at, photo_path, stores(name, city), products(name)"
      )
      .or(`status.eq.open,sorted_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  );
  const signed = await signPhotos(
    supabase,
    rows.map((r) => r.photo_path),
    PHOTO_LINK_SECONDS,
    DAMAGE_PHOTOS_BUCKET
  );
  return rows.map((r) => {
    const store = one(r.stores);
    return {
      id: r.id,
      store_id: r.store_id,
      store_name: store?.name ?? "",
      city: store?.city ?? null,
      rep_id: r.rep_id,
      product_name: one(r.products)?.name ?? null,
      item: r.item,
      qty: Number(r.qty),
      problem: r.problem,
      status: r.status,
      sorted_at: r.sorted_at,
      sorted_by: r.sorted_by,
      created_at: r.created_at,
      photo_url: r.photo_path ? (signed[r.photo_path] ?? null) : null,
    };
  });
}

/** What was damaged, in words: the product, or what the rep wrote. */
export function damagedWhat(d: Pick<DamageReport, "product_name" | "item">): string {
  return d.product_name ?? d.item ?? "Not recorded";
}

/**
 * Marks a report sorted, or open again, and returns what the database stamped
 * (who and when), so the page can change that one row in place.
 */
export async function setDamageStatus(
  supabase: SupabaseClient,
  id: string,
  status: DamageGroup
): Promise<Pick<DamageReport, "status" | "sorted_at" | "sorted_by">> {
  const { data, error } = await supabase
    .from("damage_reports")
    .update({ status })
    .eq("id", id)
    .select("status, sorted_at, sorted_by")
    .maybeSingle();
  if (error) throw new Error(error.message);
  // No row back: the database did not let this person change it.
  if (!data) throw new Error("You can't change this report.");
  return data as Pick<DamageReport, "status" | "sorted_at" | "sorted_by">;
}

/** Open reports, for the dashboard; null when the count could not be read. */
export async function countOpenDamages(supabase: SupabaseClient): Promise<number | null> {
  const { count, error } = await supabase
    .from("damage_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) return null;
  return count ?? 0;
}
