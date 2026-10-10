"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient, templateDefaults } from "@/lib/platform";
import { parseTemplateDefaults } from "@/lib/add-company";
import { SELF_SERVE_SIGNUP_OPEN, clientAddress, signupCompanyPayload, signupProblems, type SignupInput } from "@/lib/signup";
import { FOUNDING_OFFER } from "@/lib/founding-offer";

/**
 * The public free-trial sign-up (Stage 5). No session: anyone can post here,
 * so everything is checked again on the server, limited per address and per
 * email, and built by the database in one transaction.
 */

// Sign-ups allowed per caller address per hour, and per email per day. Abuse
// limits, not business settings: generous for a person, tight for a script.
const PER_ADDRESS = { limit: 5, windowSeconds: 60 * 60 };
const PER_EMAIL = { limit: 3, windowSeconds: 24 * 60 * 60 };

export type IndustryPreview = {
  words: { staffMany: string; siteMany: string; jobMany: string };
  checklists: string[];
  forms: string[];
};

/**
 * What a company of these trades starts with, for the sign-up page's summary.
 * The same `template_defaults()` that creation builds from. Catalogue data
 * only: nothing about any company.
 */
export async function previewIndustries(
  codes: string[]
): Promise<{ ok: true; preview: IndustryPreview } | { ok: false; error: string }> {
  if (codes.length === 0 || codes.length > 3 || codes.some((c) => !/^[a-z][a-z_]*$/.test(c))) {
    return { ok: false, error: "Choose what kind of work your team does." };
  }
  try {
    const d = parseTemplateDefaults(await templateDefaults(codes));
    return {
      ok: true,
      preview: {
        words: {
          staffMany: d.terms.staff?.many ?? "",
          siteMany: d.terms.site?.many ?? "",
          jobMany: d.terms.job?.many ?? "",
        },
        checklists: d.checklists.map((c) => c.name),
        forms: d.forms.map((f) => f.name),
      },
    };
  } catch {
    return { ok: false, error: "That choice of work was not understood. Please choose again." };
  }
}

/**
 * Creates the login, the company and its trial, then signs the person in.
 *
 * Two systems, so two steps: the login (Supabase Auth), then
 * `start_trial_company`, which builds the company from the chosen trades,
 * makes this person its Administrator and starts the trial, all in one
 * database transaction. If that is refused the login is deleted again; if even
 * that fails, the message says so rather than claiming nothing was created.
 */
export async function signupAction(
  input: SignupInput
): Promise<{ ok: true; signedIn: boolean } | { ok: false; error: string }> {
  if (!SELF_SERVE_SIGNUP_OPEN) {
    return { ok: false, error: `Sign-up is closed for now. Apply to be a founding member at ${FOUNDING_OFFER.applyUrl}.` };
  }
  const problems = signupProblems(input);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  const admin = platformAdminClient();
  const company = signupCompanyPayload(input);
  const h = await headers();
  const address = clientAddress(h.get("x-forwarded-for"), h.get("x-real-ip")) ?? "unknown";

  for (const [bucket, subject, rule] of [
    ["signup_address", `ip:${address}`, PER_ADDRESS],
    ["signup_email", `email:${company.owner.email}`, PER_EMAIL],
  ] as const) {
    const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
      p_bucket: bucket,
      p_subject: subject,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) return { ok: false, error: "Sign-up is not available just now. Please try again in a moment." };
    if ((data as { allowed?: boolean } | null)?.allowed !== true) {
      return { ok: false, error: "Too many sign-up attempts. Please try again later." };
    }
  }

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: company.owner.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: company.owner.full_name },
  });
  if (userError || !created.user) {
    const taken = userError?.message?.toLowerCase().includes("already");
    return {
      ok: false,
      error: taken
        ? "There is already an account with this email. Sign in instead, or use another email."
        : "Your account could not be created just now. Please try again.",
    };
  }

  const { data: orgId, error } = await admin.rpc("start_trial_company", {
    p_company: company,
    p_templates: input.templates,
    p_owner: created.user.id,
  });
  if (error) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("signup: company refused and the login could not be removed", created.user.id, deleteError.message);
      return {
        ok: false,
        error: "Your company could not be set up, and your login was left half-made. Please contact us before trying again.",
      };
    }
    console.error("signup: start_trial_company refused", error.message);
    return { ok: false, error: "Your company could not be set up just now. Nothing was created; please try again." };
  }

  // Signed in on this browser, so the next page is their own dashboard.
  // The trial is instant, but the company cannot email clients until the
  // owner opens this link (20261010250000). Sent by the outbox like any other
  // email; a failure here only means they ask for it again from the
  // dashboard, so it never stops the sign-up.
  if (typeof orgId === "string") {
    const { error: confirmError } = await admin.rpc("queue_email", {
      p_org: orgId,
      p_to: company.owner.email,
      p_to_name: company.owner.full_name,
      p_template: "confirm_email",
      p_payload: {},
    });
    if (confirmError) console.error("signup: the confirmation email was not queued", orgId, confirmError.message);
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: company.owner.email,
    password: input.password,
  });
  return { ok: true, signedIn: !signInError };
}
