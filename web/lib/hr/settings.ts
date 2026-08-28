import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAffected,
  type Department,
  type HrSettings,
  type LeaveType,
  type Lookup,
  type ReviewCategory,
  type ReviewTemplate,
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
 * Review categories are additionally nested: each belongs to a scorecard in
 * `hr_review_templates`, and the flat `reviewCategories` list below is every
 * category of every scorecard. Callers filter it by `template_id` rather than
 * asking for one scorecard's categories, because both screens that use it need
 * more than one scorecard at a time — the settings page to let HR switch
 * between them, the performance page to label a whole list of employees.
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
  reviewTemplates: ReviewTemplate[];
  /** Every scorecard's categories in one list; filter by `template_id`. */
  reviewCategories: ReviewCategory[];
  territories: { id: string; name: string }[];
};

/**
 * One round trip for every list the HR screens need.
 *
 * Seven parallel queries rather than seven sequential ones: they are
 * independent, and a settings page that takes seven round trips to first paint
 * on a Botswana mobile connection is a settings page nobody opens twice.
 */
export async function fetchHrReference(
  supabase: SupabaseClient
): Promise<HrReference> {
  const [settings, departments, lookups, leaveTypes, templates, categories, territories] =
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
        .from("hr_review_templates")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
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

  const first = [
    settings,
    departments,
    lookups,
    leaveTypes,
    templates,
    categories,
    territories,
  ].find((r) => r.error);
  if (first?.error) throw new Error(first.error.message);

  return {
    settings: (settings.data ?? null) as HrSettings | null,
    departments: (departments.data ?? []) as Department[],
    lookups: (lookups.data ?? []) as Lookup[],
    leaveTypes: (leaveTypes.data ?? []) as LeaveType[],
    reviewTemplates: (templates.data ?? []) as ReviewTemplate[],
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

/**
 * A scorecard: the named set of categories an employee is reviewed against.
 *
 * Never deleted from here. A scorecard that any review was written against is
 * refused by the database anyway — `hr_reviews.template_id` is `on delete
 * restrict`, because a completed review has to keep the criteria it was written
 * against or its overall score stops meaning anything. `active = false` is how
 * one is retired, and it stays readable on the reviews that used it.
 */
/**
 * A duplicate name, in words rather than in Postgres.
 *
 * The unique indexes are `(org_id, lower(name))` on a scorecard and
 * `(template_id, lower(name))` on a category, and PostgREST hands their
 * violation back verbatim. Without this the settings banner reads `duplicate
 * key value violates unique constraint "hr_review_categories_template_name_idx"`
 * at somebody who typed a name that was already in the list.
 */
function friendlyDuplicate(message: string, what: string): string {
  if (message.includes("hr_review_templates_org_name_idx")) {
    return `There is already a scorecard called that.`;
  }
  if (message.includes("hr_review_categories_template_name_idx")) {
    return `This scorecard already has a category called that.`;
  }
  return message || `The ${what} was not saved`;
}

export async function saveReviewTemplate(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    id?: string;
    name: string;
    description: string | null;
    active: boolean;
    sort_order: number;
  }
): Promise<void> {
  const { id, ...rest } = input;
  const query = id
    ? supabase.from("hr_review_templates").update(rest).eq("id", id)
    : supabase.from("hr_review_templates").insert({ ...rest, org_id: orgId });
  const { data, error } = await query.select("id");
  if (error) throw new Error(friendlyDuplicate(error.message, "scorecard"));
  assertAffected(data, "The scorecard was not saved");
}

/**
 * Which scorecard a department's people are reviewed on.
 *
 * Separate from `saveDepartment` rather than another field on it because they
 * are edited from different places and by different reasoning — a department's
 * name and code are its identity, and this is a policy decision about reviews
 * that HR makes on the Performance settings tab.
 */
export async function setDepartmentTemplate(
  supabase: SupabaseClient,
  departmentId: string,
  templateId: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_departments")
    .update({ review_template_id: templateId })
    .eq("id", departmentId)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The scorecard was not assigned");
}

/**
 * A category, on exactly one scorecard.
 *
 * `template_id` is destructured out of the update for the same reason a leave
 * type's `code` is: moving a category to another scorecard would silently
 * detach every rating already given against it from the review that gave it.
 * A category on the wrong scorecard is deactivated and re-created on the right
 * one.
 */
export async function saveReviewCategory(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    id?: string;
    template_id: string;
    name: string;
    description: string | null;
    weight: number;
    active: boolean;
    sort_order: number;
  }
): Promise<void> {
  const { id, template_id, ...rest } = input;
  const query = id
    ? supabase.from("hr_review_categories").update(rest).eq("id", id)
    : supabase
        .from("hr_review_categories")
        .insert({ ...rest, template_id, org_id: orgId });
  const { data, error } = await query.select("id");
  if (error) throw new Error(friendlyDuplicate(error.message, "category"));
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
