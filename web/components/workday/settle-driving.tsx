"use client";

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { countOutstanding } from "@/lib/road-distance-settle";

/**
 * Settle the finished days that have no road distance yet.
 *
 * The nightly cron does this on its own, so this button is for the gap between
 * a rep closing their day and the run at 23:00 — and for the night the cron did
 * not fire. It exists at all because for the first two days of this feature
 * there was neither: the endpoint had no caller anywhere in the app, and the
 * driving column simply stopped filling in on 25 August with nothing on any
 * screen to say why. A number that appears only when somebody remembers to
 * `curl` for it is a number nobody can trust.
 *
 * Renders **nothing** when nothing is outstanding, which is the normal state.
 * A permanently visible "Settle" button would be a permanent invitation to
 * spend money on work already done.
 */
export function SettleDriving() {
  const supabase = createClient();
  const permissions = usePermissions();
  const allowed = permissions !== null && can(permissions, "team");

  const [outstanding, setOutstanding] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [settledAny, setSettledAny] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setOutstanding(await countOutstanding(supabase));
    } catch {
      // A count that cannot be read hides the button rather than offering a
      // press whose effect nobody can describe.
      setOutstanding(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  useHrLoad(load);

  async function settle() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/workday/road-distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await res.json().catch(() => null)) as {
        settled?: number;
        days?: { error?: string }[];
        stopped?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? `The run failed (${res.status}).`);
      }
      const failed = (payload?.days ?? []).filter((d) => d.error).length;
      const settled = payload?.settled ?? 0;
      // Says what happened to every day, not just the ones that worked. A run
      // reporting "2 settled" while silently failing three is the report that
      // makes a blank column look like a rep who did not drive.
      setNote(
        [
          `${settled} day${settled === 1 ? "" : "s"} settled`,
          failed > 0 ? `${failed} could not be routed` : null,
          payload?.stopped ?? null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
      setSettledAny(settled > 0);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;
  if (outstanding === 0 && note === null) return null;

  return (
    <div className="flex items-center gap-2">
      {note && (
        <span className="max-w-[18rem] truncate text-xs text-muted-foreground">
          {note}
        </span>
      )}
      {/* The card's figures were fetched before the run, so they still show the
          blanks that were just filled in. Offered as a press rather than done
          automatically: a reload here would take the outcome above with it, and
          "2 settled, 1 could not be routed" is the part worth reading. */}
      {settledAny && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent/40"
        >
          Show the new figures
        </button>
      )}
      {outstanding > 0 && (
        <button
          type="button"
          onClick={() => void settle()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent/40 disabled:opacity-50"
          title="Asks Google to route each finished day through its GPS trail. The nightly run does this at 23:00."
        >
          <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {busy
            ? "Settling…"
            : `Settle driving — ${outstanding} day${outstanding === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
