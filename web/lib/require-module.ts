import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleCode } from "@/lib/modules";

type Verdict = { ok: true } | { ok: false; response: Response };

/**
 * Refuses an API request when the caller's company does not have the module.
 *
 * `proxy.ts` does not run for `/api`, so every route that belongs to a module
 * asks here. The database decides (`require_module`, which raises 42501 with
 * the module's name), so the route, the pages and the data agree on one answer.
 *
 * Fails closed: unlike a kill switch, a module check that cannot be answered
 * must not hand a paid feature to a company that has not got it.
 */
export async function requireModule(
  supabase: SupabaseClient,
  module: ModuleCode
): Promise<Verdict> {
  if (module === "core") return { ok: true };
  const { error } = await supabase.rpc("require_module", { p_code: module });
  if (!error) return { ok: true };
  if (error.code === "42501") {
    return {
      ok: false,
      response: Response.json({ error: error.message, module }, { status: 403 }),
    };
  }
  return {
    ok: false,
    response: Response.json(
      { error: "Could not check your company's plan just now. Try again in a moment." },
      { status: 503 }
    ),
  };
}
