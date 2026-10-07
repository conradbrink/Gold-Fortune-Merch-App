import { DEFAULT_TERMS, lower, type Terms } from "@/lib/terms";

/**
 * The catalogue of things a form question can measure.
 *
 * `form_fields.metric_key` is the *only* link between a question and an
 * analytic. The RPCs match on the literal key and never on the label, so a
 * question with `metric_key = null` is invisible to every dashboard card no
 * matter what it is called — which is why this has to be a picker in the
 * builder and not free text.
 *
 * Three database facts make the list below closed rather than advisory:
 *
 * 1. `form_fields_metric_key_check` allows exactly these ten keys. Anything
 *    else is refused on insert.
 * 2. Each RPC reads one *column* — `value_boolean`, `value_number` or
 *    `value_text` — and the mobile app decides which column an answer lands in
 *    purely from `field_type`. Link `in_stock` to a text question and the
 *    answer goes to `value_text`, where nothing looks for it: no error, no
 *    warning, just a card that stays empty. Hence `fieldTypes`.
 * 3. `form_fields_template_metric_idx` is unique on
 *    `(form_template_id, metric_key) where metric_key is not null`, so a metric
 *    belongs to exactly one question per form. The builder disables a key another
 *    question already holds rather than let the save fail on a duplicate key.
 */

export type MetricKey =
  | "in_stock"
  | "facings"
  | "shelf_position"
  | "planogram_ok"
  | "price_correct"
  | "promo_display"
  | "damaged_expired"
  | "coupons"
  | "oos_skus"
  | "pos_materials";

export type FormFieldType =
  | "text"
  | "number"
  | "photo"
  | "multiple_choice"
  | "boolean"
  | "date";

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  /** What the answer becomes once it reaches a card. */
  description: string;
  /**
   * Field types whose answer lands in the column this metric reads. Choosing
   * any other type would file the answer where the RPC does not look.
   */
  fieldTypes: FormFieldType[];
  /**
   * The dashboard and report cards that read this key today. **Empty means
   * nothing reads it yet** — the key is allowed by the constraint and will be
   * stored, but no card will move. Saying so is better than implying a link
   * that does not exist.
   */
  feeds: string[];
  /**
   * Set when the RPC compares the answer to a literal string. The question's
   * options must contain this exact value or the metric counts zero of
   * everything while looking perfectly healthy.
   */
  requiredOption?: string;
  /** Set when a "yes" is the bad outcome, which is easy to get backwards. */
  invertedNote?: string;
};

/**
 * Ordered so the keys that actually drive cards come first.
 *
 * A function of the company's words because the card names and notes say
 * "store" at Gold Fortune and whatever a site is called elsewhere. Keys,
 * labels and field types are the same for everyone.
 */
