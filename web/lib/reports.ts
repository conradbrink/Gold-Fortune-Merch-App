import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import type { DateRange } from "@/lib/date-range";

/**
 * Report fetchers.
 *
 * Every function takes the Supabase client as its first argument rather than
 * constructing one, matching `lib/dashboard.ts` and `lib/activities.ts`. That
 * is what lets the insights Route Handler reuse these unchanged on the server
 * with a cookie-scoped client — the aggregates the manager sees and the
 * aggregates Claude reads come from exactly the same code path.
 *
 * All aggregation happens in Postgres. Pulling `form_responses` to the browser
 * would mean shipping 3,351 rows today and one more per question per visit
 * forever.
 */

export type FieldType = "number" | "boolean" | "multiple_choice" | "photo" | "text";

export type NumberStats = {
  min: number | null;
  avg: number | null;
  max: number | null;
  sum: number | null;
  buckets: { label: string; count: number }[];
};
export type BooleanStats = { yes: number; no: number };
export type ChoiceStats = { options: { option: string; count: number }[] };
export type PhotoStats = { count: number; paths: string[] };
export type TextStats = { recent: { text: string; submitted_at: string }[] };

export type FieldReport = {
  field_id: string;
  label: string;
  field_type: FieldType;
  metric_key: string | null;
  sort_order: number;
  response_count: number;
  stats: NumberStats | BooleanStats | ChoiceStats | PhotoStats | TextStats | null;
};

/**
 * One form field's aggregate as a line of prose, for an export cell.
 *
 * Exists because the export used to write `JSON.stringify(field.stats)` into
 * the Summary column, which put `{"recent":[{"text":"None","submitted_at":
 * "2026-08-27T16:50:42.562945+00:00"}]}` in front of whoever opened the file.
 * It also wrecked the PDF: autoTable sizes columns by content, so a 400-
 * character cell took the whole page width and broke "Question", "Type" and
 * "Answers" mid-word in the header.
 *
 * The on-screen version of this is `FieldReportCard`, which draws charts. This
 * is the same information for a medium that has no charts, and the two are
 * deliberately separate — a component that returned both JSX and a string
 * would serve neither well.
 */
