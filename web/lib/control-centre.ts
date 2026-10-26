import { CONTROL_CENTRE_OWNER_SETTINGS, TICKD_RULES } from "@/lib/settings-tabs";
import { trialState } from "@/lib/onboarding";

/**
 * The Control Centre's half of a company's set-up (owner, 22 Oct 2026): what
 * Tickd configures for a customer, so the customer's own Settings can stay
 * short. Pure, so the operator's page, its actions and the tests agree.
 *
 * Settings the operator may change: every `internal` one (the database
 * says which), the rules moved off the customer's Settings (internal once
 * 20261022230000_tickd_sets_up_the_rules is applied, and editable here
 * before that too), and the customer's own settings whose detail only shows
 * here (how they get paid, the exact alert rules).
 */
export const CONTROL_CENTRE_SETTINGS: readonly string[] = [...TICKD_RULES, ...CONTROL_CENTRE_OWNER_SETTINGS];

export function operatorMayChange(key: string, audience: string): boolean {
  return audience === "internal" || CONTROL_CENTRE_SETTINGS.includes(key);
}

/** Where the customer can change a setting too, in a simpler form, or null when only Tickd does. */
export function customerAlsoSets(key: string): string | null {
  if (key === "alerts_on" || key === "alerts_email") return "their switches on Notifications";
  if (key.startsWith("money_")) return "their set-up wizard";
  return null;
}

/** The Control Centre's groups of settings, in the order the page shows them. */
export const SETTING_GROUPS: { id: string; title: string; match: (key: string) => boolean }[] = [
  {
    id: "hours",
    title: "Hours and overtime",
    match: (k) => (k.startsWith("report_") && k.endsWith("_hours")) || k === "report_sunday_is_overtime",
  },
  {
    id: "visits",
    title: "Check-ins and tracking",
    match: (k) => ["short_visit_minutes", "gps_ping_interval_minutes", "off_site_distance_m", "invalid_gps_distance_m"].includes(k),
  },
  { id: "alerts", title: "Alerts", match: (k) => k.startsWith("alerts_") },
  { id: "orders", title: "Orders and ranges", match: (k) => k === "reorder_after_days" || k.startsWith("range_") },
  {
    id: "dashboard",
    title: "Dashboard and reports",
    match: (k) => ["dashboard_cards", "dashboard_layout", "report_tabs", "staff_score_weights"].includes(k),
  },
  { id: "money", title: "How they get paid", match: (k) => k.startsWith("money_") },
  { id: "documents", title: "Documents", match: (k) => k === "document_style" },
];

/** Settings split into the page's groups, each in the order given; anything unknown goes last, under Other. */
export function groupSettings<T extends { key: string }>(settings: readonly T[]): { id: string; title: string; settings: T[] }[] {
  const out = SETTING_GROUPS.map((g) => ({ id: g.id, title: g.title, settings: [] as T[] }));
  const other: T[] = [];
  for (const s of settings) {
    const i = SETTING_GROUPS.findIndex((g) => g.match(s.key));
    if (i >= 0) out[i].settings.push(s);
    else other.push(s);
  }
  if (other.length > 0) out.push({ id: "other", title: "Other", settings: other });
  return out.filter((g) => g.settings.length > 0);
}

/**
 * The choices a setting's pattern allows when it is a plain list
 * (`^(classic|bold|clean)$`), so the operator picks one instead of typing
 * it; null for any other pattern.
 */
export function patternChoices(pattern: string | null | undefined): string[] | null {
  const m = /^\^\(([a-z0-9_]+(?:\|[a-z0-9_]+)+)\)\$$/.exec(pattern ?? "");
  return m ? m[1].split("|") : null;
}

/** A setting's value as the operator's field shows it. */
export function settingText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The value an operator's typed text stands for, by the setting's type, or
 * an error to show. The database still checks ranges and patterns, and says
 * what is wrong.
 */
export function parseSettingValue(valueType: string, raw: string): { value: string | number | boolean } | { error: string } {
  const text = raw.trim();
  if (valueType === "integer") {
    return /^-?\d+$/.test(text) ? { value: Number(text) } : { error: "Enter a whole number." };
  }
  if (valueType === "boolean") {
    if (text === "true" || text === "false") return { value: text === "true" };
    return { error: "Choose yes or no." };
  }
  if (valueType === "time") {
    // A time field may send seconds ("17:30:00"); the setting keeps HH:MM.
    return /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(text)
      ? { value: text.slice(0, 5) }
      : { error: "Enter a time like 17:30." };
  }
  return { value: text };
}

/** The columns on `organizations` the Control Centre keeps for a company. */
export const RECORD_FIELDS = [
  "industry",
  "registration_number",
  "tax_number",
  "vat_number",
  "vat_rate",
  "prices_include_vat",
  "invoice_terms_days",
  "invoice_prefix",
  "quote_prefix",
  "quote_validity_days",
  "invoice_footer",
  "bank_details",
  "default_visit_frequency",
] as const;

export type RecordField = (typeof RECORD_FIELDS)[number];

