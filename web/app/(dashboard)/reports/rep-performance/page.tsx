"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ExportMenu } from "@/components/export-menu";
import { RepPerformanceReport, type ReportMeta } from "@/components/rep-report/report-document";
import "@/components/rep-report/report-print.css";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgName } from "@/lib/org-settings";
import {
  fromLocalDateInput,
  toLocalDate,
  toLocalDateInput,
  type DateRange,
} from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { fetchRepReport, longDate, type RepReport } from "@/lib/rep-report";

/**
 * Rep Performance Report — the controls, and the report they produce.
 *
 * Nothing is fetched until Generate is pressed. That is not laziness about
 * loading states: the report is a *document*, and a document that quietly
 * changed underneath a manager reading it — because a date input was nudged —
 * would be the wrong thing to hand to somebody in a review. The controls stage
 * a request; the sheet below is the answer to the last one that was asked for,
 * and its header says which.
 *
 * Printing is `window.print()` against `report-print.css`, which is also how
 * the PDF is produced: every desktop browser offers "Save as PDF" as a print
 * destination, and it renders the same A4 stylesheet. The app's `jspdf`
 * exporter is not used for the report itself — it writes one table per file
 * and could not reproduce this layout — but it is still the right tool for the
 * numbers behind it, which is what the Export menu offers.
 */

type Rep = { id: string; full_name: string | null };
type Territory = { id: string; name: string; level: string; parent_id: string | null };

/** Today, as the exclusive upper bound the RPCs expect. */
function endOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** The inclusive last day of a range whose `to` is exclusive. */
function lastDay(range: DateRange): Date {
  const d = new Date(range.to);
  d.setDate(d.getDate() - 1);
  return d;
}

/**
 * Territories as a flat list, deepest last, each labelled by its tier.
 *
 * The picker offers every level because `territory_subtree` resolves a region
 * to the territories under it — so "Greater Gaborone" is a usable filter even
 * though no store sits directly in it.
 */
