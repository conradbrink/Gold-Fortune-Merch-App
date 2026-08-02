"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/roles";

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

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

      // An unreadable or unrecognised role leaves this null, so the chrome
      // stays empty rather than guessing generously.
      const value = (data as { role: string } | null)?.role;
      if (
        !cancelled &&
        (value === "rep" || value === "manager" || value === "warehouse")
      ) {
        setRole(value);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return role;
}
