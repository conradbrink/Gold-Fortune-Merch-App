import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormFieldType } from "@/lib/metrics";
import { dbError, refused } from "@/lib/write-refusal";

/**
 * Writing forms and their questions: the one place both the Forms pages and
 * the AI Manager save them.
 *
 * Kept out of the pages so a form the AI Manager creates is created exactly
 * as one made by hand: the same two writes, the same undo when the second is
 * refused, the same checks. Row-level security decides who may write (a
 * manager at their own company); these say plainly when it said no, because a
 * write PostgREST filters away answers with success and no rows.
 */

export const FIELD_TYPES: readonly FormFieldType[] = [
  "text",
  "number",
  "photo",
  "multiple_choice",
  "boolean",
  "date",
];

/** Lengths a person can read on a phone; the database itself has no limit. */
export const MAX_FORM_NAME = 120;
export const MAX_FORM_DESCRIPTION = 500;
export const MAX_FIELD_LABEL = 200;
export const MAX_OPTIONS = 20;
export const MAX_OPTION_CHARS = 100;

export type NewFormField = {
  label: string;
  field_type: string;
  required: boolean;
  /** The choices, for `multiple_choice` only. */
  options: string[] | null;
  metric_key: string | null;
};

export type NewForm = {
  name: string;
  description: string | null;
  required: boolean;
  fields: NewFormField[];
};

/** What is wrong with a question as typed, or null. */
export function formFieldProblem(field: NewFormField): string | null {
  const label = field.label.trim();
  if (!label) return "A question needs some words.";
  if (label.length > MAX_FIELD_LABEL) return `Keep a question under ${MAX_FIELD_LABEL} characters.`;
  if (!FIELD_TYPES.includes(field.field_type as FormFieldType)) return `"${label}" has a type the phone can't show.`;
  if (field.field_type === "multiple_choice") {
    const options = field.options ?? [];
    if (options.length < 2) return `"${label}" needs at least two choices.`;
    if (options.length > MAX_OPTIONS) return `"${label}" has more than ${MAX_OPTIONS} choices.`;
    if (options.some((o) => !o.trim() || o.length > MAX_OPTION_CHARS)) {
      return `Each choice in "${label}" needs words, under ${MAX_OPTION_CHARS} characters.`;
    }
  }
  return null;
}

/** What is wrong with a new form as typed, or null. */
export function newFormProblem(form: NewForm): string | null {
  const name = form.name.trim();
  if (!name) return "The form needs a name.";
  if (name.length > MAX_FORM_NAME) return `Keep the name under ${MAX_FORM_NAME} characters.`;
  if ((form.description ?? "").length > MAX_FORM_DESCRIPTION) {
    return `Keep the description under ${MAX_FORM_DESCRIPTION} characters.`;
  }
  for (const f of form.fields) {
    const problem = formFieldProblem(f);
    if (problem) return problem;
  }
  return null;
}

function fieldRows(formId: string, fields: NewFormField[], firstOrder: number) {
  return fields.map((f, i) => ({
    form_template_id: formId,
    label: f.label.trim(),
    field_type: f.field_type,
    required: f.required,
    options: f.field_type === "multiple_choice" && f.options?.length ? f.options.map((o) => o.trim()) : null,
    metric_key: f.metric_key ?? null,
    sort_order: firstOrder + i,
  }));
}

/**
 * Creates the template, and its questions too.
 *
 * Two writes rather than one, because `form_fields` needs the template's id,
 * and the client has no transaction to put them in. So the second write's
 * failure undoes the first: a template with no questions is not a form, and
 * one left behind would be joined by another on the retry the still-open
 * dialog invites.
 */
