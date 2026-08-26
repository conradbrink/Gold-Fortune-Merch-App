"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
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
import { CaseDialog } from "@/components/hr/case-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { formatDateOnly } from "@/lib/format-date";
import { fetchEmployees, fetchOrgId, type EmployeeRow } from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  fetchDisciplinaryDashboard,
  type DisciplinaryDashboard,
} from "@/lib/hr/dashboard";
import {
  fetchCases,
  fetchWarnings,
  isActiveWarning,
  type CaseRow,
  type WarningRow,
} from "@/lib/hr/disciplinary";
import { lookupLabel, lookupsOfKind } from "@/lib/hr/types";

/**
 * Disciplinary: open cases, the breakdowns a manager asks for, and warnings.
 *
 * 🔴 The dashboard counts. It does not rank people, flag repeat offenders, or
 * suggest what should happen next. "Three warnings" is a number on a page, not
 * a threshold, and nothing in this system treats it as one — the brief is
 * explicit that the module is for record management and workflow, not legal
 * decision-making.
 *
 * "Open" is whichever statuses the organisation has not marked terminal, read
 * from its own configuration rather than from the string "closed", so renaming
 * a status does not silently zero the count.
 */
export default function HrDisciplinaryPage() {
  const supabase = createClient();
  const router = useRouter();

  const [dashboard, setDashboard] = useState<DisciplinaryDashboard | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, c, w, e, ref, org] = await Promise.all([
        fetchDisciplinaryDashboard(supabase),
        fetchCases(supabase),
        fetchWarnings(supabase),
        fetchEmployees(supabase),
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setDashboard(d);
      setCases(c);
      setWarnings(w);
      setEmployees(e);
      setReference(ref);
      setOrgId(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  const lookups = reference?.lookups ?? [];

  const filtered = useMemo(
    () =>
      cases.filter((c) => {
        if (openOnly && c.closed_at) return false;
        if (statusFilter && c.status !== statusFilter) return false;
        return true;
      }),
    [cases, openOnly, statusFilter]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Disciplinary
          </h1>
          <p className="text-sm text-muted-foreground">
            Records and workflow. The system never suggests an outcome.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setOpening(true)}>
          <ShieldAlert className="h-4 w-4" /> Open a case
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat label="Open cases" value={dashboard?.open_cases ?? "—"} />
        <MiniStat
          label="Awaiting a response"
          value={dashboard?.awaiting_response ?? "—"}
        />
        <MiniStat label="Awaiting a hearing" value={dashboard?.awaiting_hearing ?? "—"} />
        <MiniStat label="Active warnings" value={dashboard?.active_warnings ?? "—"} />
        <MiniStat
          label="Warnings expiring"
          value={dashboard?.expiring_warnings ?? "—"}
          note="Within 30 days"
        />
      </div>

      <Tabs defaultValue="cases">
        <TabsList className="flex-wrap">
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="warnings">Warnings</TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              className="w-[15rem]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {lookupsOfKind(lookups, "case_status").map((s) => (
                <option key={s.id} value={s.code}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" size="sm" onClick={() => setOpenOnly((v) => !v)}>
              {openOnly ? "Include closed cases" : "Open cases only"}
            </Button>
          </div>

          <Card>
            <CardContent className="px-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No cases here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead className="hidden md:table-cell">Type</TableHead>
                      <TableHead className="hidden sm:table-cell">Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.case_number}
                          <span className="block text-xs font-normal text-muted-foreground">
                            opened {formatDateOnly(c.opened_on)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Link
                            href={`/hr/employees/${c.employee_id}`}
                            className="hover:underline"
                          >
                            {c.employee?.full_name ?? "—"}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {lookupLabel(lookups, "incident_type", c.incident_type)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="outline" className="font-normal">
                            {lookupLabel(lookups, "severity", c.severity)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={c.closed_at ? "outline" : "secondary"}
                            className="font-normal"
                          >
                            {lookupLabel(lookups, "case_status", c.status)}
                          </Badge>
                          {c.outcome && (
                            <span className="block text-xs text-muted-foreground">
                              {lookupLabel(lookups, "outcome", c.outcome)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline" nativeButton={false}
                            render={<Link href={`/hr/disciplinary/${c.id}`} />}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title="By status" rows={dashboard?.by_status ?? []} />
            <Breakdown title="By incident type" rows={dashboard?.by_type ?? []} />
            <Breakdown title="By severity" rows={dashboard?.by_severity ?? []} />
            <Breakdown title="By department" rows={dashboard?.by_department ?? []} />
            <Breakdown title="By territory" rows={dashboard?.by_territory ?? []} />
          </div>
        </TabsContent>

        <TabsContent value="warnings" className="mt-4">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Warning</TableHead>
                    <TableHead className="hidden sm:table-cell">Issued</TableHead>
                    <TableHead className="hidden md:table-cell">Valid until</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warnings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No warnings on record.
                      </TableCell>
                    </TableRow>
                  ) : (
                    warnings.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/hr/employees/${w.employee_id}`}
                            className="hover:underline"
                          >
                            {w.employee?.full_name ?? "—"}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {lookupLabel(lookups, "warning_type", w.warning_type)}
                          <span className="block text-xs text-muted-foreground">
                            {w.reason}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {formatDateOnly(w.issued_on)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {w.expires_on ? formatDateOnly(w.expires_on) : "Does not lapse"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={isActiveWarning(w) ? "default" : "outline"}
                            className="font-normal"
                          >
                            {isActiveWarning(w) ? "Active" : "Lapsed"}
                          </Badge>
                          {!w.acknowledged_at && (
                            <span className="block text-xs text-muted-foreground">
                              Not acknowledged
                            </span>
                          )}
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

      <CaseDialog
        open={opening}
        onOpenChange={setOpening}
        orgId={orgId}
        lookups={lookups}
        employees={employees}
        onCreated={(caseId) => router.push(`/hr/disciplinary/${caseId}`)}
      />
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing open.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                  {r.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm tabular-nums">
                  {r.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
