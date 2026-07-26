"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

export function HorizontalBarChart({
  data,
  dataKey,
  categoryKey,
  color = "var(--color-primary)",
  height = 180,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  categoryKey: string;
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          type="category"
          dataKey={categoryKey}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={80}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            borderColor: "var(--color-border)",
            fontSize: 12,
          }}
        />
        <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} barSize={22}>
          <LabelList dataKey={dataKey} position="right" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
