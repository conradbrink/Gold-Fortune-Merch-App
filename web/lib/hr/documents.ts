import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAffected,
  expiryBucket,
  HR_BUCKET,
  MAX_HR_FILE_BYTES,
  type ExpiryBucket,
  type HrDocument,
} from "@/lib/hr/types";

/**
 * Employee paperwork, and the expiry tracking that is the only reason most of
 * it is worth filing.
 *
 * Nothing here decides who may read a document. `hr_documents` carries the
 * policy, and the `hr-documents` bucket's read policy joins back to this table
 * rather than restating it — so a signed URL cannot be minted for a row the
 * caller could not have selected. The UI reflects that rule; it does not
 * implement a second copy.
 */

export type DocumentRow = HrDocument & {
  employee: {
    id: string;
    full_name: string | null;
    employee_number: string;
  } | null;
  uploader: { full_name: string | null } | null;
};

const DOCUMENT_SELECT =
  "*, employee:hr_employees(id, full_name, employee_number), uploader:profiles!hr_documents_uploaded_by_fkey(full_name)";

export async function fetchDocuments(
  supabase: SupabaseClient,
  employeeId?: string
): Promise<DocumentRow[]> {
  let query = supabase
    .from("hr_documents")
    .select(DOCUMENT_SELECT)
    .order("created_at", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DocumentRow[];
}

export type UploadDocumentInput = {
  employeeId: string;
  name: string;
  category: string;
  issued_on: string | null;
  expiry_date: string | null;
  notes: string | null;
  file: File;
};

/**
 * Upload the bytes, then record the row.
 *
 * In that order, and it matters: the bucket's *read* policy requires a row
 * naming the path, so an object with no row is unreadable by anyone including
 * the person who just uploaded it. If the insert fails the object is removed
 * again — leaving it would be an orphan nobody can see, list or delete through
 * the app, and only HR can clear it out of storage by hand.
 */
export async function uploadDocument(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: UploadDocumentInput
): Promise<void> {
  if (input.file.size > MAX_HR_FILE_BYTES) {
    throw new Error("That file is larger than the 25 MB limit.");
  }
  const safe = input.file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${orgId}/${input.employeeId}/${crypto.randomUUID()}-${safe}`;

  const { error: upErr } = await supabase.storage
    .from(HR_BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await supabase
    .from("hr_documents")
    .insert({
      org_id: orgId,
      employee_id: input.employeeId,
      name: input.name,
      category: input.category,
      storage_path: path,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      issued_on: input.issued_on,
      expiry_date: input.expiry_date,
      notes: input.notes,
      uploaded_by: userId,
    })
    .select("id");

  if (error || !data || data.length === 0) {
    await supabase.storage.from(HR_BUCKET).remove([path]);
    throw new Error(error?.message ?? "The document was not filed.");
  }
}

export async function updateDocument(
  supabase: SupabaseClient,
  id: string,
  input: {
    name: string;
    category: string;
    issued_on: string | null;
    expiry_date: string | null;
    notes: string | null;
  }
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_documents")
    .update(input)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The document was not updated");
}

/** Row first, then bytes: a row with no object is a broken link, an object
 *  with no row is invisible. Both are bad; only the first is recoverable. */
export async function deleteDocument(
  supabase: SupabaseClient,
  doc: Pick<HrDocument, "id" | "storage_path">
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_documents")
    .delete()
    .eq("id", doc.id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The document was not removed");
  await supabase.storage.from(HR_BUCKET).remove([doc.storage_path]);
}

/**
 * A short-lived URL for one object.
 *
 * Five minutes: long enough to click, short enough that a link pasted into a
 * chat is dead before it is read. The signature is minted by Storage only if
 * the caller's own policies permit the object, so this cannot widen access.
 */
export async function signedDocumentUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(HR_BUCKET)
    .createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export type ExpirySummary = Record<ExpiryBucket, number>;

export function summariseExpiry(docs: { expiry_date: string | null }[]): ExpirySummary {
  const out: ExpirySummary = { expired: 0, expiring_7: 0, expiring_30: 0, valid: 0 };
  for (const d of docs) out[expiryBucket(d.expiry_date)] += 1;
  return out;
}

/**
 * Contract expiry, which is tracked on the employee rather than on a document.
 *
 * Section 6 asks for it alongside document expiry and it deliberately is not a
 * document: a contract's end date is an employment fact that exists whether or
 * not anybody uploaded the PDF, and hanging it off an attachment would mean an
 * unfiled contract silently never expires.
 */
export function contractExpiry(employee: {
  contract_end_date: string | null;
  employment_status: string;
}): ExpiryBucket | null {
  if (!employee.contract_end_date) return null;
  if (["terminated", "resigned", "inactive"].includes(employee.employment_status)) {
    return null;
  }
  return expiryBucket(employee.contract_end_date);
}
