import type { Json } from "@/lib/supabase/types";

/**
 * The operator's "Add company": what the form holds, how it is checked, and
 * what is sent to `create_company` (supabase/migrations/…_create_company.sql).
 *
 * Pure, so the server action and its tests share it. The database checks
 * everything again — the module guard, the settings and terminology triggers —
 * and refuses the whole creation if anything is wrong; these checks exist so
 * the operator hears about a mistake before a login has been created for it.
 */

export type TemplateModule = { code: string; name: string; built: boolean };
export type TemplateTerm = { one: string; many: string; article: "a" | "an" | null };
export type TemplateChecklist = {
  template: string;
  code: string;
  name: string;
  items: { text: string; required: boolean; photo_required: boolean }[];
};
export type TemplateForm = {
  template: string;
  code: string;
  name: string;
  description: string;
  fields: { label: string; field_type: string; required?: boolean }[];
};

/** `template_defaults()`: the merged proposal for the chosen industries. */
export type TemplateDefaults = {
  templates: { code: string; name: string; version: number }[];
  visitFrequency: string;
  modules: TemplateModule[];
  terms: Record<string, TemplateTerm>;
  settings: Record<string, Json>;
  checklists: TemplateChecklist[];
  forms: TemplateForm[];
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** The RPC payload, checked field by field rather than asserted. */
export function parseTemplateDefaults(raw: unknown): TemplateDefaults {
  const r = obj(raw);
  const terms: Record<string, TemplateTerm> = {};
  for (const [key, value] of Object.entries(obj(r.terms))) {
    const t = obj(value);
    terms[key] = {
      one: str(t.one),
      many: str(t.many),
      article: t.article === "a" || t.article === "an" ? t.article : null,
    };
  }
  return {
    templates: arr(r.templates).map((t) => {
      const o = obj(t);
      return { code: str(o.code), name: str(o.name), version: Number(o.version) || 1 };
    }),
    visitFrequency: str(r.visit_frequency, "monthly"),
    modules: arr(r.modules).map((m) => {
      const o = obj(m);
      return { code: str(o.code), name: str(o.name), built: o.built === true };
    }),
    terms,
    settings: obj(r.settings) as Record<string, Json>,
    checklists: arr(r.checklists).map((c) => {
      const o = obj(c);
      return {
        template: str(o.template),
        code: str(o.code),
        name: str(o.name),
        items: arr(o.items).map((i) => {
          const it = obj(i);
          return { text: str(it.text), required: it.required === true, photo_required: it.photo_required === true };
        }),
      };
    }),
    forms: arr(r.forms).map((f) => {
      const o = obj(f);
      return {
        template: str(o.template),
        code: str(o.code),
        name: str(o.name),
        description: str(o.description),
        fields: arr(o.fields).map((x) => {
          const fx = obj(x);
          return { label: str(fx.label), field_type: str(fx.field_type), required: fx.required === true };
        }),
      };
    }),
  };
}

export type AddCompanyInput = {
  company: {
    name: string;
    legalName: string;
    countryCode: string;
    timezone: string;
    currencyCode: string;
    vatNumber: string;
    address: string;
    phone: string;
    supportEmail: string;
  };
  /** Template codes, primary first. */
  templates: string[];
  modules: string[];
  terms: Record<string, TemplateTerm>;
  settings: Record<string, Json>;
  checklists: string[];
  forms: string[];
  owner: { fullName: string; email: string; password: string };
};

/** A module and what it needs switched on first (`module_dependencies`). */
export type ModuleDependency = { module: string; requires: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every problem with the form, in the order the operator meets them. Empty when it is fine. */
export function addCompanyProblems(input: AddCompanyInput, deps: ModuleDependency[]): string[] {
  const p: string[] = [];
  const c = input.company;
  if (!c.name.trim()) p.push("The company needs a name.");
  // Both required: a blank country would leave address lookups unlimited, and
  // a blank currency would fall back to the catalogue's default — one
  // company's currency, not this one's.
  if (!/^[A-Za-z]{2}$/.test(c.countryCode.trim())) {
    p.push("The country is a two-letter code, such as ZA or BW.");
  }
  if (!/^[A-Za-z]{3}$/.test(c.currencyCode.trim())) {
    p.push("The currency is a three-letter code, such as ZAR or BWP.");
  }
  if (!c.timezone.trim()) p.push("Choose the company's timezone.");
  if (c.supportEmail.trim() && !EMAIL.test(c.supportEmail.trim())) p.push("The company's email address is not valid.");
  if (input.templates.length === 0) p.push("Choose at least one industry.");
  for (const d of deps) {
    if (input.modules.includes(d.module) && !input.modules.includes(d.requires)) {
      p.push(`The ${d.module} module needs ${d.requires} switched on too.`);
    }
  }
  for (const [key, t] of Object.entries(input.terms)) {
    for (const w of [t.one, t.many]) {
      if (w.trim().length < 1 || w.trim().length > 40) p.push(`The word for "${key}" needs 1 to 40 characters.`);
      else if (/[<>{}]/.test(w)) p.push(`The word for "${key}" cannot contain < > { }.`);
    }
  }
  if (!input.owner.fullName.trim()) p.push("The owner needs a name.");
  if (!EMAIL.test(input.owner.email.trim())) p.push("The owner's email address is not valid.");
  if (input.owner.password.length < 8) p.push("The owner's starting password needs at least 8 characters.");
  return [...new Set(p)];
}

/** The `p_company` argument of `create_company`. */
export function companyPayload(input: AddCompanyInput) {
  const c = input.company;
  return {
    name: c.name.trim(),
    legal_name: c.legalName.trim(),
    country_code: c.countryCode.trim().toUpperCase(),
    timezone: c.timezone.trim(),
    currency_code: c.currencyCode.trim().toUpperCase(),
    vat_number: c.vatNumber.trim(),
    address: c.address.trim(),
    phone: c.phone.trim(),
    support_email: c.supportEmail.trim(),
    owner: { full_name: input.owner.fullName.trim(), email: input.owner.email.trim().toLowerCase() },
  };
}

/** The `p_choices` argument: what the operator kept, changed or left out. */
export function choicesPayload(input: AddCompanyInput) {
  // The article goes too: a chosen word replaces the template's whole entry,
  // so leaving it out would drop an "an" the catalogue set.
  const terms: Record<string, TemplateTerm> = {};
  for (const [key, t] of Object.entries(input.terms)) {
    terms[key] = { one: t.one.trim(), many: t.many.trim(), article: t.article };
  }
  return {
    modules: input.modules,
    terms,
    settings: input.settings,
    checklists: input.checklists,
    forms: input.forms,
  };
}

// ------------------------------------------------------------ the form's helpers

/**
 * The module ticks after one change. Ticking a module ticks what it needs;
 * unticking one unticks what needs it — so the ticks can never describe a
 * company the module guard would refuse.
 */
export function toggleModule(
  selected: string[],
  code: string,
  on: boolean,
  deps: ModuleDependency[]
): string[] {
  const next = new Set(selected);
  const seen = new Set<string>();
  const queue = [code];
  while (queue.length > 0) {
    const c = queue.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    if (on) next.add(c);
    else next.delete(c);
    for (const d of deps) {
      if (on && d.module === c) queue.push(d.requires);
      if (!on && d.requires === c) queue.push(d.module);
    }
  }
  return selected.filter((m) => next.has(m)).concat([...next].filter((m) => !selected.includes(m)));
}

/** The settings the defaults step edits: not the brand colours (their own card after creation), country or currency (the details step). */
export function editableSetting(key: string): boolean {
  // How the company gets paid comes from its trade and is changed by the
  // company itself on its settings page (Quotes & invoices).
  return (
    !key.startsWith("brand_") &&
    !key.startsWith("money_") &&
    !key.startsWith("dashboard_") &&
    !key.startsWith("report_") &&
    !key.startsWith("job_report_") &&
    key !== "country_code" &&
    key !== "currency_code"
  );
}

/** A stored setting as the text an input holds. */
export function settingToText(v: Json | undefined): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

/**
 * Back to the JSON the database stores. A malformed number is sent as text so
 * the database's validation answers with the setting's own message.
 */
export function settingFromText(valueType: string, text: string): Json {
  if (valueType === "boolean") return text === "true";
  if (valueType === "integer") {
    const n = Number(text.trim());
    return text.trim() !== "" && Number.isInteger(n) ? n : text;
  }
  return text;
}

/**
 * Lower case (easy to type on a phone), without l, o, 0 or 1 (easy to misread
 * off a screen): 32 symbols, so each byte maps to one without bias.
 */
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** A starting password from random bytes (crypto.getRandomValues): 5 bits a byte, 16 bytes = 80 bits. */
export function generatePassword(bytes: Uint8Array): string {
  if (bytes.length < 12) throw new Error("A starting password needs at least 12 random bytes.");
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % 32]).join("");
}
