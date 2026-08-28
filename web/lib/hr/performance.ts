import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAffected,
  periodBounds,
  periodIndexOf,
  type Department,
  type Review,
  type ReviewCategory,
  type ReviewRating,
  type ReviewTemplate,
} from "@/lib/hr/types";

/**
 * Performance reviews.
 *
 * The one thing this module does NOT do is score anybody. `overall_rating` is
 * computed by a database trigger from the category ratings and is never sent
 * from here — a client that could write the total could write a total that does
 * not match its parts, and the parts are the evidence.
 *
 * Nor does anything read a sales figure, a visit count or a coverage
 * percentage. Section 7 is explicit that automatic metrics come later; the seam
 * for later is that a category is a row in `hr_review_categories`, so a future
 * machine-filled category needs a column on that table and not a new shape for
 * a review.
 *
 * Which categories a given review offers is its **scorecard**, resolved from
 * the employee (their own override, else their department's) and stamped onto
 * the review when it is created. Resolved here as well as in the database: the
 * database's answer is the one that counts, and this one exists so a manager
 * can see which scorecard they are about to use before they commit to it.
 */

export type ReviewRow = Review & {
  employee: {
    id: string;
    full_name: string | null;
    employee_number: string;
    position: string | null;
    /** The account, so a page can tell "is this my own review?" without a
     *  second query. Null for an employee who does not sign in — who therefore
     *  can never be the person looking at it. */
    profile_id: string | null;
  } | null;
  reviewer: { full_name: string | null } | null;
};

const REVIEW_SELECT =
  "*, employee:hr_employees(id, full_name, employee_number, position, profile_id), reviewer:profiles!hr_reviews_reviewer_id_fkey(full_name)";

