import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared documents — planograms, price lists, notices.
 *
 * Nothing here decides who may see a file. `files` carries an RLS policy that
 * does, and the storage bucket's read policy joins to it, so a plain `select`
 * returns exactly what the caller is entitled to and a signed URL cannot be
 * minted for anything else. The UI reflects that rule; it does not implement
 * a second copy of it.
 */

export const FILES_BUCKET = "files";

/** Who a file is for. Storage access follows from this via `can_see_file`. */
export type Audience = "everyone" | "reps" | "groups";

export type FileRow = {
  id: string;
  name: string;
  description: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  audience: Audience;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  /** Rep ids, when audience is "reps". */
  rep_ids: string[];
  /** Store group ids, when audience is "groups". */
  group_ids: string[];
};

export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: "Everyone",
  reps: "Selected reps",
  groups: "By chain",
};

/** 25 MB, matching the bucket's own `file_size_limit`. */
export const MAX_FILE_BYTES = 26_214_400;

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fetchFiles(supabase: SupabaseClient): Promise<FileRow[]> {
  // Single string literal — a concatenated .select() degrades to
  // GenericStringError in postgrest-js.
  const { data, error } = await supabase
    .from("files")
    .select(
      "id, name, description, storage_path, mime_type, size_bytes, audience, uploaded_by, created_at, updated_at, file_reps(rep_id), file_groups(store_group_id)"
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (Omit<FileRow, "rep_ids" | "group_ids"> & {
    file_reps: { rep_id: string }[] | null;
    file_groups: { store_group_id: string }[] | null;
  })[];

  return rows.map((r) => ({
    ...r,
    rep_ids: (r.file_reps ?? []).map((x) => x.rep_id),
    group_ids: (r.file_groups ?? []).map((x) => x.store_group_id),
  }));
}

/**
 * Signed URLs keyed by storage path.
 *
 * Mirrors `signPhotos` in `lib/photos.ts` — `createSignedUrls` (plural) means a
 * list of 60 files costs one request rather than 60. A path the caller is not
 * entitled to simply fails to sign and is absent from the map, because the
 * bucket policy checks entitlement rather than trusting the caller.
 */
export async function signFiles(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[],
  expiresInSeconds = 3600
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrls(unique, expiresInSeconds);
  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
  }
  return map;
}

/** A signed URL for one file, used when a manager opens or downloads it. */
export async function signFile(
  supabase: SupabaseClient,
  path: string,
  download = false
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(path, 3600, download ? { download: true } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Strips anything that would make an awkward or unsafe object key. */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

export type UploadInput = {
  file: File;
  name: string;
  description: string;
  audience: Audience;
  repIds: string[];
  groupIds: string[];
};

/**
 * Uploads the object, then records the row, then the audience.
 *
 * Object first: a row pointing at a missing object is a broken download for
 * every rep who can see it, whereas an object with no row is invisible and
 * harmless. If the row insert fails the object is removed again, so a retry
 * does not leave debris behind.
 */
export async function uploadFile(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: UploadInput
): Promise<FileRow> {
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error(
      `That file is ${formatBytes(input.file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`
    );
  }

  // crypto.randomUUID keeps two files of the same name apart, and makes the
  // path unguessable even before the policy is consulted.
  const fileId = crypto.randomUUID();
  const path = `${orgId}/${fileId}/${safeFileName(input.file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: inserted, error: insertError } = await supabase
    .from("files")
    .insert({
      id: fileId,
      org_id: orgId,
      name: input.name.trim() || input.file.name,
      description: input.description.trim() || null,
      storage_path: path,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      audience: input.audience,
      uploaded_by: userId,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    await supabase.storage.from(FILES_BUCKET).remove([path]);
    throw new Error(insertError?.message ?? "Could not save the file record.");
  }

  await setAudience(supabase, fileId, input.audience, input.repIds, input.groupIds);

  return {
    id: fileId,
    name: input.name.trim() || input.file.name,
    description: input.description.trim() || null,
    storage_path: path,
    mime_type: input.file.type || null,
    size_bytes: input.file.size,
    audience: input.audience,
    uploaded_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    rep_ids: input.repIds,
    group_ids: input.groupIds,
  };
}

/**
 * Replaces a file's audience.
 *
 * Rows for the audiences not in use are cleared, so switching from "selected
 * reps" to "everyone" and back does not silently restore an old list the
 * manager has forgotten about.
 */
export async function setAudience(
  supabase: SupabaseClient,
  fileId: string,
  audience: Audience,
  repIds: string[],
  groupIds: string[]
): Promise<void> {
  const { error: updateError } = await supabase
    .from("files")
    .update({ audience, updated_at: new Date().toISOString() })
    .eq("id", fileId);
  if (updateError) throw new Error(updateError.message);

  await supabase.from("file_reps").delete().eq("file_id", fileId);
  await supabase.from("file_groups").delete().eq("file_id", fileId);

  if (audience === "reps" && repIds.length > 0) {
    const { error } = await supabase
      .from("file_reps")
      .insert(repIds.map((rep_id) => ({ file_id: fileId, rep_id })));
    if (error) throw new Error(error.message);
  }
  if (audience === "groups" && groupIds.length > 0) {
    const { error } = await supabase
      .from("file_groups")
      .insert(groupIds.map((store_group_id) => ({ file_id: fileId, store_group_id })));
    if (error) throw new Error(error.message);
  }
}

export async function renameFile(
  supabase: SupabaseClient,
  fileId: string,
  name: string,
  description: string | null
): Promise<void> {
  const { error } = await supabase
    .from("files")
    .update({ name, description, updated_at: new Date().toISOString() })
    .eq("id", fileId);
  if (error) throw new Error(error.message);
}

/**
 * Deletes the object first, then the row.
 *
 * If the object cannot be removed the row stays: an orphaned object is untidy
 * and invisible, whereas a row whose object is gone is a broken download for
 * everyone who can see it.
 */
export async function deleteFile(
  supabase: SupabaseClient,
  file: FileRow
): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(FILES_BUCKET)
    .remove([file.storage_path]);
  if (storageError) throw new Error(storageError.message);

  const { error } = await supabase.from("files").delete().eq("id", file.id);
  if (error) throw new Error(error.message);
}
