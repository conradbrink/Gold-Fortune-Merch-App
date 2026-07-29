"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export type TrendPoint = { label: string; value: number };

/**
 * Generic trend chart.
 *
 * Previously typed as `typeof unitsSoldTrend` — importing mock data as a type
 * source, which meant the shape of a placeholder dictated the component's API.
 *
 * Renders bars rather than an area below `minPointsForArea`: an area chart of
 * one or two points is a nearly invisible sliver, which reads as "broken"
 * rather than "not much data yet".
 */
export function UnitsTrendChart({
  data,
  valueLabel = "Value",
  height = 180,
  minPointsForArea = 5,
}: {
  data: TrendPoint[];
  valueLabel?: string;
  height?: number;
  minPointsForArea?: number;
}) {
  const tooltipStyle = {
    borderRadius: 8,
    borderColor: "var(--color-border)",
    fontSize: 12,
  };

  if (data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-sm text-muted-foreground"
      >
        No activity in this period.
      </div>
    );
  }

  if (data.length < minPointsForArea) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="value" name={valueLabel} fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="unitsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area
          type="monotone"
          dataKey="value"
          name={valueLabel}
          stroke="var(--color-primary)"
          strokeWidth={2}
          fill="url(#unitsFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
