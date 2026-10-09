"use client";

import { Fragment } from "react";
import { FileSignature, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import { companyTime } from "@/lib/company-time";
import { minutesLabel, onSiteLabel, serviceLogTotals, type ServiceLogRow } from "@/lib/service-log";

/**
 * Proof of service, grouped by {site}: each finished {job} with who, when,
 * on site or not, forms and photos. The gap column appears only when a {site}
 * had more than one check-in on a day (rounds), where the longest gap is what
 * a client asks about.
 */
/** A job's report as the app sees it (Stage 8.3). */
export type ReportState = { signed_name: string | null; signed_at: string | null; last_queued_at: string | null };
export type ReportAction = "open" | "copy" | "send";

export function ServiceLogTable({
  rows,
  timeZone,
  reports = {},
  onReport,
}: {
  rows: ServiceLogRow[];
  timeZone: string | undefined;
  /** By visit id. */
  reports?: Record<string, ReportState>;
  /** Present when the person may open and send reports. */
  onReport?: (visitId: string, action: ReportAction) => void;
}) {
  const t = useTerms();
  // Times on the company\'s clock, like the dates beside them.
  const time = (iso: string | null) => companyTime(iso, timeZone) || "-";
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
            {onReport && <TableHead className="text-right">Report</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <Fragment key={r.visit_id}>
              {(i === 0 || rows[i - 1].store_id !== r.store_id) && (
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={8 + (rounds ? 1 : 0) + (onReport ? 1 : 0)} className="py-2">
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
                {onReport && (
                  <TableCell className="text-right whitespace-nowrap">
                    <ReportCell state={reports[r.visit_id]} onAction={(a) => onReport(r.visit_id, a)} />
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

/** Signed, sent or nothing yet, and what can be done with the report. */
function ReportCell({ state, onAction }: { state: ReportState | undefined; onAction: (a: ReportAction) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      {state?.signed_at ? (
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400" title={`Signed by ${state.signed_name}`}>
          Signed
        </span>
      ) : state?.last_queued_at ? (
        <span className="hidden text-xs text-muted-foreground sm:inline">Sent</span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Report actions">
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onAction("open")} className="gap-2">
            <FileSignature className="size-4" aria-hidden />
            Open report
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("copy")}>Copy link for the client</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("send")}>Send to the client now</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
