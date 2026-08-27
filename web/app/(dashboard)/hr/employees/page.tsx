"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmployeeDialog } from "@/components/hr/employee-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import {
  fetchEmployees,
  fetchOrgId,
  fetchProfileOptions,
  type EmployeeRow,
  type ProfileOption,
} from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  expiryBucket,
  type EmploymentStatus,
} from "@/lib/hr/types";
import { formatDateOnly } from "@/lib/format-date";

/**
 * The employee directory.
 *
 * The list shows everyone the caller is entitled to — HR sees the organisation,
 * a line manager sees their chain — and that narrowing happens in RLS, not
 * here. There is no "show only my team" toggle because for a line manager there
 * is nothing else to show.
 *
 * Contract expiry is on the row rather than buried in the profile, because it
 * is the one employment date that stops being true without anybody doing
 * anything.
 */
export default function HrEmployeesPage() {
  const supabase = createClient();

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [department, setDepartment] = useState<string>("");
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, r, p, o] = await Promise.all([
        fetchEmployees(supabase),
        fetchHrReference(supabase),
        fetchProfileOptions(supabase),
        fetchOrgId(supabase),
      ]);
      setEmployees(e);
      setReference(r);
      setProfiles(p);
      setOrgId(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((e) => {
      if (status && e.employment_status !== status) return false;
      if (department && e.department_id !== department) return false;
      if (!q) return true;
      return [e.full_name, e.employee_number, e.position, e.email, e.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [employees, query, status, department]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Employees
          </h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {employees.length} shown
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setCreating(true)}>
          <UserPlus className="h-4 w-4" />
          Add employee
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load employees</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search name, ID, position…"
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelect
          className="max-w-[11rem]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="max-w-[13rem]"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">All departments</option>
          {(reference?.departments ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <Card>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {employees.length === 0
                ? "No employees yet."
                : "No employees match those filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden md:table-cell">Department</TableHead>
                  <TableHead className="hidden lg:table-cell">Manager</TableHead>
                  <TableHead className="hidden lg:table-cell">Territory</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Contract</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => {
                  const contract = e.contract_end_date
                    ? expiryBucket(e.contract_end_date)
                    : null;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/hr/employees/${e.id}`}
                          className="hover:underline"
                        >
                          {e.full_name ?? "Unnamed"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {e.employee_number}
                          {e.position ? ` · ${e.position}` : ""}
                          {/* An employee with no account has no attendance and
                              no self-service, which is worth seeing at a glance
                              rather than discovering on an empty tab. */}
                          {!e.profile_id && " · no login"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {e.department?.name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {e.manager?.full_name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {e.territory?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            EMPLOYMENT_STATUS_TONE[
                              e.employment_status as EmploymentStatus
                            ] ?? "outline"
                          }
                          className="font-normal"
                        >
                          {EMPLOYMENT_STATUS_LABELS[
                            e.employment_status as EmploymentStatus
                          ] ?? e.employment_status}
                        </Badge>
                        <span className="block text-xs text-muted-foreground">
                          {EMPLOYMENT_TYPE_LABELS[
                            e.employment_type as keyof typeof EMPLOYMENT_TYPE_LABELS
                          ] ?? e.employment_type}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {contract === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              contract === "expired"
                                ? "text-destructive"
                                : contract === "expiring_7"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {formatDateOnly(e.contract_end_date)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(e)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EmployeeDialog
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        employee={editing}
        orgId={orgId}
        departments={reference?.departments ?? []}
        territories={reference?.territories ?? []}
        managers={employees}
        profiles={profiles}
        onSaved={load}
      />
    </div>
  );
}
