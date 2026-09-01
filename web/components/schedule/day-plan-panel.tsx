"use client";

import { useState } from "react";
import { Pin, Plus, Repeat, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { StorePicker, type PickableStore } from "@/components/stores/store-picker";
import type { DayPlanStop, PlannedDay } from "@/lib/schedule";

/**
 * One day of one rep's month, opened for editing.
 *
 * **An inline panel, not a dialog**, and that is the whole point of the screen:
 * planning a day means adding a shop, then another, then another, and a modal
 * that closes on each write turns that into a dozen round trips through a
 * button. The picker here clears only once the write has landed, so a failed
 * add leaves the name still on screen instead of making somebody retype a store
 * they had just found.
 *
 * Every stop says where it came from. That distinction is not decoration: the
 * generator owns its own `'cycle'` rows and retracts them when the pattern
 * moves, and never touches a one-off. A manager deciding what to change needs
 * to know which of the two they are looking at.
 */

function formatFullDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function StopRow({
  stop,
  readOnly,
  busy,
  onRemove,
}: {
  stop: DayPlanStop;
  readOnly: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const oneOff = stop.source === "manual";

  return (
    <li
      className={[
        "flex flex-wrap items-center gap-3 px-3 py-2.5",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="min-w-[160px] flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="truncate">{stop.store_name}</span>
          {oneOff ? (
            <Badge
              variant="secondary"
              className="shrink-0 gap-1 text-[10px]"
              title="Pinned to this date only. The generator never writes it and never takes it away."
            >
              <Pin className="h-3 w-3" />
              One-off
            </Badge>
          ) : (
            // The counterpart the cycle rows never had. Without it, the only
            // labelled stops are the hand-added ones and the rest read as
            // permanent — when in fact these are the ones a re-generate can
            // move or withdraw.
            <Badge
              variant="outline"
              className="shrink-0 gap-1 text-[10px] font-normal text-muted-foreground"
              title="Written by the call cycle. Generating again may move it or take it away when the pattern changes."
            >
              <Repeat className="h-3 w-3" />
              From call cycle
            </Badge>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {stop.city ?? "No town"}
          {oneOff ? " · this date only" : " · repeats"}
          {stop.visited && " · already visited"}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-destructive"
        // A visited stop is never removable, whichever source wrote it:
        // `visits.route_id` is `on delete set null`, so deleting the route
        // succeeds and leaves a check-in that no longer says what it was for.
        // `generate_routes` refuses to retract these for the same reason.
        disabled={stop.visited || readOnly || busy}
        title={
          stop.visited
            ? "A rep has already checked in here, so this stop is part of the record now."
            : readOnly
              ? "This day has passed, so its stops cannot be changed."
              : oneOff
                ? "Remove this one-off stop"
                : "Remove this stop from this date. The call cycle still holds it, so generating again will put it back."
        }
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {busy ? "Removing…" : "Remove"}
      </Button>
    </li>
  );
}

export function DayPlanPanel({
  date,
  plan,
  storeOptions,
  storesPerDay,
  readOnly,
  readOnlyNote,
  canAddStops,
  stopBusy,
  onAdd,
  onRemove,
  onClose,
}: {
  date: Date;
  plan: PlannedDay | null;
  /** Every store, not just this rep's — a hand-added stop is usually cover. */
  storeOptions: PickableStore[];
  storesPerDay: number;
  /** The date has passed, or belongs to another month. Read but do not change. */
  /** Why it is read-only, in the panel's own voice. */
  readOnlyNote: string;
  readOnly: boolean;
  /** False until the org is known — `routes` cannot be written without it. */
  canAddStops: boolean;
  /** Route ids being removed, plus "add" while an insert is in flight. */
  stopBusy: ReadonlySet<string>;
  /** Resolves true when the stop landed, false when the write failed. */
  onAdd: (date: Date, storeIds: string[]) => Promise<boolean>;
  onRemove: (stop: DayPlanStop) => void;
  onClose: () => void;
}) {
  const [addStoreIds, setAddStoreIds] = useState<string[]>([]);

  const stops = plan?.stops ?? [];
  const oneOffs = stops.filter((s) => s.source === "manual").length;
  const heavy = stops.length > storesPerDay;

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {formatFullDate(date)}
          <span className="ml-2 font-normal text-muted-foreground">
            <span
              className={
                heavy ? "font-semibold text-destructive" : "text-muted-foreground"
              }
            >
              {stops.length} of {storesPerDay}
            </span>{" "}
            {stops.length === 1 ? "stop" : "stops"}
            {oneOffs > 0 &&
              ` · ${oneOffs} one-off${oneOffs === 1 ? "" : "s"}`}
            {plan && plan.towns.length > 1 && ` · ${plan.towns.join(", ")}`}
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </div>

      {stops.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing scheduled on this day yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {stops.map((s) => (
            <StopRow
              key={s.route_id}
              stop={s}
              readOnly={readOnly}
              busy={stopBusy.has(s.route_id)}
              onRemove={() => onRemove(s)}
            />
          ))}
        </ul>
      )}

      {readOnly ? (
        /* The reason comes from the parent: a day can be read-only because it
           has passed, or because the viewer cannot write routes at all, and
           telling somebody "this day has passed" about tomorrow would send them
           looking for a bug that is not there. */
        <p className="text-xs text-muted-foreground">{readOnlyNote}</p>
      ) : (
        <>
          {/* Offered on every day, including empty ones — a blank Tuesday is
              exactly where somebody wants to put a stop, and hiding the control
              behind "has stops already" would be backwards. */}
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-card/60 p-2.5">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label
                htmlFor="day-add-stop"
                className="text-xs text-muted-foreground"
              >
                Add stores to this day
              </Label>
              <StorePicker
                multiple
                id="day-add-stop"
                stores={storeOptions}
                value={addStoreIds}
                onChange={setAddStoreIds}
                placeholder="Search stores…"
                disabled={!canAddStops || stopBusy.has("add")}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={
                addStoreIds.length === 0 || !canAddStops || stopBusy.has("add")
              }
              onClick={async () => {
                const added = await onAdd(date, addStoreIds);
                // Cleared only once it landed, so the picker stays ready for
                // the next batch and a failure does not lose the picks.
                if (added) setAddStoreIds([]);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {stopBusy.has("add")
                ? "Adding…"
                : addStoreIds.length > 1
                  ? `Add ${addStoreIds.length} stops`
                  : "Add stop"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            A store added here sits on this date only. It does not join the call
            cycle, will not repeat, and survives every re-generate. To have a
            store called on regularly, give it a day on the Call cycle tab.
          </p>
        </>
      )}
    </div>
  );
}
