import type { SupabaseClient } from "@supabase/supabase-js";

export type RpcResult = { data: unknown; error: { message: string } | null };

/**
 * Calls a Postgres function that `lib/supabase/types.ts` doesn't know about yet.
 *
 * The generated types predate our RPCs, so the typed client rejects them. All
 * the casting lives here rather than being scattered across pages; delete this
 * once types are regenerated.
 *
 * Cast the *client*, never the extracted method — pulling `rpc` off the object
 * detaches `this` and it fails inside on `this.rest`.
 */
export function callRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): PromiseLike<RpcResult> {
  const client = supabase as unknown as {
    rpc: (f: string, a: Record<string, unknown>) => PromiseLike<RpcResult>;
  };
  return client.rpc(fn, args);
}
