"use client";

import { AlertTriangle, Pin } from "lucide-react";
import type { MonthDay } from "@/lib/schedule";

/**
 * One rep's month, as a calendar.
 *
 * **Deliberately not `CycleGrid`, and deliberately not sharing its `DayCell`.**
 * That grid draws the call cycle *projected* — what `generate_routes` would
 * write, laid out on the weekdays the cycle happens to use. This one draws the
 * `routes` rows that actually exist, on all seven columns, because somebody
 * looking for the 14th needs the 14th where a calendar puts it, and a stop that
 * has landed on a non-working day has to be visible or the mistake is not.
 *
 * The two look similar and will drift apart. That is the intent: they answer
 * "what repeats" and "what is happening", and merging them would force one
 * component to hold both a `CycleDay` and a `MonthDay` behind a union prop.
 *
 * The visual grammar is shared on purpose, though — count, pin, over/split
 * warnings — so that a manager who has read one grid can read the other.
 */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function describeTowns(towns: string[]): string {
  if (towns.length === 0) return "";
  if (towns.length <= 2) return towns.join(", ");
  return `${towns[0]} +${towns.length - 1}`;
}

function formatDayMonth(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function DayCell({
  day,
  storesPerDay,
  selected,
  onSelect,
}: {
  day: MonthDay;
  storesPerDay: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const stops = day.plan?.stops ?? [];
  const towns = day.plan?.towns ?? [];
  const count = stops.length;
  const empty = count === 0;
  const heavy = count > storesPerDay;
  const multiTown = towns.length > 1;
  const pinned = stops.some((s) => s.source === "manual");

  // A day belonging to a neighbouring month is drawn so the row is a whole
  // week, but planning it here would be planning a month you are not looking
  // at. The past is drawn the same way for a different reason: a stop
  // back-dated onto it is one the rep's phone will never fetch, which the Today
  // board would then render as a miss that never happened.
  const readOnly = !day.inMonth || day.isPast;

  const body = (
    <>
      <p className="flex items-baseline justify-between gap-1">
        <span
          className={[
            "text-base font-bold tabular-nums leading-none",
            empty ? "text-muted-foreground/40" : "text-foreground",
          ].join(" ")}
        >
          {count || "—"}
        </span>
        <span className="flex items-baseline gap-0.5 text-[10px] tabular-nums text-muted-foreground/70">
          {/* A pin, not a count. That some of this day was placed by hand
              changes how the number reads — those stops will not move when the
              cycle does. */}
          {pinned && (
            <Pin
              className="h-2.5 w-2.5 shrink-0 text-primary"
              aria-label="holds a one-off stop"
            />
          )}
          <span
            className={
              day.isToday
                ? "rounded-full bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground"
                : ""
            }
          >
            {day.date.getDate()}
          </span>
        </span>
      </p>

      {!empty && (
        <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
          {describeTowns(towns)}
        </p>
      )}

      {(heavy || multiTown || (day.isOffDay && !empty)) && (
        <p
          className={[
            "mt-auto flex items-center gap-0.5 pt-0.5 text-[10px] font-medium leading-tight",
            heavy ? "text-destructive" : "text-amber-700 dark:text-amber-400",
          ].join(" ")}
        >
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          {heavy ? `${count - storesPerDay} over` : multiTown ? "split" : "off day"}
        </p>
      )}
    </>
  );

  if (readOnly) {
    return (
      <div
        className={[
          "flex min-h-[68px] flex-col rounded-md border border-dashed px-1.5 py-1.5 text-left",
          empty ? "border-border/50" : "border-border/70 bg-muted/20",
          "opacity-60",
        ].join(" ")}
        title={
          !day.inMonth
            ? `${formatDayMonth(day.date)} — belongs to another month`
            : `${formatDayMonth(day.date)} — already past, so it cannot be changed`
        }
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      // The cell truncates at this width, so hovering has to be worth it.
      title={
        empty
          ? `${formatDayMonth(day.date)} — nothing scheduled`
          : `${formatDayMonth(day.date)} — ${count} stop${count === 1 ? "" : "s"} in ${towns.join(", ") || "no town on file"}`
      }
      className={[
        "flex min-h-[68px] flex-col rounded-md border px-1.5 py-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
        heavy
          ? "border-destructive/50 bg-destructive/10 hover:bg-destructive/15"
          : multiTown
            ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15"
            : day.isOffDay
              ? // Tinted, never hidden. A working week is Monday to Friday here,
                // but a Saturday that somehow carries a stop must be visible.
                "border-border/60 bg-muted/40 hover:bg-muted/60"
              : "border-border bg-card hover:bg-muted/50",
      ].join(" ")}
    >
      {body}
    </button>
  );
}

export function MonthGrid({
  weeks,
  storesPerDay,
  selectedKey,
  onSelect,
}: {
  weeks: MonthDay[][];
  storesPerDay: number;
  /** `toDateString()` of the open day, or null. */
  selectedKey: string | null;
  onSelect: (date: Date) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <p
            key={label}
            className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day) => (
          <DayCell
            key={day.date.toDateString()}
            day={day}
            storesPerDay={storesPerDay}
            selected={selectedKey === day.date.toDateString()}
            onSelect={() => onSelect(day.date)}
          />
        ))}
      </div>
    </div>
  );
}