export async function fetchReviews(
  supabase: SupabaseClient,
  opts: { employeeId?: string; status?: string } = {}
): Promise<ReviewRow[]> {
  let query = supabase
    .from("hr_reviews")
    .select(REVIEW_SELECT)
    .order("period_year", { ascending: false })
    .order("period_index", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReviewRow[];
}

export async function fetchReview(
  supabase: SupabaseClient,
  id: string
): Promise<ReviewRow | null> {
  const { data, error } = await supabase
    .from("hr_reviews")
    .select(REVIEW_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as ReviewRow | null;
}

export async function fetchRatings(
  supabase: SupabaseClient,
  reviewId: string
): Promise<ReviewRating[]> {
  const { data, error } = await supabase
    .from("hr_review_ratings")
    .select("*")
    .eq("review_id", reviewId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ReviewRating[];
}

/**
 * Start a review for a period.
 *
 * The period bounds are computed here and sent, rather than being derived in
 * the database, because the unique index is on (employee, type, year, index)
 * and the dates are description rather than identity. `status` is not sent: the
 * guard forces `draft` on insert whatever a client asks for.
 */
export async function createReview(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    employee_id: string;
    period_type: string;
    period_year: number;
    period_index: number;
    review_date: string;
    /** Omit to let the database resolve it. Sent only when HR has deliberately
     *  chosen a scorecard other than the employee's own. */
    template_id?: string | null;
  }
): Promise<Review> {
  const bounds = periodBounds(input.period_type, input.period_year, input.period_index);
  const { data, error } = await supabase
    .from("hr_reviews")
    .insert({
      org_id: orgId,
      employee_id: input.employee_id,
      period_type: input.period_type,
      period_year: input.period_year,
      period_index: input.period_index,
      period_start: bounds.start,
      period_end: bounds.end,
      review_date: input.review_date,
      ...(input.template_id ? { template_id: input.template_id } : {}),
    })
    .select("*");
  if (error) {
    if (error.message.includes("hr_reviews_period_unique_idx")) {
      throw new Error("This employee already has a review for that period.");
    }
    throw new Error(error.message);
  }
  assertAffected(data, "The review was not created");
  return (data as Review[])[0];
}

/** The manager's half of the form. Refused by the guard once completed. */
export async function saveReviewNarrative(
  supabase: SupabaseClient,
  id: string,
  input: {
    manager_comments: string | null;
    strengths: string | null;
    improvements: string | null;
    goals: string | null;
    review_date: string;
  }
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_reviews")
    .update(input)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The review was not saved");
}

/**
 * One rating. Upserted per category as the manager moves through the form, so
 * a half-filled review survives a dropped connection.
 */
export async function saveRating(
  supabase: SupabaseClient,
  reviewId: string,
  categoryId: string,
  rating: number,
  comment: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_review_ratings")
    .upsert(
      { review_id: reviewId, category_id: categoryId, rating, comment },
      { onConflict: "review_id,category_id" }
    )
    .select("review_id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The rating was not saved");
}

export async function clearRating(
  supabase: SupabaseClient,
  reviewId: string,
  categoryId: string
): Promise<void> {
  const { error } = await supabase
    .from("hr_review_ratings")
    .delete()
    .eq("review_id", reviewId)
    .eq("category_id", categoryId);
  if (error) throw new Error(error.message);
}

/**
 * Complete the review, handing it to the employee.
 *
 * Irreversible for the manager who wrote it: after this only HR can edit, and
 * every such edit lands in `security_events`. The database also refuses to
 * complete a review with no ratings on it.
 */
export async function completeReview(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_reviews")
    .update({ status: "completed" })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The review was not completed");
}

/**
 * The employee's own two actions: their comments, and acknowledgement.
 *
 * `acknowledged_by` and `acknowledged_at` are absent from the payload on
 * purpose — the trigger stamps them from `auth.uid()` and `now()`, so an
 * acknowledgement is something the database witnessed rather than something a
 * client claimed.
 */
export async function acknowledgeReview(
  supabase: SupabaseClient,
  id: string,
  employeeComments: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_reviews")
    .update({ status: "acknowledged", employee_comments: employeeComments })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The review was not acknowledged");
}

export async function saveEmployeeComments(
  supabase: SupabaseClient,
  id: string,
  employeeComments: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_reviews")
    .update({ employee_comments: employeeComments })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "Your comments were not saved");
}

export async function deleteReview(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("hr_reviews")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  assertAffected(data, "The review was not deleted — only drafts can be");
}

/** The period a review created today would cover, for the org's frequency. */
export function currentPeriod(frequency: string, now = new Date()) {
  return {
    period_type: frequency,
    period_year: now.getFullYear(),
    period_index: periodIndexOf(frequency, now),
  };
}

/**
 * Finished reviews oldest-first, for the trend on an employee profile.
 *
 * Drafts are excluded: a trend line that moves when a manager types is a trend
 * line about typing.
 */
export function history(reviews: ReviewRow[]): ReviewRow[] {
  return reviews
    .filter((r) => r.status !== "draft" && r.overall_rating != null)
    .slice()
    .sort(
      (a, b) =>
        a.period_year - b.period_year || a.period_index - b.period_index
    );
}

/**
 * The categories a review is actually rated on.
 *
 * Filtered to the review's own scorecard, which is the whole point: a warehouse
 * clerk's form asks about picking accuracy and a merchandiser's asks about
 * shelf facings, and neither is offered the other's. A null `templateId` yields
 * nothing rather than everything — a review with no scorecard is a review the
 * database would refuse to create today, and showing every category of every
 * scorecard is precisely the behaviour this replaced.
 *
 * Inactive categories are dropped, so retiring one stops it appearing on new
 * reviews. Ratings already given against it survive: the rating rows are
 * untouched and the stored `overall_rating` on a completed review does not move.
 */
export function activeCategories(
  categories: ReviewCategory[],
  templateId: string | null | undefined
): ReviewCategory[] {
  if (!templateId) return [];
  return categories
    .filter((c) => c.active && c.template_id === templateId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Every category on a scorecard, retired ones included, for the settings list. */
export function categoriesOfTemplate(
  categories: ReviewCategory[],
  templateId: string | null | undefined
): ReviewCategory[] {
  if (!templateId) return [];
  return categories
    .filter((c) => c.template_id === templateId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/**
 * The scorecard a new review for this employee would use.
 *
 * The employee's own override first, then their department's. Deliberately no
 * organisation-wide fallback: the database refuses to create a review without a
 * scorecard, and the screens read a null here as "HR has not said what this
 * person is reviewed on" — which is a sentence somebody can act on, unlike a
 * default nobody chose.
 *
 * An inactive scorecard resolves to null. Retiring one has to stop new reviews
 * being written against it, or retiring it means nothing.
 */
export function resolveTemplateId(
  employee: { review_template_id?: string | null; department_id?: string | null } | null,
  departments: Department[],
  templates: ReviewTemplate[]
): string | null {
  if (!employee) return null;
  const id =
    employee.review_template_id ??
    departments.find((d) => d.id === employee.department_id)?.review_template_id ??
    null;
  if (!id) return null;
  return templates.some((t) => t.id === id && t.active) ? id : null;
}

/** A scorecard's name, or an em dash. Never throws on a retired or missing one. */
export function templateName(
  templates: ReviewTemplate[],
  id: string | null | undefined
): string {
  if (!id) return "—";
  return templates.find((t) => t.id === id)?.name ?? "—";
}

export function activeTemplates(templates: ReviewTemplate[]): ReviewTemplate[] {
  return templates
    .filter((t) => t.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/**
 * What the total *would* be, shown live while a manager fills the form.
 *
 * Deliberately the same weighted mean the trigger computes, and deliberately
 * not saved. If these two ever disagree the database is right — this is a
 * preview of a number somebody else owns.
 */
export function previewOverall(
  categories: ReviewCategory[],
  ratings: Map<string, number>
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const c of categories) {
    const r = ratings.get(c.id);
    if (r == null) continue;
    weighted += r * Number(c.weight);
    weight += Number(c.weight);
  }
  if (weight === 0) return null;
  return Math.round((weighted / weight) * 100) / 100;
}
