import { lower, type Terms } from "@/lib/terms";
import { isPhoneLogin } from "@/lib/phone-login";
import { PRODUCT_NAME } from "@/lib/product";

/**
 * The message an owner can send a new staff member who was not there for the
 * hand-over (copied, or on WhatsApp): where to get the app, what to type to
 * sign in, and the first thing to do.
 *
 * Today's phone app (1.1.13) has only an Email box, so a phone login is
 * spelled out in full there; the next app will take the number alone. The
 * button it names is the app's own ("Start workday", in the company's word).
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
  const signIn = isPhoneLogin(input.login)
    ? `In the Email box type ${input.login} and the password ${input.password}`
    : `Use ${input.login} and the password ${input.password}`;
  return [
    `Hi ${first}, this is ${input.company}. We use ${PRODUCT_NAME} for our work.`,
    `1. Install the app: ${input.downloadUrl}`,
    `2. Sign in. ${signIn}`,
    `3. Tap "Start ${lower(input.terms.workday.one)}" when you start work.`,
  ].join("\n");
}
