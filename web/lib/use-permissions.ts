"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toPermissionSet, type PermissionSet } from "@/lib/permissions";

/**
 * The signed-in user's permissions, for deciding what the chrome offers.
 *
 * `null` while it is still being fetched — callers must render nothing
 * permission-dependent until it resolves. An empty set would be a wrong answer
 * rather than a missing one: it would flash "you can do nothing" at an
 * administrator on every page load. This is the same contract `useCurrentRole`
 * had, and for the same reason.
 *
 * This is chrome, not access control. `proxy.ts` has already decided whether
 * the page is served by the time this runs, and a user who tampered with the
 * answer here would gain a menu item that redirects and a query RLS refuses.
 */
export function usePermissions(): PermissionSet | null {
  const [permissions, setPermissions] = useState<PermissionSet | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) {
      console.error(
        "usePermissions: the lookup failed, so no permission-dependent chrome will render."
      );
    }
  }, [failed]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    void (async () => {
      const { data, error } = await supabase.rpc("my_permissions");
      if (cancelled) return;
      // A query that failed is not "no permissions". Left null the chrome stays
      // empty rather than claiming the user has been locked out; `proxy.ts`
      // treats the identical failure as a 503.
      if (error) {
        setFailed(true);
        return;
      }
      setPermissions(toPermissionSet(data as string[] | null));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return permissions;
}
