"use client";

import { AlertTriangle, MapPin } from "lucide-react";
import { WEEKDAYS, type DayLoad } from "@/lib/schedule";

/**
 * Mon–Sun load for one rep's call cycle.
 *
 * Every number here is the **worst single occurrence** of that weekday over the
 * horizon, not a total — see `computeWeekLoad`. A rep with four monthly stores
 * on Tuesday is not carrying four stores every Tuesday, and a strip that said
 * so would be advising against a perfectly sensible plan.
 *
 * The two things it flags are the two things that actually ruin a day: too many
 * stops, and stops in more than one city.
 */
export function WeekLoadStrip({
  days,
  storesPerDay,
}: {
  days: DayLoad[];
  /** From org settings — what counts as a full day differs per business. */
  storesPerDay: number;
}) {
  const overloaded = days.filter((d) => d.peakStores > storesPerDay);
  const split = days.filter((d) => d.peakCities > 1);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-7 gap-2">
          {days.map((d) => {
            const label = WEEKDAYS.find((w) => w.value === d.weekday)?.short ?? "";
            const heavy = d.peakStores > storesPerDay;
            const multiCity = d.peakCities > 1;
            const empty = d.peakStores === 0;

            return (
              <div
                key={d.weekday}
                className={[
                  "rounded-lg border p-2.5 text-center",
                  heavy
                    ? "border-destructive/50 bg-destructive/10"
                    : multiCity
                      ? "border-amber-500/50 bg-amber-500/10"
                      : "border-border bg-card",
                ].join(" ")}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p
                  className={[
                    "mt-1 text-2xl font-bold tabular-nums",
                    empty ? "text-muted-foreground/40" : "text-foreground",
                  ].join(" ")}
                >
                  {d.peakStores}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {empty ? "no stops" : d.peakStores === 1 ? "store" : "stores"}
                </p>

                {!empty && (
                  <p
                    className={[
                      "mt-1.5 inline-flex items-center gap-1 text-[11px]",
                      multiCity ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                    ].join(" ")}
                    title={d.cities.join(", ")}
                  >
                    <MapPin className="h-3 w-3" />
                    {d.peakCities} {d.peakCities === 1 ? "city" : "cities"}
                  </p>
                )}

                {/* Peak and average diverge only when the day carries bi-weekly
                    or monthly stores — showing both makes that visible rather
                    than leaving the manager to wonder which number is real. */}
                {!empty && d.avgStores !== d.peakStores && (
                  <p className="text-[11px] text-muted-foreground">
                    {d.avgStores} avg
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Deliberately no per-visit duration. The figure this used to quote was
          measured from demo data that no longer exists; stores-per-day is a
          number the manager actually set. */}
      <p className="text-xs text-muted-foreground">
        Peak load on any single occurrence of that day. A full day is{" "}
        {storesPerDay} stores.
      </p>

      {(overloaded.length > 0 || split.length > 0) && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {overloaded.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {overloaded
                  .map(
                    (d) =>
                      `${WEEKDAYS.find((w) => w.value === d.weekday)?.long} (${d.peakStores})`
                  )
                  .join(", ")}{" "}
                {overloaded.length === 1 ? "goes" : "go"} past a full day.
              </span>
            </p>
          )}
          {split.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {split
                  .map(
                    (d) =>
                      `${WEEKDAYS.find((w) => w.value === d.weekday)?.long} spans ${d.peakCities} cities`
                  )
                  .join(", ")}
                . Driving between cities eats the day.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
