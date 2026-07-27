import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

let browserClient:
  | ReturnType<typeof createBrowserClient<Database>>
  | undefined;

/**
 * The single browser Supabase client for the whole app.
 *
 * Must be a singleton. Every `createBrowserClient()` call constructs its own
 * GoTrueClient, and each of those takes a `navigator.locks` lock on the shared
 * `sb-<ref>-auth-token` key before it will resolve a session. Pages call this
 * helper straight from the render body, so returning a fresh instance per call
 * left many clients contending for that one lock — requests then hang forever
 * waiting on a session that never resolves, with no error ever surfacing.
 */
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );
  }
  return browserClient;
}
