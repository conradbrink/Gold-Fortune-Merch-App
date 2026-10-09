"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import { companyTime } from "@/lib/company-time";
import { clockDuration, hoursTotals, type HoursDay } from "@/lib/staff-hours";

/**
 * Hours: one row per person per day, newest first. A short or long day is
 * named in words, not only in colour; a day still open says so. With an
 * overtime rule on, each day is split into normal hours and overtime.
 */
export function HoursTable({
  days,
  timeZone,
  overtime = false,
}: {
  days: HoursDay[];
  timeZone: string | undefined;
  overtime?: boolean;
}) {
  const t = useTerms();
  // Times on the company\'s clock, like the dates beside them.
  const time = (iso: string | null) => companyTime(iso, timeZone) || "-";
  if (days.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-pretty text-muted-foreground">
        No workdays in this period yet. Hours fill in when your team starts their day on the phone.
      </p>
    );
  }
  const totals = hoursTotals(days);

  return (
    <div>
      <p className="border-b border-border px-4 pb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{clockDuration(totals.workdaySeconds)}</span> hours worked by{" "}
        <span className="tabular-nums">{totals.people}</span> {lower(totals.people === 1 ? t.staff.one : t.staff.many)},{" "}
        <span className="tabular-nums">{clockDuration(totals.onsiteSeconds)}</span> of it on site,{" "}
        {overtime && (
          <>
            <span className="tabular-nums">{clockDuration(totals.overtimeSeconds)}</span> of it overtime,{" "}
          </>
        )}
        <span className="tabular-nums">{totals.km.toLocaleString("en-GB")}</span> km
        {totals.short > 0 && (
          <>
            , <span className="tabular-nums">{totals.short}</span> short {totals.short === 1 ? "day" : "days"}
          </>
        )}
        {totals.long > 0 && (
          <>
            , <span className="tabular-nums">{totals.long}</span> long {totals.long === 1 ? "day" : "days"}
          </>
        )}
        .
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.staff.one}</TableHead>
            <TableHead className="hidden sm:table-cell">Date</TableHead>
            <TableHead className="hidden text-right sm:table-cell">First in</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Last out</TableHead>
            <TableHead className="text-right">Workday</TableHead>
            {overtime && <TableHead className="hidden text-right lg:table-cell">Normal</TableHead>}
            {overtime && <TableHead className="hidden text-right sm:table-cell">Overtime</TableHead>}
            <TableHead className="hidden text-right md:table-cell">On site</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Between</TableHead>
            <TableHead className="text-right">{t.job.many}</TableHead>
            <TableHead className="hidden text-right md:table-cell">Km</TableHead>
            <TableHead className="hidden lg:table-cell">Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((d) => (
            <TableRow key={`${d.staff_id}-${d.day}`}>
              <TableCell className="max-w-40 truncate font-medium">
                {d.staff_name ?? "-"}
                {/* On a phone the date sits under the name rather than in its own column. */}
                <span className="block text-xs font-normal tabular-nums text-muted-foreground sm:hidden">{d.day}</span>
              </TableCell>
              <TableCell className="hidden tabular-nums whitespace-nowrap sm:table-cell">{d.day}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{time(d.first_in)}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{d.open_now ? "Open" : time(d.last_out)}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {d.workday_seconds > 0 ? clockDuration(d.workday_seconds) : "-"}
                {d.mark && (
                  <span className="ml-1.5 text-xs font-medium text-destructive">{d.mark === "short" ? "short" : "long"}</span>
                )}
                {/* On a phone the overtime sits under the workday rather than in its own column. */}
                {overtime && (d.overtimeSeconds ?? 0) > 0 && (
                  <span className="block text-xs text-muted-foreground sm:hidden">{clockDuration(d.overtimeSeconds)} over</span>
                )}
              </TableCell>
              {overtime && (
                <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
                  {clockDuration(d.normalSeconds)}
                </TableCell>
              )}
              {overtime && (
                <TableCell
                  className={`hidden text-right tabular-nums sm:table-cell ${(d.overtimeSeconds ?? 0) > 0 ? "font-medium" : "text-muted-foreground"}`}
                >
                  {clockDuration(d.overtimeSeconds)}
                </TableCell>
              )}
              <TableCell className="hidden text-right tabular-nums md:table-cell">{clockDuration(d.onsite_seconds)}</TableCell>
              <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
                {clockDuration(d.betweenSeconds)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{d.jobs}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{d.km ?? "-"}</TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                {d.open_now ? "Workday still open" : !d.first_in ? "No workday started" : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
