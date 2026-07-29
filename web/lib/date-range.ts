export type RangePreset = "7d" | "30d" | "90d" | "month";

export type DateRange = {
  /** Inclusive start. */
  from: Date;
  /** Exclusive end — always the start of the day after the last day shown. */
  to: Date;
};

/**
 * `YYYY-MM-DD` in the *viewer's* timezone.
 *
 * `toISOString().slice(0, 10)` is UTC, so east of Greenwich "today" flips
 * early — in CAT (UTC+2, Botswana) a manager opening the dashboard at 01:00
 * would see tomorrow's date. Always use this for `<input type="date">` values.
 */
export function toLocalDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parses a `YYYY-MM-DD` input value as local midnight, not UTC midnight. */
export function fromLocalDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function rangeForPreset(preset: RangePreset, now = new Date()): DateRange {
  // Exclusive end: start of tomorrow, so today's activity is included.
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const from = new Date(to);

  switch (preset) {
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "30d":
      from.setDate(from.getDate() - 30);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
  }
  return { from, to };
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  month: "This month",
};

/** How many whole days the range covers — used to label deltas honestly. */
export function rangeDays({ from, to }: DateRange): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}
