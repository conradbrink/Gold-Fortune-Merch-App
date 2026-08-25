"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  WEEKDAYS,
  buildCycleCalendar,
  describeCycle,
  type CycleDay,
  type PlannedStore,
} from "@/lib/schedule";

/**
 * The call cycle as dated days: weeks down, working days across.
 *
 * The store list groups by town, which is the right shape for deciding a store's
 * frequency and the wrong shape for the question a manager asks while planning —
 * *what does Tuesday of week three actually look like?* Frequency and
 * week-of-cycle mean that answer is a simulation, so this runs the simulation and
 * shows the result.
 *
 * Every cell is a real date the generator will write a route for. Nothing here is
 * an average or a peak: `WeekLoadStrip` already reports those, and putting a
 * per-occurrence figure in a cell dated to one specific day would be a lie about a
 * day that exists.
 *
 * Read-only over the same rows the list edits — moving a store from here goes
 * through the same one-row write, so a failure affects one store and nothing else.
 */

function formatDayMonth(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Towns in the space a cell has.
 *
 * Two names is the most that fits at this width, and three is where they stop
 * being readable anyway — past that the count is the useful fact, because the
 * point being made is "this day is scattered", not which towns specifically.
 */
function describeTowns(towns: string[]): string {
  if (towns.length === 0) return "";
  if (towns.length <= 2) return towns.join(" · ");
  return `${towns.length} towns`;
}

/* Column widths, in pixels.
 *
 * Sized so a six-day week fits the content column the sidebar leaves without
 * scrolling at all — `LABEL_W + 6 * DAY_W + 6 * GAP` has to stay under it. A
 * two-town label truncates at this width and everything else fits; the full
 * detail is in each cell's tooltip and in the panel below the grid. */
const LABEL_W = 76;
const DAY_W = 76;
const GAP = 4;

function DayCell({
  day,
  storesPerDay,
  isOffDay,
  selected,
  onSelect,
}: {
  day: CycleDay;
  storesPerDay: number;
  isOffDay: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  // A date before the horizon opens is drawn so the first row is a whole week,
  // but the generator will never write to it — so it must not look plannable.
  if (!day.inHorizon) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-1.5 py-2 text-center">
        <p className="text-[10px] tabular-nums text-muted-foreground/50">
          {day.date.getDate()}
        </p>
      </div>
    );
  }

  const empty = day.stores.length === 0;
  const heavy = day.stores.length > storesPerDay;
  const multiTown = day.towns.length > 1;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      // The full picture goes in the tooltip: the cell is 80px wide and has to
      // truncate, so hovering must not be the only way to learn nothing new.
      title={
        empty
          ? `${formatDayMonth(day.date)} — nothing scheduled`
          : `${formatDayMonth(day.date)} — ${day.stores.length} stop${day.stores.length === 1 ? "" : "s"}` +
            ` in ${day.towns.join(", ")}` +
            (day.stores.length > 1
              ? day.driveKm === null
                ? " · distance unknown, a stop has no coordinates"
                : ` · ${Math.round(day.driveKm)} km straight line`
              : "")
      }
      className={[
        "flex flex-col rounded-md border px-1.5 py-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
        heavy
          ? "border-destructive/50 bg-destructive/10 hover:bg-destructive/15"
          : multiTown
            ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15"
            : "border-border bg-card hover:bg-muted/50",
      ].join(" ")}
    >
      <p className="flex items-baseline justify-between gap-1">
        <span
          className={[
            "text-base font-bold tabular-nums leading-none",
            empty ? "text-muted-foreground/40" : "text-foreground",
          ].join(" ")}
        >
          {day.stores.length || "—"}
        </span>
        {/* Day of the month only — the row label already says which month, and
            repeating it 47 times is what made this read as a wall of text. */}
        <span className="text-[10px] tabular-nums text-muted-foreground/70">
          {day.date.getDate()}
        </span>
      </p>

      {!empty && (
        <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
          {describeTowns(day.towns)}
        </p>
      )}

      {/* A single stop has no travel between stops, so it has no distance worth
          printing — "0 km" there is noise that reads as a measurement. Null is
          different: a stop has no coordinates, and saying "0 km" would claim the
          shops are all in the same place. */}
      {!empty && day.stores.length > 1 && (
        <p className="text-[10px] leading-tight tabular-nums text-muted-foreground/80">
          {/* "unknown", not "no distance" — the latter reads as *zero* distance,
              which is the precise misreading the null-instead-of-0 rule exists
              to prevent. The tooltip says why it is unknown. */}
          {day.driveKm === null ? "unknown" : `${Math.round(day.driveKm)} km`}
        </p>
      )}

      {(heavy || multiTown || isOffDay) && (
        <p
          className={[
            "mt-auto flex items-center gap-0.5 pt-0.5 text-[10px] font-medium leading-tight",
            heavy ? "text-destructive" : "text-amber-700 dark:text-amber-400",
          ].join(" ")}
        >
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          {heavy
            ? `${day.stores.length - storesPerDay} over`
            : multiTown
              ? "split"
              : "off day"}
        </p>
      )}
    </button>
  );
}

