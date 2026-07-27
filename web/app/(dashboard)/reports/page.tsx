"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/ui/native-select";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { FieldReportCard } from "@/components/reports/field-report-card";
import { CoverageTable } from "@/components/reports/coverage-table";
import { RepScorecardTable } from "@/components/reports/rep-scorecard-table";
import { ComplianceTrendChart } from "@/components/reports/compliance-trend-chart";
import { PhotoGrid } from "@/components/reports/photo-grid";
import { InsightsPanel } from "@/components/reports/insights-panel";
import { PerfectStoreTable } from "@/components/reports/perfect-store-table";
import { OosHotspotsTable } from "@/components/reports/oos-hotspots-table";
import { AdherenceTable } from "@/components/reports/adherence-table";
import { createClient } from "@/lib/supabase/client";
import { rangeForPreset, rangeDays, type DateRange } from "@/lib/date-range";
import {
  fetchComplianceTrends,
  fetchCoverageGaps,
  fetchFormReport,
  fetchFormTemplates,
  fetchRepScorecard,
  fetchPerfectStoreScore,
  fetchOosHotspots,
  fetchScheduleAdherence,
  formatRate,
  type Adherence,
  type CoverageGap,
  type FieldReport,
  type FormTemplate,
  type OosHotspot,
  type PerfectStore,
  type PhotoStats,
  type RepScore,
  type TrendPointRow,
} from "@/lib/reports";

type Rep = { id: string; full_name: string | null };
type Store = { id: string; name: string };

