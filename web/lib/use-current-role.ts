"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isAppRole, type AppRole } from "@/lib/roles";

/**
 * The signed-in user's role, for deciding what the chrome offers.
 *
 * `null` while it is still being fetched — callers must render nothing
 * role-dependent until it resolves. Defaulting to `"manager"` during the wait
 * would flash the full menu at a warehouse clerk on every page load, and
 * defaulting to `"warehouse"` would do the reverse to a manager. An empty
 * sidebar for one paint is the honest option.
 *
 * This is chrome, not access control. `proxy.ts` has already decided whether
 * the page is served by the time this runs; a user who tampered with the answer
 * here would gain a menu item that redirects and a query that RLS refuses.
 */
export function useCurrentRole(): AppRole | null {
  const [role, setRole] = useState<AppRole | null>(null);
  // Kept apart from `role` so a caller can tell "still loading" from "could
  // not resolve". Exposed through the console for now rather than the return
  // type, because every current caller renders chrome and none of them has
  // anywhere to put an error — widening the signature would be a change to
  // all of them for a message none would show.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) {
      console.error(
        "useCurrentRole: the profile lookup failed, so no role-dependent chrome will render."
      );
    }
  }, [failed]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

      if (cancelled) return;

      // A query that failed is not a role of `null`. Left as null the sidebar
      // renders no destinations at all and the top bar hides search — chrome
      // that looks stripped rather than broken, with nothing to retry. Say so
      // instead; `proxy.ts` treats the identical failure as a 503.
      if (error) {
        setFailed(true);
        return;
      }

      // An unrecognised role still leaves this null, so the chrome stays empty
      // rather than guessing generously. `isAppRole` is shared with the proxy
      // so the two cannot drift on what counts as a role.
      const value = (data as { role: string } | null)?.role;
      if (isAppRole(value)) setRole(value);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return role;
}
