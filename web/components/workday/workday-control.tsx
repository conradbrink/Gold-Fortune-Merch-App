"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { useHrLoad } from "@/lib/hr/use-load";
import { can } from "@/lib/permissions";
import { fetchOrgId } from "@/lib/hr/employees";
import {
  elapsedSince,
  fetchOpenWorkday,
  startWorkday,
  stopWorkday,
  type WorkdaySession,
} from "@/lib/workday";

/**
 * Start workday / Stop working, in the app chrome.
 *
 * The same control the Android app has, for the people who do not carry the
 * Android app: the warehouse clerk, the office, anybody whose HR attendance was
 * blank not because they were absent but because nothing had ever offered them
 * a button.
 *
 * It sits in the top bar rather than on a page because a working day is not a
 * page — somebody stopping at five in the afternoon should not have to navigate
 * to it. Rendered only for whoever holds `workday`, which the database also
 * requires before it will accept the row.
 */
export function WorkdayControl() {
  const supabase = createClient();
  const permissions = usePermissions();
  const allowed = permissions !== null && can(permissions, "workday");

  const [open, setOpen] = useState<WorkdaySession | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  // Re-rendered once a minute so the elapsed time is not frozen at whatever it
  // said when the page loaded.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    // The permission check lives inside the loader rather than around the hook
    // call, so this can go through `useHrLoad` like every other fetch in the
    // app. A bare `if (allowed) void load()` in an effect body still trips
    // react-hooks/set-state-in-effect, and the tree is trying to reach zero.
    if (!allowed) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);
      const [state, org] = await Promise.all([
        fetchOpenWorkday(supabase),
        fetchOrgId(supabase),
      ]);
      setOpen(state.open);
      setOrgId(org);
      setUnreadable(false);
    } catch {
      // A control that cannot read its own state hides rather than offering a
      // button that will fail. The phone app is unaffected either way.
      //
      // Recorded rather than swallowed: `finally` sets `ready` either way, so
      // without this the failure rendered Start with no org id and the press
      // died at "Your organisation could not be resolved" — which reads as the
      // account being broken rather than the page having failed to load.
      setUnreadable(true);
    } finally {
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  useHrLoad(load);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [open]);

  if (!allowed || !ready || unreadable) return null;

  async function toggle() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      if (open) {
        await stopWorkday(supabase, open, userId);
      } else {
        if (!orgId) throw new Error("Your organisation could not be resolved.");
        await startWorkday(supabase, orgId, userId);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="hidden max-w-[16rem] truncate text-xs text-destructive sm:inline">
          {error}
        </span>
      )}
      <Button
        size="sm"
        variant={open ? "outline" : "default"}
        className="gap-1.5"
        disabled={busy}
        onClick={toggle}
        title={
          open
            ? "Stop working. Your finishing position is recorded."
            : "Start your working day. Your starting position is recorded."
        }
      >
        {open ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">
          {busy
            ? "…"
            : open
              ? `Stop · ${elapsedSince(open.started_at)}`
              : "Start workday"}
        </span>
      </Button>
    </div>
  );
}
