"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { unitsSoldTrend } from "@/lib/mock-data";

export function UnitsTrendChart({ data }: { data: typeof unitsSoldTrend }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="unitsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            borderColor: "var(--color-border)",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="units"
          stroke="var(--color-primary)"
          strokeWidth={2}
          fill="url(#unitsFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