export function summariseFieldStats(field: FieldReport): string {
  const { field_type, stats, response_count } = field;
  if (!stats || response_count === 0) return "No answers";

  switch (field_type) {
    case "number": {
      const s = stats as NumberStats;
      const n = (v: number | null) => (v === null || v === undefined ? "—" : String(Number(v)));
      return `min ${n(s.min)} · avg ${n(s.avg)} · max ${n(s.max)} · total ${n(s.sum)}`;
    }
    case "boolean": {
      const s = stats as BooleanStats;
      const yes = Number(s.yes ?? 0);
      const no = Number(s.no ?? 0);
      const total = yes + no;
      if (total === 0) return "No answers";
      const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
      return `Yes ${yes} (${pct(yes)}) · No ${no} (${pct(no)})`;
    }
    case "multiple_choice": {
      const s = stats as ChoiceStats;
      const options = s.options ?? [];
      if (options.length === 0) return "No answers";
      // Zero-count options are kept for the same reason the chart keeps them:
      // "nobody ever picks Top shelf" is the finding.
      return options.map((o) => `${o.option} ${o.count}`).join(" · ");
    }
    case "photo": {
      const s = stats as PhotoStats;
      const count = Number(s.count ?? 0);
      return `${count} photo${count === 1 ? "" : "s"}`;
    }
    case "text": {
      const s = stats as TextStats;
      const recent = s.recent ?? [];
      if (recent.length === 0) return "No answers";
      // Newlines are flattened: a rep's multi-line list of out-of-stock SKUs
      // would otherwise blow a table row open in the PDF and break the CSV.
      const answers = recent
        .map((r) => r.text.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      // `form_report` returns the 20 most recent, and twenty joined answers is
      // the same oversized cell that broke the PDF header in the first place —
      // just made of prose instead of JSON. Five and a count, and the Form tab
      // on screen is where you go to read them all.
      const SHOWN = 5;
      const head = answers.slice(0, SHOWN).join(" | ");
      const rest = answers.length - SHOWN;
      return rest > 0 ? `${head} … (+${rest} more)` : head;
    }
    default:
      return "";
  }
}

export type CoverageGap = {
  store_id: string;
  store_name: string;
  store_group: string | null;
  city: string | null;
  state: string | null;
  last_visit_at: string | null;
  days_since: number | null;
  visits_in_period: number;
  /** Comma-joined names of every rep responsible for the store. */
  assigned_reps: string | null;
  assigned_count: number;
};

export type RepScore = {
  rep_id: string;
  rep_name: string | null;
  visits_total: number;
  visits_completed: number;
  completion_rate: number | null;
  avg_duration_seconds: number | null;
  stores_covered: number;
  submissions: number;
  form_compliance_rate: number | null;
  /** Share of check-ins inside the store geofence. Now a pillar of `score`. */
  verified_rate: number | null;
  /**
   * Overall 0–100 rep score: the mean of completion, form compliance and
   * location verification. A pillar with no data is excluded from the mean
   * rather than counted as zero.
   */
  score: number | null;
};

export type TrendPointRow = {
  bucket_start: string;
  submissions: number;
  oos_rate: number | null;
  planogram_rate: number | null;
  price_correct_rate: number | null;
  avg_facings: number | null;
};

export type FormTemplate = { id: string; name: string };

/**
 * Perfect Store index — the FMCG standard composite.
 *
 * A pillar is `null` when it was never measured in the period, and is excluded
 * from `score` rather than counted as zero: a store nobody price-checked has
 * not failed price compliance.
 */
export type PerfectStore = {
  store_id: string;
  store_name: string;
  store_group: string | null;
  audits: number;
  availability_pct: number | null;
  planogram_pct: number | null;
  price_pct: number | null;
  condition_pct: number | null;
  score: number | null;
};

export type OosHotspot = {
  store_id: string;
  store_name: string;
  store_group: string | null;
  checks: number;
  oos_count: number;
  oos_rate: number | null;
  /** Longest unbroken run of visits that found the product out of stock. */
  max_consecutive_oos: number;
  last_oos_at: string | null;
  top_skus: { sku: string; n: number }[];
};

export type Adherence = {
  rep_id: string;
  rep_name: string | null;
  planned: number;
  completed: number;
  missed: number;
  adherence_rate: number | null;
  missed_detail: { store: string; date: string }[];
};

/** Every RPC returns `{data, error}`; surface the message rather than an empty page. */
function unwrap<T>(res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
}

export async function fetchFormTemplates(
  supabase: SupabaseClient
): Promise<FormTemplate[]> {
  const { data, error } = await supabase
    .from("form_templates")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FormTemplate[];
}

export async function fetchFormReport(
  supabase: SupabaseClient,
  templateId: string,
  range: DateRange,
  filters: { repIds?: string[]; storeIds?: string[] } = {}
): Promise<FieldReport[]> {
  return unwrap<FieldReport>(
    await callRpc(supabase, "form_report", {
      p_template_id: templateId,
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_rep_ids: filters.repIds?.length ? filters.repIds : null,
      p_store_ids: filters.storeIds?.length ? filters.storeIds : null,
    })
  );
}

export async function fetchCoverageGaps(
  supabase: SupabaseClient,
  range: DateRange
): Promise<CoverageGap[]> {
  return unwrap<CoverageGap>(
    await callRpc(supabase, "coverage_gaps", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
    })
  );
}

export async function fetchRepScorecard(
  supabase: SupabaseClient,
  range: DateRange
): Promise<RepScore[]> {
  return unwrap<RepScore>(
    await callRpc(supabase, "rep_scorecard", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
    })
  );
}

export async function fetchComplianceTrends(
  supabase: SupabaseClient,
  range: DateRange,
  bucket: "day" | "week" = "day",
  storeGroupId?: string | null
): Promise<TrendPointRow[]> {
  return unwrap<TrendPointRow>(
    await callRpc(supabase, "compliance_trends", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_bucket: bucket,
      p_store_group_id: storeGroupId ?? null,
    })
  );
}

export async function fetchPerfectStoreScore(
  supabase: SupabaseClient,
  range: DateRange
): Promise<PerfectStore[]> {
  return unwrap<PerfectStore>(
    await callRpc(supabase, "perfect_store_score", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
    })
  );
}

export async function fetchOosHotspots(
  supabase: SupabaseClient,
  range: DateRange
): Promise<OosHotspot[]> {
  return unwrap<OosHotspot>(
    await callRpc(supabase, "oos_hotspots", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
    })
  );
}

export async function fetchScheduleAdherence(
  supabase: SupabaseClient,
  range: DateRange
): Promise<Adherence[]> {
  return unwrap<Adherence>(
    await callRpc(supabase, "schedule_adherence", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
    })
  );
}

/** `0.1353` → `13.5%`; null stays an em dash rather than becoming a false 0%. */
export function formatRate(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Human-readable duration: `1h 12m`, `56m`, `45s`.
 *
 * Under a minute falls back to seconds — rounding to the nearest minute turned
 * a 30-second visit into "1m", which reads as a real visit rather than the
 * drive-by it was.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(Number(seconds));
  if (s <= 0) return "—";
  if (s < 60) return `${s}s`;
  // Round to minutes first, or 3599s reads "60m" while 3600s reads "1h 0m".
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
