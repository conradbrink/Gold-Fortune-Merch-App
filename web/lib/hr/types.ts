import type { Tables } from "@/lib/supabase/types";

/**
 * The vocabulary the HR module shares, and the labels it shows.
 *
 * Two kinds of thing live here and it is worth knowing which is which.
 *
 * **Closed sets** — employment status, employment type, leave status, review
 * status — are `check` constraints in the database. The union types below
 * mirror them exactly, so adding a value means changing both, on purpose: each
 * of these appears in a workflow rule that a new value would silently fall
 * through.
 *
 * **Open sets** — incident types, severities, case statuses, warning types,
 * outcomes, document categories — are rows in `hr_lookups` and are NOT typed
 * here. They are configurable by HR at runtime; a union type would be a second
 * copy of a list the customer is invited to edit, and it would be wrong the
 * first time they edited it. Those are plain strings, resolved to labels
 * through `lookupLabel`.
 */

export const HR_BUCKET = "hr-documents";

/** 25 MB, matching the bucket's own `file_size_limit`. */
export const MAX_HR_FILE_BYTES = 26_214_400;

export type Employee = Tables<"hr_employees">;
export type Compensation = Tables<"hr_employee_compensation">;
export type EmployeeAsset = Tables<"hr_employee_assets">;
export type Department = Tables<"hr_departments">;
export type Lookup = Tables<"hr_lookups">;
export type HrSettings = Tables<"hr_settings">;
export type LeaveType = Tables<"hr_leave_types">;
export type LeaveBalanceRow = Tables<"hr_leave_balances">;
export type LeaveRequest = Tables<"hr_leave_requests">;
export type HrDocument = Tables<"hr_documents">;
export type ReviewCategory = Tables<"hr_review_categories">;
export type Review = Tables<"hr_reviews">;
export type ReviewRating = Tables<"hr_review_ratings">;
export type DisciplinaryCase = Tables<"hr_disciplinary_cases">;
export type CaseEvidence = Tables<"hr_case_evidence">;
export type CaseResponse = Tables<"hr_case_responses">;
export type Warning = Tables<"hr_warnings">;
export type HrNotification = Tables<"hr_notifications">;

export type EmploymentStatus =
  | "active"
  | "on_leave"
  | "suspended"
  | "terminated"
  | "resigned"
  | "inactive";

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  suspended: "Suspended",
  terminated: "Terminated",
  resigned: "Resigned",
  inactive: "Inactive",
};

/**
 * Tone per status, used for the pill on a list row.
 *
 * "Terminated" and "resigned" are both endings and only one of them is bad
 * news, so resigned is neutral rather than destructive — the colour should not
 * editorialise about why somebody left.
 */
export const EMPLOYMENT_STATUS_TONE: Record<
  EmploymentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  active: "default",
  on_leave: "secondary",
  suspended: "destructive",
  terminated: "destructive",
  resigned: "outline",
  inactive: "outline",
};

export type EmploymentType =
  | "permanent"
  | "fixed_term"
  | "temporary"
  | "casual"
  | "other";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  permanent: "Permanent",
  fixed_term: "Fixed term",
  temporary: "Temporary",
  casual: "Casual",
  other: "Other",
};

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export type ReviewStatus = "draft" | "completed" | "acknowledged";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  completed: "Completed",
  acknowledged: "Acknowledged",
};

export type ReviewPeriodType = "monthly" | "quarterly" | "six_monthly" | "annual";

export const REVIEW_PERIOD_LABELS: Record<ReviewPeriodType, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  six_monthly: "Six monthly",
  annual: "Annual",
};

/** The five rungs of the 1–5 scale, named as section 7 names them. */
export const RATING_LABELS = [
  "Poor",
  "Needs improvement",
  "Meets expectations",
  "Very good",
  "Excellent",
] as const;

/**
 * The band an overall score falls in.
 *
 * Rounds to the nearest whole rung, so 4.2 reads "Very good" rather than
 * inventing a sixth label for the gap. Returns null rather than a band for a
 * missing score: a review with no ratings has not been judged, and "Poor" is
 * not the honest rendering of that.
 *
 * `scaleMax` exists because the scale is configurable. On a 1–10 scale the
 * bands are stretched proportionally rather than the top five being used and
 * everything below 5 collapsing into "Poor".
 */
