import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAffected, type Compensation, type Employee, type EmployeeAsset } from "@/lib/hr/types";

/**
 * Employees — the central HR record, and the one that points at `profiles`
 * rather than duplicating it.
 *
 * Nothing here filters by organisation. `hr_employees` carries an RLS policy
 * that already does, and the same policy is what decides whether a line manager
 * sees three people or thirty. Adding an `org_id` filter in the client would be
 * a second copy of a rule that is enforced properly one layer down, and the
 * copy is the one that goes stale.
 *
 * ⚠️ **Every embed here names its foreign key, and all four have to.**
 * PostgREST refuses an ambiguous embed at runtime — "more than one
 * relationship was found" — while `tsc` and `next build` pass happily, so the
 * first sign of it is an empty page. The same trap cost this repo an afternoon
 * on `routes → profiles`.
 *
 * The pairs that are ambiguous, and why:
 *
 *   * `profiles` — reached twice, by `profile_id` and `created_by`.
 *   * `hr_departments` — reached twice, and the second one goes the other way:
 *     `hr_departments.head_employee_id` points back at `hr_employees`. Caught
 *     only by loading the page; the department name is not a nullable column
 *     that renders as a dash, it is an embed that fails the whole query.
 *   * `hr_employees` itself, through `manager_id` — and this one has three
 *     spellings, two of which are wrong in different ways. PostgREST resolves a
 *     recursive embed by the column, and the *direction* is carried by whether
 *     the table is named:
 *
 *         manager:hr_employees!hr_employees_manager_id_fkey(…)
 *             "could not find a relationship between 'hr_employees' and
 *             'hr_employees'" — a self-relation will not take a constraint name.
 *         manager:hr_employees!manager_id(…)
 *             Succeeds, and returns the WRONG END: the employee's direct
 *             reports, as an array. An employee with no reports gets `[]`,
 *             which is truthy, so `manager ? manager.full_name : "—"` renders
 *             an empty cell rather than a dash and nothing looks broken.
 *         manager:manager_id(…)                                    ← correct
 *             The parent. Embedding on the column alone is the many-to-one
 *             form.
 *
 * `territories` is reached once and would work unqualified. It is named anyway,
 * so that the rule here is "always" rather than "when you remember to check".
 */

/** One row of the employee list, with the names its foreign keys point at. */
export type EmployeeRow = Employee & {
  department: { name: string } | null;
  territory: { name: string } | null;
  manager: { id: string; full_name: string | null } | null;
  account: { id: string; role: string; is_active: boolean; email: string | null } | null;
};

const EMPLOYEE_SELECT =
  "*, department:hr_departments!hr_employees_department_id_fkey(name), territory:territories!hr_employees_territory_id_fkey(name), manager:manager_id(id, full_name), account:profiles!hr_employees_profile_id_fkey(id, role, is_active, email)";

