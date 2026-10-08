import { getExampleNumber, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/mobile";
import examples from "libphonenumber-js/examples.mobile.json";

/**
 * Field staff who have no email address sign in with their phone number and a
 * password (owner, 8 Oct 2026: "just phone number no need for sms").
 *
 * Sign-in is email and password underneath, so a number becomes a login that
 * nobody types or sees on the web: "+27 82 555 0142" →
 * "27825550142@staff.tickd.co.za". That address has no mailbox and nothing is
 * ever sent to it; a forgotten password is reset by the company. The domain
 * can never change, because every phone login already carries it. Today's
 * phone app (1.1.13) only takes an email, so until the next app its people
 * type the whole login; the welcome message says exactly what.
 */
export const STAFF_LOGIN_DOMAIN = "staff.tickd.co.za";

function country(code: string | null | undefined): CountryCode | undefined {
  return code && /^[A-Z]{2}$/.test(code) ? (code as CountryCode) : undefined;
}

/**
 * A typed mobile number in international form ("+27825550142"), read in the
 * given country unless it starts with + or 00. Null when it is not a valid
 * mobile number: staff need one for WhatsApp and the app.
 */
export function normalisePhone(raw: string, countryCode: string | null | undefined): string | null {
  const typed = raw.trim().replace(/^00/, "+");
  if (!/^\+?[\d\s().-]{6,}$/.test(typed)) return null;
  const parsed = parsePhoneNumberFromString(typed, country(countryCode));
  if (!parsed || !parsed.isValid()) return null;
  // Some numbering plans allow short numbers that are nobody's phone (South
  // Africa's 082 555 passes); a staff phone is at least as long as the
  // country's own example mobile number.
  const example = parsed.country ? getExampleNumber(parsed.country, examples) : undefined;
  if (example && parsed.nationalNumber.length < example.nationalNumber.length) return null;
  return parsed.number;
}

/** The hidden login for a number in international form. */
export function phoneLogin(e164: string): string {
  return `${e164.replace(/^\+/, "")}@${STAFF_LOGIN_DOMAIN}`;
}

/** Whether a login is a phone number's, not a real email address. */
export function isPhoneLogin(email: string | null | undefined): boolean {
  return !!email && new RegExp(`^\\d{6,15}@${STAFF_LOGIN_DOMAIN.replace(/\./g, "\\.")}$`).test(email.toLowerCase());
}

/** "+27 82 555 0142" for a number in international form; the input when it is not one. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** The number in international form behind a phone login; null for a real email address. */
export function loginPhone(email: string | null | undefined): string | null {
  return email && isPhoneLogin(email) ? `+${email.split("@")[0]}` : null;
}

/** How a login is shown: the phone number for a phone login, the email otherwise. */
export function displayLogin(email: string | null | undefined): string {
  if (!email) return "";
  const phone = loginPhone(email);
  return phone ? formatPhone(phone) : email;
}

/**
 * The logins to try for what someone typed on the sign-in page: an email as
 * typed, or a phone number read in each of the given countries in turn (the
 * browser does not know the company yet). At most three, none twice.
 */
export function loginCandidates(raw: string, countries: readonly string[]): string[] {
  const typed = raw.trim();
  if (typed.includes("@")) return [typed.toLowerCase()];
  const out: string[] = [];
  const tries: (string | null)[] = /^(\+|00)/.test(typed) ? [null] : [...countries];
  for (const c of tries) {
    const e164 = normalisePhone(typed, c);
    if (e164 && !out.includes(phoneLogin(e164))) out.push(phoneLogin(e164));
    if (out.length === 3) break;
  }
  return out;
}

/** The countries the browser's languages name ("en-ZA" → ZA), in its order. */
export function browserCountries(languages: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of languages) {
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(l);
    const c = m?.[1].toUpperCase();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * A WhatsApp link that opens a chat with the text ready to send: to the
 * number when there is one, otherwise WhatsApp asks whom to send it to.
 */
export function whatsappLink(e164: string | null, text: string): string {
  const to = e164 ? e164.replace(/^\+/, "") : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
