/**
 * The company's own words for the things the product is about.
 *
 * Requirements (Field Teams Platform, draft v6): "No hard-coded business words
 * in UI, app, reports or PDFs. Use the terminology system." A cleaning company
 * has sites and cleaners where Gold Fortune has stores and reps; the screens
 * say whichever the company chose (`company_terminology`), falling back to the
 * catalogue's neutral default (`term_definitions`).
 *
 * The words arrive with `my_company_config()`. Everything here is pure, so it
 * runs the same in a server component, a client component, an export and a
 * PDF.
 *
 *   t.site.one                 "Store"
 *   count(t, "site", 3)        "3 stores"
 *   withArticle(t, "job")      "a visit"
 *   lower(t.staff.many)        "reps"
 */

export const TERM_KEYS = [
  "site",
  "site_group",
  "job",
  "staff",
  "client",
  "region",
  "territory",
  "prospect",
  "schedule_cycle",
  "day_plan",
  "workday",
] as const;

export type TermKey = (typeof TERM_KEYS)[number];

export type Term = {
  /** Singular, as a label: "Store". */
  one: string;
  /** Plural, as a label: "Stores". */
  many: string;
  /** "a" / "an" when the first letter does not tell; null to decide from it. */
  article: "a" | "an" | null;
};

export type Terms = Record<TermKey, Term>;

/**
 * The catalogue's neutral defaults, mirrored from `term_definitions`. Used
 * before the configuration has loaded and for any key the payload lacks, so a
 * screen never shows `undefined`.
 */
export const DEFAULT_TERMS: Terms = {
  site: { one: "Site", many: "Sites", article: null },
  site_group: { one: "Group", many: "Groups", article: null },
  job: { one: "Job", many: "Jobs", article: null },
  staff: { one: "Staff member", many: "Staff", article: null },
  client: { one: "Client", many: "Clients", article: null },
  region: { one: "Region", many: "Regions", article: null },
  territory: { one: "Territory", many: "Territories", article: null },
  prospect: { one: "Lead", many: "Leads", article: null },
  schedule_cycle: { one: "Recurring schedule", many: "Recurring schedules", article: null },
  day_plan: { one: "Today's jobs", many: "Today's jobs", article: null },
  workday: { one: "Workday", many: "Workdays", article: null },
};

function word(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

/** The `terms` object of the config payload, checked key by key. */
export function parseTerms(raw: unknown): Terms {
  const r =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out = {} as Terms;
  for (const key of TERM_KEYS) {
    const d = DEFAULT_TERMS[key];
    const v =
      r[key] !== null && typeof r[key] === "object" && !Array.isArray(r[key])
        ? (r[key] as Record<string, unknown>)
        : {};
    out[key] = {
      one: word(v.one, d.one),
      many: word(v.many, d.many),
      article: v.article === "a" || v.article === "an" ? v.article : null,
    };
  }
  return out;
}

/**
 * Lower-case a term for use mid-sentence, leaving acronyms alone: "Store" →
 * "store", but "POS outlet" stays "POS outlet" and "ATM" stays "ATM".
 */
export function lower(text: string): string {
  return text
    .split(" ")
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join(" ");
}

/** Capitalise the first letter, for a term that opens a sentence. */
export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every word capitalised, for titles: "Call cycle" → "Call Cycle". */
export function title(text: string): string {
  return text
    .split(" ")
    .map((w) => capital(w))
    .join(" ");
}

/** "a" or "an" for a term, the company's override first. */
export function article(term: Term): "a" | "an" {
  if (term.article) return term.article;
  return /^[aeiou]/i.test(term.one) ? "an" : "a";
}

/** "a store", "an outlet": the singular, lower-case, with its article. */
export function withArticle(t: Terms, key: TermKey): string {
  const term = t[key];
  return `${article(term)} ${lower(term.one)}`;
}

/**
 * A count with the right form: "1 store", "3 stores", "0 stores". Lower-case,
 * for running text; `{ label: true }` keeps the label's capital ("3 Stores").
 */
export function count(
  t: Terms,
  key: TermKey,
  n: number,
  opts: { label?: boolean } = {}
): string {
  const term = t[key];
  const w = n === 1 ? term.one : term.many;
  return `${n.toLocaleString()} ${opts.label ? w : lower(w)}`;
}

/**
 * The word alone in the form a number calls for, lower-case for running text:
 * noun(t, "site", 1) → "store", noun(t, "site", 3) → "stores". For "3 stores"
 * with the number, use `count`.
 */
export function noun(t: Terms, key: TermKey, n: number): string {
  return lower(n === 1 ? t[key].one : t[key].many);
}

/** "Store's", "Reps'": the possessive of a singular or plural label. */
export function possessive(text: string): string {
  return /s$/i.test(text) ? `${text}'` : `${text}'s`;
}
