"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import {
  achievedFor,
  fetchTargetProgress,
  MEASURES,
  monthStart,
  saveTargets,
  type Measure,
  type TargetProgress,
} from "@/lib/targets";

type Draft = { measure: Measure; target: string };

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return monthStart(new Date(y, m - 1 + by, 1));
}

function fmt(value: number, measure: Measure) {
  return MEASURES.find((m) => m.value === measure)?.money
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toLocaleString();
}

/**
 * One month's targets, set and tracked on one screen.
 *
 * Targets are typed straight into the table and saved together, because a
 * manager sets a month for the whole team at once. Progress counts delivered
 * orders only — an order still on the van is not a sale yet, which is the
 * Sales page's rule and has to be this page's too.
 */
export default function TargetsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthStart());
  const [rows, setRows] = useState<TargetProgress[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load(m: string) {
    setLoading(true);
    try {
      const [org, progress] = await Promise.all([fetchOrgId(supabase), fetchTargetProgress(supabase, m)]);
      setOrgId(org);
      setRows(progress);
      setDrafts(
        Object.fromEntries(
          progress.map((r) => [
            r.rep_id,
            {
              measure: (r.measure as Measure) ?? "revenue",
              target: r.target == null ? "" : String(r.target),
            },
          ])
        )
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const dirty = useMemo(
    () =>
      rows.some((r) => {
        const d = drafts[r.rep_id];
        if (!d) return false;
        return (
          d.target !== (r.target == null ? "" : String(r.target)) ||
          (r.target != null && d.measure !== r.measure)
        );
      }),
    [rows, drafts]
  );

  async function copyLastMonth() {
    try {
      const previous = await fetchTargetProgress(supabase, shiftMonth(month, -1));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of previous) {
          if (p.target != null && next[p.rep_id]) {
            next[p.rep_id] = { measure: p.measure as Measure, target: String(p.target) };
          }
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save() {
    if (!orgId) return;
    setSaving(true);
    setError(null);
    try {
      await saveTargets(supabase, {
        orgId,
        month,
        rows: rows.map((r) => {
          const d = drafts[r.rep_id];
          const n = Number(d?.target);
          return {
            repId: r.rep_id,
            measure: d?.measure ?? "revenue",
            target: d?.target.trim() && n > 0 ? n : null,
          };
        }),
      });
      await load(month);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = new Date(`${month}T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Sales targets</h1>
          <p className="text-sm text-muted-foreground">
            A monthly target per rep. Progress counts delivered orders, excluding VAT, less
            returns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ←
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            →
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rep</TableHead>
              <TableHead className="w-48">Measure</TableHead>
              <TableHead className="w-36">Target</TableHead>
              <TableHead className="text-right">Achieved</TableHead>
              <TableHead className="w-56">Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
            {!loading && rows.length === 0 && <EmptyRow colSpan={5}>No active reps.</EmptyRow>}
            {!loading &&
              rows.map((r) => {
                const d = drafts[r.rep_id] ?? { measure: "revenue" as Measure, target: "" };
                const achieved = achievedFor(r, d.measure);
                const target = Number(d.target) || 0;
                const pct = target > 0 ? Math.round((achieved / target) * 100) : null;
                return (
                  <TableRow key={r.rep_id}>
                    <TableCell className="font-medium">{r.rep_name}</TableCell>
                    <TableCell>
                      <NativeSelect
                        value={d.measure}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [r.rep_id]: { ...d, measure: e.target.value as Measure },
                          }))
                        }
                        aria-label={`Measure for ${r.rep_name}`}
                      >
                        {MEASURES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={d.target}
                        placeholder="No target"
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [r.rep_id]: { ...d, target: e.target.value },
                          }))
                        }
                        aria-label={`Target for ${r.rep_name}`}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(achieved, d.measure)}
                      {d.measure === "gross_profit" && Number(r.uncosted_units) > 0 && (
                        <span className="block text-xs text-amber-600 dark:text-amber-500">
                          {Number(r.uncosted_units)} units have no cost
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {pct === null ? (
                        <span className="text-xs text-muted-foreground">No target set</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Progress value={Math.min(pct, 100)} className="flex-1" />
                          <span className="w-12 text-right text-xs tabular-nums">{pct}%</span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
        <Button variant="outline" onClick={copyLastMonth} disabled={loading}>
          Copy last month&apos;s targets
        </Button>
        <Button onClick={save} disabled={saving || loading || !dirty}>
          {saving ? "Saving…" : "Save targets"}
        </Button>
      </div>
    </div>
  );
}
