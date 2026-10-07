"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
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
import { fetchOffsiteCheckins, type OffsiteCheckin } from "@/lib/dashboard";
import {
  fromLocalDateInput,
  rangeForPreset,
  toLocalDateInput,
  toLocalDateTime,
  type DateRange,
} from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { createClient } from "@/lib/supabase/client";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

/** 4490 → "4.5 km", 730 → "730 m". */
function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/**
 * Google Maps directions from where the phone was to where the store is: the
 * quickest way for a manager to see *where* the rep actually was — another
 * store, a depot, home — without us drawing a map for it.
 */
function mapsHref(c: OffsiteCheckin): string | null {
  if (c.checkin_lat == null || c.checkin_lng == null || c.store_lat == null || c.store_lng == null) {
    return null;
  }
  const params = new URLSearchParams({
    api: "1",
    origin: `${c.checkin_lat},${c.checkin_lng}`,
    destination: `${c.store_lat},${c.store_lng}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * The check-ins behind the dashboard's "Check-ins over 500 m from store".
 * Opened from that number with the dashboard's range in the URL, so the list
 * answers the question that was clicked rather than the default 30 days.
 */
export default function OffsiteCheckinsPage() {
  const t = useTerms();
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [urlRead, setUrlRead] = useState(false);
  const [rows, setRows] = useState<OffsiteCheckin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** A rep's id, or "" for everyone. */
  const [repId, setRepId] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on Reports: the picker owns the range from here.
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
    fetchOffsiteCheckins(createClient(), range)
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

  const offSiteM = rows[0]?.off_site_m ?? 500;
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
      title: "Off-site check-ins",
      context: [
        rangeLabel,
        `Over ${offSiteM} m from a confirmed ${lower(t.site.one)} position, after GPS error`,
        repName ? `${t.staff.one}: ${repName}` : `All ${lower(t.staff.many)}`,
      ],
      filename: "off-site-checkins",
      columns: [
        { header: "Checked in", key: "at" },
        { header: t.staff.one, key: "rep" },
        { header: t.site.one, key: "store" },
        { header: "Distance (m)", key: "distance", numeric: true },
        { header: "GPS accuracy (m)", key: "accuracy", numeric: true },
      ],
      rows: shown.map((r) => ({
        at: toLocalDateTime(r.checkin_at),
        rep: r.rep_name ?? "",
        store: r.store_name,
        distance: Math.round(r.distance_m),
        accuracy: r.gps_accuracy_m == null ? null : Math.round(r.gps_accuracy_m),
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
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Off-site check-ins</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Check-ins more than {offSiteM} m from the {lower(t.site.one)} even after allowing for the phone&apos;s GPS
            error. Only {lower(t.site.many)} whose position has been confirmed are counted, and readings over the
            company&apos;s invalid-GPS distance are left out as bad fixes.
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
              <TableHead className="text-right">Distance</TableHead>
              <TableHead className="hidden text-right md:table-cell">GPS ±</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Loading check-ins…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">Could not load check-ins</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No off-site check-ins in this period.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => {
                const href = mapsHref(r);
                return (
                  <TableRow key={r.visit_id}>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {toLocalDateTime(r.checkin_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/tracking/${r.rep_id}`} className="hover:underline">
                        {r.rep_name ?? `Unknown ${lower(t.staff.one)}`}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-[160px] text-sm font-medium">{r.store_name}</TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {formatDistance(r.distance_m)}
                    </TableCell>
                    <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground md:table-cell">
                      {r.gps_accuracy_m == null ? "—" : `${Math.round(r.gps_accuracy_m)} m`}
                    </TableCell>
                    <TableCell>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Where the phone was, and the route to the ${lower(t.site.one)}`}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline"
                        >
                          <MapPin className="h-3.5 w-3.5" /> Map
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {shown.length} check-in{shown.length === 1 ? "" : "s"}, {rangeLabel}.
        </p>
      )}
    </div>
  );
}
