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
/**
 * Change one of Tickd's own settings for a company (GPS timing, distance
 * thresholds, report formulas). Operator only, logged first like a module
 * change, and only for internal settings: a business setting is the
 * company's to change, on its own Company settings.
 */
export async function setCompanySetting(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("value") ?? "").trim();
  const back = `/platform/companies/${encodeURIComponent(orgId)}`;

  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !/^[a-z][a-z_]*$/.test(key)) {
    redirect(`${back}?error=${encodeURIComponent("That request was not understood.")}`);
  }

  const admin = platformAdminClient();
  const { data: def, error: defError } = await admin
    .from("setting_definitions")
    .select("key, value_type, audience")
    .eq("key", key)
    .maybeSingle();
  if (defError || !def) redirect(`${back}?error=${encodeURIComponent("No such setting.")}`);
  if (def.audience !== "internal") {
    redirect(`${back}?error=${encodeURIComponent("That is the company's own setting, changed on its Company settings.")}`);
  }

  // The database validates the value (range, pattern) and says what is wrong.
  let value: string | number | boolean = raw;
  if (def.value_type === "integer") {
    if (!/^-?\d+$/.test(raw)) redirect(`${back}?error=${encodeURIComponent("Enter a whole number.")}`);
    value = Number(raw);
  } else if (def.value_type === "boolean") {
    value = raw === "true";
  }

  const { data: before } = await admin
    .from("company_settings")
    .select("value")
    .eq("org_id", orgId)
    .eq("key", key)
    .maybeSingle();
  const { data: audit, error: auditError } = await admin
    .from("platform_audit_log")
    .insert({
      actor_id: actor,
      action: "setting.change",
      target_org_id: orgId,
      detail: { key, from: before?.value ?? null, to: value, refused: null },
    })
    .select("id")
    .single();
  if (auditError) {
    redirect(`${back}?error=${encodeURIComponent(`Not changed: the audit log could not be written (${auditError.message}).`)}`);
  }

  const { error } = await admin
    .from("company_settings")
    .upsert({ org_id: orgId, key, value, updated_by: actor }, { onConflict: "org_id,key" });
  if (error) {
    await admin
      .from("platform_audit_log")
      .update({ detail: { key, from: before?.value ?? null, to: value, refused: error.message } })
      .eq("id", audit.id);
    redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(back);
}

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

// ------------------------------------------------------------ Trials (Stage 5)

/**
 * Extends a company's free trial by a number of days, from its current end or
 * from today if it has already ended. Platform operator only; the audit row
 * first, as for module switches. A company with no account row (one the
 * operator created) gets one, which puts it on a trial.
 */
export async function extendTrial(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const days = Number(formData.get("days") ?? "");
  const back = `/platform/companies/${encodeURIComponent(orgId)}`;

  const actor = await operatorId();
  if (!actor) redirect("/");
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !Number.isInteger(days) || days < 1 || days > 365) {
    redirect(`${back}?error=${encodeURIComponent("Extend by a whole number of days, 1 to 365.")}`);
  }

  const admin = platformAdminClient();
  const { data: current, error: readError } = await admin
    .from("company_account")
    .select("trial_ends_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (readError) redirect(`${back}?error=${encodeURIComponent(readError.message)}`);

  const now = Date.now();
  const from = current?.trial_ends_at ? Math.max(new Date(current.trial_ends_at).getTime(), now) : now;
  const endsAt = new Date(from + days * 24 * 60 * 60 * 1000).toISOString();

  const { error: auditError } = await admin.from("platform_audit_log").insert({
    actor_id: actor,
    action: "trial.extend",
    target_org_id: orgId,
    detail: { days, from: current?.trial_ends_at ?? null, to: endsAt },
  });
  if (auditError) {
    redirect(`${back}?error=${encodeURIComponent(`Not changed: the audit log could not be written (${auditError.message}).`)}`);
  }

  const { error } = await admin
    .from("company_account")
    .upsert({ org_id: orgId, trial_ends_at: endsAt, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  redirect(back);
}

/**
 * Link a Founding application to the company made from it, or unlink it
 * (an empty company). Platform operator only, checked here like every action
 * in this file. The audit row is written first: if it cannot be, nothing
 * changes. The database refuses a second application for the same company
 * (a unique index), and that refusal is shown as written.
 */
export async function linkFoundingApplication(formData: FormData): Promise<void> {
  const applicationId = String(formData.get("applicationId") ?? "");
  const orgId = String(formData.get("orgId") ?? "");
  const back = "/platform/founding";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isOperator, error: checkError } = await supabase.rpc("is_platform_admin");
  if (checkError || !isOperator) redirect("/");
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(applicationId) || (orgId !== "" && !uuid.test(orgId))) {
    redirect(`${back}?error=${encodeURIComponent("That request was not understood.")}`);
  }

  const admin = platformAdminClient();
  const { error: auditError } = await admin.from("platform_audit_log").insert({
    actor_id: user.id,
    action: orgId ? "founding.link" : "founding.unlink",
    target_org_id: orgId || null,
    detail: { application: applicationId },
  });
  if (auditError) {
    redirect(`${back}?error=${encodeURIComponent(`Not changed: the audit log could not be written (${auditError.message}).`)}`);
  }

  const { error } = await admin
    .from("founding_applications")
    .update({ organization_id: orgId || null })
    .eq("id", applicationId);
  if (error) {
    const message =
      error.code === "23505" ? "That company is already linked to another application." : error.message;
    redirect(`${back}?error=${encodeURIComponent(`Not linked: ${message}`)}`);
  }
  redirect(`${back}#${applicationId}`);
}
