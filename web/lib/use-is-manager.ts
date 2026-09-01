"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether the signed-in user holds the `manager` base role.
 *
 * **This exists to mirror an RLS check, not to decide access.** Scheduling
 * writes — `routes` and `store_assignments` — still test
 * `current_role() = 'manager'` in their policies; only HR and the warehouse have
 * moved to `has_permission()` (see `20260826152506` and the note at the top of
 * `lib/roles.ts`). Meanwhile the pages those writes live on are gated on the
 * `field_ops` and `team` permissions, which a custom job role can hold without
 * being a manager. Such a user could open the page, press Save, and collect a
 * raw RLS error for their trouble.
 *
 * So this is the narrow fix for that gap: stop offering writes the database is
 * going to refuse. When those tables convert to `has_permission()`, this goes
 * and the call sites move to `can()`.
 *
 * Deliberately calls `current_role()` — the very function the policies call —
 * rather than reading `profiles.role` directly. A second query could disagree
 * with the policy it is predicting; this one cannot. It is `security definer`
 * and granted to `authenticated`, and it already returns null for a deactivated
 * user, so that case falls out correctly.
 *
 * `null` while it is still being fetched, exactly as `usePermissions` does, and
 * on failure. Callers treat only `true` as permission to write: a control that
 * is briefly disabled and then enables is a smaller wrong than one that invites
 * a manager to press it before the answer is known, and fail-closed is the
 * right direction when the alternative is a error the user cannot act on.
 */
export function useIsManager(): boolean | null {
  const [isManager, setIsManager] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    /**
     * Bumped on every auth change, and captured by each lookup.
     *
     * Asking once on mount is not enough: `TopBar` calls `signOut()` before it
     * navigates, so a mounted schedule page would keep a stale `true` through
     * the transition and go on offering writes that now have no session behind
     * them. Resetting to `null` on any change closes the controls immediately,
     * and the generation check drops the answer from a session that has since
     * been replaced — a sign-in and a sign-out racing would otherwise be
     * settled by whichever RPC happened to return last.
     */
    let generation = 0;

    function refresh() {
      const mine = ++generation;
      setIsManager(null);
      void (async () => {
        const { data, error } = await supabase.rpc("current_role");
        if (mine !== generation) return;
        if (error) {
          console.error(
            "useIsManager: the lookup failed, so write controls stay disabled."
          );
          return;
        }
        setIsManager(data === "manager");
      })();
    }

    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());

    return () => {
      // Stops any in-flight lookup landing after unmount.
      generation++;
      sub.subscription.unsubscribe();
    };
  }, []);

  return isManager;
}
