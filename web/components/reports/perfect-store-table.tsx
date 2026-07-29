"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PerfectStore } from "@/lib/reports";

/**
 * Perfect Store index — one 0–100 score per store, worst first.
 *
 * The pillars are shown alongside the score because the score alone tells a
 * manager a store is bad, not what to fix. 7-Eleven scoring 80 on strong
 * availability but 60% price accuracy is a price conversation, not a stock one.
 *
 * `promo_display` is deliberately not a pillar — it reflects whether a promo was
 * running, not whether the store executed, so it would penalise everyone for
 * something nobody can act on.
 */
export function PerfectStoreTable({ rows }: { rows: PerfectStore[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No active stores to score.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Store</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="hidden sm:table-cell text-right">Availability</TableHead>
          <TableHead className="hidden md:table-cell text-right">Planogram</TableHead>
          <TableHead className="hidden md:table-cell text-right">Price</TableHead>
          <TableHead className="hidden lg:table-cell text-right">Condition</TableHead>
          <TableHead className="hidden lg:table-cell text-right">Audits</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.store_id}>
            <TableCell className="font-medium">
              {r.store_name}
              <span className="block text-xs text-muted-foreground">
                {r.store_group ?? "—"}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <ScoreBadge score={r.score} />
            </TableCell>
            <Pillar value={r.availability_pct} className="hidden sm:table-cell" />
            <Pillar value={r.planogram_pct} className="hidden md:table-cell" />
            <Pillar value={r.price_pct} className="hidden md:table-cell" />
            <Pillar value={r.condition_pct} className="hidden lg:table-cell" />
            <TableCell className="hidden lg:table-cell text-right tabular-nums text-muted-foreground">
              {r.audits}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Null means "not measured", which must never render as a red 0%. */
function Pillar({ value, className }: { value: number | null; className?: string }) {
  if (value === null || value === undefined) {
    return (
      <TableCell className={`${className} text-right text-muted-foreground`}>
        <span title="Not measured in this period">—</span>
      </TableCell>
    );
  }
  const v = Number(value);
  const tone =
    v >= 90 ? "text-emerald-600 dark:text-emerald-400"
    : v >= 75 ? "text-foreground"
    : "text-amber-600 dark:text-amber-400";
  return (
    <TableCell className={`${className} text-right tabular-nums ${tone}`}>
      {v.toFixed(0)}%
    </TableCell>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-sm text-muted-foreground">No data</span>;
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
    >
      {v.toFixed(0)}
    </span>
  );
}
