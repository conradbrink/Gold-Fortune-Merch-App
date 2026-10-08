import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { MoneySwitches, MoneyWorkflow } from "@/lib/money-workflow";

/**
 * Saves how the company gets paid: the route and its five switches, which are
 * company settings (the database refuses what a switch turns off). Shared by
 * the settings page and the set-up wizard.
 */
export async function saveMoneyWorkflow(
  supabase: SupabaseClient<Database>,
  orgId: string,
  workflow: MoneyWorkflow,
  sw: MoneySwitches
): Promise<void> {
  const { error } = await supabase.from("company_settings").upsert(
    [
      { org_id: orgId, key: "money_workflow", value: workflow },
      { org_id: orgId, key: "money_quotes", value: sw.quotes },
      { org_id: orgId, key: "money_deposits", value: sw.deposits },
      { org_id: orgId, key: "money_invoice_from_jobs", value: sw.jobs },
      { org_id: orgId, key: "money_invoice_direct", value: sw.direct },
      { org_id: orgId, key: "money_contracts", value: sw.contracts },
    ],
    { onConflict: "org_id,key" }
  );
  if (error) throw new Error(error.message);
}
