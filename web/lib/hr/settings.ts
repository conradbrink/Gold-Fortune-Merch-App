import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAffected,
  type Department,
  type HrSettings,
  type LeaveType,
  type Lookup,
  type ReviewCategory,
} from "@/lib/hr/types";

/**
 * Everything HR can configure, and the reference data the rest of the module
 * reads.
 *
 * The split is deliberate and it is the same split the database makes.
 * `hr_lookups` holds the six vocabularies that are only a code and a label —
 * incident types, severities, case statuses, warning types, outcomes, document
 * categories. Leave types and review categories carry real data of their own
 * (entitlement days, a weight) and have their own tables. Departments have
 * both a name and a head, and are their own table for the same reason.
 *
 * Nothing here hard-codes a Botswana rule. The working day, the late threshold,
 * the leave year, the rating scale and the acceptable score are all settings,
 * because section 12 is explicit that policy changes and the schema should not
 * have to.
 */

export type HrReference = {
  settings: HrSettings | null;
  departments: Department[];
  lookups: Lookup[];
  leaveTypes: LeaveType[];
  reviewCategories: ReviewCategory[];
  territories: { id: string; name: string }[];
};

/**
 * One round trip for every list the HR screens need.
 *
 * Six parallel queries rather than six sequential ones: they are independent,
 * and a settings page that takes six round trips to first paint on a Botswana
 * mobile connection is a settings page nobody opens twice.
 */
export async function fetchHrReference(
  supabase: SupabaseClient
): Promise<HrReference> {
  const [settings, departments, lookups, leaveTypes, categories, territories] =
    await Promise.all([
      supabase.from("hr_settings").select("*").maybeSingle(),
      supabase
        .from("hr_departments")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("hr_lookups")
        .select("*")
        .order("kind", { ascending: true })
        .order("sort_order", { ascending: true }),
      supabase
        .from("hr_leave_types")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("hr_review_categories")
        .select("*")
        .order("sort_order", { ascending: true }),
      // The deepest tier only: a store sits in a territory, and so does a rep.
      // Regions and countries are containers and would be a nonsense answer to
      // "which patch does this person cover?".
      supabase
        .from("territories")
        .select("id, name")
        .eq("level", "territory")
        .eq("active", true)
        .order("name", { ascending: true }),
    ]);

  const first = [settings, departments, lookups, leaveTypes, categories, territories].find(
    (r) => r.error
  );
  if (first?.error) throw new Error(first.error.message);

  return {
    settings: (settings.data ?? null) as HrSettings | null,
    departments: (departments.data ?? []) as Department[],
    lookups: (lookups.data ?? []) as Lookup[],
    leaveTypes: (leaveTypes.data ?? []) as LeaveType[],
    reviewCategories: (categories.data ?? []) as ReviewCategory[],
    territories: (territories.data ?? []) as { id: string; name: string }[],
  };
}

export type SettingsInput = {
  work_start_time: string;
  work_end_time: string;
  late_threshold_minutes: number;
  short_day_hours: number;
  workweek: number[];
  review_frequency: string;
  rating_scale_max: number;
  min_acceptable_score: number;
  leave_year_start_month: number;
  expiry_warning_days: number;
};

export async function saveSettings(
  supabase: SupabaseClient,
  orgId: string,
  input: SettingsInput
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_settings")
    .upsert({ ...input, org_id: orgId }, { onConflict: "org_id" })
    .select("org_id");
  if (error) throw new Error(error.message);
  assertAffected(data, "Settings were not saved");
}

export async function saveDepartment(
  supabase: SupabaseClient,
  orgId: string,
  input: { id?: string; name: string; code: string | null; active: boolean; sort_order: number }
): Promise<void> {
  const { id, ...rest } = input;
  const query = id
    ? supabase.from("hr_departments").update(rest).eq("id", id)
    : supabase.from("hr_departments").insert({ ...rest, org_id: orgId });
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The department was not saved");
}

/**
 * Departments are disabled, never deleted, once anyone has been filed under
 * one. The delete is offered only when nothing points at it, which the caller
 * checks — the database would refuse with `on delete set null` and quietly
 * orphan the employees instead of failing, which is worse.
 */
