import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * The people at a site (Stage 8.2): who the job reports go to, and who to
 * call. A client's number can be a landline, so any valid number is taken,
 * read in the company's own country unless it starts with + or 00, and kept
 * in international form ("+27115550142").
 */

export type SiteContact = {
  id: string;
  store_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  receives_reports: boolean;
};

export type ContactDraft = { name: string; email: string; phone: string; role: string; receivesReports: boolean };

export const EMPTY_CONTACT: ContactDraft = { name: "", email: "", phone: "", role: "", receivesReports: true };

export function contactPhone(raw: string, countryCode: string | null | undefined): string | null {
  const typed = raw.trim().replace(/^00/, "+");
  if (!typed) return null;
  const country = countryCode && /^[A-Z]{2}$/.test(countryCode) ? (countryCode as CountryCode) : undefined;
  const parsed = parsePhoneNumberFromString(typed, country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** The row to save, or what is wrong with the draft, field by field. */
export function checkContact(
  d: ContactDraft,
  countryCode: string | null | undefined
):
  | { ok: true; row: { name: string; email: string | null; phone: string | null; role: string | null; receives_reports: boolean } }
  | { ok: false; errors: Partial<Record<"name" | "email" | "phone" | "role", string>> } {
  const errors: Partial<Record<"name" | "email" | "phone" | "role", string>> = {};
  const name = d.name.trim();
  const email = d.email.trim().toLowerCase();
  const phone = d.phone.trim() ? contactPhone(d.phone, countryCode) : null;
  if (!name) errors.name = "Enter their name.";
  else if (name.length > 120) errors.name = "Up to 120 characters.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "That is not an email address.";
  else if (email.length > 254) errors.email = "Up to 254 characters.";
  if (d.phone.trim() && !phone) errors.phone = "That is not a phone number. Type it as you would dial it, or with +.";
  if (!email && !d.phone.trim()) errors.email = "Enter an email address or a phone number.";
  if (d.role.trim().length > 60) errors.role = "Up to 60 characters.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    row: { name, email: email || null, phone, role: d.role.trim() || null, receives_reports: d.receivesReports },
  };
}
