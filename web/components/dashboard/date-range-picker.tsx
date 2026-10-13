"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PRESET_LABELS,
  fromLocalDateInput,
  rangeForPreset,
  toLocalDateInput,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "month"];

/**
 * Presets plus two native date inputs.
 *
 * Deliberately not shadcn `popover` + `calendar`: neither is installed, and the
 * same class of overlay component is what made `Select` unusable inside a
 * `Dialog` here. A native date input works everywhere, including on a phone.
 */
export function DateRangePicker({
  value,
  onChange,
  className,
  allTime = false,
  onAllTime,
  presets = PRESETS,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  /** Whether "All time" is the choice; the dates then stand by, dimmed. */
  allTime?: boolean;
  /** Offer "All time" after the presets, for a page that can show every date. */
  onAllTime?: () => void;
  /** The quick choices, when a page wants other ones (Sales adds "This week"). */
  presets?: RangePreset[];
}) {
  // `to` is exclusive (start of the day after), so display one day earlier.
  const displayTo = new Date(value.to);
  displayTo.setDate(displayTo.getDate() - 1);

  function activePreset(): RangePreset | null {
    for (const p of presets) {
      const r = rangeForPreset(p);
      if (
        toLocalDateInput(r.from) === toLocalDateInput(value.from) &&
        toLocalDateInput(r.to) === toLocalDateInput(value.to)
      ) {
        return p;
      }
    }
    return null;
  }

  const active = allTime ? null : activePreset();

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={active === p ? "default" : "outline"}
            onClick={() => onChange(rangeForPreset(p))}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
        {onAllTime && (
          <Button size="sm" variant={allTime ? "default" : "outline"} onClick={onAllTime}>
            All time
          </Button>
        )}
      </div>

      <div className={cn("flex items-center gap-1.5", allTime && "opacity-60")}>
        <Input
          type="date"
          aria-label="From date"
          className="w-[9.5rem]"
          value={toLocalDateInput(value.from)}
          onChange={(e) => {
            if (!e.target.value) return;
            onChange({ ...value, from: fromLocalDateInput(e.target.value) });
          }}
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label="To date"
          className="w-[9.5rem]"
          value={toLocalDateInput(displayTo)}
          onChange={(e) => {
            if (!e.target.value) return;
            // Convert the inclusive date the user picked back to an exclusive end.
            const next = fromLocalDateInput(e.target.value);
            next.setDate(next.getDate() + 1);
            onChange({ ...value, to: next });
          }}
        />
      </div>
    </div>
  );
}
