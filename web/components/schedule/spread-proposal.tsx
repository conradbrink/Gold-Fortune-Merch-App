"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { WEEKDAYS, applySpread, autoSpreadDays } from "@/lib/schedule";
import type { PlannedStore, SpreadResult } from "@/lib/schedule";
import type { OrgSettings } from "@/lib/org-settings";

/**
 * "Auto-spread days" — propose a day for every store, then accept or discard.
 *
 * Nothing is written until it is accepted: `autoSpreadDays` is a pure function
 * of the stores and the capacity settings, so pressing the button costs nothing
 * and changes nothing. That is the only reason it is safe to offer on a plan
 * somebody has already tuned by hand.
 *
 * Its own file because the proposal, the count derived from it and the applying
 * flag are three pieces of state that mean nothing to the rest of the planner,
 * and they sat in the middle of it.
 */
export function SpreadProposal({
  stores,
  settings,
  onApplied,
}: {
  stores: PlannedStore[];
  settings: OrgSettings;
  /** Re-read the rep's stores — every one of them may have moved. */
  onApplied: () => Promise<void> | void;
}) {
  const supabase = createClient();

  /** Non-null while a proposal is waiting to be accepted. */
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Proposes days for every store. Nothing is written until it is accepted. */
  function proposeSpread() {
    setError(null);
    setSpread(
      autoSpreadDays(stores, {
        storesPerDay: settings.storesPerDay,
        workingDays: settings.workingDays,
      })
    );
  }

  /** Stores the proposal actually put on a day. */
  const placedCount = useMemo(
    () => (spread?.assignments ?? []).filter((a) => a.dayOfWeek !== null).length,
    [spread]
  );

  async function acceptSpread() {
    if (!spread) return;
    setApplying(true);
    setError(null);
    try {
      await applySpread(supabase, spread.assignments);
      await onApplied();
      setSpread(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={proposeSpread}>
          <Wand2 className="mr-1.5 h-3.5 w-3.5" />
          Auto-spread days
        </Button>
        <span className="text-xs text-muted-foreground">
          Groups stores by how close together they are and fills each day to{" "}
          {settings.storesPerDay}, putting outlying towns on a day of their
          own. You can change anything after.
        </span>
      </div>

      {spread && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium text-foreground">
            {/* Placed, not every assignment. Overflow stores are written with
                a null day so they are cleared rather than left where they
                were — which meant this count included the very stores the
                next sentence says did not fit. The two disagreed. */}
            Proposed: {placedCount} store
            {placedCount === 1 ? "" : "s"} over{" "}
            {spread.daysUsed} of {spread.daysAvailable} working days, peak{" "}
            {Math.max(0, ...Object.values(spread.peakByDay))} on a day.
          </p>

          {/* The target is a floor now, not a ceiling. A day that comes out
              short is the finding — the rep drives out and back either way,
              so a half-empty day costs nearly what a full one does. */}
          {spread.underTarget.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Under {settings.storesPerDay} stops:{" "}
              {spread.underTarget
                .map(
                  (u) =>
                    `${WEEKDAYS.find((w) => w.value === u.day)?.long} (${u.stores})`
                )
                .join(", ")}
              . There is not enough work to fill those days at this
              frequency — either they take more stores, or this rep does not
              need the whole week.
            </p>
          )}

          {spread.riders.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Riding along without a location:{" "}
              {spread.riders
                .map(
                  (r) =>
                    `${WEEKDAYS.find((w) => w.value === r.day)?.long} (${r.stores})`
                )
                .join(", ")}
              . These could not be grouped by distance, so they follow their
              town and add to that day&rsquo;s count.
            </p>
          )}

          {spread.splitTowns.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Too big for one day, so split across days:{" "}
              {spread.splitTowns.join(", ")}.
            </p>
          )}

          {/* Not the alarm it once was. Days are grouped on position now, so
              a day holding Gaborone and Mogoditshane — five kilometres apart
              — is a sensible day, and saying otherwise trained people to
              ignore the warning. */}
          {spread.sharedDays.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Days covering more than one town:{" "}
              {spread.sharedDays
                .map(
                  (d) =>
                    `${WEEKDAYS.find((w) => w.value === d.day)?.short} (${d.towns.join(", ")})`
                )
                .join("; ")}
              . Grouped by distance, so these are neighbours rather than a
              drive between towns.
            </p>
          )}

          {spread.overflow.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {spread.overflow.length} store
              {spread.overflow.length === 1 ? "" : "s"} did not fit in the
              week and {spread.overflow.length === 1 ? "was" : "were"} left
              unplanned. Reduce their frequency, add a working day, or move
              them to another rep.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={acceptSpread} disabled={applying}>
              {applying ? "Applying…" : "Apply to all stores"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSpread(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