export async function deleteDepartment(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_departments")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The department was not removed");
}

export async function saveLeaveType(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    id?: string;
    name: string;
    code: string;
    is_paid: boolean;
    default_entitlement_days: number;
    requires_document: boolean;
    deducts_from_balance: boolean;
    active: boolean;
    sort_order: number;
  }
): Promise<void> {
  // `code` is what balances and requests are filed under, so it is destructured
  // out of the update. Renaming the label is safe; renaming the code would
  // silently detach every request already filed under the old one.
  const { id, code, ...rest } = input;
  const query = id
    ? supabase.from("hr_leave_types").update(rest).eq("id", id)
    : supabase.from("hr_leave_types").insert({ ...rest, code, org_id: orgId });
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The leave type was not saved");
}

export async function saveReviewCategory(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    id?: string;
    name: string;
    description: string | null;
    weight: number;
    active: boolean;
    sort_order: number;
  }
): Promise<void> {
  const { id, ...rest } = input;
  const query = id
    ? supabase.from("hr_review_categories").update(rest).eq("id", id)
    : supabase.from("hr_review_categories").insert({ ...rest, org_id: orgId });
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The category was not saved");
}

export async function saveLookup(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    id?: string;
    kind: string;
    code: string;
    label: string;
    sort_order: number;
    active: boolean;
  }
): Promise<void> {
  const { id, kind, code, ...rest } = input;
  const query = id
    ? // Same reasoning as leave types: the code is a foreign key in all but
      // name. Cases, warnings and documents store it as text.
      supabase.from("hr_lookups").update(rest).eq("id", id)
    : supabase.from("hr_lookups").insert({ ...rest, kind, code, org_id: orgId });
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The entry was not saved");
}

/**
 * A code for a new lookup or leave type, derived from its label.
 *
 * Lower case, underscores, no punctuation — the same shape as the seeded codes,
 * so a list HR has added to still reads consistently in the database.
 */
export function codeFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** ISO day numbers, 1 = Monday, for the workweek editor. */
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export const LOOKUP_KINDS: { kind: string; label: string; help: string }[] = [
  { kind: "incident_type", label: "Incident types", help: "What a disciplinary case is about." },
  { kind: "severity", label: "Severity levels", help: "How serious the incident is held to be." },
  { kind: "case_status", label: "Case statuses", help: "The steps a case moves through." },
  { kind: "warning_type", label: "Warning types", help: "The kinds of warning that can be issued." },
  { kind: "outcome", label: "Outcomes", help: "What was decided. Never suggested by the system." },
  { kind: "document_category", label: "Document categories", help: "How HR documents are filed." },
];

/**
 * Create an HR manager login.
 *
 * Goes through `/api/reps/invite` rather than the browser client, because
 * creating an auth user needs the service-role key and that must never reach a
 * bundle. The route verifies the caller is a `manager` before it uses the key,
 * so an HR manager cannot create another one — the Admin tier grants this role,
 * and the role cannot grant itself.
 *
 * ⚠️ The password is posted once and never stored client-side. It is shown to
 * whoever created the account so they can hand it over, and it should be
 * changed by its owner at first sign-in — this is the same "no work email, so
 * no invite mail" arrangement the rep and warehouse logins use, and it inherits
 * the same weakness: for a moment the password exists somewhere other than in
 * its owner's head.
 */
export async function createHrManager(input: {
  email: string;
  fullName: string;
  password: string;
}): Promise<void> {
  const res = await fetch("/api/reps/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      full_name: input.fullName,
      password: input.password,
      role: "hr_manager",
    }),
  });
  // The route always answers with JSON, but a proxy or a crash could still
  // return HTML, and `res.json()` would throw a parse error saying nothing.
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `The account was not created (${res.status}).`;
    throw new Error(message);
  }
}

/** Everyone in the org holding the HR role, for the staff list in Settings. */
export async function fetchHrStaff(
  supabase: SupabaseClient
): Promise<{ id: string; full_name: string | null; email: string | null; is_active: boolean }[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, is_active")
    .eq("role", "hr_manager")
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    is_active: boolean;
  }[];
}
