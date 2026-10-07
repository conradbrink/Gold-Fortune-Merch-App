"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient } from "@/lib/platform";

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
  const { error } = await admin
    .from("company_modules")
    .upsert(
      { org_id: orgId, module_code: moduleCode, enabled, updated_by: user.id },
      { onConflict: "org_id,module_code" }
    );

  await admin.from("platform_audit_log").insert({
    actor_id: user.id,
    action: enabled ? "module.enable" : "module.disable",
    target_org_id: orgId,
    detail: { module: moduleCode, refused: error ? error.message : null },
  });

  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  redirect(back);
}
