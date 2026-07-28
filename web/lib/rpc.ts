import type { SupabaseClient } from "@supabase/supabase-js";

export type RpcResult = { data: unknown; error: { message: string } | null };

/**
 * Calls a Postgres function through an untyped boundary.
 *
 * `lib/supabase/types.ts` is now current and does include every RPC, so new
 * code can call `supabase.rpc(...)` directly and get real types. This stays for
 * the existing call sites — converting them is a mechanical change worth doing
 * on its own rather than mixed into feature work — and for the window after a
 * migration lands but before the types are regenerated.
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
