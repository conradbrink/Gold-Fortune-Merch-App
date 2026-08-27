import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAffected,
  HR_BUCKET,
  MAX_HR_FILE_BYTES,
  type LeaveRequest,
  type LeaveType,
} from "@/lib/hr/types";

/**
 * Leave: balances that are counted rather than stored, and requests whose
 * status only the database is allowed to change.
 *
 * Two rules from the schema that the UI must not quietly re-implement:
 *
 *   * **Nothing here decrements a balance.** `hr_leave_balance_summary` derives
 *     used, pending and remaining from the requests every time it is read.
 *     Approving and then cancelling returns the number to where it started
 *     because it was never anywhere else.
 *   * **Nothing here decides who may approve.** The client sets `status` and
 *     `hr_leave_request_guard` accepts or refuses it, stamping `decided_by` and
 *     `decided_at` itself. `canDecide` below exists to decide which *buttons*
 *     to show, and is allowed to be wrong in the direction of offering a button
 *     that fails — never in the direction of performing a decision the database
 *     would have refused.
 */

export type LeaveBalance = {
  employee_id: string;
  leave_type_id: string;
  leave_type_name: string;
  leave_type_code: string;
  is_paid: boolean;
  deducts_from_balance: boolean;
  leave_year: number;
  entitlement_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
};

export type LeaveRequestRow = LeaveRequest & {
  employee: { id: string; full_name: string | null; employee_number: string } | null;
  leave_type: { id: string; name: string; is_paid: boolean } | null;
  decided_by_profile: { full_name: string | null } | null;
};

const REQUEST_SELECT =
  "*, employee:hr_employees(id, full_name, employee_number), leave_type:hr_leave_types(id, name, is_paid), decided_by_profile:profiles!hr_leave_requests_decided_by_fkey(full_name)";

export async function fetchLeaveRequests(
  supabase: SupabaseClient,
  opts: { employeeId?: string; status?: string } = {}
): Promise<LeaveRequestRow[]> {
  let query = supabase
    .from("hr_leave_requests")
    .select(REQUEST_SELECT)
    .order("start_date", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeaveRequestRow[];
}

/** Approved leave overlapping a window — the calendar's only query. */
export async function fetchLeaveCalendar(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<LeaveRequestRow[]> {
  const { data, error } = await supabase
    .from("hr_leave_requests")
    .select(REQUEST_SELECT)
    .eq("status", "approved")
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeaveRequestRow[];
}

export async function fetchLeaveBalances(
  supabase: SupabaseClient,
  employeeId?: string
): Promise<LeaveBalance[]> {
  let query = supabase
    .from("hr_leave_balance_summary")
    .select(
      "employee_id, leave_type_id, leave_type_name, leave_type_code, is_paid, deducts_from_balance, leave_year, entitlement_days, used_days, pending_days, remaining_days"
    );
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeaveBalance[];
}

export type LeaveRequestInput = {
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  document_path: string | null;
};

export async function createLeaveRequest(
  supabase: SupabaseClient,
  orgId: string,
  input: LeaveRequestInput
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_leave_requests")
    .insert({ ...input, org_id: orgId })
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The leave request was not created");
}

/**
 * Approve, reject or cancel.
 *
 * `decided_by` and `decided_at` are deliberately absent from the payload. The
 * trigger writes them from `auth.uid()` and `now()`, so "approved by Conrad on
 * the 3rd" is a fact the database is prepared to stand behind rather than a
 * value a client asserted.
 */
export async function decideLeaveRequest(
  supabase: SupabaseClient,
  id: string,
  status: "approved" | "rejected" | "cancelled",
  note?: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_leave_requests")
    .update({ status, decision_note: note ?? null })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The leave request was not updated");
}

/**
 * Working days between two dates, asked of the database.
 *
 * The same function the leave year and the attendance report use, so the number
 * offered in the form is the number the rest of the module would have counted.
 * Public holidays are not deducted — there is no holiday calendar and inventing
 * Botswana's would hard-code the sort of rule section 12 forbids — so this is a
 * default the requester can correct, and the field stays editable.
 */
export async function suggestDays(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await supabase.rpc("hr_working_days", {
    p_org: orgId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Upload a supporting document into the employee's own folder.
 *
 * The path is `<org>/<employee>/leave/<uuid>-<name>` and that second segment is
 * load-bearing: the bucket's insert policy reads it and refuses an upload aimed
 * at an employee the caller may not see. Naming the file after the employee is
 * not a convention, it is the check.
 */
export async function uploadLeaveDocument(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string,
  file: File
): Promise<string> {
  if (file.size > MAX_HR_FILE_BYTES) {
    throw new Error("That file is larger than the 25 MB limit.");
  }
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${orgId}/${employeeId}/leave/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from(HR_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Balance adjustments. HR only — the RLS policy says so, not this function. */
export async function saveLeaveBalance(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    employee_id: string;
    leave_type_id: string;
    leave_year: number;
    entitlement_days: number | null;
    carried_over_days: number;
    adjustment_days: number;
    note: string | null;
  },
  userId: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_leave_balances")
    .upsert(
      { ...input, org_id: orgId, updated_by: userId },
      { onConflict: "employee_id,leave_type_id,leave_year" }
    )
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The balance was not saved");
}

export function activeLeaveTypes(types: LeaveType[]): LeaveType[] {
  return types.filter((t) => t.active);
}

/**
 * Whether to offer approve/reject on this row.
 *
 * Presentation only. The database refuses a decision from anyone who is neither
 * HR nor the employee's manager, and refuses a second decision on a request
 * that has already been settled; this just avoids offering buttons that would
 * bounce. `isHr` comes from the role, `managedIds` from the employee list the
 * caller could read at all — which RLS has already narrowed to their chain.
 */
export function canDecide(
  request: LeaveRequestRow,
  isHr: boolean,
  managedEmployeeIds: Set<string>
): boolean {
  if (request.status !== "pending") return false;
  return isHr || managedEmployeeIds.has(request.employee_id);
}
