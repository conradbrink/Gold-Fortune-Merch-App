import { lower, type Terms } from "@/lib/terms";
import { formatPhone, loginPhone } from "@/lib/phone-login";
import { PRODUCT_NAME } from "@/lib/product";

/**
 * The message an owner can send a new staff member who was not there for the
 * hand-over (copied, or on WhatsApp): where to get the app, what to type to
 * sign in, and the first thing to do.
 *
 * Since 1.2.7, required from 29 Oct 2026, the phone app signs in with the
 * cellphone number itself, so a phone login is given as the number, in
 * international form: that reads on a phone set to any country. The button it
 * names is the app's own ("Start workday", in the company's word).
 */
export function welcomeMessage(input: {
  fullName: string;
  company: string;
  login: string;
  password: string;
  downloadUrl: string;
  terms: Terms;
}): string {
  const first = input.fullName.trim().split(/\s+/)[0] || input.fullName.trim();
  const phone = loginPhone(input.login);
  const signIn = phone
    ? `Use your cellphone number ${formatPhone(phone)} and the password ${input.password}`
    : `Use ${input.login} and the password ${input.password}`;
  return [
    `Hi ${first}, this is ${input.company}. We use ${PRODUCT_NAME} for our work.`,
    `1. Install the app: ${input.downloadUrl}`,
    `2. Sign in. ${signIn}`,
    `3. Tap "Start ${lower(input.terms.workday.one)}" when you start work.`,
  ].join("\n");
}
