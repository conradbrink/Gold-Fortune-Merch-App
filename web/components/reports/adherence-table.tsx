"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRate, type Adherence } from "@/lib/reports";

/**
 * Planned routes versus what actually happened.
 *
 * Future-dated routes are excluded server-side — a visit scheduled for tomorrow
 * is not missed, and counting it would make every rep look negligent.
 */
export function AdherenceTable({ rows }: { rows: Adherence[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No routes were scheduled in this period.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rep</TableHead>
          <TableHead className="text-right">Adherence</TableHead>
          <TableHead className="hidden sm:table-cell text-right">Planned</TableHead>
          <TableHead className="text-right">Missed</TableHead>
          <TableHead className="hidden lg:table-cell">Missed visits</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.rep_id}>
            <TableCell className="font-medium">
              {r.rep_name ?? "Unknown rep"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <span className={toneFor(r.adherence_rate)}>
                {formatRate(r.adherence_rate)}
              </span>
            </TableCell>
            <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
              {r.completed} of {r.planned}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.missed > 0 ? (
                <span className="font-medium text-destructive">{r.missed}</span>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              {r.missed_detail.length === 0 ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {r.missed_detail
                    .slice(0, 3)
                    .map((m) => `${m.store} (${m.date})`)
                    .join(", ")}
                  {r.missed_detail.length > 3 &&
                    ` +${r.missed_detail.length - 3} more`}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function toneFor(rate: number | null): string {
  if (rate === null || rate === undefined) return "text-muted-foreground";
  const v = Number(rate);
  if (v >= 0.9) return "text-emerald-600 dark:text-emerald-400";
  if (v >= 0.75) return "text-foreground";
  return "text-amber-600 dark:text-amber-400";
}
