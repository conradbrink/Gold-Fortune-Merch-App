"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { StorePicker } from "@/components/stores/store-picker";
import { ExportMenu } from "@/components/export-menu";
import type { ExportSheet } from "@/lib/export";
import { createClient } from "@/lib/supabase/client";
import {
  rangeForPreset,
  rangeDays,
  toLocalDateInput,
  fromLocalDateInput,
  type DateRange,
} from "@/lib/date-range";
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
type Store = { id: string; name: string; city: string | null };

/**
 * The tabs, in the order a manager acts on them: which store is worst, what is
 * out of stock, who has been neglected — then the descriptive reports.
 *
 * A list rather than eight `TabsTrigger`s written out, because three other
 * things now need to know the set: the URL check that lets the dashboard link
 * to one, the export that exports whichever is open, and the title that export
 * carries.
 */
const TABS = [
  { value: "score", label: "Perfect Store" },
  { value: "oos", label: "Out of stock" },
  { value: "coverage", label: "Coverage" },
  { value: "adherence", label: "Adherence" },
  { value: "reps", label: "Reps" },
  { value: "trends", label: "Trends" },
  { value: "form", label: "Form" },
  { value: "photos", label: "Photos" },
] as const;

export default function ReportsPage() {
  const supabase = createClient();

  /**
   * The range and the tab both come from the URL when it names them, because
   * the dashboard tiles link straight in: "out of stock rate, 6.2%" is a
   * question, and the answer is the hotspots table over the same days the tile
   * was measuring. Read with `window.location` rather than `useSearchParams`,
   * which in this version of Next forces the whole page into a Suspense
   * boundary — the same reason the global search reads it that way.
   */
  const [range, setRange] = useState<DateRange>(() => {
    if (typeof window === "undefined") return rangeForPreset("30d");
    const q = new URLSearchParams(window.location.search);
    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to) return rangeForPreset("30d");
    const parsed = { from: fromLocalDateInput(from), to: fromLocalDateInput(to) };
    // A malformed date would otherwise produce an Invalid Date, which every RPC
    // below turns into a 400 the page reports as its own failure.
    if (Number.isNaN(+parsed.from) || Number.isNaN(+parsed.to)) {
      return rangeForPreset("30d");
    }
    return parsed;
  });
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === "undefined") return "score";
    const asked = new URLSearchParams(window.location.search).get("tab") ?? "";
    return TABS.some((t) => t.value === asked) ? asked : "score";
  });
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
            .select("id, name, city")
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

  /**
   * The open tab, as a spreadsheet.
   *
   * One tab, not all eight. The old export wrote coverage, the scorecard and
   * the trend into a single CSV whatever you were looking at, so the file never
   * matched the screen and three of its sections were noise. Exporting what is
   * in front of you is the version somebody can hand to a supplier.
   *
   * Photos are the one tab with nothing to export — a grid of images is not a
   * table, and a spreadsheet of storage paths would be a worse answer than
   * saying so.
   */
  function sheetForTab(): ExportSheet | null {
    const context = [
      `${toLocalDateInput(range.from)} to ${toLocalDateInput(new Date(+range.to - 86_400_000))}`,
      repId ? `Rep: ${reps.find((r) => r.id === repId)?.full_name ?? repId}` : null,
      storeId ? `Store: ${stores.find((st) => st.id === storeId)?.name ?? storeId}` : null,
      templateId
        ? `Form: ${templates.find((t) => t.id === templateId)?.name ?? templateId}`
        : null,
    ].filter((line): line is string => line !== null);

    const base = { context, orgName: "Gold Fortune Merchandising" };

    switch (tab) {
      case "score":
        return {
          ...base,
          title: "Perfect Store score",
          filename: "gf-perfect-store",
          columns: [
            { header: "Store", key: "store" },
            { header: "Group", key: "group" },
            { header: "Audits", key: "audits", numeric: true },
            { header: "Availability %", key: "availability", numeric: true },
            { header: "Planogram %", key: "planogram", numeric: true },
            { header: "Price %", key: "price", numeric: true },
            { header: "Condition %", key: "condition", numeric: true },
            { header: "Score", key: "score", numeric: true },
          ],
          rows: perfect.map((r) => ({
            store: r.store_name,
            group: r.store_group ?? "",
            audits: r.audits,
            availability: r.availability_pct,
            planogram: r.planogram_pct,
            price: r.price_pct,
            condition: r.condition_pct,
            score: r.score,
          })),
        };
      case "oos":
        return {
          ...base,
          title: "Out-of-stock hotspots",
          filename: "gf-out-of-stock",
          columns: [
            { header: "Store", key: "store" },
            { header: "Checks", key: "checks", numeric: true },
            { header: "Out of stock", key: "oos", numeric: true },
            { header: "Rate", key: "rate" },
            { header: "Longest run", key: "run", numeric: true },
            { header: "Last seen out", key: "last" },
            { header: "Top lines", key: "skus" },
          ],
          rows: hotspots.map((r) => ({
            store: r.store_name,
            checks: r.checks,
            oos: r.oos_count,
            rate: formatRate(r.oos_rate),
            run: r.max_consecutive_oos,
            last: r.last_oos_at ? r.last_oos_at.slice(0, 10) : "",
            skus: r.top_skus.map((t) => `${t.sku} (${t.n})`).join(", "),
          })),
        };
      case "coverage":
        return {
          ...base,
          title: "Store coverage",
          filename: "gf-coverage",
          columns: [
            { header: "Store", key: "store" },
            { header: "Group", key: "group" },
            { header: "Town", key: "city" },
            { header: "Responsible rep", key: "reps" },
            { header: "Visits in period", key: "visits", numeric: true },
            { header: "Last visited", key: "last" },
            { header: "Days since last visit", key: "days" },
          ],
          rows: gaps.map((g) => ({
            store: g.store_name,
            group: g.store_group ?? "",
            city: g.city ?? "",
            reps: g.assigned_reps ?? "",
            visits: g.visits_in_period,
            last: g.last_visit_at ? g.last_visit_at.slice(0, 10) : "never",
            // "never visited" rather than a blank: an empty cell in this column
            // reads as nought days, which is the opposite of what it means.
            days: g.days_since ?? "never visited",
          })),
        };
      case "adherence":
        return {
          ...base,
          title: "Schedule adherence",
          filename: "gf-adherence",
          columns: [
            { header: "Rep", key: "rep" },
            { header: "Planned", key: "planned", numeric: true },
            { header: "Completed", key: "completed", numeric: true },
            { header: "Missed", key: "missed", numeric: true },
            { header: "Adherence", key: "rate" },
            { header: "Missed stops", key: "detail" },
          ],
          rows: adherence.map((a) => ({
            rep: a.rep_name ?? "",
            planned: a.planned,
            completed: a.completed,
            missed: a.missed,
            rate: formatRate(a.adherence_rate),
            detail: a.missed_detail
              .map((m) => `${m.store} (${m.date.slice(0, 10)})`)
              .join(", "),
          })),
        };
      case "reps":
        return {
          ...base,
          title: "Rep scorecard",
          filename: "gf-rep-scorecard",
          columns: [
            { header: "Rep", key: "rep" },
            { header: "Completed", key: "completed", numeric: true },
            { header: "Total", key: "total", numeric: true },
            { header: "Completion", key: "completion" },
            { header: "Stores covered", key: "stores", numeric: true },
            { header: "Forms", key: "forms" },
            { header: "Location verified", key: "verified" },
          ],
          rows: scores.map((r) => ({
            rep: r.rep_name ?? "",
            completed: r.visits_completed,
            total: r.visits_total,
            completion: formatRate(r.completion_rate),
            stores: r.stores_covered,
            forms: formatRate(r.form_compliance_rate),
            verified: formatRate(r.verified_rate),
          })),
        };
      case "trends":
        return {
          ...base,
          title: "Compliance trend",
          filename: "gf-compliance-trend",
          columns: [
            { header: "Bucket", key: "bucket" },
            { header: "Submissions", key: "submissions", numeric: true },
            { header: "Out of stock", key: "oos" },
            { header: "Planogram OK", key: "planogram" },
            { header: "Price correct", key: "price" },
            { header: "Avg facings", key: "facings", numeric: true },
          ],
          rows: trends.map((t) => ({
            bucket: t.bucket_start.slice(0, 10),
            submissions: t.submissions,
            oos: formatRate(t.oos_rate),
            planogram: formatRate(t.planogram_rate),
            price: formatRate(t.price_correct_rate),
            facings: t.avg_facings,
          })),
        };
      case "form":
        return {
          ...base,
          title: "Form results",
          filename: "gf-form-results",
          columns: [
            { header: "Question", key: "label" },
            { header: "Type", key: "type" },
            { header: "Answers", key: "answers", numeric: true },
            { header: "Summary", key: "summary" },
          ],
          rows: chartFields.map((f) => ({
            label: f.label,
            type: f.field_type,
            answers: f.response_count,
            summary: JSON.stringify(f.stats ?? {}),
          })),
        };
      default:
        return null;
    }
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
        <ExportMenu
          build={sheetForTab}
          disabled={loading}
          label={`Export ${TABS.find((t) => t.value === tab)?.label ?? ""}`}
        />
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
          <StorePicker
            className="w-[13rem]"
            stores={stores}
            value={storeId}
            onChange={setStoreId}
            allLabel="All stores"
            placeholder="All stores"
          />
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

      <InsightsPanel
        request={{ reportType: "reports", range, templateId }}
        title="Manager briefing"
        blurb="Summarise this period’s coverage, rep performance and compliance metrics, and surface anomalies worth acting on."
      />

      {/* Ordered by what a manager acts on first: which store is worst, what is
          out of stock, who has been neglected — then the descriptive reports. */}
      <Tabs value={tab} onValueChange={setTab}>
        {/* One row, scrolled — never wrapped. TabsList is a fixed-height pill,
            so wrapping pushes the second row outside its own background and the
            triggers' `flex-1` stretches them into ragged spacing. Labels are
            kept short so all eight fit without scrolling on a normal screen. */}
        <TabsList className="max-w-full justify-start overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:px-2.5">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
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
