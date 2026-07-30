import { createClient as createAdminClient } from "@supabase/supabase-js";

export const APP_RELEASES_BUCKET = "app-releases";

export type AndroidRelease = {
  versionName: string;
  versionCode: number;
  releaseDate: string;
  notes: string[];
  fileSizeBytes: number;
  minSupportedVersionCode: number;
  storagePath: string;
};

/**
 * Reads the current Android release straight from the REST endpoint rather than
 * through a Supabase client.
 *
 * `app_releases` is world-readable by policy and this runs on the server during
 * a public page render, where there is no session to attach — pulling in a
 * cookie-bound client here would tie a page that must work signed-out to a
 * session that does not exist. `no-store` because a rep refreshing after a
 * release must not be told about the previous one.
 *
 * Returns null when nothing has been published yet. That is a real state — the
 * table is empty until the first APK is uploaded — and the page renders a
 * "no release yet" panel instead of failing.
 */
export async function getCurrentAndroidRelease(): Promise<AndroidRelease | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const res = await fetch(
    `${url}/rest/v1/app_releases` +
      `?select=version_name,version_code,release_date,notes,file_size_bytes,min_supported_version_code,storage_path` +
      `&platform=eq.android&is_current=is.true&limit=1`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    }
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as Array<{
    version_name: string;
    version_code: number;
    release_date: string;
    notes: string[] | null;
    file_size_bytes: number;
    min_supported_version_code: number;
    storage_path: string;
  }>;

  const row = rows[0];
  if (!row) return null;

  return {
    versionName: row.version_name,
    versionCode: row.version_code,
    releaseDate: row.release_date,
    notes: row.notes ?? [],
    fileSizeBytes: row.file_size_bytes,
    minSupportedVersionCode: row.min_supported_version_code,
    storagePath: row.storage_path,
  };
}

/**
 * A service-role client for reading the private release bucket.
 *
 * Only ever called from a route handler. The key bypasses row-level security
 * entirely, so nothing that returns it or its client may be imported by a
 * component that could render in the browser.
 */
export function createReleaseStorageClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;

  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Bytes as something a person can judge a mobile download against. */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "30 July 2026" — unambiguous, unlike any all-numeric format. */
export function formatReleaseDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  // Constructed as UTC and read back as UTC: building a local Date from a plain
  // calendar date shifts it a day backwards anywhere west of Greenwich.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
