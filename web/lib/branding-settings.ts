/**
 * The checks and plans behind the "Terminology & branding" settings, kept out
 * of the components so they can be tested without a browser.
 *
 * Every check here mirrors one the database makes, and the database stays the
 * judge: `company_terminology_validate` for the words, `company_settings_validate`
 * for the colours, the `branding` bucket's own limits and the
 * `organizations_logo_path_own_folder` constraint for the logo. Checking first
 * only saves a round trip and lets the message sit next to the field.
 */

import type { TermKey } from "@/lib/terms";

// ------------------------------------------------------------------ words

export const TERM_WORD_MAX = 40;

/** What the screen edits for one term: the two words and the article. */
export type TermDraft = {
  one: string;
  many: string;
  article: "a" | "an" | null;
};

/** One row of `term_definitions`, as far as the settings need it. */
export type TermDefinition = {
  key: TermKey;
  singular: string;
  plural: string;
  article: "a" | "an" | null;
};

/** A company's override row, as far as the settings need it. */
export type TermOverride = TermDraft & { key: TermKey };

// Postgres' [:cntrl:] in a UTF-8 database: C0, DEL and C1.
const FORBIDDEN = /[<>{}\u0000-\u001F\u007F-\u009F]/;

/**
 * Why a word would be refused, or null. Same rules and same messages as
 * `company_terminology_validate`, measured in characters as Postgres counts
 * them (an emoji is one, not two).
 */
export function termWordError(word: string): string | null {
  const w = word.trim();
  const length = [...w].length;
  if (length < 1 || length > TERM_WORD_MAX) {
    return `Each word needs between 1 and ${TERM_WORD_MAX} characters.`;
  }
  if (FORBIDDEN.test(w)) return "Words cannot contain < > { } or control characters.";
  return null;
}

/** A field left blank means the default, which is what its placeholder shows. */
export function resolveTermDraft(draft: TermDraft, def: TermDefinition): TermDraft {
  return {
    one: draft.one.trim() || def.singular,
    many: draft.many.trim() || def.plural,
    article: draft.article,
  };
}

function same(a: TermDraft, b: TermDraft): boolean {
  return a.one === b.one && a.many === b.many && a.article === b.article;
}

export type TermPlan = {
  /** Rows to upsert into `company_terminology` (without org_id). */
  upserts: { key: TermKey; singular: string; plural: string; article: "a" | "an" | null }[];
  /** Keys whose override is deleted, which puts them back to the default. */
  deletes: TermKey[];
  /** Field errors by key; when any is present nothing should be saved. */
  errors: Partial<Record<TermKey, string>>;
};

/**
 * What saving the drafts would change. A term that is unchanged is left
 * alone; one edited back to exactly the catalogue's words has its override
 * removed rather than stored, so a later change to the default reaches it.
 */
export function planTermChanges(
  definitions: readonly TermDefinition[],
  overrides: readonly TermOverride[],
  drafts: Partial<Record<TermKey, TermDraft>>
): TermPlan {
  const plan: TermPlan = { upserts: [], deletes: [], errors: {} };
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  for (const def of definitions) {
    const draft = drafts[def.key];
    if (!draft) continue;
    const resolved = resolveTermDraft(draft, def);
    const error = termWordError(resolved.one) ?? termWordError(resolved.many);
    if (error) {
      plan.errors[def.key] = error;
      continue;
    }
    const override = byKey.get(def.key);
    const fallback: TermDraft = { one: def.singular, many: def.plural, article: def.article };
    const current = override ?? fallback;
    if (same(resolved, current)) continue;
    if (same(resolved, fallback)) {
      if (override) plan.deletes.push(def.key);
      continue;
    }
    plan.upserts.push({
      key: def.key,
      singular: resolved.one,
      plural: resolved.many,
      article: resolved.article,
    });
  }
  return plan;
}

// ------------------------------------------------------------------- logo

/** The `branding` bucket's `file_size_limit`. */
export const LOGO_MAX_BYTES = 1024 * 1024;
/**
 * The largest file the browser will try to shrink. Anything bigger is refused
 * before it is decoded; anything between this and the bucket's limit is
 * accepted only if it comes out of the resize under the limit.
 */
export const LOGO_MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** The longest side a logo is stored at: plenty for a sidebar and an invoice. */
export const LOGO_MAX_SIDE = 512;

/** The bucket's `allowed_mime_types`, with the extension each is saved as. */
export const LOGO_TYPES: Readonly<Record<string, "png" | "jpg" | "webp">> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The `accept` attribute for the file input. */
export const LOGO_ACCEPT = Object.keys(LOGO_TYPES).join(",");

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a chosen file cannot be used, before any work is done on it. */
export function logoFileError(file: { type: string; size: number }): string | null {
  if (!(file.type in LOGO_TYPES)) {
    return "The logo must be a PNG, JPEG or WebP image.";
  }
  if (file.size > LOGO_MAX_INPUT_BYTES) {
    return `That image is ${megabytes(file.size)}. Choose one under 1 MB.`;
  }
  return null;
}

/** Why the file about to be uploaded would be refused by the bucket. */
export function logoUploadError(blob: { size: number }): string | null {
  if (blob.size > LOGO_MAX_BYTES) {
    return `The logo must be 1 MB or smaller; this one is ${megabytes(blob.size)} even at ${LOGO_MAX_SIDE} px across. Try saving it as a JPEG or WebP.`;
  }
  return null;
}

/**
 * The size to draw an image at so its longest side is at most `max`, or null
 * when it already fits and should be uploaded as it is.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = LOGO_MAX_SIDE
): { width: number; height: number } | null {
  if (width <= max && height <= max) return null;
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const SUFFIX = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Where a new logo goes: `<org>/logo-<suffix>.<ext>`, the only shape the
 * bucket policy and the `organizations` check constraint accept. A new suffix
 * for every upload, so an issued invoice keeps the file it points at.
 */
export function logoObjectPath(orgId: string, mimeType: string, suffix: string): string {
  const ext = LOGO_TYPES[mimeType];
  if (!ext) throw new Error(`Not a logo type: ${mimeType}`);
  if (!SUFFIX.test(suffix)) throw new Error(`Not a logo name: ${suffix}`);
  return `${orgId}/logo-${suffix}.${ext}`;
}

/** A fresh suffix: the time, for sorting by eye, and some randomness. */
export function newLogoSuffix(now: number = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${now.toString(36)}-${random}`;
}

// ---------------------------------------------------------------- colours

/**
 * A typed colour as the database stores it, "#RRGGBB" in capitals, or null
 * if it is not one. Takes the forms people paste: with or without "#", and
 * the three-digit shorthand.
 */
export function normalizeHex(input: string): string | null {
  const v = input.trim().replace(/^#/, "");
  if (/^[0-9A-Fa-f]{6}$/.test(v)) return `#${v.toUpperCase()}`;
  if (/^[0-9A-Fa-f]{3}$/.test(v)) {
    return `#${[...v].map((c) => c + c).join("").toUpperCase()}`;
  }
  return null;
}
