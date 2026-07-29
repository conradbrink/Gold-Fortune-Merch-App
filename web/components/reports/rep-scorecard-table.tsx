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
 * Overall score, with the location-verification pillar surfaced on hover — it
 * is the one input a manager is most likely to want to interrogate, and it is
 * no longer a column of its own.
 */
function RepScoreBadge({
  score,
  verified,
}: {
  score: number | null;
  verified: number | null;
}) {
  if (score === null || score === undefined) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const v = Number(score);
  const tone =
    v >= 90 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : v >= 80 ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
    : v >= 70 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : "bg-destructive/15 text-destructive";
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${tone}`}
      title={`Completion, form compliance and location verification averaged. Location verified: ${formatRate(
        verified
      )}`}
    >
      {v.toFixed(0)}
    </span>
  );
}

/**
 * Per-rep performance for the selected period, ranked by overall score.
 *
 * `score` is the mean of completion, form compliance and location verification.
 * `verified_rate` counts only visits that actually recorded a GPS fix — a visit
 * with no fix is unknown, never a failure, since scoring it as one would punish
 * a rep for a flat battery.
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
          <TableHead className="text-right">Score</TableHead>
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
            <TableCell className="text-right">
              <RepScoreBadge score={r.score} verified={r.verified_rate} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
