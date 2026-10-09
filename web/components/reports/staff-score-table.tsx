"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import { MIN_EVENTS, findPart, type TeamScore, type Weight } from "@/lib/staff-score";

function tone(score: number) {
  return score >= 90
    ? "text-emerald-700 dark:text-emerald-400"
    : score >= 80
      ? "text-foreground"
      : score >= 70
        ? "text-amber-700 dark:text-amber-400"
        : "text-destructive";
}

/**
 * Everyone's score on the company's weights, best first: the band in words
 * beside the number, each part's result (or why it sits out), and the one
 * part to work on next. The employee report shows the same score for each
 * person, with every part's basis.
 */
export function StaffScoreTable({ scores, weights }: { scores: TeamScore[]; weights: Weight[] }) {
  const t = useTerms();
  if (scores.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-pretty text-muted-foreground">
        No {lower(t.staff.many)} worked in this period yet. Scores fill in as planned {lower(t.job.many)} are done.
      </p>
    );
  }
  // Parts nothing measures yet are the same for everyone: said once, not in every row.
  const waiting = weights.filter((w) => findPart(w.code)?.needs);
  const shown = weights.filter((w) => !findPart(w.code)?.needs);

  return (
    <div>
      {waiting.length > 0 && (
        <p className="border-b border-border px-4 pb-3 text-sm text-pretty text-muted-foreground">
          Not measured yet, so shared across the rest:{" "}
          {waiting.map((w, i) => (
            <span key={w.code}>
              {i > 0 && ", "}
              {findPart(w.code)!.label(t)} ({w.weight}%)
            </span>
          ))}
          .
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.staff.one}</TableHead>
            <TableHead className="text-right">Score</TableHead>
            {shown.map((w) => (
              <TableHead key={w.code} className="hidden text-right lg:table-cell">
                {findPart(w.code)!.label(t)}
                <span className="ml-1 font-normal text-muted-foreground">{w.weight}%</span>
              </TableHead>
            ))}
            <TableHead className="hidden md:table-cell">Work on this next</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {scores.map(({ staffId, name, result }) => (
            <TableRow key={staffId}>
              <TableCell className="max-w-44 truncate font-medium">
                {name || "-"}
                {/* On a phone the next step sits under the name rather than in its own column. */}
                {result.focus && (
                  <span className="block truncate text-xs font-normal text-muted-foreground md:hidden">
                    Next: {result.focus.label}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                {result.score === null ? (
                  <span className="text-sm text-muted-foreground">Not enough data</span>
                ) : (
                  <>
                    <span className={`font-semibold tabular-nums ${tone(result.score)}`}>{result.score}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">{result.band}</span>
                  </>
                )}
              </TableCell>
              {shown.map((w) => {
                const c = result.components.find((x) => x.key === w.code);
                return (
                  <TableCell key={w.code} className="hidden text-right tabular-nums lg:table-cell" title={c?.basis}>
                    {c?.state === "scored" ? (
                      `${Math.round(c.value ?? 0)}%`
                    ) : (
                      <span className="text-xs text-muted-foreground">{c?.state === "not_enough" ? `under ${MIN_EVENTS}` : "-"}</span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{result.focus?.label ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
