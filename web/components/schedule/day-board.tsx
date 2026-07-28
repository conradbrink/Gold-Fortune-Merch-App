"use client";

import { CheckCircle2, Circle, Clock, MapPin, Plus, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DayRep, DayStop } from "@/lib/schedule";

/**
 * One day, one panel per rep.
 *
 * Replaces the hour-by-hour Gantt, which asked a question this product does not
 * answer: reps are given a list and choose their own order, so there was never
 * a planned time to draw. The old view fell back to a 9am bar for every stop,
 * which looked like information and was not.
 *
 * Every time shown here came from an actual check-in.
 */

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function StopRow({ stop, isPast }: { stop: DayStop; isPast: boolean }) {
  // "Missed" is derived, never stored: a stop with no check-in is simply not
  // started until its date has passed. Nothing to backfill, nothing to go
  // stale, and no nightly job to forget to run.
  const missed = isPast && stop.status === "not_started";

  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span className="mt-0.5 shrink-0">
        {stop.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : stop.status === "in_progress" ? (
          <Clock className="h-4 w-4 text-amber-600" />
        ) : missed ? (
          <X className="h-4 w-4 text-destructive" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground/50" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
          <span className="truncate">{stop.storeName}</span>
          {stop.adHoc && (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <Zap className="h-3 w-3" />
              Unplanned
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {stop.city ?? "No town"}
          {stop.checkinAt && ` · in ${formatTime(stop.checkinAt)}`}
          {stop.checkoutAt && ` · out ${formatTime(stop.checkoutAt)}`}
          {formatDuration(stop.durationSeconds) &&
            ` · ${formatDuration(stop.durationSeconds)}`}
        </p>
        {missed && (
          <p className="text-xs font-medium text-destructive">Not visited</p>
        )}
      </div>
    </li>
  );
}

export function DayBoard({
  reps,
  isPast,
  onAddStop,
}: {
  reps: DayRep[];
  /** The date being shown has already passed, so gaps are misses. */
  isPast: boolean;
  onAddStop: (repId: string) => void;
}) {
  const working = reps.filter((r) => r.stops.length > 0);
  const idle = reps.filter((r) => r.stops.length === 0);

  if (working.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          Nobody is scheduled for this day.
        </p>
        {idle.length > 0 && (
          <IdleReps reps={idle} onAddStop={onAddStop} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Side by side on wide screens, stacked on narrow — the columns are a
          convenience for comparing reps, never the only way to read this. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {working.map((rep) => {
          const done = rep.stops.filter((s) => s.status === "done").length;
          const active = rep.stops.find((s) => s.status === "in_progress");
          const pct = Math.round((done / rep.stops.length) * 100);

          return (
            <div
              key={rep.repId}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
            >
              <div className="space-y-2 border-b border-border px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {rep.repName}
                  </p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {done} of {rep.stops.length} done
                  </p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {active && (
                  <p className="flex items-center gap-1 truncate text-xs text-amber-700 dark:text-amber-400">
                    <MapPin className="h-3 w-3 shrink-0" />
                    At {active.storeName}
                    {active.checkinAt && ` since ${formatTime(active.checkinAt)}`}
                  </p>
                )}
              </div>

              <ul className="flex-1 divide-y divide-border">
                {rep.stops.map((stop) => (
                  <StopRow key={stop.id} stop={stop} isPast={isPast} />
                ))}
              </ul>

              <button
                type="button"
                onClick={() => onAddStop(rep.repId)}
                className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add stop
              </button>
            </div>
          );
        })}
      </div>

      {idle.length > 0 && <IdleReps reps={idle} onAddStop={onAddStop} />}
    </div>
  );
}

/** Reps with nothing on. Worth showing — an empty day is usually a mistake. */
function IdleReps({
  reps,
  onAddStop,
}: {
  reps: DayRep[];
  onAddStop: (repId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">
        Nothing scheduled ({reps.length})
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {reps.map((r) => (
          <Button
            key={r.repId}
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => onAddStop(r.repId)}
          >
            <Plus className="h-3 w-3" />
            {r.repName}
          </Button>
        ))}
      </div>
    </div>
  );
}
