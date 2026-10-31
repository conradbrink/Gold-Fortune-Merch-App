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
     * Bumped whenever the person changes, and captured by each lookup.
     *
     * Asking once on mount is not enough: `TopBar` calls `signOut()` before it
     * navigates, so a mounted schedule page would keep a stale `true` through
     * the transition and go on offering writes that now have no session behind
     * them. Resetting to `null` when the person changes closes the controls at once,
     * and the generation check drops the answer from a session that has since
     * been replaced — a sign-in and a sign-out racing would otherwise be
     * settled by whichever RPC happened to return last.
     */
    let generation = 0;

    /** Whose answer this is: a user id, null when signed out, unset at first. */
    let askedFor: string | null | undefined;

    function refresh(userId: string | null) {
      const lookup = lookupFor(askedFor, userId);
      if (lookup === "keep") return;
      askedFor = userId;
      const mine = ++generation;
      setIsManager(null);
      if (lookup === "clear") return;
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

    // No lookup of its own on mount: subscribing delivers INITIAL_SESSION
    // straight away, with the session or without one, and asking before that
    // could not tell a signed-out page from a signed-in one.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      refresh(session?.user.id ?? null)
    );

    return () => {
      // Stops any in-flight lookup landing after unmount.
      generation++;
      sub.subscription.unsubscribe();
    };
  }, []);

  return isManager;
}

/**
 * What a session change means for the answer.
 *
 * - `keep`: the same person, which is every hourly token refresh. Asking again
 *   would close the manager's controls for a round trip once an hour, under a
 *   hand that might be pressing one.
 * - `clear`: signed out. There is nobody to ask about, and asking anyway is a
 *   401 that was reported as a failed lookup each time someone signed out with
 *   a schedule page open (Sentry JAVASCRIPT-NEXTJS-6).
 * - `ask`: a person this tab has not asked about yet.
 *
 * A role changed under a signed-in person is picked up on their next page
 * load; until then the database still refuses what they may no longer do.
 */
export function lookupFor(
  askedFor: string | null | undefined,
  userId: string | null
): "keep" | "clear" | "ask" {
  if (userId === askedFor) return "keep";
  return userId === null ? "clear" : "ask";
}
