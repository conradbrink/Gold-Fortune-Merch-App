import type { SupabaseClient } from "@supabase/supabase-js";

export const VISIT_PHOTOS_BUCKET = "visit-photos";

/**
 * Signed URLs for visit photos, keyed by storage path.
 *
 * The bucket is private, so every image needs signing before it can render.
 * Uses `createSignedUrls` (plural) so a gallery of 60 photos costs one request
 * rather than 60 round-trips.
 *
 * Paths that fail to sign are simply absent from the returned map — callers
 * should treat a missing key as "no image", which also covers rows whose
 * storage object was never uploaded.
 */
export async function signPhotos(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[],
  expiresInSeconds = 3600
): Promise<Record<string, string>> {
  const unique = Array.from(
    new Set(paths.filter((p): p is string => Boolean(p)))
  );
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(VISIT_PHOTOS_BUCKET)
    .createSignedUrls(unique, expiresInSeconds);

  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
  }
  return map;
}