function orderTerritories(rows: Territory[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, Territory[]>();
  for (const t of rows) {
    const key = t.parent_id;
    byParent.set(key, [...(byParent.get(key) ?? []), t]);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const child of children) {
      out.push({ id: child.id, label: `${"— ".repeat(depth)}${child.name}` });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  // A row whose parent is missing (or whose parent the reader may not see)
  // would vanish from a strict tree walk. Anything the walk did not reach is
  // appended rather than dropped.
  const reached = new Set(out.map((o) => o.id));
  for (const t of rows) {
    if (!reached.has(t.id)) out.push({ id: t.id, label: t.name });
  }
  return out;
}

/**
 * The A4 page box, and the marker that scopes the shell's print rules.
 *
 * Both live here rather than in `report-print.css` because the App Router does
 * not unload a route's global stylesheet when you navigate away from it. Left
 * in the stylesheet, `@page { margin: 0 }` would still be in force when the
 * manager printed the Orders page an hour later, and their output would run
 * into the printer's unprintable edge. `@page` cannot be narrowed by a
 * selector, so the only way to scope it is to add and remove the rule itself.
 *
 * The body marker is the same idea for the rules that *can* be scoped: the
 * stylesheet hides the sidebar and the top bar only under
 * `body[data-rep-report]`, which exists exactly while this page is mounted.
 */
function usePrintPageBox() {
  useEffect(() => {
    document.body.dataset.repReport = "true";
    const style = document.createElement("style");
    style.media = "print";
    // The sheet carries its own 13mm padding, so the page margin is the
    // printer's unprintable edge and nothing else. Setting both would shrink
    // the content box and reflow every break that was measured on screen.
    style.textContent = "@page { size: A4 portrait; margin: 0; }";
    document.head.appendChild(style);
    return () => {
      delete document.body.dataset.repReport;
      style.remove();
    };
  }, []);
}

export default function RepPerformancePage() {
  const supabase = createClient();
  usePrintPageBox();

  const [reps, setReps] = useState<Rep[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [orgName, setOrgName] = useState<string>("Gold Fortune");
  const [managerName, setManagerName] = useState<string>("—");

  const [repId, setRepId] = useState<string>("");
  const [territoryId, setTerritoryId] = useState<string>("");
  const [range, setRange] = useState<DateRange>(() => ({
    from: startOfMonth(),
    to: endOfToday(),
  }));

  const [report, setReport] = useState<RepReport | null>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which Generate press this is; a slow earlier one must not win. */
  const runSeq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [repRows, terrRows, name, auth] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name")
            .eq("role", "rep")
            .order("full_name", { ascending: true }),
          supabase
            .from("territories")
            .select("id, name, level, parent_id")
            .eq("active", true)
            .order("name", { ascending: true }),
          fetchOrgName(supabase),
          supabase.auth.getUser(),
        ]);
        if (repRows.error) throw new Error(repRows.error.message);
        // Checked too, and not only the reps: a failed territories read left
        // `terrRows.data` null, the picker showing nothing but "All
        // territories", and the manager with no way to know the filter list
        // had not loaded rather than being empty.
        if (terrRows.error) throw new Error(terrRows.error.message);
        setReps((repRows.data ?? []) as Rep[]);
        setTerritories((terrRows.data ?? []) as Territory[]);
        if (name) setOrgName(name);
        const user = auth.data.user;
        const metaName = (user?.user_metadata as { full_name?: string } | undefined)?.full_name;
        setManagerName(metaName || user?.email || "—");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const territoryOptions = useMemo(() => orderTerritories(territories), [territories]);

  const fromInput = toLocalDateInput(range.from);
  const toInput = toLocalDateInput(lastDay(range));
  const todayInput = toLocalDateInput(lastDay({ from: range.from, to: endOfToday() }));
  const rangeInvalid = range.to <= range.from;

  const generate = useCallback(async () => {
    if (!repId) return;
    const runId = ++runSeq.current;
    setGenerating(true);
    setError(null);
    try {
      const data = await fetchRepReport(supabase, repId, range, territoryId || null);
      if (runId !== runSeq.current) return;
      setReport(data);
      setMeta({
        orgName,
        repName:
          data.summary.repName ??
          reps.find((r) => r.id === repId)?.full_name ??
          "Unnamed rep",
        // The rep's own territories when the whole round is in scope, and the
        // chosen one when it is not — so the header always says what the
        // figures below it actually cover.
        territoryLabel:
          territoryOptions.find((t) => t.id === territoryId)?.label.replace(/^(— )+/, "") ??
          data.summary.territories ??
          "All territories",
        from: range.from,
        to: lastDay(range),
        managerName,
        generatedAt: new Date(),
      });
    } catch (e) {
      if (runId !== runSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setReport(null);
      setMeta(null);
    } finally {
      if (runId === runSeq.current) setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId, range, territoryId, orgName, managerName, reps, territoryOptions]);

  const exportVariants = useMemo(() => {
    if (!report || !meta) return [];
    const context = [
      `${meta.repName} · ${meta.territoryLabel}`,
      `${longDate(meta.from)} – ${longDate(meta.to)}`,
    ];
    return [
      {
        label: "Missed visits",
        build: (): ExportSheet => ({
          orgName: meta.orgName,
          title: "Missed visits",
          filename: "gf-rep-missed-visits",
          context,
          columns: [
            { header: "Store", key: "store" },
            { header: "Chain", key: "group" },
            { header: "Town", key: "city" },
            { header: "Planned date", key: "planned" },
            { header: "Went back on", key: "wentBack" },
            { header: "Reason", key: "reason" },
            { header: "Last visit before", key: "last" },
            { header: "Previous sales", key: "previous", numeric: true },
          ],
          rows: report.missed.map((m) => ({
            store: m.storeName,
            group: m.storeGroup ?? "",
            city: m.city ?? "",
            planned: m.plannedDate,
            // The word, not a blank: a spreadsheet filtered on an empty cell
            // is a different operation from one filtered on "Never", and this
            // is the column somebody will sort by.
            wentBack: toLocalDate(m.visitedAt) || "Never",
            reason: m.reason ?? "Reason not recorded",
            last: toLocalDate(m.lastVisitAt) || "",
            previous: m.previousSales,
          })),
        }),
      },
      {
        label: "Day by day",
        build: (): ExportSheet => ({
          orgName: meta.orgName,
          title: "Daily visits and sales",
          filename: "gf-rep-daily",
          context,
          columns: [
            { header: "Date", key: "day" },
            { header: "Planned", key: "planned", numeric: true },
            { header: "Completed", key: "completed", numeric: true },
            { header: "Visits", key: "visits", numeric: true },
            { header: "Orders", key: "orders", numeric: true },
            { header: "Sales (excl. VAT)", key: "sales", numeric: true },
          ],
          rows: report.days.map((d) => ({
            day: d.day,
            planned: d.planned,
            completed: d.completed,
            visits: d.visits,
            orders: d.salesOrders,
            sales: d.salesNet,
          })),
        }),
      },
      {
        label: "Store performance",
        build: (): ExportSheet => ({
          orgName: meta.orgName,
          title: "Store performance",
          filename: "gf-rep-stores",
          context,
          columns: [
            { header: "Store", key: "store" },
            { header: "Chain", key: "group" },
            { header: "Planned", key: "planned", numeric: true },
            { header: "Completed", key: "completed", numeric: true },
            { header: "Missed", key: "missed", numeric: true },
            { header: "Sales", key: "sales", numeric: true },
            { header: "Prior period", key: "prior", numeric: true },
            { header: "Stock checks", key: "checks", numeric: true },
            { header: "Out of stock", key: "oos", numeric: true },
            { header: "Last visit", key: "last" },
          ],
          rows: report.stores.map((s) => ({
            store: s.storeName,
            group: s.storeGroup ?? "",
            planned: s.planned,
            completed: s.completed,
            missed: s.missed,
            sales: s.salesNet,
            prior: s.priorSalesNet,
            checks: s.oosChecked,
            oos: s.oosVisits,
            last: toLocalDate(s.lastVisitAt) || "",
          })),
        }),
      },
    ];
  }, [report, meta]);

  return (
    <div className="space-y-6">
      <div data-print-hide className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rep Performance Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A two-page management report for one merchandiser over one period, built from
            the visits, orders and audits already in the system.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Report controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="rr-rep">Rep / merchandiser</Label>
                <NativeSelect
                  id="rr-rep"
                  value={repId}
                  onChange={(e) => setRepId(e.target.value)}
                >
                  <option value="">Choose a rep…</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.full_name ?? "Unnamed rep"}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rr-from">Start date</Label>
                <Input
                  id="rr-from"
                  type="date"
                  value={fromInput}
                  max={toInput}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setRange((r) => ({ ...r, from: fromLocalDateInput(e.target.value) }));
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rr-to">End date</Label>
                <Input
                  id="rr-to"
                  type="date"
                  value={toInput}
                  min={fromInput}
                  // A period cannot end after today: routes are scheduled months
                  // ahead, and counting an unreached Tuesday as a missed visit
                  // would mark every rep down for work that is not yet due.
                  max={todayInput}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const day = fromLocalDateInput(e.target.value);
                    day.setDate(day.getDate() + 1);
                    setRange((r) => ({ ...r, to: day }));
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rr-territory">Territory</Label>
                <NativeSelect
                  id="rr-territory"
                  value={territoryId}
                  onChange={(e) => setTerritoryId(e.target.value)}
                >
                  <option value="">All territories</option>
                  {territoryOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => void generate()}
                disabled={!repId || rangeInvalid || generating}
              >
                {generating ? "Generating…" : "Generate Report"}
              </Button>

              {report && meta && (
                <>
                  <Button
                    variant="outline"
                    size="lg"
                    className="gap-1.5"
                    onClick={() => window.print()}
                  >
                    <Printer className="h-4 w-4" />
                    Print / Save as PDF
                  </Button>
                  <ExportMenu variants={exportVariants} label="Export data" />
                </>
              )}

              {!repId && (
                <span className="text-sm text-muted-foreground">
                  Choose a rep to generate the report.
                </span>
              )}
              {rangeInvalid && (
                <span className="text-sm text-destructive">
                  The end date must not be before the start date.
                </span>
              )}
            </div>

            {report && (
              <p className="text-xs text-muted-foreground">
                Print produces the PDF too — choose <strong>Save as PDF</strong> as the
                destination. It is the only route that keeps the A4 layout; the Export menu
                writes the numbers behind the report as a spreadsheet or a table PDF.
                {report.missed.length >= 19 && (
                  <>
                    {" "}
                    This period has <strong>{report.missed.length} missed visits</strong>,
                    listed in two columns and in full — the report may run past two sheets
                    rather than hide any of them.
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <p className="font-medium">Could not generate the report</p>
            <p className="mt-1">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => void generate()}
              disabled={!repId || generating}
            >
              Retry
            </Button>
          </div>
        )}
      </div>

      {report && meta ? (
        <div className="rr-viewport -mx-4 sm:-mx-6">
          <RepPerformanceReport report={report} meta={meta} />
        </div>
      ) : (
        !generating && (
          <div
            data-print-hide
            className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground"
          >
            Choose a rep and a period, then press <strong>Generate Report</strong>.
          </div>
        )
      )}
    </div>
  );
}
