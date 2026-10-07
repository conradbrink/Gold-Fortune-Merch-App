/**
 * The public sign-up for a free trial (Stage 5): what the form holds, how it is
 * checked, and what is sent to `start_trial_company`.
 *
 * Pure, so the server action and its tests share it. The database checks
 * everything again (create_company's validation, the module guard); these
 * checks exist so a person hears about a mistake before a login is made.
 */

export type SignupInput = {
  fullName: string;
  email: string;
  password: string;
  companyName: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  /** Template codes, primary first. */
  templates: string[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_CODE = /^[a-z][a-z_]*$/;

/** The shortest starting password accepted, matching the operator's form. */
export const PASSWORD_MIN = 8;

export type SignupIssue = { field: keyof SignupInput; message: string };

/** Every problem, with the field it belongs to, in the order the person meets them. */
export function signupIssues(input: SignupInput): SignupIssue[] {
  const p: SignupIssue[] = [];
  const add = (field: keyof SignupInput, message: string) => p.push({ field, message });
  if (!input.fullName.trim()) add("fullName", "Please enter your name.");
  if (!EMAIL.test(input.email.trim())) add("email", "Please enter a valid email address.");
  if (input.password.length < PASSWORD_MIN) add("password", `Your password needs at least ${PASSWORD_MIN} characters.`);
  if (!input.companyName.trim()) add("companyName", "Please enter your company's name.");
  if (!/^[A-Za-z]{2}$/.test(input.countryCode.trim())) add("countryCode", "Choose your country.");
  if (!/^[A-Za-z]{3}$/.test(input.currencyCode.trim())) add("currencyCode", "Choose your currency.");
  if (!input.timezone.trim()) add("timezone", "Choose your timezone.");
  if (input.templates.length === 0) add("templates", "Choose what kind of work your team does.");
  else if (input.templates.some((t) => !TEMPLATE_CODE.test(t)) || new Set(input.templates).size !== input.templates.length) {
    add("templates", "That choice of work was not understood. Please choose again.");
  }
  return p;
}

/** The messages alone. Empty when it is fine. */
export function signupProblems(input: SignupInput): string[] {
  return signupIssues(input).map((i) => i.message);
}

/** The `p_company` argument of `start_trial_company`. */
export function signupCompanyPayload(input: SignupInput) {
  return {
    name: input.companyName.trim(),
    country_code: input.countryCode.trim().toUpperCase(),
    currency_code: input.currencyCode.trim().toUpperCase(),
    timezone: input.timezone.trim(),
    support_email: input.email.trim().toLowerCase(),
    owner: { full_name: input.fullName.trim(), email: input.email.trim().toLowerCase() },
  };
}

/**
 * The first address in `x-forwarded-for` (the client, as Vercel's edge saw it),
 * else the platform's own header, else null. Only ever a rate-limit key.
 */
export function clientAddress(forwardedFor: string | null, realIp: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  if (first) return first;
  const real = realIp?.trim();
  return real ? real : null;
}

/** A template code from the sales site's link (`/signup?industry=cleaning`), if it is one we offer. */
export function industryFromQuery(raw: string | string[] | undefined, offered: string[]): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && offered.includes(v) ? v : null;
}
