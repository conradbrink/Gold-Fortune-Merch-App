"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { LegendDonut } from "@/components/dashboard/legend-donut";
import type {
  BooleanStats,
  ChoiceStats,
  FieldReport,
  NumberStats,
  TextStats,
} from "@/lib/reports";

/**
 * Renders one form field's aggregate, chosen by `field_type`.
 *
 * Driven entirely by the field type rather than by hardcoded question names, so
 * a manager adding a question to a template gets a chart for it with no code
 * change. Photo fields are handled by the gallery tab, not here.
 */

function Empty({ label }: { label: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      No {label} in this period.
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

const num = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : String(Number(v));

export function FieldReportCard({ field }: { field: FieldReport }) {
  const { field_type, label, response_count, stats } = field;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{label}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {response_count} {response_count === 1 ? "response" : "responses"}
        </p>
      </CardHeader>
      <CardContent>
        {response_count === 0 || !stats ? (
          <Empty label="responses" />
        ) : field_type === "number" ? (
          <NumberBody stats={stats as NumberStats} />
        ) : field_type === "boolean" ? (
          <BooleanBody stats={stats as BooleanStats} />
        ) : field_type === "multiple_choice" ? (
          <ChoiceBody stats={stats as ChoiceStats} />
        ) : field_type === "text" ? (
          <TextBody stats={stats as TextStats} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function NumberBody({ stats }: { stats: NumberStats }) {
  const buckets = stats.buckets ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Min" value={num(stats.min)} />
        <Stat label="Average" value={num(stats.avg)} />
        <Stat label="Max" value={num(stats.max)} />
        <Stat label="Total" value={num(stats.sum)} />
      </div>
      {buckets.length > 0 && (
        <HorizontalBarChart
          data={buckets.map((b) => ({ label: b.label, count: b.count }))}
          dataKey="count"
          categoryKey="label"
          height={Math.max(140, buckets.length * 26)}
        />
      )}
    </div>
  );
}

function BooleanBody({ stats }: { stats: BooleanStats }) {
  const yes = Number(stats.yes ?? 0);
  const no = Number(stats.no ?? 0);
  if (yes + no === 0) return <Empty label="answers" />;
  return (
    <LegendDonut
      data={[
        { name: "Yes", value: yes, color: "var(--color-chart-2)" },
        { name: "No", value: no, color: "var(--color-chart-1)" },
      ]}
    />
  );
}

function ChoiceBody({ stats }: { stats: ChoiceStats }) {
  const options = stats.options ?? [];
  if (options.length === 0) return <Empty label="options" />;
  // Zero-count options are deliberately kept: "nobody ever picks Top shelf" is
  // the finding, and dropping the bar would hide it.
  return (
    <HorizontalBarChart
      data={options.map((o) => ({ label: o.option, count: o.count }))}
      dataKey="count"
      categoryKey="label"
      height={Math.max(140, options.length * 34)}
    />
  );
}

function TextBody({ stats }: { stats: TextStats }) {
  const recent = stats.recent ?? [];
  if (recent.length === 0) return <Empty label="answers" />;
  return (
    <ul className="divide-y divide-border">
      {recent.map((r, i) => (
        <li key={i} className="flex items-baseline justify-between gap-4 py-2">
          <span className="text-sm text-foreground">{r.text}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(r.submitted_at).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
