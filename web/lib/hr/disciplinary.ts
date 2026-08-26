import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAffected,
  HR_BUCKET,
  MAX_HR_FILE_BYTES,
  type CaseEvidence,
  type CaseResponse,
  type DisciplinaryCase,
  type Lookup,
  type Warning,
} from "@/lib/hr/types";

/**
 * Disciplinary cases and warnings.
 *
 * 🔴 **Nothing in this file recommends an outcome, and nothing ever should.**
 * The brief says so twice and the schema enforces it: `outcome` is null until a
 * person picks a code from a list a person configured. There is no rule here
 * that a severity implies a sanction, that three warnings imply a fourth step,
 * or that a case type maps to a result. Employment law is not a lookup table
 * and this system is not qualified to apply it — it records what people decided
 * and when, which is what makes it useful if anyone ever has to prove it.
 *
 * Access is the narrowest in the module: HR, the employee's management chain,
 * and the employee themselves. That last one is not a leak — somebody answering
 * an allegation has to be able to read it.
 */

export type CaseRow = DisciplinaryCase & {
  employee: {
    id: string;
    full_name: string | null;
    employee_number: string;
    department_id: string | null;
    territory_id: string | null;
  } | null;
  reporter: { full_name: string | null } | null;
  handler: { full_name: string | null } | null;
};

const CASE_SELECT =
  "*, employee:hr_employees(id, full_name, employee_number, department_id, territory_id), reporter:profiles!hr_disciplinary_cases_reported_by_fkey(full_name), handler:profiles!hr_disciplinary_cases_manager_id_fkey(full_name)";

