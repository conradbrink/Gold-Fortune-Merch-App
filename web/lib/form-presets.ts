/**
 * Forms a manager can start from instead of a blank page.
 *
 * A preset is a *starting point*, not a fixed form: it inserts a template and
 * its questions and then gets out of the way — every field can be renamed,
 * reordered, retyped or deleted in the builder afterwards, exactly as if it
 * had been typed by hand. Nothing in the app reads a template back and expects
 * it to still match the blueprint.
 *
 * Kept here rather than seeded into the database because a form is content: a
 * migration that inserted rows would put one org's questions into every
 * environment built from this repo, and could not be re-run once a manager had
 * edited them.
 */

import type { FormFieldType, MetricKey } from "@/lib/metrics";

export type PresetField = {
  label: string;
  field_type: FormFieldType;
  required: boolean;
  /**
   * The choices offered, for `multiple_choice` only. Stored as a JSON array
   * in `form_fields.options` — the builder's comma-separated input is parsed
   * into this shape before it is written, and this is the shape the phone
   * reads.
   */
  options?: string[];
  /**
   * Left `null` on every field of every preset so far, and for the competitor
   * audit that is a decision rather than an omission — see the note on the
   * preset itself.
   */
  metric_key?: MetricKey | null;
};

export type FormPreset = {
  key: string;
  /** What the manager picks in the New form dialog. */
  name: string;
  description: string;
  /** One line under the picker, saying what they are about to get. */
  blurb: string;
  /**
   * Whether the created form blocks check-out. A preset that describes an
   * occasional survey must be optional, or every rep in the country is held at
   * every door until they fill in a form about a shop that may not stock the
   * competitor at all.
   */
  required: boolean;
  fields: PresetField[];
};

/**
 * Competitor price audit.
 *
 * The Price Survey answers "what are OUR lines selling for". This answers a
 * different question — what the shelf next to ours is charging — and it is a
 * separate template rather than more fields on the survey because the two are
 * filled in at different times, by different reps, in different shops, and
 * mixing them makes both exports useless.
 *
 * ⚠️ **Every field's `metric_key` is null, deliberately.** The metric keys are
 * about our own execution: `price_correct` means our price matched the list,
 * `in_stock` means our line was on the shelf, and both feed Perfect Store and
 * the out-of-stock reports. Linking a competitor's price or facings to those
 * keys would fold another brand's shelf into our own compliance figures — a
 * number that looks fine and means nothing. Competitor answers are read
 * through the Form tab and its per-response export, which is where they
 * belong.
 */
const COMPETITOR_PRICE_AUDIT: FormPreset = {
  key: "competitor-price-audit",
  name: "Competitor Price Audit",
  description:
    "Prices, promotions and shelf presence of competing brands, recorded store by store.",
  blurb:
    "Brand, product, price, promotion and a photo — one submission per competitor line seen. Optional, so it never blocks a check-out.",
  required: false,
  fields: [
    { label: "Competitor brand", field_type: "text", required: true },
    { label: "Product name", field_type: "text", required: true },
    { label: "Puffs / size", field_type: "text", required: false },
    // A number, not text, so the export sums and sorts it and the chart on the
    // Form tab is a price distribution rather than a list of strings.
    { label: "Shelf price (BWP)", field_type: "number", required: true },
    { label: "On promotion?", field_type: "boolean", required: false },
    {
      label: "Promotion detail",
      field_type: "text",
      required: false,
    },
    { label: "Facings on shelf", field_type: "number", required: false },
    {
      label: "Shelf position",
      field_type: "multiple_choice",
      required: false,
      options: ["Eye level", "Above eye level", "Below eye level", "Till point", "Not on shelf"],
    },
    { label: "Photo of shelf or price tag", field_type: "photo", required: false },
    { label: "Notes", field_type: "text", required: false },
  ],
};

export const FORM_PRESETS: FormPreset[] = [COMPETITOR_PRICE_AUDIT];

export function findPreset(key: string): FormPreset | undefined {
  return FORM_PRESETS.find((p) => p.key === key);
}
