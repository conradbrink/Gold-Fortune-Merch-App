"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
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
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { formatDateOnly } from "@/lib/format-date";
import { toLocalDateInput } from "@/lib/date-range";
import { fetchEmployees, type EmployeeRow } from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  EXCEPTION_LABELS,
  fetchAttendance,
  mapLink,
  summarise,
  type AttendanceDay,
  type AttendanceStatus,
} from "@/lib/hr/attendance";
import { formatClock, formatDuration } from "@/lib/hr/types";

/**
 * Attendance across the team.
 *
 * There is no clock-in button anywhere in HR. Every row here is derived from
 * the workday sessions the rep app already records, the store visits that prove
 * somebody was working, and the leave that explains the days they were not —
 * which is why the filters are the ones from section 4 and none of them is
 * "edit".
 *
 * 🔴 Read `Incomplete` before reading `Absent`. On this organisation's live
 * data, `incomplete`/`no_start` is the most common non-present status by a wide
 * margin: reps work the day and never press *Start workday*. That is a training
 * problem, not an attendance problem, and the two must not be confused — which
 * is why the summary strip counts them separately and the empty-state text says
 * so out loud.
 */
export default function HrAttendancePage() {
  const supabase = createClient();

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return toLocalDateInput(d);
  });
  const [to, setTo] = useState(() => toLocalDateInput(new Date()));
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [status, setStatus] = useState<string>("");
  const [includeNonWorking, setIncludeNonWorking] = useState(false);

  const [rows, setRows] = useState<AttendanceDay[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReference = useCallback(async () => {
    try {
      const [e, r] = await Promise.all([
        fetchEmployees(supabase),
        fetchHrReference(supabase),
      ]);
      setEmployees(e);
      setReference(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(
        await fetchAttendance(supabase, {
          from,
          to,
          employeeId: employeeId || null,
          departmentId: departmentId || null,
          territoryId: territoryId || null,
          status: (status || null) as AttendanceStatus | null,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, employeeId, departmentId, territoryId, status]);

  useHrLoad(loadReference);

  useHrLoad(load);

  const visible = useMemo(
    () => (includeNonWorking ? rows : rows.filter((r) => r.is_working_day)),
    [rows, includeNonWorking]
  );
  const totals = summarise(rows);
  const settings = reference?.settings;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Attendance
          </h1>
          <p className="text-sm text-muted-foreground">
            From Start workday, store visits and approved leave.{" "}
            {settings
              ? `Day runs ${settings.work_start_time.slice(0, 5)}–${settings.work_end_time.slice(
                  0,
                  5
                )}, late after ${settings.late_threshold_minutes} min.`
              : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hr/settings" />}>
          Working hours
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load attendance</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">From</span>
          <Input
            type="date"
            className="w-[10rem]"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">To</span>
          <Input
            type="date"
            className="w-[10rem]"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <NativeSelect
          className="w-[13rem]"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name ?? e.employee_number}
            </option>
          ))}
        </NativeSelect>
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
          className="w-[11rem]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {(["present", "late", "absent", "on_leave", "incomplete"] as const).map((s) => (
            <option key={s} value={s}>
              {ATTENDANCE_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIncludeNonWorking((v) => !v)}
        >
          {includeNonWorking ? "Hide non-working days" : "Show non-working days"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Working days" value={totals.days} />
        <MiniStat label="Present" value={totals.present} />
        <MiniStat label="Late" value={totals.late} />
        <MiniStat label="Absent" value={totals.absent} />
        <MiniStat
          label="Incomplete"
          value={totals.incomplete}
          note="Worked, no Start/Stop"
        />
        <MiniStat label="Hours" value={formatDuration(totals.workedSeconds)} />
      </div>

      <Card>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nothing in this range. Attendance only exists for employees with a
              linked account, and only from their start date — or from the first
              workday they recorded, if no start date is set.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Start</TableHead>
                  <TableHead className="hidden sm:table-cell">End</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="hidden lg:table-cell">Exceptions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={`${r.employee_id}-${r.work_date}`}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDateOnly(r.work_date)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/hr/employees/${r.employee_id}`}
                        className="text-sm hover:underline"
                      >
                        {r.employee_name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {r.department_name ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={ATTENDANCE_STATUS_TONE[r.status] ?? "outline"}
                        className="font-normal"
                      >
                        {ATTENDANCE_STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                      {r.leave_type && (
                        <span className="block text-xs text-muted-foreground">
                          {r.leave_type}
                        </span>
                      )}
                      {r.status === "incomplete" && r.activity_events > 0 && (
                        // The number that makes the case: this person did
                        // twelve things today.
                        <span className="block text-xs text-muted-foreground">
                          {r.activity_events} activities recorded
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {formatClock(r.started_at)}
                      {mapLink(r.start_lat, r.start_lng) && (
                        <a
                          href={mapLink(r.start_lat, r.start_lng)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 text-xs text-muted-foreground underline"
                        >
                          map
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {formatClock(r.ended_at)}
                      {mapLink(r.end_lat, r.end_lng) && (
                        <a
                          href={mapLink(r.end_lat, r.end_lng)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 text-xs text-muted-foreground underline"
                        >
                          map
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatDuration(r.worked_seconds)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {r.exceptions.map((x) => (
                          <Badge key={x} variant="outline" className="font-normal">
                            {EXCEPTION_LABELS[x] ?? x}
                          </Badge>
                        ))}
                        {r.exceptions.length === 0 && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
