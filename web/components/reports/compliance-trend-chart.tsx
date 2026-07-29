"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TrendPointRow } from "@/lib/reports";

const SERIES = [
  { key: "oos", name: "Out of stock", color: "var(--color-chart-1)" },
  { key: "planogram", name: "Planogram OK", color: "var(--color-chart-2)" },
  { key: "price", name: "Price correct", color: "var(--color-chart-3)" },
] as const;

/**
 * Compliance rates over time.
 *
 * Rates arrive as decimals and are plotted as percentages. A null rate means
 * the metric wasn't captured in that bucket — it is passed through as null so
 * recharts breaks the line, rather than being coerced to 0 and drawing a
 * dramatic crash that never happened.
 */
export function ComplianceTrendChart({
  rows,
  height = 260,
}: {
  rows: TrendPointRow[];
  height?: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No submissions in this period.
      </p>
    );
  }

  // A single point cannot show a trend; recharts would render an invisible dot.
  if (rows.length === 1) {
    const r = rows[0];
    return (
      <div className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">
        <Single label="Submissions" value={String(r.submissions)} />
        <Single label="Out of stock" value={pct(r.oos_rate)} />
        <Single label="Planogram OK" value={pct(r.planogram_rate)} />
        <Single label="Price correct" value={pct(r.price_correct_rate)} />
      </div>
    );
  }

  const data = rows.map((r) => ({
    label: new Date(r.bucket_start).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    oos: toPct(r.oos_rate),
    planogram: toPct(r.planogram_rate),
    price: toPct(r.price_correct_rate),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          formatter={(v) => (v === null ? "—" : `${v}%`)}
          contentStyle={{
            borderRadius: 8,
            borderColor: "var(--color-border)",
            fontSize: 12,
          }}
        />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function toPct(v: number | null): number | null {
  return v === null || v === undefined ? null : Math.round(Number(v) * 1000) / 10;
}

function pct(v: number | null): string {
  const p = toPct(v);
  return p === null ? "—" : `${p}%`;
}

function Single({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
