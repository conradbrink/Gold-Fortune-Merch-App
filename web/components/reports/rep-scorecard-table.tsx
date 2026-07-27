"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatRate, type RepScore } from "@/lib/reports";

/**
 * Per-rep performance for the selected period.
 *
 * `verified_rate` counts only visits that actually recorded a GPS fix. A visit
 * with no fix is unknown, never a failure — scoring it as one would punish a
 * rep for a flat battery.
 */
export function RepScorecardTable({ rows }: { rows: RepScore[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No rep activity in this period.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rep</TableHead>
          <TableHead className="text-right">Completed</TableHead>
          <TableHead className="hidden sm:table-cell text-right">Completion</TableHead>
          <TableHead className="hidden md:table-cell text-right">Avg time</TableHead>
          <TableHead className="hidden lg:table-cell text-right">Stores</TableHead>
          <TableHead className="hidden md:table-cell text-right">Forms</TableHead>
          <TableHead className="text-right">Location verified</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.rep_id}>
            <TableCell className="font-medium">
              {r.rep_name ?? "Unknown rep"}
              <span className="block text-xs text-muted-foreground sm:hidden">
                {formatRate(r.completion_rate)} completion
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.visits_completed}
              <span className="text-muted-foreground"> / {r.visits_total}</span>
            </TableCell>
            <TableCell className="hidden sm:table-cell text-right tabular-nums">
              {formatRate(r.completion_rate)}
            </TableCell>
            <TableCell className="hidden md:table-cell text-right tabular-nums">
              {formatDuration(r.avg_duration_seconds)}
            </TableCell>
            <TableCell className="hidden lg:table-cell text-right tabular-nums">
              {r.stores_covered}
            </TableCell>
            <TableCell className="hidden md:table-cell text-right tabular-nums">
              {formatRate(r.form_compliance_rate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatRate(r.verified_rate)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
