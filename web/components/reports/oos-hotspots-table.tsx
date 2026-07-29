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
import { formatRate, type OosHotspot } from "@/lib/reports";

/**
 * Out-of-stock hotspots.
 *
 * The compliance trend chart shows the rate over time but cannot tell a chronic
 * store from an unlucky one. `max_consecutive_oos` is what separates them: four
 * consecutive visits finding an empty shelf is a supply or ordering problem;
 * four scattered ones across three months is noise.
 */
export function OosHotspotsTable({ rows }: { rows: OosHotspot[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No out-of-stock readings in this period.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Store</TableHead>
          <TableHead className="text-right">OOS rate</TableHead>
          <TableHead className="hidden sm:table-cell text-right">Occurrences</TableHead>
          <TableHead className="text-right">Worst run</TableHead>
          <TableHead className="hidden lg:table-cell">Most-cited SKUs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.store_id}>
            <TableCell className="font-medium">
              {r.store_name}
              {r.last_oos_at && (
                <span className="block text-xs text-muted-foreground">
                  last {new Date(r.last_oos_at).toLocaleDateString()}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatRate(r.oos_rate)}
            </TableCell>
            <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
              {r.oos_count} of {r.checks}
            </TableCell>
            <TableCell className="text-right">
              <RunBadge run={r.max_consecutive_oos} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              {r.top_skus.length === 0 ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {r.top_skus.map((s) => (
                    <Badge key={s.sku} variant="outline" className="font-normal">
                      {s.sku}
                      {s.n > 1 && (
                        <span className="ml-1 text-muted-foreground">×{s.n}</span>
                      )}
                    </Badge>
                  ))}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RunBadge({ run }: { run: number }) {
  const n = Number(run);
  if (n >= 3) {
    return <Badge variant="destructive">{n} in a row</Badge>;
  }
  if (n === 2) {
    return <Badge variant="secondary">2 in a row</Badge>;
  }
  // A run of 1 is the normal, non-alarming case — don't dress it as a finding.
  return <span className="text-sm text-muted-foreground">isolated</span>;
}
