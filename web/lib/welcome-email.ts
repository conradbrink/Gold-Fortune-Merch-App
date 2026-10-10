import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { templateDefaults } from "@/lib/platform";
import { parseTemplateDefaults } from "@/lib/add-company";

/**
 * Queues the welcome email to the owner of a company that has just been set up
 * (by the operator, or by sign-up when it is open). It goes through the outbox
 * like every other email, so it is retried, listed, and never sent to a blocked
 * address; the sender (`/api/cron/messages`) sends it as Tickd.
 *
 * The company's own words for its staff and its places make it read like their
 * Tickd. Never throws: the company is already made and nothing here may undo it.
 */
export async function queueWelcomeEmail(
  admin: SupabaseClient<Database>,
  company: { orgId: string; email: string; fullName: string; name: string; templates: string[] }
): Promise<void> {
  try {
    let staff = "";
    let sites = "";
    try {
      const d = parseTemplateDefaults(await templateDefaults(company.templates));
      staff = d.terms.staff?.many ?? "";
      sites = d.terms.site?.many ?? "";
    } catch {
      // The words are a nicety: the email says "team" and "places" without them.
    }
    const { error } = await admin.rpc("queue_email", {
      p_org: company.orgId,
      p_to: company.email,
      p_to_name: company.fullName,
      p_template: "welcome",
      p_payload: {
        first_name: company.fullName.trim().split(/\s+/)[0] ?? "",
        company_name: company.name,
        email: company.email,
        staff_word: staff,
        site_word: sites,
      },
      p_related_kind: "welcome",
      p_related_id: company.orgId,
    });
    if (error) console.error("welcome: the email was not queued", company.orgId, error.message);
  } catch (e) {
    console.error("welcome: the email failed", company.orgId, e instanceof Error ? e.message : e);
  }
}
