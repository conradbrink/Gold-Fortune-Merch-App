"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchShortVisits, formatVisitMinutes, type ShortVisit } from "@/lib/dashboard";
import {
  fromLocalDateInput,
  rangeForPreset,
  toLocalDateInput,
  toLocalDateTime,
  type DateRange,
} from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { count, lower } from "@/lib/terms";

/** "07:31" from an ISO timestamp, in the browser's zone like the rest of the row. */
function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The visits behind the dashboard's "Visits under N min": checked out sooner
 * than the company's short-visit setting, which is the same number the phone
 * warns the rep about ("Short visits are flagged for your manager"). Opened
 * from that number with the dashboard's range in the URL, like the off-site
 * list.
 */
export default function ShortVisitsPage() {
  const t = useTerms();
  const configMinutes = useCompanyConfig()?.settings.short_visit_minutes ?? 5;
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [urlRead, setUrlRead] = useState(false);
  const [rows, setRows] = useState<ShortVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** A rep's id, or "" for everyone. */
  const [repId, setRepId] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on the off-site list: the picker owns the range from here.
    const q = new URLSearchParams(window.location.search);
    const from = q.get("from");
    const to = q.get("to");
    if (from && to) {
      const parsed = { from: fromLocalDateInput(from), to: fromLocalDateInput(to) };
      if (!Number.isNaN(+parsed.from) && !Number.isNaN(+parsed.to)) setRange(parsed);
    }
    setUrlRead(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!urlRead) return;
    let stale = false;
    fetchShortVisits(createClient(), range)
      .then((r) => {
        if (!stale) setRows(r);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [urlRead, range]);

  /** Loading and error reset here, not in the fetch effect, so it only syncs. */
  function changeRange(next: DateRange) {
    setLoading(true);
    setError(null);
    setRange(next);
  }

  // The database's own threshold when there are rows, so the words match the list.
  const shortM = rows[0]?.short_visit_minutes ?? configMinutes;
  const byRep = [...rows.reduce((m, r) => {
    const cur = m.get(r.rep_id) ?? { name: r.rep_name ?? `Unknown ${lower(t.staff.one)}`, n: 0 };
    cur.n += 1;
    return m.set(r.rep_id, cur);
  }, new Map<string, { name: string; n: number }>())].sort((a, b) => b[1].n - a[1].n);
  // A rep picked in another range may have nothing in this one; fall back to
  // everyone rather than an empty list with no chip lit.
  const activeRep = byRep.some(([id]) => id === repId) ? repId : "";
  const shown = activeRep ? rows.filter((r) => r.rep_id === activeRep) : rows;

  const lastDay = new Date(range.to);
  lastDay.setDate(lastDay.getDate() - 1);
  const rangeLabel = `${toLocalDateInput(range.from)} to ${toLocalDateInput(lastDay)}`;

  function buildSheet(): ExportSheet {
    const repName = byRep.find(([id]) => id === activeRep)?.[1].name;
    return {
      title: `Short ${lower(t.job.many)}`,
      context: [
        rangeLabel,
        `Checked out in under ${shortM} minutes`,
        repName ? `${t.staff.one}: ${repName}` : `All ${lower(t.staff.many)}`,
      ],
      filename: "short-visits",
      columns: [
        { header: "Checked in", key: "in" },
        { header: "Checked out", key: "out" },
        { header: "Minutes", key: "minutes", numeric: true },
        { header: t.staff.one, key: "rep" },
        { header: t.site.one, key: "store" },
      ],
      rows: shown.map((r) => ({
        in: toLocalDateTime(r.checkin_at),
        out: toLocalDateTime(r.checkout_at),
        minutes: Math.round(r.minutes * 10) / 10,
        rep: r.rep_name ?? "",
        store: r.store_name,
      })),
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Short {lower(t.job.many)}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t.job.many} checked out in under {shortM} minutes, the same limit the app warns your{" "}
            {lower(t.staff.many)} about before they leave. Change it in Company settings.
          </p>
        </div>
        <ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />
      </div>

      <DateRangePicker value={range} onChange={changeRange} />

      {byRep.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={activeRep === "" ? "default" : "outline"} onClick={() => setRepId("")}>
            Everyone · {rows.length}
          </Button>
          {byRep.map(([id, r]) => (
            <Button key={id} size="sm" variant={activeRep === id ? "default" : "outline"} onClick={() => setRepId(id)}>
              {r.name} · {r.n}
            </Button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Checked in</TableHead>
              <TableHead>{t.staff.one}</TableHead>
              <TableHead>{t.site.one}</TableHead>
              <TableHead className="text-right">Time on {lower(t.site.one)}</TableHead>
              <TableHead className="hidden text-right md:table-cell">Left at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Loading {lower(t.job.many)}…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">Could not load {lower(t.job.many)}</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No short {lower(t.job.many)} in this period.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.visit_id}>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">{toLocalDateTime(r.checkin_at)}</TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/tracking/${r.rep_id}`} className="hover:underline">
                      {r.rep_name ?? `Unknown ${lower(t.staff.one)}`}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-[160px] text-sm font-medium">{r.store_name}</TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                    {formatVisitMinutes(r.minutes)}
                  </TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground md:table-cell">
                    {timeOnly(r.checkout_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {count(t, "job", shown.length)}, {rangeLabel}.
        </p>
      )}
    </div>
  );
}
