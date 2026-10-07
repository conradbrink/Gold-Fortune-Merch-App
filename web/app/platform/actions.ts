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
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: `Nothing was created: ${error?.message ?? "unknown error"}` };
  }
  return { ok: true, orgId };
}