export async function createForm(supabase: SupabaseClient, form: NewForm): Promise<string> {
  // Checked, not asserted. An expired session gives `user: null`, and a
  // profile RLS hides gives `data: null` with an error.
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Your session has expired. Sign in again.");
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .single();
  if (profileError || !profileRow) {
    throw new Error("Could not read your organisation. Try again.");
  }

  const { data: created, error: insertError } = await supabase
    .from("form_templates")
    .insert({
      org_id: (profileRow as { org_id: string }).org_id,
      name: form.name.trim(),
      description: form.description?.trim() || null,
      required: form.required,
      created_by: userId,
    })
    .select("id")
    .single();
  if (insertError) throw dbError(insertError);
  const id = (created as { id: string }).id;
  if (form.fields.length === 0) return id;

  const { error: fieldsError } = await supabase.from("form_fields").insert(fieldRows(id, form.fields, 0));
  if (fieldsError) {
    // Take the empty template back out before saying so. Nothing has been
    // submitted against it, so the delete cannot be refused for history.
    // `select("id")`: a delete RLS filters out deletes nothing and reports
    // success, and the message must not say "not created" over a template
    // that is still there.
    const { data: undone, error: undoError } = await supabase
      .from("form_templates")
      .delete()
      .eq("id", id)
      .select("id");
    const rolledBack = !undoError && (undone?.length ?? 0) > 0;
    if (rolledBack) throw dbError({ ...fieldsError, message: `The form was not created — its questions were refused: ${fieldsError.message}` });
    // Left behind without its questions: said as it is, and never simply
    // tried again, or a second empty form joins the first.
    throw refused(
      `The form was created but its questions were not: ${fieldsError.message}. Open it from the list and add them by hand.`,
      "partial"
    );
  }
  return id;
}

/**
 * Adds questions at the end of a form, in the order given.
 *
 * The place at the end is read here rather than taken from a screen, so two
 * people adding at once (or the AI Manager while the builder is open) both
 * land after what is really there.
 */
export async function addFormFields(
  supabase: SupabaseClient,
  formId: string,
  fields: NewFormField[]
): Promise<string[]> {
  const { data: last, error: lastError } = await supabase
    .from("form_fields")
    .select("sort_order")
    .eq("form_template_id", formId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) throw dbError(lastError);
  const next = ((last ?? []) as { sort_order: number }[])[0]?.sort_order;
  const first = next === undefined ? 0 : next + 1;

  // Select the inserted rows back: a write PostgREST filters away answers
  // with success and no rows, so nothing else would tell us it was refused.
  const { data, error } = await supabase
    .from("form_fields")
    .insert(fieldRows(formId, fields, first))
    .select("id");
  if (error) throw dbError(error);
  if ((data?.length ?? 0) !== fields.length) {
    throw refused("The questions were not added — you may not have permission to edit this form.", "not_written");
  }
  return (data as { id: string }[]).map((r) => r.id);
}

/** Saves the questions' order: the first id first. */
export async function saveFieldOrder(supabase: SupabaseClient, fieldIds: string[]): Promise<void> {
  const results = await Promise.all(
    fieldIds.map((id, i) => supabase.from("form_fields").update({ sort_order: i }).eq("id", id).select("id"))
  );
  for (const { data, error } of results) {
    if (error) throw dbError(error);
    if ((data?.length ?? 0) === 0) {
      throw refused("The new order was not saved — you may not have permission to edit this form.", "not_written");
    }
  }
}

export type FormChange = { required?: boolean; active?: boolean };

/**
 * Makes a form compulsory or optional, or archives and restores it. Resolves
 * with the form's new `updated_at`, the version the next change carries.
 *
 * `seenUpdatedAt` is the version the person was shown: a form changed since
 * then is refused rather than changed again on old information. Read again to
 * say which it was, since a write that reached nothing looks the same either
 * way: changed by somebody else, or not this person's to change.
 */
export async function updateForm(
  supabase: SupabaseClient,
  formId: string,
  change: FormChange,
  seenUpdatedAt?: string
): Promise<string> {
  let query = supabase.from("form_templates").update(change).eq("id", formId);
  if (seenUpdatedAt) query = query.eq("updated_at", seenUpdatedAt);
  const { data, error } = await query.select("id, updated_at");
  if (error) throw dbError(error);
  const row = (data ?? [])[0] as { updated_at: string } | undefined;
  if (row) return row.updated_at;
  if (seenUpdatedAt) {
    const { data: now } = await supabase.from("form_templates").select("updated_at").eq("id", formId).maybeSingle();
    if (now && (now as { updated_at: string }).updated_at !== seenUpdatedAt) {
      throw refused("This form was changed by someone else since it was opened. Reload it and try again.", "stale");
    }
  }
  throw refused("Nothing was saved — you may not have permission.", "not_written");
}
