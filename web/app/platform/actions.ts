"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { moduleDependencies, platformAdminClient, templateDefaults } from "@/lib/platform";
import {
  addCompanyProblems,
  choicesPayload,
  companyPayload,
  parseTemplateDefaults,
  type AddCompanyInput,
  type TemplateDefaults,
} from "@/lib/add-company";

/**
 * Switch one module on or off for one company. Platform operator only.
 *
 * Checked here, on the server, against `is_platform_admin()` with the caller's
 * own session — the page hiding the buttons is not the boundary, and this
 * function is reachable by anyone who can post to it. The write itself uses the
 * service role, because a company's switches are not writable through the API
 * at all (`company_modules` has no write policy). The database still has the
 * last word on what is allowed: `company_modules_guard` refuses an unbuilt
 * module and any change that breaks a dependency (warehouse needs
 * distribution), and that refusal is shown on the page as written.
 *
 * Every change, refused or not, is written to `platform_audit_log`.
 */
export async function setCompanyModule(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const moduleCode = String(formData.get("module") ?? "");
  const enabled = formData.get("enabled") === "true";
  const back = `/platform/companies/${encodeURIComponent(orgId)}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isOperator, error: checkError } = await supabase.rpc("is_platform_admin");
  if (checkError || !isOperator) {
    // Same answer the page gives a non-operator: nothing here exists.
    redirect("/");
  }
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !/^[a-z][a-z_]*$/.test(moduleCode)) {
    redirect(`${back}?error=${encodeURIComponent("That request was not understood.")}`);
  }

  const admin = platformAdminClient();

  // The audit row first: if it cannot be written, nothing changes. Written
  // after the change, a failed insert left a switch nobody could account for
  // (CodeRabbit on #74).
  const { data: audit, error: auditError } = await admin
    .from("platform_audit_log")
    .insert({
      actor_id: user.id,
      action: enabled ? "module.enable" : "module.disable",
      target_org_id: orgId,
      detail: { module: moduleCode, refused: null },
    })
    .select("id")
    .single();
  if (auditError) {
    redirect(
      `${back}?error=${encodeURIComponent(
        `Not changed: the audit log could not be written (${auditError.message}).`
      )}`
    );
  }

  const { error } = await admin
    .from("company_modules")
    .upsert(
      { org_id: orgId, module_code: moduleCode, enabled, updated_by: user.id },
      { onConflict: "org_id,module_code" }
    );

  if (error) {
    // The attempt is already logged; record why it was refused.
    await admin
      .from("platform_audit_log")
      .update({ detail: { module: moduleCode, refused: error.message } })
      .eq("id", audit.id);
    redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(back);
}

// ------------------------------------------------------------ Add company

/** The caller's user id if they are a platform operator; null otherwise. */
async function operatorId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  return !error && isOperator ? user.id : null;
}

/**
 * The merged defaults for a set of industries, for the form to show and edit.
 * The same `template_defaults()` that `create_company` builds from, so what
 * the operator reviews is what the company gets.
 */
export async function previewTemplates(
  codes: string[]
): Promise<{ ok: true; defaults: TemplateDefaults } | { ok: false; error: string }> {
  if (!(await operatorId())) return { ok: false, error: "Not allowed." };
  if (codes.length === 0 || codes.some((c) => !/^[a-z][a-z_]*$/.test(c))) {
    return { ok: false, error: "Choose at least one industry." };
  }
  try {
    return { ok: true, defaults: parseTemplateDefaults(await templateDefaults(codes)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Creates a company from templates, with its owner's login. Platform operator only.
 *
 * Two systems, so two steps: the login (Supabase Auth) first, then
 * `create_company`, which builds the company, its settings, words, checklists
 * and the owner's Administrator profile in one database transaction and writes
 * the audit row. If that fails the login is deleted again, so a refused
 * company leaves nothing behind — the requirement's "if any step fails,
 * nothing is created", across both.
 */
export async function createCompanyAction(
  input: AddCompanyInput
): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const actor = await operatorId();
  if (!actor) return { ok: false, error: "Not allowed." };

  const admin = platformAdminClient();
  const problems = addCompanyProblems(input, await moduleDependencies());
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  const company = companyPayload(input);
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: company.owner.email,
    password: input.owner.password,
    email_confirm: true,
    user_metadata: { full_name: company.owner.full_name },
  });
  if (userError || !created.user) {
    return { ok: false, error: `The owner's login could not be created: ${userError?.message ?? "unknown error"}` };
  }

  const { data: orgId, error } = await admin.rpc("create_company", {
    p_company: company,
    p_templates: input.templates,
    p_choices: choicesPayload(input),
    p_owner: created.user.id,
    p_actor: actor,
  });
  if (error || !orgId) {
    const reason = error?.message ?? "unknown error";
    const { error: deleteError } = await admin.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      // Say so: the login is left in Auth with no company, and its email
      // cannot be used again until it is removed (CodeRabbit on #89).
      return {
        ok: false,
        error:
          `The company was not created (${reason}), and the owner's login could not be removed ` +
          `(${deleteError.message}). Remove login ${created.user.id} in Supabase Auth before trying this email again.`,
      };
    }
    return { ok: false, error: `Nothing was created: ${reason}` };
  }
  return { ok: true, orgId };
}

