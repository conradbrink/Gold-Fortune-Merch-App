import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { DateRange } from "@/lib/date-range";
import { lower, type Terms } from "@/lib/terms";

/**
 * The staff score: parts and weights per trade, as data (`staff_score_weights`,
 * seeded from the industry research), weighed by one engine for the {Staff}
 * tab and the employee report.
 *
 * The research's fairness rules (INDUSTRY-REPORTS-RESEARCH.md, "Score engine"):
 * - a part needs at least `MIN_EVENTS` events, or it shows "not enough data"
 *   rather than 0% or 100%;
 * - a part nothing measures yet shows "not measured yet", says what would
 *   measure it, and its weight is spread over the rest;
 * - output ({jobs} a day, time on site) is compared with the team's middle
 *   person and capped at 100, never with one fixed target;
 * - a check-in without a GPS fix is unknown, never a fail;
 * - planned work on approved leave days leaves the score;
 * - no part may reward reporting less (incidents, defects, failure reasons):
 *   the catalogue has none, and a test fails if one is added.
 */

export const MIN_EVENTS = 5;

/** One row of `staff_score_inputs()`: every count a part needs, per person. */
export type StaffScoreInputs = Database["public"]["Functions"]["staff_score_inputs"]["Returns"][number];

export async function fetchStaffScoreInputs(
  supabase: SupabaseClient<Database>,
  range: DateRange,
  territoryId: string | null = null
): Promise<StaffScoreInputs[]> {
  const { data, error } = await supabase.rpc("staff_score_inputs", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_territory_id: territoryId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** A part's result: 0-100, how many events it rests on, and how it was arrived at. */
export type PartValue = { value: number | null; events: number | null; basis: string };

type Measure = (me: StaffScoreInputs, team: readonly StaffScoreInputs[], t: Terms) => PartValue;

export type ScorePart = {
  code: string;
  label: (t: Terms) => string;
  /** How Tickd measures it today; absent when it needs data Tickd does not record yet. */
  measure?: Measure;
  /** For a stand-in: what is measured instead, until the real data exists. */
  standIn?: string;
  /** What would measure it, for a part with no measure yet. */
  needs?: string;
  /**
   * Measured by the employee report from its own sources only (sales, retail
   * audits), so the {Staff} tab, which scores everyone at once, cannot.
   */
  reportOnly?: boolean;
};

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Planned work done, with planned work on approved leave days left out. */
export function completion(me: StaffScoreInputs, t: Terms): PartValue {
  const planned = me.planned - me.leave_planned;
  const served = me.served - me.leave_served;
  const jobs = lower(t.job.many);
  const leave = me.leave_planned > 0 ? `; ${me.leave_planned} on approved leave left out` : "";
  return { value: pct(served, planned), events: planned, basis: `${served} of ${planned} planned ${jobs} done${leave}` };
}

const proof: Measure = (me, _team, t) => ({
  value: pct(me.proven, me.finished),
  events: me.finished,
  basis: `${me.proven} of ${me.finished} finished ${lower(t.job.many)} with a photo and a checklist`,
});

const gpsVerified: Measure = (me) => ({
  value: pct(me.inside, me.with_fix),
  events: me.with_fix,
  basis: `${me.inside} of ${me.with_fix} check-ins with a GPS fix were on site; check-ins without a fix are not counted`,
});

/** A person's own figure against the team's middle person, capped at 100. */
function againstMedian(
  me: StaffScoreInputs,
  team: readonly StaffScoreInputs[],
  own: (r: StaffScoreInputs) => number | null,
  events: (r: StaffScoreInputs) => number,
  describe: (mine: number, middle: number) => string
): PartValue {
  const mine = own(me);
  const middle = median(team.map(own).filter((v): v is number => v !== null));
  if (mine === null || middle === null || middle <= 0) {
    return { value: null, events: events(me), basis: "Nothing to compare yet" };
  }
  return { value: Math.min(100, (mine / middle) * 100), events: events(me), basis: describe(mine, middle) };
}

const onsiteShare: Measure = (me, team) =>
  againstMedian(
    me,
    team,
    (r) => (r.workday_seconds > 0 ? Math.min(1, r.onsite_seconds / r.workday_seconds) : null),
    (r) => r.workdays,
    (mine, middle) =>
      `${Math.round(mine * 100)}% of the workday on site, against the team's middle ${Math.round(middle * 100)}%`
  );

const jobsPerDay: Measure = (me, team, t) =>
  againstMedian(
    me,
    team,
    (r) => (r.staff_days > 0 ? r.finished / r.staff_days : null),
    (r) => r.staff_days,
    (mine, middle) =>
      `${mine.toFixed(1)} ${lower(t.job.many)} a day, against the team's middle ${middle.toFixed(1)}`
  );

const PHOTO_AND_CHECKLIST = "For now: a photo and a checklist on each finished job";
const RETURNS = "Needs a return to the same job to be marked as one";

/** Every part a trade's weights may name. */
export const SCORE_PARTS: ScorePart[] = [
  // Today's parts (the employee report's own five, Gold Fortune's weights).
  { code: "sales", label: () => "Sales performance", reportOnly: true },
  { code: "visits", label: (t) => `${t.job.one} completion`, measure: (me, _team, t) => completion(me, t) },
  {
    code: "coverage",
    label: (t) => `${t.site.one} coverage`,
    measure: (me, _team, t) => ({
      value: pct(me.sites_reached, me.sites_planned),
      events: me.sites_planned,
      basis: `${me.sites_reached} of ${me.sites_planned} planned ${lower(t.site.many)} reached at least once`,
    }),
  },
  { code: "merchandising", label: () => "Merchandising execution", reportOnly: true },
  {
    code: "compliance",
    label: () => "App / data compliance",
    measure: (me) => {
      const parts = [pct(me.with_form, me.finished), pct(me.inside, me.with_fix)].filter((v): v is number => v !== null);
      return {
        value: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null,
        events: me.finished,
        basis: "Mean of form completion per job and GPS-verified check-ins",
      };
    },
  },
  // The research's parts, measurable today.
  { code: "completion", label: () => "Done as planned", measure: (me, _team, t) => completion(me, t) },
  { code: "proof", label: () => "Proof captured", measure: proof },
  { code: "gps_verified", label: () => "Checked in on site", measure: gpsVerified },
  { code: "onsite_share", label: () => "Time on site", measure: onsiteShare },
  { code: "jobs_per_day", label: (t) => `${t.job.many} a day`, measure: jobsPerDay },
  {
    code: "reporting",
    label: () => "Reporting",
    measure: (me, _team, t) => ({
      value: pct(me.with_form, me.finished),
      events: me.finished,
      basis: `${me.with_form} of ${me.finished} finished ${lower(t.job.many)} with a checklist`,
    }),
  },
  // Stand-ins the owner approved (8 Oct): measured another way until the data exists.
  { code: "paperwork", label: () => "Paperwork and proof", measure: proof, standIn: PHOTO_AND_CHECKLIST },
  { code: "handover", label: () => "Handover complete", measure: proof, standIn: PHOTO_AND_CHECKLIST },
  { code: "treatment_records", label: () => "Treatment records", measure: proof, standIn: PHOTO_AND_CHECKLIST },
  { code: "delivery_proof", label: () => "Proof of delivery", measure: proof, standIn: PHOTO_AND_CHECKLIST },
  { code: "before_after", label: () => "Before and after photos", measure: proof, standIn: PHOTO_AND_CHECKLIST },
  {
    code: "round_quality",
    label: () => "Round quality",
    standIn: "For now: rounds checked in on site with a photo",
    measure: (me) => ({
      value: pct(me.rounds_proven, me.finished),
      events: me.finished,
      basis: `${me.rounds_proven} of ${me.finished} rounds checked in on site with a photo`,
    }),
  },
  // Needs data Tickd does not record yet (research B1-B10).
  { code: "punctuality", label: () => "Punctuality", needs: "Needs planned start times" },
  { code: "full_time", label: () => "Full time on site", needs: "Needs planned minutes per job" },
  { code: "hours_vs_budget", label: () => "Hours against budget", needs: "Needs planned minutes per job" },
  { code: "hours_vs_quoted", label: () => "Hours against quoted", needs: "Needs jobs linked to their quote" },
  { code: "inspection", label: () => "Inspection score", needs: "Needs inspection forms with scores" },
  { code: "first_time_fix", label: () => "First-time fix", needs: RETURNS },
  { code: "no_returns", label: () => "No returns", needs: RETURNS },
  { code: "no_repeats", label: () => "No repeat faults", needs: RETURNS },
  { code: "no_callbacks", label: () => "No callbacks", needs: RETURNS },
  { code: "quote_conversion", label: () => "Quotes won", needs: "Needs quotes linked to the person who quoted" },
  { code: "response_time", label: () => "Response within the promised time", needs: "Needs a promised response time" },
  { code: "no_long_gaps", label: () => "No long gaps between rounds", needs: "Needs planned round times" },
  { code: "readings", label: () => "Readings every time", needs: "Needs readings with their safe ranges" },
  { code: "back_in_range", label: () => "Back in range", needs: "Needs readings with their safe ranges" },
  { code: "driver_failures", label: () => "Failures the driver caused", needs: "Needs reasons recorded for failed deliveries" },
];

export function findPart(code: string): ScorePart | undefined {
  return SCORE_PARTS.find((p) => p.code === code);
}

export type Weight = { code: string; weight: number };

/** The known parts in a `staff_score_weights` setting, in its order, each once. */
export function parseWeights(setting: string | null | undefined): Weight[] {
  const out: Weight[] = [];
  for (const piece of (setting ?? "").split(",")) {
    const m = /^([a-z_]+):(\d{1,3})$/.exec(piece.trim());
    if (m && findPart(m[1]) && !out.some((w) => w.code === m[1])) out.push({ code: m[1], weight: Number(m[2]) });
  }
  return out;
}

export function weightsTotal(weights: readonly Weight[]): number {
  return weights.reduce((a, w) => a + w.weight, 0);
}

export function weightsSetting(weights: readonly Weight[]): string {
  return weights.map((w) => `${w.code}:${w.weight}`).join(",");
}

/** Whether the {Staff} tab can score these weights for everyone at once. */
export function teamScorable(weights: readonly Weight[]): boolean {
  return weights.length > 0 && weights.every((w) => !findPart(w.code)?.reportOnly);
}

/** Every part's value for one person, from the shared inputs. Report-only parts are left out. */
export function teamValues(me: StaffScoreInputs, team: readonly StaffScoreInputs[], t: Terms): Record<string, PartValue> {
  const out: Record<string, PartValue> = {};
  for (const p of SCORE_PARTS) {
    if (p.measure) out[p.code] = p.measure(me, team, t);
  }
  return out;
}

export type ScoreState = "scored" | "not_enough" | "not_measured";

export type WeighedPart = {
  key: string;
  label: string;
  /** The published weight, as a percentage. */
  weight: number;
  /** The weight it counts for once unmeasured parts are spread over the rest. */
  effectiveWeight: number;
  /** 0-100 when scored; null otherwise. */
  value: number | null;
  basis: string;
  state: ScoreState;
};

export type Band = "Excellent" | "Good" | "Needs Improvement" | "Poor" | "Not scored";

export type WeighedScore = {
  score: number | null;
  band: Band;
  components: WeighedPart[];
  /** True when at least one part sat out and the rest were re-weighted. */
  reweighted: boolean;
  /** The scored part losing the most points: what to work on next. */
  focus: WeighedPart | null;
};

export function classifyScore(score: number | null): Band {
  if (score === null) return "Not scored";
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Needs Improvement";
  return "Poor";
}

/**
 * The weighing: parts with a value and enough events share the published
 * weight in proportion; the rest show why they sit out. `minEvents` 0 turns
 * the floor off (the employee report's old call form, kept for its tests).
 */
export function weighScore(
  weights: readonly Weight[],
  values: Record<string, PartValue>,
  t: Terms,
  minEvents = MIN_EVENTS
): WeighedScore {
  const parts = weights.map((w) => {
    const p = findPart(w.code);
    const v = values[w.code];
    const label = p ? p.label(t) : w.code;
    let state: ScoreState;
    let basis: string;
    if (!v || v.value === null) {
      state = "not_measured";
      basis = v?.basis ?? p?.needs ?? "Not measured yet";
    } else if (v.events !== null && v.events < minEvents) {
      state = "not_enough";
      basis = `Not enough data: ${v.events} of ${minEvents} needed`;
    } else {
      state = "scored";
      basis = p?.standIn ? `${v.basis}. ${p.standIn}` : v.basis;
    }
    return { key: w.code, label, weight: w.weight, value: state === "scored" ? v!.value : null, basis, state };
  });
  const scoredWeight = parts.filter((p) => p.state === "scored").reduce((a, p) => a + p.weight, 0);
  const components: WeighedPart[] = parts.map((p) => ({
    ...p,
    effectiveWeight: p.state === "scored" && scoredWeight > 0 ? (p.weight / scoredWeight) * 100 : 0,
  }));
  const raw =
    scoredWeight === 0 ? null : components.reduce((a, c) => a + (c.value ?? 0) * (c.effectiveWeight / 100), 0);
  const score = raw === null ? null : Math.round(raw);
  let focus: WeighedPart | null = null;
  let lost = 0;
  for (const c of components) {
    const l = c.state === "scored" ? (100 - (c.value ?? 0)) * c.effectiveWeight : 0;
    if (l > lost) {
      lost = l;
      focus = c;
    }
  }
  return {
    score,
    band: classifyScore(score),
    components,
    reweighted: components.some((c) => c.state === "scored") && components.some((c) => c.state !== "scored"),
    focus,
  };
}

export type TeamScore = { staffId: string; name: string; result: WeighedScore };

/** Everyone's score from the shared inputs, best first; people with no score last. */
export function teamScores(team: readonly StaffScoreInputs[], weights: readonly Weight[], t: Terms): TeamScore[] {
  return team
    .map((me) => ({ staffId: me.staff_id, name: me.staff_name ?? "", result: weighScore(weights, teamValues(me, team, t), t) }))
    .sort((a, b) => (b.result.score ?? -1) - (a.result.score ?? -1) || a.name.localeCompare(b.name));
}