export function ratingBand(
  score: number | null | undefined,
  scaleMax = 5
): string | null {
  if (score == null || Number.isNaN(score)) return null;
  const normalised = ((score - 1) / (scaleMax - 1)) * (RATING_LABELS.length - 1);
  const index = Math.min(
    RATING_LABELS.length - 1,
    Math.max(0, Math.round(normalised))
  );
  return RATING_LABELS[index];
}

/** `4.2 / 5`, or an em dash. */
export function formatScore(
  score: number | null | undefined,
  scaleMax = 5
): string {
  if (score == null) return "—";
  return `${Number(score).toFixed(1)} / ${scaleMax}`;
}

export type ExpiryBucket = "expired" | "expiring_7" | "expiring_30" | "valid";

export const EXPIRY_LABELS: Record<ExpiryBucket, string> = {
  expired: "Expired",
  expiring_7: "Expires within 7 days",
  expiring_30: "Expires within 30 days",
  valid: "Valid",
};

/**
 * Which expiry band a date falls in.
 *
 * A null expiry is **valid**, not unknown. Most HR documents genuinely do not
 * expire — a qualification certificate, a signed contract copy — and treating
 * the absence of a date as a problem would fill the dashboard with warnings
 * about paperwork that is fine.
 *
 * Days are counted on calendar dates in the reader's zone, which is what
 * `fromLocalDateInput`-style parsing gives us: `expiry_date` is a date column
 * and means the same calendar day everywhere.
 */
export function expiryBucket(
  expiry: string | null | undefined,
  today = new Date()
): ExpiryBucket {
  if (!expiry) return "valid";
  const [y, m, d] = expiry.split("-").map(Number);
  if (!y || !m || !d) return "valid";
  const end = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= 7) return "expiring_7";
  if (days <= 30) return "expiring_30";
  return "valid";
}

/** `2026 Q3`, `2026 Aug`, `2026 H1`, `2026`. */
export function periodLabel(
  type: string,
  year: number,
  index: number
): string {
  switch (type) {
    case "quarterly":
      return `${year} Q${index}`;
    case "six_monthly":
      return `${year} H${index}`;
    case "monthly": {
      const month = new Date(year, Math.max(0, index - 1), 1);
      return `${year} ${month.toLocaleString(undefined, { month: "short" })}`;
    }
    default:
      return `${year}`;
  }
}

/** How many periods of this type there are in a year. */
export function periodsPerYear(type: string): number {
  switch (type) {
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "six_monthly":
      return 2;
    default:
      return 1;
  }
}

/** The period that contains a given date, for the org's review frequency. */
export function periodIndexOf(type: string, date: Date): number {
  switch (type) {
    case "monthly":
      return date.getMonth() + 1;
    case "quarterly":
      return Math.floor(date.getMonth() / 3) + 1;
    case "six_monthly":
      return date.getMonth() < 6 ? 1 : 2;
    default:
      return 1;
  }
}

/** First and last calendar day of a period, as `YYYY-MM-DD`. */
export function periodBounds(
  type: string,
  year: number,
  index: number
): { start: string; end: string } {
  const monthsPer = 12 / periodsPerYear(type);
  const startMonth = (index - 1) * monthsPer;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + monthsPer, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}

/**
 * The display label for a lookup code, falling back to the code itself.
 *
 * Never throws and never shows a blank. An incident type whose lookup row was
 * deleted still has cases filed under it, and "policy_violation" is a worse
 * label than "Policy Violation" but a much better one than nothing.
 */
export function lookupLabel(lookups: Lookup[], kind: string, code: string | null): string {
  if (!code) return "—";
  return lookups.find((l) => l.kind === kind && l.code === code)?.label ?? code;
}

/** Active rows of one kind, in the order HR put them in. */
export function lookupsOfKind(lookups: Lookup[], kind: string): Lookup[] {
  return lookups
    .filter((l) => l.kind === kind && l.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `7h 42m`, from a seconds count that may be null or fractional. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** `08:57`, from a timestamptz, in the reader's zone. */
export function formatClock(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * PostgREST answers a write that matched no rows with success.
 *
 * A row refused by RLS is therefore indistinguishable from a row that was
 * updated, unless the caller asks for the affected rows back and checks. Every
 * write in this module goes through here, so "saved" on screen means a row
 * really moved.
 */
export function assertAffected(data: unknown[] | null, what: string): void {
  if (!data || data.length === 0) {
    throw new Error(`${what} — you may not have permission.`);
  }
}
