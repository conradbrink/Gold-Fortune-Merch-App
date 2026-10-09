import { toLocalDateInput, type DateRange } from "@/lib/date-range";

/**
 * Dates and times in the company's own timezone, for reports whose days are
 * the company's days (`org_timezone` in SQL). A manager or client reading
 * from another timezone sees the same days and times the company does.
 */

/** How far `timeZone`'s wall clock is ahead of UTC at `at`, in milliseconds. */
function offsetAt(timeZone: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a calendar day ("YYYY-MM-DD") starts in `timeZone`. */
export function companyMidnight(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // The two offsets either side of a daylight-saving change give two
  // candidates; the day starts at the earlier one that falls on it. Where the
  // clocks jump from 00:00 to 01:00 (Santiago, September) midnight never
  // happens and the day starts at 01:00.
  const first = guess - offsetAt(timeZone, guess);
  const second = guess - offsetAt(timeZone, first);
  const onDay = [first, second].filter((at) => localDate(timeZone, at) === day);
  return new Date(onDay.length > 0 ? Math.min(...onDay) : Math.max(first, second));
}

function localDate(timeZone: string, at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/**
 * The picked range's calendar days, as the company's midnights. The pickers
 * work in the viewer's days; the report's days are the company's.
 */
export function companyRange(range: DateRange, timeZone: string): DateRange {
  return {
    from: companyMidnight(toLocalDateInput(range.from), timeZone),
    to: companyMidnight(toLocalDateInput(range.to), timeZone),
  };
}

/** "08:05" in the company's timezone; "" for no time. */
export function companyTime(iso: string | null, timeZone: string | undefined): string {
  return iso
    ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })
    : "";
}
