"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { CoverageGap } from "@/lib/reports";

/**
 * Stores ranked by how long they have gone unvisited.
 *
 * `days_since` is measured over all history, not the selected range — "last
 * visited" has to mean last visited, or a narrow filter would make every store
 * look neglected.
 */
export function CoverageTable({ rows }: { rows: CoverageGap[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No active stores to report on.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Store</TableHead>
          <TableHead className="hidden sm:table-cell">Group</TableHead>
          <TableHead className="hidden md:table-cell">Responsible</TableHead>
          <TableHead className="text-right">Visits in period</TableHead>
          <TableHead className="text-right">Last visit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.store_id}>
            <TableCell className="font-medium">
              {r.store_name}
              <span className="block text-xs text-muted-foreground sm:hidden">
                {r.store_group ?? "—"}
              </span>
              {(r.city || r.state) && (
                <span className="block text-xs text-muted-foreground">
                  {[r.city, r.state].filter(Boolean).join(", ")}
                </span>
              )}
            </TableCell>
            <TableCell className="hidden sm:table-cell text-muted-foreground">
              {r.store_group ?? "—"}
            </TableCell>
            <TableCell className="hidden md:table-cell text-muted-foreground">
              {r.assigned_reps ?? (
                <span className="italic text-amber-600 dark:text-amber-400">
                  Unassigned
                </span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.visits_in_period}
            </TableCell>
            <TableCell className="text-right">
              <GapBadge days={r.days_since} last={r.last_visit_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function GapBadge({ days, last }: { days: number | null; last: string | null }) {
  // A store that has never been visited is the biggest gap there is — it must
  // not render as a neutral dash alongside "visited yesterday".
  if (last === null || days === null) {
    return <Badge variant="destructive">Never visited</Badge>;
  }
  const d = Number(days);
  const label = d < 1 ? "Today" : `${Math.floor(d)}d ago`;
  if (d >= 14) return <Badge variant="destructive">{label}</Badge>;
  if (d >= 7) return <Badge variant="secondary">{label}</Badge>;
  return <span className="text-sm text-muted-foreground">{label}</span>;
}
