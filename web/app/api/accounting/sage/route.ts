import { createClient as createAdminClient } from "@supabase/supabase-js";
import { supabaseFetch } from "@/lib/supabase/fetch";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { SageError, officeMessage, pickBankAccount, sageAll, sageConfig, type SageAuth, type SageBankAccount, type SageCompany } from "@/lib/accounting/sage";
import { seal, secretKey } from "@/lib/accounting/secret";
import { dayIn, readSageInput, type SageCompanyChoice } from "@/lib/accounting/connect";

/**
 * Connecting a company's Sage (Settings > Sage), and disconnecting it.
 *
 * A Route Handler because it needs what the browser must never have: Tickd's
 * Sage API key, the key that seals the sign-in, and the service role, which
 * alone may write the connection and its secret. `proxy.ts` leaves /api
 * alone, so the caller is checked here: signed in, allowed company settings,
 * with the Accounting sync add-on, and (to connect) not read-only for an
 * unpaid plan.
 *
 * Sage locks a login for a day after 20 failed sign-ins in an hour, so trying
 * a login is limited to a few an hour per person (LIMITS.sageConnect).
 */

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, { status });

function sageProblem(err: unknown) {
  if (err instanceof SageError) {
    if (err.kind === "sign_in") return json({ error: "Sage did not accept that email and password." }, 400);
    if (err.kind === "refused") return json({ error: `Sage said: ${err.message}` }, 400);
    return json({ error: officeMessage(err) }, err.kind === "limit" ? 429 : 502);
  }
  console.error("accounting: connect failed", err);
  return json({ error: "Sage could not be reached. Try again in a minute." }, 502);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Not signed in." }, 401);

  const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  const orgId = (profile as { org_id: string } | null)?.org_id;
  if (!orgId) return json({ error: "Your account is incomplete." }, 403);

  const [{ data: allowed }, { data: hasModule }] = await Promise.all([
    supabase.rpc("has_permission", { p_code: "company_settings" }),
    supabase.rpc("module_enabled", { p_code: "accounting_sync" }),
  ]);
  if (allowed !== true) return json({ error: "Only someone who runs the company's settings can connect Sage." }, 403);
  if (hasModule !== true) return json({ error: "Your plan does not include Accounting sync." }, 403);

  const config = sageConfig();
  const key = secretKey();
  if (!config || !key || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Sage is not set up on Tickd's side yet. Please ask Tickd." }, 503);
  }

  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", orgId).single();
  const today = dayIn(org?.timezone || "Africa/Johannesburg");
  const input = readSageInput(await request.json().catch(() => null), today);
  if ("error" in input) return json({ error: input.error }, 400);

  const admin = createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: supabaseFetch },
  });

  if (input.step === "disconnect") {
    const { error } = await admin.from("accounting_connections").delete().eq("org_id", orgId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (input.step === "connect") {
    const { data: writable } = await supabase.rpc("company_writable");
    if (writable === false) return json({ error: "Your plan is unpaid, so nothing can be changed until it is paid." }, 409);
  }

  const gate = await enforceRateLimit(supabase, LIMITS.sageConnect);
  if (!gate.ok) return gate.response;

  const auth: SageAuth = { config, signIn: { kind: "password", username: input.username, password: input.password } };
  let companies: SageCompany[];
  try {
    companies = (await sageAll<SageCompany>(auth, "Company/Get", null, { maxPages: 2 })).filter((c) => c.Active !== false);
  } catch (err) {
    return sageProblem(err);
  }
  if (companies.length === 0) return json({ error: "That Sage login has no companies." }, 400);

  if (input.step === "check") {
    try {
      const choices: SageCompanyChoice[] = [];
      for (const c of companies.slice(0, 10)) {
        const banks = (await sageAll<SageBankAccount>(auth, "BankAccount/Get", c.ID, { maxPages: 1 })).filter(
          (b) => b.Active !== false,
        );
        const chosen = pickBankAccount(banks);
        choices.push({
          id: c.ID,
          name: c.Name,
          bankAccounts: banks.map((b) => ({ id: b.ID, name: b.Name, isDefault: b.ID === chosen?.ID })),
        });
      }
      return json({ companies: choices, today });
    } catch (err) {
      return sageProblem(err);
    }
  }

  // Connect: the company and bank account must be ones this login opens.
  const company = companies.find((c) => c.ID === input.companyId);
  if (!company) return json({ error: "That Sage login does not open the company chosen." }, 400);
  let bank: SageBankAccount | undefined;
  try {
    bank = (await sageAll<SageBankAccount>(auth, "BankAccount/Get", company.ID, { maxPages: 1 })).find(
      (b) => b.ID === input.bankAccountId && b.Active !== false,
    );
  } catch (err) {
    return sageProblem(err);
  }
  if (!bank) return json({ error: "That bank account is not in the Sage company chosen." }, 400);

  const { error: connError } = await admin.from("accounting_connections").upsert(
    {
      org_id: orgId,
      provider: "sage_za",
      sign_in: "password",
      sign_in_name: input.username,
      company_id: company.ID,
      company_name: company.Name.slice(0, 200),
      bank_account_id: bank.ID,
      bank_account_name: bank.Name.slice(0, 200),
      sync_from: input.syncFrom,
      paused_until: null,
      last_error: null,
      connected_by: user.id,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (connError) return json({ error: connError.message }, 500);
  const sealed = seal({ kind: "password", username: input.username, password: input.password }, orgId, key);
  const { error: secretError } = await admin
    .from("accounting_secrets")
    .upsert({ org_id: orgId, sealed }, { onConflict: "org_id" });
  if (secretError) {
    await admin.from("accounting_connections").delete().eq("org_id", orgId);
    return json({ error: secretError.message }, 500);
  }
  const { data: queued } = await admin.rpc("accounting_queue_since", { p_org: orgId });
  return json({ ok: true, queued: typeof queued === "number" ? queued : 0 });
}