export async function fetchCases(
  supabase: SupabaseClient,
  opts: { employeeId?: string; openOnly?: boolean } = {}
): Promise<CaseRow[]> {
  let query = supabase
    .from("hr_disciplinary_cases")
    .select(CASE_SELECT)
    .order("opened_on", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.openOnly) query = query.is("closed_at", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CaseRow[];
}

export async function fetchCase(
  supabase: SupabaseClient,
  id: string
): Promise<CaseRow | null> {
  const { data, error } = await supabase
    .from("hr_disciplinary_cases")
    .select(CASE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as CaseRow | null;
}

export type CaseInput = {
  employee_id: string;
  incident_date: string | null;
  incident_type: string;
  description: string;
  severity: string;
  status: string;
  manager_id: string | null;
};

/**
 * Open a case. `case_number` is absent from the payload: the trigger draws it
 * from the same gapless per-organisation counter the warehouse documents use,
 * so a rolled-back transaction takes its number with it.
 */
export async function createCase(
  supabase: SupabaseClient,
  orgId: string,
  input: CaseInput
): Promise<DisciplinaryCase> {
  const { data, error } = await supabase
    .from("hr_disciplinary_cases")
    .insert({ ...input, org_id: orgId })
    .select("*");
  if (error) throw new Error(error.message);
  assertAffected(data, "The case was not opened");
  return (data as DisciplinaryCase[])[0];
}

export async function updateCase(
  supabase: SupabaseClient,
  id: string,
  input: Partial<CaseInput> & {
    outcome?: string | null;
    outcome_note?: string | null;
  }
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_disciplinary_cases")
    .update(input)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The case was not updated");
}

export type EvidenceRow = CaseEvidence & {
  uploader: { full_name: string | null } | null;
};

export async function fetchEvidence(
  supabase: SupabaseClient,
  caseId: string
): Promise<EvidenceRow[]> {
  const { data, error } = await supabase
    .from("hr_case_evidence")
    .select("*, uploader:profiles!hr_case_evidence_uploaded_by_fkey(full_name)")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EvidenceRow[];
}

/**
 * Attach a file as evidence.
 *
 * Filed under the employee's folder, not the case's, so the bucket's insert
 * policy — which reads the employee id out of the second path segment — is the
 * thing deciding whether the upload is allowed.
 */
export async function uploadEvidence(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string,
  caseId: string,
  userId: string | null,
  input: { kind: string; name: string; note: string | null; file: File }
): Promise<void> {
  if (input.file.size > MAX_HR_FILE_BYTES) {
    throw new Error("That file is larger than the 25 MB limit.");
  }
  const safe = input.file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${orgId}/${employeeId}/case/${crypto.randomUUID()}-${safe}`;

  const { error: upErr } = await supabase.storage
    .from(HR_BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await supabase
    .from("hr_case_evidence")
    .insert({
      org_id: orgId,
      case_id: caseId,
      kind: input.kind,
      name: input.name,
      storage_path: path,
      note: input.note,
      uploaded_by: userId,
    })
    .select("id");

  if (error || !data || data.length === 0) {
    await supabase.storage.from(HR_BUCKET).remove([path]);
    throw new Error(error?.message ?? "The evidence was not attached.");
  }
}

/**
 * Attach something the merchandising system already holds.
 *
 * A pointer rather than a copy: an attendance day, a workday session, a store
 * visit. The evidence stays the live record, so a case that turns on "he
 * started at 10:40" does not carry a screenshot that will still say 10:40 after
 * somebody corrects the underlying row.
 */
export async function linkEvidence(
  supabase: SupabaseClient,
  orgId: string,
  caseId: string,
  userId: string | null,
  input: {
    kind: string;
    name: string;
    reference_type: string | null;
    reference_id: string | null;
    note: string | null;
  }
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_case_evidence")
    .insert({ ...input, org_id: orgId, case_id: caseId, uploaded_by: userId })
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The evidence was not attached");
}

export async function deleteEvidence(
  supabase: SupabaseClient,
  row: Pick<CaseEvidence, "id" | "storage_path">
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_case_evidence")
    .delete()
    .eq("id", row.id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The evidence was not removed");
  if (row.storage_path) {
    await supabase.storage.from(HR_BUCKET).remove([row.storage_path]);
  }
}

export type CaseResponseRow = CaseResponse & {
  author: { full_name: string | null } | null;
};

export async function fetchResponses(
  supabase: SupabaseClient,
  caseId: string
): Promise<CaseResponseRow[]> {
  const { data, error } = await supabase
    .from("hr_case_responses")
    .select("*, author:profiles!hr_case_responses_created_by_fkey(full_name)")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CaseResponseRow[];
}

export async function addResponse(
  supabase: SupabaseClient,
  orgId: string,
  caseId: string,
  userId: string | null,
  input: { response: string; response_date: string; document_path: string | null }
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_case_responses")
    .insert({ ...input, org_id: orgId, case_id: caseId, created_by: userId })
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The response was not recorded");
}

export async function uploadResponseDocument(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string,
  file: File
): Promise<string> {
  if (file.size > MAX_HR_FILE_BYTES) {
    throw new Error("That file is larger than the 25 MB limit.");
  }
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${orgId}/${employeeId}/response/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from(HR_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export type WarningRow = Warning & {
  employee: { id: string; full_name: string | null; employee_number: string } | null;
  issuer: { full_name: string | null } | null;
  case: { id: string; case_number: string } | null;
};

const WARNING_SELECT =
  "*, employee:hr_employees(id, full_name, employee_number), issuer:profiles!hr_warnings_issued_by_fkey(full_name), case:hr_disciplinary_cases(id, case_number)";

export async function fetchWarnings(
  supabase: SupabaseClient,
  opts: { employeeId?: string; caseId?: string } = {}
): Promise<WarningRow[]> {
  let query = supabase
    .from("hr_warnings")
    .select(WARNING_SELECT)
    .order("issued_on", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.caseId) query = query.eq("case_id", opts.caseId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as WarningRow[];
}

export async function issueWarning(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    employee_id: string;
    case_id: string | null;
    warning_type: string;
    issued_on: string;
    reason: string;
    expires_on: string | null;
    document_path: string | null;
  }
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_warnings")
    .insert({ ...input, org_id: orgId })
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The warning was not issued");
}

/**
 * The employee's acknowledgement. The payload is empty of stamps for the same
 * reason as everywhere else in this module — the trigger writes who and when.
 * A blank update would match no columns, so `acknowledged_at` is sent as a
 * placeholder the trigger overwrites with its own `now()`.
 */
export async function acknowledgeWarning(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_warnings")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The warning was not acknowledged");
}

/** Live today: no expiry, or an expiry still ahead. */
export function isActiveWarning(w: Pick<Warning, "expires_on">, today = new Date()): boolean {
  if (!w.expires_on) return true;
  const [y, m, d] = w.expires_on.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() >= new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

/**
 * Whether a status means the case is finished, read from the org's own
 * configuration rather than from the string `closed`.
 *
 * An organisation that renames its final status should not silently lose every
 * open-case count, which is exactly what a hard-coded comparison would do.
 */
export function isTerminalStatus(lookups: Lookup[], code: string): boolean {
  const row = lookups.find((l) => l.kind === "case_status" && l.code === code);
  return Boolean((row?.meta as { terminal?: boolean } | null)?.terminal);
}

export type TimelineEntry = {
  id: string;
  date: string;
  kind: "case" | "warning";
  title: string;
  detail: string;
  href: string | null;
};

/**
 * The employee-profile timeline: cases and warnings on one dated list.
 *
 * Two record types on one axis because that is how the history reads to a
 * person — "written warning in January, case in May, verbal in August" — and
 * two separate tables on the page would make the reader interleave them by eye.
 */
export function buildTimeline(
  cases: CaseRow[],
  warnings: WarningRow[],
  lookups: Lookup[]
): TimelineEntry[] {
  const label = (kind: string, code: string | null) =>
    code
      ? lookups.find((l) => l.kind === kind && l.code === code)?.label ?? code
      : "—";

  const entries: TimelineEntry[] = [
    ...cases.map((c) => ({
      id: `case-${c.id}`,
      date: c.opened_on,
      kind: "case" as const,
      title: `Disciplinary case ${c.case_number}`,
      detail: `${label("incident_type", c.incident_type)} · ${label("severity", c.severity)}`,
      href: `/hr/disciplinary/${c.id}`,
    })),
    ...warnings.map((w) => ({
      id: `warning-${w.id}`,
      date: w.issued_on,
      kind: "warning" as const,
      title: label("warning_type", w.warning_type),
      detail: w.reason,
      href: w.case_id ? `/hr/disciplinary/${w.case_id}` : null,
    })),
  ];

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