export function CycleGrid({
  stores,
  weeks,
  storesPerDay,
  workingDays,
  busy,
  onChangeDay,
  onChangeWeek,
}: {
  stores: PlannedStore[];
  weeks: number;
  storesPerDay: number;
  workingDays: number[];
  /** Assignment id currently being written, from the planner's own optimistic update. */
  busy: string | null;
  onChangeDay: (store: PlannedStore, day: number | null) => void;
  onChangeWeek: (store: PlannedStore, week: number) => void;
}) {
  // Keyed by date rather than by object identity: the calendar is rebuilt on every
  // edit, so holding the day itself would leave the panel showing a stale list.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const calendar = useMemo(
    () => buildCycleCalendar(stores, weeks, workingDays),
    [stores, weeks, workingDays]
  );

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    for (const week of calendar.weeks) {
      for (const day of week.days) {
        if (day.date.toDateString() === selectedKey) return day;
      }
    }
    return null;
  }, [calendar, selectedKey]);

  const unplanned = stores.filter((s) => s.active && s.day_of_week === null);

  const totals = useMemo(() => {
    const inHorizon = calendar.weeks
      .flatMap((w) => w.days)
      .filter((d) => d.inHorizon && d.stores.length > 0);
    return {
      days: inHorizon.length,
      overloaded: inHorizon.filter((d) => d.stores.length > storesPerDay).length,
      split: inHorizon.filter((d) => d.towns.length > 1).length,
      // Only summed over days where every stop has coordinates — mixing in the
      // days we cannot measure would understate the total and look precise.
      km: inHorizon.reduce((n, d) => n + (d.driveKm ?? 0), 0),
      unmeasured: inHorizon.filter((d) => d.driveKm === null).length,
    };
  }, [calendar, storesPerDay]);

  if (calendar.weeks.length === 0 || totals.days === 0) {
    // Two different states, and they had one message between them. A store can
    // have a day set and still put nothing in the horizon: four occurrences of a
    // weekday do not always cover all four nth-of-the-month values, so a monthly
    // store on week 4 can miss a 4-week window entirely. Blaming that on "no
    // store has a day set" sends the manager to the wrong screen.
    const planned = stores.filter((s) => s.active && s.day_of_week !== null);
    return (
      <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
        {planned.length === 0
          ? "No store has a day set, so there is nothing to lay out. "
          : `${planned.length} store${planned.length === 1 ? " has a day" : "s have days"} set, but none of them fall in the next ${weeks} weeks — check the cycle week on the monthly and fortnightly ones, or widen the horizon. `}
        {unplanned.length > 0 &&
          `${unplanned.length} assigned store${unplanned.length === 1 ? "" : "s"} ${unplanned.length === 1 ? "is" : "are"} waiting for one.`}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Four figures at the same weight wrapped into a paragraph nobody read.
          As tiles they scan in one pass, and the two that need acting on carry
          their own colour. */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
          <p className="text-base font-bold leading-none tabular-nums text-foreground">
            {totals.days}
          </p>
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            working days · {weeks} weeks
          </p>
        </div>

        <div
          className="rounded-md border border-border bg-card px-2.5 py-1.5"
          title="Straight-line distance between stops, in the shortest order found. Not road distance and not a drive time."
        >
          <p className="text-base font-bold leading-none tabular-nums text-foreground">
            {Math.round(totals.km).toLocaleString("en-GB")} km
          </p>
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            {totals.unmeasured > 0
              ? `crow flies · ${totals.unmeasured} unmeasured`
              : "as the crow flies"}
          </p>
        </div>

        {/* Always rendered, including at zero — a figure that disappears when it
            is good teaches nobody that it was ever being watched. */}
        <div
          className={[
            "rounded-md border px-2.5 py-1.5",
            totals.overloaded > 0
              ? "border-destructive/50 bg-destructive/10"
              : "border-border bg-card",
          ].join(" ")}
        >
          <p
            className={[
              "text-base font-bold leading-none tabular-nums",
              totals.overloaded > 0 ? "text-destructive" : "text-foreground",
            ].join(" ")}
          >
            {totals.overloaded}
          </p>
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            over {storesPerDay} stops
          </p>
        </div>

        <div
          className={[
            "rounded-md border px-2.5 py-1.5",
            totals.split > 0
              ? "border-amber-500/50 bg-amber-500/10"
              : "border-border bg-card",
          ].join(" ")}
        >
          <p
            className={[
              "text-base font-bold leading-none tabular-nums",
              totals.split > 0
                ? "text-amber-700 dark:text-amber-400"
                : "text-foreground",
            ].join(" ")}
          >
            {totals.split}
          </p>
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            span 2+ towns
          </p>
        </div>
      </div>

      {calendar.offDayColumns.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Stores are planned on{" "}
          {calendar.offDayColumns
            .map((d) => WEEKDAYS.find((w) => w.value === d)?.long)
            .join(" and ")}
          , which the team does not work. They will still be scheduled — either
          move them, or add the day in Settings.
        </p>
      )}

      {/*
        The sidebar leaves a narrow content column, so six or seven day columns
        still overflow it and the grid scrolls sideways. The week label must
        therefore be **sticky**: without it, scrolling far enough to reach
        Saturday takes Monday *and* every row label off screen at once, and what
        is left is a block of numbers with nothing saying which week any of them
        belongs to. That is the single thing that made this hard to read.
      */}
      <div className="overflow-x-auto">
        <div
          className="grid"
          style={{
            gap: GAP,
            // The gaps are part of the width. Leaving them out of this sum is
            // what made the grid overflow by exactly one gap per column.
            minWidth:
              LABEL_W +
              calendar.columns.length * DAY_W +
              calendar.columns.length * GAP,
            gridTemplateColumns: `${LABEL_W}px repeat(${calendar.columns.length}, minmax(${DAY_W}px, 1fr))`,
          }}
        >
          {/* The corner sits above the sticky column, so it has to be sticky too
              or the weekday headings slide underneath it. */}
          <div className="sticky left-0 z-20 bg-background" />
          {calendar.columns.map((weekday) => {
            const day = WEEKDAYS.find((w) => w.value === weekday);
            const off = calendar.offDayColumns.includes(weekday);
            return (
              <div
                key={weekday}
                className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {day?.short}
                {off && (
                  <span className="ml-1 font-normal normal-case text-amber-700 dark:text-amber-400">
                    off
                  </span>
                )}
              </div>
            );
          })}

          {calendar.weeks.map((week, i) => (
            <div key={week.weekStart.toISOString()} className="contents">
              <div className="sticky left-0 z-10 flex flex-col justify-center bg-background pr-2">
                <p className="text-xs font-semibold leading-tight text-foreground">
                  Week {i + 1}
                </p>
                {/* Bi-weekly stores alternate on ISO week parity, so which of the
                    two a row is decides half of what lands in it. On one line
                    with the date: three stacked lines made the label column wider
                    than the days it was labelling. */}
                <p className="text-[10px] leading-tight text-muted-foreground">
                  {formatDayMonth(week.weekStart)}
                  <span className="text-muted-foreground/70">
                    {" · "}
                    {week.isoWeek % 2 === 1 ? "A" : "B"}
                  </span>
                </p>
              </div>
              {week.days.map((day) => (
                <DayCell
                  key={day.date.toISOString()}
                  day={day}
                  storesPerDay={storesPerDay}
                  isOffDay={calendar.offDayColumns.includes(day.weekday)}
                  selected={selected?.date.toDateString() === day.date.toDateString()}
                  onSelect={() =>
                    setSelectedKey((k) =>
                      k === day.date.toDateString() ? null : day.date.toDateString()
                    )
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              {selected.date.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              <span className="ml-2 font-normal text-muted-foreground">
                {selected.stores.length}{" "}
                {selected.stores.length === 1 ? "stop" : "stops"}
                {selected.stores.length > 1 &&
                  selected.driveKm !== null &&
                  ` · ${Math.round(selected.driveKm)} km straight line`}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>

          {selected.stores.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing lands on this day.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {selected.stores.map((s) => (
                <li
                  key={s.assignment_id}
                  className={[
                    "flex flex-wrap items-end gap-3 px-3 py-2.5",
                    busy === s.assignment_id ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <div className="min-w-[160px] flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <span className="truncate">{s.store_name}</span>
                      {/* Both, not just lat: `toPoint` needs the pair, and one
                          missing half nulls the whole day's distance. Checking
                          lat alone left a day reading "unknown" with no row
                          saying which stop was responsible. */}
                      {(s.lat === null || s.lng === null) && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 gap-1 text-[10px]"
                          title="No coordinates on file, so this stop cannot be placed on a route."
                        >
                          <MapPin className="h-3 w-3" />
                          No location
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.city ?? "No town"} · {describeCycle(s)}
                    </p>
                  </div>

                  <div className="w-32 space-y-1">
                    <Label
                      htmlFor={`grid-day-${s.assignment_id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Move to
                    </Label>
                    <NativeSelect
                      id={`grid-day-${s.assignment_id}`}
                      value={String(s.day_of_week ?? "")}
                      disabled={busy === s.assignment_id}
                      onChange={(e) =>
                        onChangeDay(
                          s,
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                    >
                      <option value="">Not planned</option>
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.long}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {/* Week only means anything above weekly, exactly as in the
                      list — showing it always invites setting a value the
                      generator ignores. */}
                  {s.visit_frequency !== "weekly" && (
                    <div className="w-28 space-y-1">
                      <Label
                        htmlFor={`grid-week-${s.assignment_id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Week
                      </Label>
                      <NativeSelect
                        id={`grid-week-${s.assignment_id}`}
                        value={String(s.week_of_cycle ?? 1)}
                        disabled={busy === s.assignment_id}
                        onChange={(e) => onChangeWeek(s, Number(e.target.value))}
                      >
                        {s.visit_frequency === "biweekly" ? (
                          <>
                            <option value="1">Week A</option>
                            <option value="2">Week B</option>
                          </>
                        ) : (
                          <>
                            <option value="1">1st</option>
                            <option value="2">2nd</option>
                            <option value="3">3rd</option>
                            <option value="4">4th</option>
                          </>
                        )}
                      </NativeSelect>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Distances are straight-line between stops, in the shortest order found —
        not road distance, and not a drive time. Stops are still listed
        alphabetically on the rep&rsquo;s phone.
      </p>
    </div>
  );
}
