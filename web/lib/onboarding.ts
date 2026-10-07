import { TERM_KEYS, type TermKey, type Terms } from "@/lib/terms";

/**
 * The trial countdown and the getting-started list (Stage 5).
 *
 * Pure, so the dashboard cards and their tests share it. The facts come from
 * the database — `company_account.trial_ends_at` and `my_onboarding()` — and the
 * list's titles are data too (`onboarding_steps`), naming things through the
 * company's own words with tokens such as `{site.many|lower}`.
 */

const TOKEN = /\{([a-z_]+)\.(one|many)(\|lower)?\}/g;

function isTermKey(key: string): key is TermKey {
  return (TERM_KEYS as readonly string[]).includes(key);
}

/** `{staff.many|lower}` → "cleaners". An unknown term is left as written, so a typo shows rather than vanishing. */
export function fillTermTokens(text: string, terms: Terms): string {
  return text.replace(TOKEN, (whole, key: string, form: "one" | "many", lower?: string) => {
    if (!isTermKey(key)) return whole;
    const word = terms[key][form];
    return lower ? word.toLowerCase() : word;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How the trial banner looks: counting down, nearly over, or over. */
export type TrialState =
  | { kind: "none" }
  | { kind: "active"; daysLeft: number }
  | { kind: "ending"; daysLeft: number }
  | { kind: "ended" };

/**
 * Days left are whole days rounded up, so a trial that ends this evening still
 * says "1 day left" until it has ended. "Ending" is the last three days.
 */
export function trialState(trialEndsAt: string | null | undefined, now: Date = new Date()): TrialState {
  if (!trialEndsAt) return { kind: "none" };
  const ends = new Date(trialEndsAt).getTime();
  if (Number.isNaN(ends)) return { kind: "none" };
  const left = ends - now.getTime();
  if (left <= 0) return { kind: "ended" };
  const daysLeft = Math.ceil(left / DAY_MS);
  return daysLeft <= 3 ? { kind: "ending", daysLeft } : { kind: "active", daysLeft };
}

export type OnboardingStep = { code: string; title: string; description: string; href: string; done: boolean };
export type Onboarding = { dismissedAt: string | null; steps: OnboardingStep[] };

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** `my_onboarding()`, checked field by field. A step without a code or a link is dropped. */
export function parseOnboarding(raw: unknown): Onboarding {
  const r = obj(raw);
  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => {
      const o = obj(s);
      return {
        code: typeof o.code === "string" ? o.code : "",
        title: typeof o.title === "string" ? o.title : "",
        description: typeof o.description === "string" ? o.description : "",
        href: typeof o.href === "string" && o.href.startsWith("/") ? o.href : "",
        done: o.done === true,
      };
    })
    .filter((s) => s.code && s.href && s.title);
  return { dismissedAt: typeof r.dismissed_at === "string" ? r.dismissed_at : null, steps };
}

/** Whether the card shows: not put away, and something still to do. */
export function showOnboarding(o: Onboarding): boolean {
  return o.dismissedAt === null && o.steps.some((s) => !s.done);
}
