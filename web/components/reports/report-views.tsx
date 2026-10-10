"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { companyTime } from "@/lib/company-time";
import { minutesText } from "@/lib/alerts";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import type { ServiceLogRow } from "@/lib/service-log";
import { hoursText, pct, type MissedRow, type TeamRow } from "@/lib/report-summary";

/**
 * The pieces of the new report views (Performance summary, Service, the team
 * breakdown), in the same visual language as the existing report tables: plain
 * tables, outline tiles, one chart colour.
 */

export type Tile = {
  label: string;
  value: string;
  sub?: string;
  /** Opens the report behind the figure, on this page. */
  onClick?: () => void;
};

/**
 * The headline figures of a report. A figure the company has no data for is
 * not given a tile. A tile with somewhere to go is a button: the report
 * behind the number is one click away.
 */
export function SummaryTiles({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) =>
        t.onClick ? (
          <button
            key={t.label}
            type="button"
            onClick={t.onClick}
            className="rounded-xl text-left transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0"
          >
            <StatTile tone="outline" label={t.label} value={t.value} sublabel={t.sub} className="h-full" />
          </button>
        ) : (
          <StatTile key={t.label} tone="outline" label={t.label} value={t.value} sublabel={t.sub} />
        )
      )}
    </div>
  );
}

/** One bar per day: the shape of the period at a glance. */
export function DailyBars({ data, label }: { data: { day: string; value: number }[]; label: string }) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nothing finished in this period yet.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={12}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "var(--color-muted)" }}
            formatter={(v) => [String(v), label]}
            labelFormatter={(d) => String(d)}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Bar dataKey="value" name={label} fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The team, one row each: planned, done, missed and hours. A name opens that
 * person's full performance report for the same period.
 */
export function TeamBreakdownTable({ rows, reportHref }: { rows: TeamRow[]; reportHref: (staffId: string) => string }) {
  const t = useTerms();
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No planned work and no hours in this period.</p>;
  }
  const showPlan = rows.some((r) => r.planned !== null);
  const showHours = rows.some((r) => r.hours !== null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.staff.one}</TableHead>
          {showPlan && <TableHead className="text-right">Planned</TableHead>}
          {showPlan && <TableHead className="text-right">Done</TableHead>}
          {showPlan && <TableHead className="text-right">Missed</TableHead>}
          {showPlan && <TableHead className="hidden sm:table-cell text-right">Adherence</TableHead>}
          {showHours && <TableHead className="text-right">Hours</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.staffId}>
            <TableCell className="font-medium">
              <Link href={reportHref(r.staffId)} className="hover:underline focus-visible:underline">
                {r.name || "Unnamed"}
              </Link>
            </TableCell>
            {showPlan && <TableCell className="text-right tabular-nums">{r.planned ?? "—"}</TableCell>}
            {showPlan && <TableCell className="text-right tabular-nums">{r.completed ?? "—"}</TableCell>}
            {showPlan && <TableCell className="text-right tabular-nums">{r.missed ?? "—"}</TableCell>}
            {showPlan && <TableCell className="hidden sm:table-cell text-right tabular-nums">{pct(r.adherence)}</TableCell>}
            {showHours && <TableCell className="text-right tabular-nums">{hoursText(r.hours)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Every finished job in the period: when, where, who, and how long. */
export function CompletedTable({ rows, timeZone }: { rows: ServiceLogRow[]; timeZone: string | undefined }) {
  const t = useTerms();
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">No {lower(t.job.many)} were finished in this period.</p>
    );
  }
  const time = (iso: string | null) => companyTime(iso, timeZone) || "-";
  const sorted = [...rows].sort((a, b) => b.checkin_at.localeCompare(a.checkin_at));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>{t.site.one}</TableHead>
          <TableHead className="hidden sm:table-cell">{t.staff.one}</TableHead>
          <TableHead className="text-right">Start</TableHead>
          <TableHead className="text-right">End</TableHead>
          <TableHead className="text-right">Time</TableHead>
          <TableHead className="hidden md:table-cell">Planned</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.visit_id}>
            <TableCell className="tabular-nums">{r.day}</TableCell>
            <TableCell className="font-medium">{r.store_name}</TableCell>
            <TableCell className="hidden sm:table-cell">{r.staff_name ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{time(r.checkin_at)}</TableCell>
            <TableCell className="text-right tabular-nums">{time(r.checkout_at)}</TableCell>
            <TableCell className="text-right tabular-nums">{r.minutes === null ? "—" : minutesText(r.minutes)}</TableCell>
            <TableCell className="hidden md:table-cell text-muted-foreground">{r.planned ? "Planned" : "Not planned"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Every planned job that was not done, newest first. */
export function MissedTable({ rows }: { rows: MissedRow[] }) {
  const t = useTerms();
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No planned {lower(t.job.many)} were missed in this period.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>{t.site.one}</TableHead>
          <TableHead>{t.staff.one}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.date}-${r.site}-${r.staff}-${i}`}>
            <TableCell className="tabular-nums">{r.date}</TableCell>
            <TableCell className="font-medium">{r.site}</TableCell>
            <TableCell>{r.staff || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
