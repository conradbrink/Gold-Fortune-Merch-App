"use client";

import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import { minutesLabel, onSiteLabel, serviceLogTotals, type ServiceLogRow } from "@/lib/service-log";

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-";

/**
 * Proof of service, grouped by {site}: each finished {job} with who, when,
 * on site or not, forms and photos. The gap column appears only when a {site}
 * had more than one check-in on a day (rounds), where the longest gap is what
 * a client asks about.
 */
export function ServiceLogTable({ rows }: { rows: ServiceLogRow[] }) {
  const t = useTerms();
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-pretty text-muted-foreground">
        No finished {lower(t.job.many)} in this period yet. Proof of service fills in as your team checks in and out.
      </p>
    );
  }
  const totals = serviceLogTotals(rows);
  const rounds = totals.longestGap !== null;

  return (
    <div>
      <p className="border-b border-border px-4 pb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{totals.jobs}</span> {lower(t.job.many)} at{" "}
        <span className="tabular-nums">{totals.places}</span> {lower(totals.places === 1 ? t.site.one : t.site.many)},{" "}
        <span className="tabular-nums">{totals.onSite}</span> of <span className="tabular-nums">{totals.withFix}</span> checked in on
        site, <span className="tabular-nums">{totals.photos}</span> photos
        {rounds && (
          <>
            , longest gap <span className="tabular-nums">{minutesLabel(totals.longestGap)}</span>
          </>
        )}
        .
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden sm:table-cell">Date</TableHead>
            <TableHead>{t.staff.one}</TableHead>
            <TableHead className="text-right">In</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Out</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Time</TableHead>
            <TableHead>GPS</TableHead>
            <TableHead className="hidden text-right md:table-cell">Forms</TableHead>
            <TableHead className="text-right">Photos</TableHead>
            {rounds && <TableHead className="hidden text-right lg:table-cell">Since last</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <Fragment key={r.visit_id}>
              {(i === 0 || rows[i - 1].store_id !== r.store_id) && (
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={rounds ? 9 : 8} className="py-2">
                    <span className="font-medium text-foreground">{r.store_name}</span>
                    {r.store_address && <span className="ml-2 text-xs text-muted-foreground">{r.store_address}</span>}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="hidden tabular-nums whitespace-nowrap sm:table-cell">{r.day}</TableCell>
                <TableCell className="max-w-40 truncate">
                  {r.staff_name ?? "-"}
                  {!r.planned && <span className="ml-1.5 text-xs text-muted-foreground">(extra)</span>}
                  {/* On a phone the date sits under the name rather than in its own column. */}
                  <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">{r.day}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{time(r.checkin_at)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{time(r.checkout_at)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{minutesLabel(r.minutes)}</TableCell>
                <TableCell
                  className={`whitespace-nowrap ${r.on_site === false ? "font-medium text-destructive" : r.on_site === null ? "text-muted-foreground" : ""}`}
                >
                  {onSiteLabel(r.on_site)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{r.forms}</TableCell>
                <TableCell className="text-right tabular-nums">{r.photos}</TableCell>
                {rounds && (
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
                    {r.gap_minutes === null ? "-" : minutesLabel(r.gap_minutes)}
                  </TableCell>
                )}
              </TableRow>
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