export type CompanyRecordUpdate = {
  industry: string | null;
  registration_number: string | null;
  tax_number: string | null;
  vat_number: string | null;
  vat_rate: number;
  prices_include_vat: boolean;
  invoice_terms_days: number;
  invoice_prefix: string;
  quote_prefix: string;
  quote_validity_days: number;
  invoice_footer: string | null;
  bank_details: string | null;
  default_visit_frequency: "weekly" | "biweekly" | "monthly";
};

/**
 * The company record from the operator's form, checked the way the
 * customer's own screens checked it before it moved here (the set-up wizard
 * still checks it the same way). Blank text is stored as nothing.
 */
export function parseCompanyRecord(form: (key: RecordField) => string): { update: CompanyRecordUpdate } | { error: string } {
  const text = (k: RecordField) => form(k).trim();
  const orNull = (k: RecordField) => text(k) || null;
  const whole = (k: RecordField) => (/^\d+$/.test(text(k)) ? Number(text(k)) : NaN);

  const vat = text("vat_rate") === "" ? NaN : Number(text("vat_rate"));
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) {
    return { error: "The VAT rate is a percentage from 0 to 100. Use 0 if they are not registered for VAT." };
  }
  const terms = whole("invoice_terms_days");
  if (!Number.isInteger(terms) || terms > 365) return { error: "Invoices are due 0 to 365 days after they are issued." };
  const validity = whole("quote_validity_days");
  if (!Number.isInteger(validity) || validity > 365) return { error: "Quotes are valid for 0 to 365 days." };
  const invoicePrefix = text("invoice_prefix").toUpperCase();
  const quotePrefix = text("quote_prefix").toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(invoicePrefix) || !/^[A-Z]{2,6}$/.test(quotePrefix)) {
    return { error: "A prefix is two to six capital letters, like INV or QT." };
  }
  const frequency = text("default_visit_frequency");
  if (frequency !== "weekly" && frequency !== "biweekly" && frequency !== "monthly") {
    return { error: "Choose the default visit frequency." };
  }
  return {
    update: {
      industry: orNull("industry"),
      registration_number: orNull("registration_number"),
      tax_number: orNull("tax_number"),
      vat_number: orNull("vat_number"),
      vat_rate: vat,
      prices_include_vat: text("prices_include_vat") === "true",
      invoice_terms_days: terms,
      invoice_prefix: invoicePrefix,
      quote_prefix: quotePrefix,
      quote_validity_days: validity,
      invoice_footer: orNull("invoice_footer"),
      bank_details: orNull("bank_details"),
      default_visit_frequency: frequency,
    },
  };
}

/** The `company_account` columns the company page's pilot line reads. */
export type OperatorAccount = {
  status: string;
  trial_ends_at: string | null;
  period: string | null;
  period_end: string | null;
};

/**
 * Where a company stands with its free pilot, for the operator's company
 * page, and which button it gets:
 *   extend  on its pilot, or locked after it without paying: more days, and
 *           back on its pilot (`billing_operator_extend_trial`)
 *   start   free by arrangement (exempt, or no account row yet): a pilot of
 *           that many days (`billing_operator_set_exempt`, off)
 *   null    it has paid for a plan, or is closed: nothing to extend
 * Paying leaves `trial_ends_at` as it was, so the status decides, as
 * `pilotState` does on the company's own screens. "Paid" is what the
 * database's own check refuses: active, past_due or cancelled, or a plan
 * period behind it.
 */
export type PilotStanding = { text: string; button: "extend" | "start" | null };

const pilotDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const when = (iso: string) => `${pilotDate.format(new Date(iso))} UTC`;

export function pilotStanding(account: OperatorAccount | null, closed: boolean, now: Date): PilotStanding {
  if (closed) return { text: "Closed, so its pilot can't be changed.", button: null };
  if (!account || account.status === "exempt") {
    return { text: "Free by arrangement: not on a pilot and not paying.", button: "start" };
  }
  const paid = ["active", "past_due", "cancelled"].includes(account.status) || account.period !== null;
  if (paid) {
    const until = account.period_end ? ` (paid up to ${when(account.period_end)})` : "";
    if (account.status === "active") return { text: `Paying${until}.`, button: null };
    if (account.status === "past_due") return { text: `Paying, but the last payment didn't go through${until}.`, button: null };
    if (account.status === "cancelled") return { text: `Cancelled its plan${until}.`, button: null };
    if (account.status === "read_only") return { text: `Read-only: its plan wasn't paid${until}.`, button: null };
    return { text: `Has had a paid plan${until}.`, button: null };
  }
  if (account.status === "read_only") {
    return {
      text: account.trial_ends_at
        ? `Read-only since its free pilot ended ${when(account.trial_ends_at)}, and it hasn't paid. Extending unlocks it.`
        : "Read-only, and it hasn't paid. Extending unlocks it.",
      button: "extend",
    };
  }
  if (account.status !== "trial") return { text: `Account status: ${account.status}.`, button: null };
  const trial = trialState(account.trial_ends_at, now);
  if (trial.kind === "none") return { text: "On a free pilot with no end date.", button: "extend" };
  if (trial.kind === "ended") {
    return { text: `Free pilot ended ${when(account.trial_ends_at!)}, and it hasn't paid yet.`, button: "extend" };
  }
  const left = `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left`;
  return { text: `Free pilot ends ${when(account.trial_ends_at!)} (${left}).`, button: "extend" };
}
