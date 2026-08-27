"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { formatDateOnly } from "@/lib/format-date";
import { toLocalDateInput } from "@/lib/date-range";
import { fetchEmployees, fetchOrgId, type EmployeeRow } from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  fetchPerformanceDashboard,
  type PerformanceDashboard,
} from "@/lib/hr/dashboard";
import { createReview, currentPeriod, fetchReviews, type ReviewRow } from "@/lib/hr/performance";
import {
  formatScore,
  periodLabel,
  ratingBand,
  REVIEW_STATUS_LABELS,
} from "@/lib/hr/types";

/**
 * Performance: what is due, what is outstanding, and the trend.
 *
 * "Due" is a left join, not a guess: one review per employee per period is a
 * unique index in the database, so an employee with no completed review for the
 * current period is exactly the set this page lists. "Outstanding" is the same
 * set grouped by the manager who owes it, because chasing is done by person and
 * not by row.
 *
 * Every score on this page was typed by a human. Nothing is derived from sales,
 * visits or coverage — section 7 asks for the review system first and the
 * automatic metrics later, and a number the system produced would be
 * indistinguishable on screen from one a manager stood behind.
 */
export default function HrPerformancePage() {
  const supabase = createClient();
  const router = useRouter();

  const [dashboard, setDashboard] = useState<PerformanceDashboard | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [departmentId, setDepartmentId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [position, setPosition] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, r, e, ref, org] = await Promise.all([
        fetchPerformanceDashboard(supabase, {
          departmentId: departmentId || null,
          managerId: managerId || null,
          territoryId: territoryId || null,
          position: position || null,
        }),
        fetchReviews(supabase),
        fetchEmployees(supabase),
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setDashboard(d);
      setReviews(r);
      setEmployees(e);
      setReference(ref);
      setOrgId(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, managerId, territoryId, position]);

  useHrLoad(load);

  const scaleMax = reference?.settings?.rating_scale_max ?? 5;
  const frequency = reference?.settings?.review_frequency ?? "quarterly";

  /** Distinct positions actually in use, so the filter offers only real ones. */
  const positions = useMemo(
    () =>
      Array.from(
        new Set(employees.map((e) => e.position).filter((p): p is string => Boolean(p)))
      ).sort(),
    [employees]
  );

  /** Employees who manage somebody, for the "outstanding by manager" filter. */
  const managers = useMemo(() => {
    const ids = new Set(
      employees.map((e) => e.manager_id).filter((id): id is string => Boolean(id))
    );
    return employees.filter((e) => ids.has(e.id));
  }, [employees]);

  async function startReview(employeeId: string) {
    if (!orgId) return;
    setStarting(employeeId);
    setError(null);
    try {
      const period = currentPeriod(frequency);
      const created = await createReview(supabase, orgId, {
        employee_id: employeeId,
        ...period,
        review_date: toLocalDateInput(new Date()),
      });
      router.push(`/hr/performance/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Performance
          </h1>
          <p className="text-sm text-muted-foreground">
            {dashboard
              ? `${periodLabel(
                  dashboard.period.type,
                  dashboard.period.year,
                  dashboard.period.index
                )} · below ${dashboard.threshold} counts as below expectations`
              : "Loading…"}
          </p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hr/settings" />}>
          Review settings
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <NativeSelect
          className="w-[12rem]"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="">All departments</option>
          {(reference?.departments ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-[12rem]"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
        >
          <option value="">All managers</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name ?? m.employee_number}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-[12rem]"
          value={territoryId}
          onChange={(e) => setTerritoryId(e.target.value)}
        >
          <option value="">All territories</option>
          {(reference?.territories ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-[12rem]"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        >
          <option value="">All positions</option>
          {positions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat label="Headcount" value={dashboard?.headcount ?? "—"} />
        <MiniStat label="Reviews due" value={dashboard?.reviews_due ?? "—"} />
        <MiniStat label="In draft" value={dashboard?.reviews_in_draft ?? "—"} />
        <MiniStat label="Completed" value={dashboard?.reviews_completed ?? "—"} />
        <MiniStat
          label="Average"
          value={formatScore(dashboard?.average_score ?? null, scaleMax)}
          note={
            ratingBand(dashboard?.average_score ?? null, scaleMax) ??
            "No completed reviews"
          }
        />
      </div>

      <Tabs defaultValue="due">
        <TabsList className="flex-wrap">
          <TabsTrigger value="due">Due</TabsTrigger>
          <TabsTrigger value="outstanding">Outstanding by manager</TabsTrigger>
          <TabsTrigger value="below">Below expectations</TabsTrigger>
          <TabsTrigger value="trend">Trend</TabsTrigger>
          <TabsTrigger value="all">All reviews</TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="mt-4">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="hidden sm:table-cell">Position</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(dashboard?.due_list ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        {loading ? "Loading…" : "Everyone has been reviewed this period."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    (dashboard?.due_list ?? []).map((d) => (
                      <TableRow key={d.employee_id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/hr/employees/${d.employee_id}`}
                            className="hover:underline"
                          >
                            {d.name}
                          </Link>
                          <span className="block text-xs font-normal text-muted-foreground">
                            {d.employee_number}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {d.position ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            disabled={starting === d.employee_id}
                            onClick={() => startReview(d.employee_id)}
                          >
                            <Plus className="mr-1.5 h-4 w-4" />
                            {starting === d.employee_id ? "Starting…" : "Start review"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outstanding" className="mt-4">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Manager</TableHead>
                    <TableHead className="text-right">Reviews outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(dashboard?.outstanding_by_manager ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing outstanding.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (dashboard?.outstanding_by_manager ?? []).map((m) => (
                      <TableRow key={m.manager_id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.outstanding}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="below" className="mt-4">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="hidden sm:table-cell">Position</TableHead>
                    <TableHead className="text-right">Latest score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(dashboard?.below_expectations ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        Nobody is below the threshold.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (dashboard?.below_expectations ?? []).map((b) => (
                      <TableRow key={b.employee_id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/hr/employees/${b.employee_id}`}
                            className="hover:underline"
                          >
                            {b.name}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {b.position ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(b.score, scaleMax)}
                          <span className="block text-xs text-muted-foreground">
                            {ratingBand(b.score, scaleMax)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trend" className="mt-4">
          <Card>
            <CardContent className="space-y-3 p-5">
              {(dashboard?.trend ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No completed reviews to chart yet.
                </p>
              ) : (
                (dashboard?.trend ?? []).map((t) => (
                  <div key={`${t.year}-${t.index}`} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      {periodLabel(t.type, t.year, t.index)}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(t.average / scaleMax) * 100}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                      {formatScore(t.average, scaleMax)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t.reviews})
                      </span>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="hidden sm:table-cell">Reviewer</TableHead>
                    <TableHead className="text-right">Overall</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No reviews yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reviews.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.employee?.full_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {periodLabel(r.period_type, r.period_year, r.period_index)}
                          <span className="block text-xs text-muted-foreground">
                            {formatDateOnly(r.review_date)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {r.reviewer?.full_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(r.overall_rating, scaleMax)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.status === "draft" ? "outline" : "default"}
                            className="font-normal"
                          >
                            {REVIEW_STATUS_LABELS[
                              r.status as keyof typeof REVIEW_STATUS_LABELS
                            ] ?? r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline" nativeButton={false}
                            render={<Link href={`/hr/performance/${r.id}`} />}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MiniStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
