"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { generateRoutes, type GenerateResult } from "@/lib/schedule";

/**
 * "Generate schedule" — the button and the dialog behind it.
 *
 * One component rather than a button in the planner and a dialog 500 lines
 * below it, because the five pieces of state between them (the dry run, whether
 * it is still running, the result) mean nothing to anything else on the page.
 *
 * The dry run is not a nicety. Generating **removes** future cycle routes the
 * pattern no longer calls for, so the count of what is about to disappear has to
 * be on screen before anybody presses the button.
 */
export function GenerateScheduleDialog({
  weeks,
  repName,
  disabled,
}: {
  weeks: number;
  /** Named only to say the run is wider than them. Null before reps load. */
  repName: string | null;
  disabled?: boolean;
}) {
  const supabase = createClient();

  const [genOpen, setGenOpen] = useState(false);
  const [preview, setPreview] = useState<GenerateResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openGenerate() {
    setGenOpen(true);
    setPreview(null);
    setGenResult(null);
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await generateRoutes(supabase, weeks, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGenOpen(false);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmGenerate() {
    setGenerating(true);
    setError(null);
    try {
      setGenResult(await generateRoutes(supabase, weeks, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <Button
        className="gap-1.5"
        onClick={openGenerate}
        disabled={previewing || disabled}
      >
        <CalendarPlus className="h-4 w-4" />
        {previewing ? "Checking…" : "Generate schedule"}
      </Button>

      {/* Shown here rather than handed up to the planner's error line: a dry run
          that fails closes the dialog, and the reason would otherwise vanish
          with it. */}
      {error && (
        <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

    <Dialog open={genOpen} onOpenChange={setGenOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate schedule</DialogTitle>
          <DialogDescription>
            This covers every rep in the organisation, not just{" "}
            {repName ?? "the selected rep"}.
          </DialogDescription>
        </DialogHeader>

        {previewing && (
          <p className="text-sm text-muted-foreground">
            Working out what would be created…
          </p>
        )}

        {!previewing && !genResult && preview && (
          <div className="space-y-2 text-sm">
            {preview.created === 0 && preview.removed === 0 ? (
              <p className="text-foreground">
                Nothing to change. Every date in the next {weeks} weeks that
                the call cycle calls for already has a route — or no store has
                a day set yet.
              </p>
            ) : (
              <>
                {preview.created > 0 && (
                  <p className="text-foreground">
                    Creates{" "}
                    <span className="font-semibold">{preview.created}</span>{" "}
                    route{preview.created === 1 ? "" : "s"} for{" "}
                    {preview.reps_covered} rep
                    {preview.reps_covered === 1 ? "" : "s"}, from{" "}
                    {preview.first_date} to {preview.last_date}.
                  </p>
                )}
                {/* Stated plainly: this is the only part that takes work off
                    a rep's phone, so it should never be a surprise. */}
                {preview.removed > 0 && (
                  <p className="text-foreground">
                    Removes{" "}
                    <span className="font-semibold">{preview.removed}</span>{" "}
                    future route{preview.removed === 1 ? "" : "s"} the plan no
                    longer calls for.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Nothing in the past is touched, nothing a rep has already
                  checked into, and no stop added by hand. No visit records
                  are created — a visit belongs to a check-in.
                </p>
              </>
            )}
          </div>
        )}

        {genResult && (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
            Created {genResult.created} route
            {genResult.created === 1 ? "" : "s"}
            {genResult.created > 0 &&
              ` from ${genResult.first_date} to ${genResult.last_date}`}
            {genResult.removed > 0 &&
              `, and removed ${genResult.removed} that no longer matched`}
            .
          </p>
        )}

        <DialogFooter>
          {/* The confirm button is enabled when the run changes *anything*, not
              only when it creates. A dry run can come back `created: 0,
              removed: N` — that is what happens after a store is unassigned or
              dropped to a lower frequency, and the future routes the pattern no
              longer calls for are already on the reps' phones. Gating on
              `created` alone showed "Removes N future routes" above a disabled
              button reading "Create 0 routes", leaving no way to retract. */}
          {!genResult && (
            <Button
              onClick={confirmGenerate}
              disabled={
                generating ||
                previewing ||
                !preview ||
                (preview.created === 0 && preview.removed === 0)
              }
            >
              {generating
                ? "Generating…"
                : preview && preview.created === 0
                  ? `Remove ${preview.removed} route${preview.removed === 1 ? "" : "s"}`
                  : `Create ${preview?.created ?? 0} route${preview?.created === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button variant="outline" onClick={() => setGenOpen(false)}>
            {genResult ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