export function metricDefinitions(t: Terms): MetricDefinition[] {
  const perfect = `Perfect ${t.site.one}`;
  const site = lower(t.site.one);
  return [
    {
      key: "in_stock",
      label: "Product in stock",
      description:
        "A yes/no availability check. Every “no” is one out-of-stock observation.",
      fieldTypes: ["boolean"],
      feeds: [
        "Out of Stock Rate",
        `Availability (${perfect})`,
        "Out-of-stock hotspots",
        "Compliance trend",
      ],
    },
    {
      key: "facings",
      label: "Number of facings",
      description: "Counted shelf facings, averaged across audits.",
      fieldTypes: ["number"],
      feeds: ["Average facings", "Compliance trend"],
    },
    {
      key: "planogram_ok",
      label: "Planogram compliant",
      description: "A yes/no compliance check. The rate of “yes” is the score.",
      fieldTypes: ["boolean"],
      feeds: [
        "Planogram compliance",
        `Planogram (${perfect})`,
        "Compliance trend",
      ],
    },
    {
      key: "price_correct",
      label: "Shelf price correct",
      description:
        "Counts only the answer “Correct” as compliant, so the other options can name what was wrong.",
      fieldTypes: ["multiple_choice"],
      requiredOption: "Correct",
      feeds: [`Price accuracy (${perfect})`, "Compliance trend"],
    },
    {
      key: "damaged_expired",
      label: "Damaged or expired stock",
      description: "A yes/no condition check.",
      fieldTypes: ["boolean"],
      invertedNote: `“Yes” counts against the ${site} — it means damage was found.`,
      feeds: [`Stock condition (${perfect})`],
    },
    {
      key: "oos_skus",
      label: "Which SKUs were out of stock",
      description:
        `Free text. Answers are tallied verbatim, so the top five per ${site} can be listed.`,
      fieldTypes: ["text"],
      feeds: ["Out-of-stock hotspots — top SKUs"],
    },
    {
      key: "shelf_position",
      label: "Shelf position",
      description: "Where on the shelf the product sits.",
      fieldTypes: ["multiple_choice"],
      feeds: [],
    },
    {
      key: "promo_display",
      label: "Promotional display present",
      description: "A yes/no check for a promotional display.",
      fieldTypes: ["boolean"],
      feeds: [],
    },
    {
      key: "pos_materials",
      label: "Point-of-sale materials",
      description: "How much of the point-of-sale material is in place.",
      fieldTypes: ["multiple_choice"],
      feeds: [],
    },
    {
      key: "coupons",
      label: "Coupons available",
      description: "A yes/no check for coupons at the till.",
      fieldTypes: ["boolean"],
      feeds: [],
    },
  ];
}

/**
 * For the lookups whose answer does not depend on the words — a metric's
 * label and the field types it reads.
 */
const BY_KEY = new Map<string, MetricDefinition>(
  metricDefinitions(DEFAULT_TERMS).map((m) => [m.key, m])
);

export function findMetric(key: string | null, t: Terms): MetricDefinition | null {
  if (!key || !BY_KEY.has(key)) return null;
  return metricDefinitions(t).find((m) => m.key === key) ?? null;
}

/**
 * The metric's name, falling back to the raw key.
 *
 * A key stored before this catalogue existed, or one added to the database
 * constraint without being added here, should still render as itself rather
 * than disappear from the row it is attached to.
 */
export function metricLabel(key: string | null): string {
  return (key ? BY_KEY.get(key)?.label : undefined) ?? key ?? "";
}

/** The metrics a question of this type can actually feed. */
export function metricsForFieldType(fieldType: string, t: Terms): MetricDefinition[] {
  return metricDefinitions(t).filter((m) =>
    m.fieldTypes.includes(fieldType as FormFieldType)
  );
}

/**
 * The reason this pairing will not measure what it claims, or null if it will.
 *
 * Checked in the builder rather than left to the database: every one of these
 * saves cleanly and then reports nothing, which is the failure mode a manager
 * has no way to diagnose.
 */
export function metricMismatch(
  key: string | null,
  fieldType: string,
  options: string[]
): string | null {
  const metric = key ? BY_KEY.get(key) : undefined;
  if (!metric) return null;

  if (!metric.fieldTypes.includes(fieldType as FormFieldType)) {
    const names = metric.fieldTypes.map(fieldTypeLabel).join(" or ");
    return `${metric.label} is only read from a ${names} question, so this answer would not reach it.`;
  }

  if (
    metric.requiredOption &&
    !options.some((o) => o === metric.requiredOption)
  ) {
    return `${metric.label} counts only the answer “${metric.requiredOption}”, so one option must be spelled exactly that.`;
  }

  return null;
}

export const fieldTypeLabels: Record<string, string> = {
  text: "Text",
  number: "Number",
  photo: "Photo",
  multiple_choice: "Multiple choice",
  boolean: "Yes / No",
  date: "Date",
};

export function fieldTypeLabel(fieldType: string): string {
  return fieldTypeLabels[fieldType] ?? fieldType;
}