export async function fetchEmployees(
  supabase: SupabaseClient
): Promise<EmployeeRow[]> {
  // Single string literal — a concatenated `.select()` degrades to
  // GenericStringError in postgrest-js.
  const { data, error } = await supabase
    .from("hr_employees")
    .select(EMPLOYEE_SELECT)
    .order("employee_number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EmployeeRow[];
}

export async function fetchEmployee(
  supabase: SupabaseClient,
  id: string
): Promise<EmployeeRow | null> {
  const { data, error } = await supabase
    .from("hr_employees")
    .select(EMPLOYEE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as EmployeeRow | null;
}

/**
 * The caller's own employee record, or null.
 *
 * Goes through the database helper rather than matching `profile_id` in the
 * client, so "which employee am I?" has one answer and it is the same one every
 * RLS policy in the module uses.
 */
export async function fetchMyEmployee(
  supabase: SupabaseClient
): Promise<EmployeeRow | null> {
  const { data: id, error } = await supabase.rpc("hr_my_employee_id");
  if (error) throw new Error(error.message);
  if (!id) return null;
  return fetchEmployee(supabase, id as string);
}

/** The people who report to this employee, directly. */
export async function fetchDirectReports(
  supabase: SupabaseClient,
  employeeId: string
): Promise<EmployeeRow[]> {
  const { data, error } = await supabase
    .from("hr_employees")
    .select(EMPLOYEE_SELECT)
    .eq("manager_id", employeeId)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EmployeeRow[];
}

export type ProfileOption = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  /** True when some employee record already claims this account. */
  linked: boolean;
};

/**
 * Every account, flagged with whether it is already somebody's HR record.
 *
 * The list includes taken accounts rather than hiding them, because "Jerry is
 * already EMP-004" is the answer to the question the user was about to ask, and
 * a name silently missing from a dropdown is not.
 */
export async function fetchProfileOptions(
  supabase: SupabaseClient
): Promise<ProfileOption[]> {
  const [{ data: profiles, error: pErr }, { data: taken, error: tErr }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active")
        .order("full_name", { ascending: true }),
      supabase.from("hr_employees").select("profile_id"),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (tErr) throw new Error(tErr.message);

  const claimed = new Set(
    ((taken ?? []) as { profile_id: string | null }[])
      .map((t) => t.profile_id)
      .filter((v): v is string => Boolean(v))
  );
  return ((profiles ?? []) as Omit<ProfileOption, "linked">[]).map((p) => ({
    ...p,
    linked: claimed.has(p.id),
  }));
}

/**
 * The next free `EMP-nnn`, as a suggestion only.
 *
 * Derived from the highest existing number rather than a count, so deleting
 * EMP-003 does not make the next new starter EMP-003 as well. It is not a
 * reservation: two people creating an employee at the same moment get the same
 * suggestion and the second one hits the unique index and is told to change it.
 * A gapless per-org counter exists (`next_document_number`) and was considered
 * overkill for a field somebody usually overtypes with the payroll's own
 * reference anyway.
 */
export async function suggestEmployeeNumber(
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("hr_employees")
    .select("employee_number");
  if (error) throw new Error(error.message);
  let highest = 0;
  for (const row of (data ?? []) as { employee_number: string }[]) {
    const m = /(\d+)\s*$/.exec(row.employee_number);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `EMP-${String(highest + 1).padStart(3, "0")}`;
}

export type EmployeeInput = {
  employee_number: string;
  first_name: string;
  last_name: string;
  profile_id: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  national_id: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  position: string | null;
  department_id: string | null;
  manager_id: string | null;
  territory_id: string | null;
  employment_status: string;
  employment_type: string;
  start_date: string | null;
  probation_end_date: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  end_date: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  weekly_hours: number | null;
  notes: string | null;
};

export async function createEmployee(
  supabase: SupabaseClient,
  orgId: string,
  input: EmployeeInput
): Promise<Employee> {
  const { data, error } = await supabase
    .from("hr_employees")
    .insert({ ...input, org_id: orgId })
    .select("*");
  if (error) throw new Error(friendlyEmployeeError(error.message));
  assertAffected(data, "The employee was not created");
  return (data as Employee[])[0];
}

export async function updateEmployee(
  supabase: SupabaseClient,
  id: string,
  input: Partial<EmployeeInput>
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_employees")
    .update(input)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(friendlyEmployeeError(error.message));
  assertAffected(data, "The employee was not updated");
}

/**
 * Turns the two constraint violations a user can actually cause into English.
 *
 * Everything else is passed through unchanged: a message nobody recognises is
 * better than a friendly one that describes the wrong problem.
 */
function friendlyEmployeeError(message: string): string {
  if (message.includes("hr_employees_org_number_idx")) {
    return "That employee number is already in use.";
  }
  if (message.includes("hr_employees_profile_id_key")) {
    return "That account already has an employee record.";
  }
  if (message.includes("hr_employees_manager_not_self")) {
    return "An employee cannot be their own manager.";
  }
  return message;
}

export async function fetchCompensation(
  supabase: SupabaseClient,
  employeeId: string
): Promise<Compensation | null> {
  const { data, error } = await supabase
    .from("hr_employee_compensation")
    .select("*")
    .eq("employee_id", employeeId)
    .maybeSingle();
  // A row the caller may not read comes back as null, not an error. The UI
  // shows "not visible to you" rather than an empty salary, which would read as
  // "this person is unpaid".
  if (error) throw new Error(error.message);
  return (data ?? null) as Compensation | null;
}

export type CompensationInput = {
  currency: string;
  basic_salary: number | null;
  pay_frequency: string;
  commission_structure: string | null;
  overtime_rate: number | null;
  bonus_note: string | null;
  bank_name: string | null;
  bank_branch_code: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  tax_number: string | null;
  tax_status: string | null;
  payroll_status: string;
  effective_from: string | null;
  notes: string | null;
};

/**
 * Upsert, because compensation is one row per employee and the first save
 * creates it. The audit trigger records the before and after either way.
 */
export async function saveCompensation(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string,
  userId: string | null,
  input: CompensationInput
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_employee_compensation")
    .upsert(
      { ...input, employee_id: employeeId, org_id: orgId, updated_by: userId },
      { onConflict: "employee_id" }
    )
    .select("employee_id");
  if (error) throw new Error(error.message);
  assertAffected(data, "Pay details were not saved");
}

export async function fetchAssets(
  supabase: SupabaseClient,
  employeeId: string
): Promise<EmployeeAsset[]> {
  const { data, error } = await supabase
    .from("hr_employee_assets")
    .select("*")
    .eq("employee_id", employeeId)
    .order("issued_on", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeAsset[];
}

export type AssetInput = {
  kind: string;
  vehicle_id: string | null;
  label: string;
  identifier: string | null;
  issued_on: string | null;
  returned_on: string | null;
  notes: string | null;
};

export async function addAsset(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string,
  userId: string | null,
  input: AssetInput
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_employee_assets")
    .insert({ ...input, org_id: orgId, employee_id: employeeId, created_by: userId })
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The asset was not recorded");
}

/** Returning an asset is an update, not a delete: it happened. */
export async function returnAsset(
  supabase: SupabaseClient,
  assetId: string,
  returnedOn: string
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_employee_assets")
    .update({ returned_on: returnedOn })
    .eq("id", assetId)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The asset was not updated");
}

export async function deleteAsset(
  supabase: SupabaseClient,
  assetId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_employee_assets")
    .delete()
    .eq("id", assetId)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The asset was not removed");
}

/** The signed-in user's organisation, for the `org_id` every insert needs. */
export async function fetchOrgId(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { org_id: string } | null)?.org_id ?? null;
}
