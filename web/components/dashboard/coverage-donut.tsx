"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

export function CoverageDonut({
  covered,
  notCovered,
}: {
  covered: number;
  notCovered: number;
}) {
  const data = [
    { name: "Covered", value: covered },
    { name: "Not Covered", value: notCovered },
  ];
  const colors = ["var(--color-gold)", "var(--color-primary)"];

  return (
    <div className="relative h-44 w-44">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={colors[i % colors.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{covered}%</span>
        <span className="text-xs text-muted-foreground">Covered</span>
      </div>
    </div>
  );
}