// ------------------------------------------------------------ Trials and billing

/** Back to the company page, with the database's refusal if there was one. */
function backTo(orgId: string, error?: string | null): never {
  const back = `/platform/companies/${encodeURIComponent(orgId)}`;
  redirect(error ? `${back}?error=${encodeURIComponent(error)}` : back);
}

const UUID = /^[0-9a-f-]{36}$/i;

/** "1 499,50" or "1499.50" → 149950; null when it is not an amount of rands. */
function randsToCents(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").replace(/[\sR,]/g, (c) => (c === "," ? "." : ""));
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * Extends a company's free trial by a number of days, from its current end or
 * from today if it has already ended; a company that went read-only when its
 * trial ended is a trial again. Platform operator only. Since Stage 6 the
 * database does it (`billing_operator_extend_trial`), with its audit row in the
 * same transaction, and refuses for a company that has paid or is exempt.
 */
export async function extendTrial(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const days = Number(formData.get("days") ?? "");
  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!UUID.test(orgId) || !Number.isInteger(days) || days < 1 || days > 365) {
    backTo(orgId, "Extend by a whole number of days, 1 to 365.");
  }
  const { error } = await platformAdminClient().rpc("billing_operator_extend_trial", {
    p_org: orgId,
    p_days: days,
    p_actor: actor,
  });
  backTo(orgId, error?.message);
}

/** A quoted price per period instead of the price list; empty puts it back on the list. */
export async function setCustomPrice(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const raw = String(formData.get("rands") ?? "").trim();
  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!UUID.test(orgId)) backTo(orgId, "That request was not understood.");
  const cents = raw === "" ? null : randsToCents(raw);
  if (raw !== "" && (cents === null || cents <= 0)) backTo(orgId, "Enter the price in rands, e.g. 14990.");
  const { error } = await platformAdminClient().rpc("billing_operator_set_custom_price", {
    p_org: orgId,
    p_cents: cents,
    p_actor: actor,
  });
  backTo(orgId, error?.message);
}

/** Exempt: never charged, never limited. Off: back on a trial of N days. */
export async function setExempt(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const exempt = formData.get("exempt") === "true";
  const days = Number(formData.get("days") ?? "") || null;
  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!UUID.test(orgId)) backTo(orgId, "That request was not understood.");
  const { error } = await platformAdminClient().rpc("billing_operator_set_exempt", {
    p_org: orgId,
    p_exempt: exempt,
    p_days: days,
    p_actor: actor,
  });
  backTo(orgId, error?.message);
}

/** An EFT (or other payment outside the card) received for an unpaid charge. */
export async function markChargePaid(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const chargeId = String(formData.get("chargeId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!UUID.test(orgId) || !UUID.test(chargeId)) backTo(orgId, "That request was not understood.");
  const { error } = await platformAdminClient().rpc("billing_operator_mark_paid", {
    p_charge: chargeId,
    p_reference: reference,
    p_actor: actor,
  });
  backTo(orgId, error?.message);
}

/** Stops collecting a charge (agreed with the company). */
export async function cancelCharge(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const chargeId = String(formData.get("chargeId") ?? "");
  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!UUID.test(orgId) || !UUID.test(chargeId)) backTo(orgId, "That request was not understood.");
  const { error } = await platformAdminClient().rpc("billing_operator_cancel_charge", {
    p_charge: chargeId,
    p_actor: actor,
  });
  backTo(orgId, error?.message);
}

/** A credit note against a paid invoice. The refund itself is made in Payfast's dashboard. */
export async function issueCreditNote(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const cents = randsToCents(formData.get("rands"));
  const reason = String(formData.get("reason") ?? "").trim();
  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!UUID.test(orgId) || !UUID.test(invoiceId)) backTo(orgId, "That request was not understood.");
  if (cents === null || cents <= 0) backTo(orgId, "Enter the credit in rands, e.g. 1499.");
  const { error } = await platformAdminClient().rpc("billing_operator_credit_note", {
    p_invoice: invoiceId,
    p_cents: cents,
    p_reason: reason,
    p_actor: actor,
  });
  backTo(orgId, error?.message);
}
