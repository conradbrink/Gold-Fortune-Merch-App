"use client";

import { AlertTriangle } from "lucide-react";
import type { Capacity, OrgSettings } from "@/lib/org-settings";

/**
 * Whether the plan is deliverable, shown while it is being built.
 *
 * The arithmetic is not hard — reps × working days × stores per day × 4 weeks
 * — but it was invisible, so a manager could spend an afternoon on a call
 * cycle the team physically cannot service and only find out when routes
 * started being missed. Frequency is the binding constraint on an estate of
 * any size, and this is the only place that says so.
 */
export function CapacityMeter({
  capacity,
  settings,
  repCount,
}: {
  capacity: Capacity;
  settings: OrgSettings;
  repCount: number;
}) {
  const over = capacity.loadPct > 100;
  const tight = capacity.loadPct > 85 && !over;

  const barColour = over
    ? "bg-destructive"
    : tight
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {capacity.planned.toLocaleString()} of {capacity.total.toLocaleString()}{" "}
          visit-slots per 4-week cycle
        </p>
        <p
          className={[
            "text-sm font-semibold tabular-nums",
            over
              ? "text-destructive"
              : tight
                ? "text-amber-700 dark:text-amber-400"
                : "text-emerald-700 dark:text-emerald-500",
          ].join(" ")}
        >
          {capacity.loadPct}%
        </p>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColour}`}
          // Bar stops at 100% while the number keeps counting — a bar that
          // overflowed its track would understate how far over the plan is.
          style={{ width: `${Math.min(capacity.loadPct, 100)}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {repCount} {repCount === 1 ? "rep" : "reps"} ×{" "}
        {settings.workingDays.length}{" "}
        {settings.workingDays.length === 1 ? "day" : "days"} ×{" "}
        {settings.storesPerDay} stores × 4 weeks
      </p>

      {over && (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This plan needs {(capacity.planned - capacity.total).toLocaleString()}{" "}
            more visit-slots than the team has. Reduce how many stores are
            weekly, raise stores per day in settings, or add a rep — generating
            now would create routes nobody can complete.
          </span>
        </p>
      )}

      {tight && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Close to capacity — there is little room for a sick day or a
          breakdown.
        </p>
      )}
    </div>
  );
}