export default function ReportsPage() {
  const supabase = createClient();

  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [storeId, setStoreId] = useState<string>("");

  const [form, setForm] = useState<FieldReport[]>([]);
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [scores, setScores] = useState<RepScore[]>([]);
  const [trends, setTrends] = useState<TrendPointRow[]>([]);
  const [perfect, setPerfect] = useState<PerfectStore[]>([]);
  const [hotspots, setHotspots] = useState<OosHotspot[]>([]);
  const [adherence, setAdherence] = useState<Adherence[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter options load once — they don't depend on the date range.
  useEffect(() => {
    (async () => {
      try {
        const [tpl, repRows, storeRows] = await Promise.all([
          fetchFormTemplates(supabase),
          supabase
            .from("profiles")
            .select("id, full_name")
            .eq("role", "rep")
            .order("full_name", { ascending: true }),
          supabase
            .from("stores")
            .select("id, name")
            .eq("active", true)
            .order("name", { ascending: true }),
        ]);
        setTemplates(tpl);
        setTemplateId((prev) => prev ?? tpl[0]?.id ?? null);
        setReps((repRows.data ?? []) as Rep[]);
        setStores((storeRows.data ?? []) as Store[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Weekly buckets past ~6 weeks, or the x-axis becomes unreadable.
      const bucket = rangeDays(range) > 45 ? "week" : "day";
      const [g, s, t, f, ps, oh, ad] = await Promise.all([
        fetchCoverageGaps(supabase, range),
        fetchRepScorecard(supabase, range),
        fetchComplianceTrends(supabase, range, bucket),
        templateId
          ? fetchFormReport(supabase, templateId, range, {
              repIds: repId ? [repId] : undefined,
              storeIds: storeId ? [storeId] : undefined,
            })
          : Promise.resolve([] as FieldReport[]),
        fetchPerfectStoreScore(supabase, range),
        fetchOosHotspots(supabase, range),
        fetchScheduleAdherence(supabase, range),
      ]);
      setGaps(g);
      setScores(s);
      setTrends(t);
      setForm(f);
      setPerfect(ps);
      setHotspots(oh);
      setAdherence(ad);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, templateId, repId, storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const photoGroups = useMemo(
    () =>
      form
        .filter((f) => f.field_type === "photo")
        .map((f) => ({
          label: f.label,
          paths: ((f.stats as PhotoStats | null)?.paths ?? []) as string[],
        })),
    [form]
  );

  const chartFields = useMemo(
    () => form.filter((f) => f.field_type !== "photo"),
    [form]
  );

  const submissionsInPeriod = trends.reduce(
    (n, t) => n + Number(t.submissions ?? 0),
    0
  );

  function exportCsv() {
    const rows: (string | number)[][] = [
      ["Report", "Gold Fortune Merchandising"],
      ["From", range.from.toISOString().slice(0, 10)],
      ["To (exclusive)", range.to.toISOString().slice(0, 10)],
      [],
      ["Store coverage"],
      ["Store", "Group", "Responsible rep", "Visits in period", "Days since last visit"],
      ...gaps.map((g) => [
        g.store_name,
        g.store_group ?? "",
        g.primary_rep_name ?? "",
        g.visits_in_period,
        g.days_since ?? "never visited",
      ]),
      [],
      ["Rep scorecard"],
      ["Rep", "Completed", "Total", "Completion", "Forms", "Location verified"],
      ...scores.map((s) => [
        s.rep_name ?? "",
        s.visits_completed,
        s.visits_total,
        formatRate(s.completion_rate),
        formatRate(s.form_compliance_rate),
        formatRate(s.verified_rate),
      ]),
      [],
      ["Compliance trend"],
      [
        "Bucket",
        "Submissions",
        "Out of stock",
        "Planogram OK",
        "Price correct",
        "Avg facings",
      ],
      ...trends.map((t) => [
        t.bucket_start.slice(0, 10),
        t.submissions,
        formatRate(t.oos_rate),
        formatRate(t.planogram_rate),
        formatRate(t.price_correct_rate),
        t.avg_facings ?? "",
      ]),
    ];

    // Quote every cell and double embedded quotes — store names contain commas.
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `gf-report-${range.from.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            {submissionsInPeriod} audit{submissionsInPeriod === 1 ? "" : "s"}{" "}
            submitted in the selected period
          </p>
        </div>
        <Button className="gap-1.5" onClick={exportCsv} disabled={loading}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Form template"
            className="w-[15rem]"
            value={templateId ?? ""}
            onChange={(e) => setTemplateId(e.target.value || null)}
          >
            {templates.length === 0 && <option value="">No templates</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Rep"
            className="w-[11rem]"
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
          >
            <option value="">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? "Unnamed"}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Store"
            className="w-[11rem]"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load reports</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <InsightsPanel range={range} templateId={templateId} />

      {/* Ordered by what a manager acts on first: which store is worst, what is
          out of stock, who has been neglected — then the descriptive reports. */}
      <Tabs defaultValue="score">
        {/* One row, scrolled — never wrapped. TabsList is a fixed-height pill,
            so wrapping pushes the second row outside its own background and the
            triggers' `flex-1` stretches them into ragged spacing. Labels are
            kept short so all eight fit without scrolling on a normal screen. */}
        <TabsList className="max-w-full justify-start overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:px-2.5">
          <TabsTrigger value="score">Perfect Store</TabsTrigger>
          <TabsTrigger value="oos">Out of stock</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="adherence">Adherence</TabsTrigger>
          <TabsTrigger value="reps">Reps</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="form">Form</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
        </TabsList>

        <TabsContent value="score" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Perfect Store score</CardTitle>
              <p className="text-xs text-muted-foreground">
                Availability, planogram, price accuracy and stock condition
                averaged into one index, worst store first. Promotional displays
                are excluded — they track whether a promo was running, not
                whether the store executed.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? <SkeletonRows /> : <PerfectStoreTable rows={perfect} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oos" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Out-of-stock hotspots</CardTitle>
              <p className="text-xs text-muted-foreground">
                &ldquo;Worst run&rdquo; is the longest unbroken sequence of visits
                that found an empty shelf — the difference between a chronic
                supply problem and an unlucky day.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? <SkeletonRows /> : <OosHotspotsTable rows={hotspots} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="adherence" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Schedule adherence</CardTitle>
              <p className="text-xs text-muted-foreground">
                Planned routes versus visits actually completed. Future-dated
                routes are excluded.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? <SkeletonRows /> : <AdherenceTable rows={adherence} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="form" className="mt-4">
          {loading ? (
            <SkeletonGrid />
          ) : chartFields.length === 0 ? (
            <EmptyCard>
              No responses for this template in the selected period.
            </EmptyCard>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {chartFields.map((f) => (
                <FieldReportCard key={f.field_id} field={f} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="coverage" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Store coverage</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ranked by longest gap. &ldquo;Last visit&rdquo; looks across all
                history, not just this period.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? <SkeletonRows /> : <CoverageTable rows={gaps} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reps" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Rep scorecard</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? <SkeletonRows /> : <RepScorecardTable rows={scores} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Compliance over time</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? <SkeletonRows /> : <ComplianceTrendChart rows={trends} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="photos" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Shelf photos</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? <SkeletonRows /> : <PhotoGrid groups={photoGroups} />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="h-48 animate-pulse rounded-md bg-muted/50" />
        </Card>
      ))}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2 p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
      ))}
    </div>
  );
}
