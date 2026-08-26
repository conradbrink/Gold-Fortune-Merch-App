"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { LeaveRequestDialog } from "@/components/hr/leave-request-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { formatDateOnly } from "@/lib/format-date";
import { toLocalDateInput } from "@/lib/date-range";
import { fetchEmployees, fetchOrgId, type EmployeeRow } from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  canDecide,
  decideLeaveRequest,
  fetchLeaveBalances,
  fetchLeaveCalendar,
  fetchLeaveRequests,
  saveLeaveBalance,
  type LeaveBalance,
  type LeaveRequestRow,
} from "@/lib/hr/leave";
import { LEAVE_STATUS_LABELS } from "@/lib/hr/types";

/**
 * Leave: requests to decide, balances to adjust, and a calendar of who is away.
 *
 * The balance table has no "remaining" column to edit, and that is deliberate.
 * Entitlement, carry-over and a manual adjustment are the three numbers a human
 * decides; remaining is counted from the requests every time it is read. Making
 * it editable would create two answers to the same question, and the wrong one
 * would be the one people looked at.
 */
export default function HrLeavePage() {
  const supabase = createClient();
  const permissions = usePermissions();
  const isHr = permissions !== null && can(permissions, "hr");

  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [calendar, setCalendar] = useState<LeaveRequestRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("pending");
  const [requesting, setRequesting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthStart = useMemo(() => {
    const d = new Date();
    return toLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
  }, []);
  const monthEnd = useMemo(() => {
    const d = new Date();
    return toLocalDateInput(new Date(d.getFullYear(), d.getMonth() + 2, 0));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);
      const [r, b, c, e, ref, org] = await Promise.all([
        fetchLeaveRequests(supabase),
        fetchLeaveBalances(supabase),
        fetchLeaveCalendar(supabase, monthStart, monthEnd),
        fetchEmployees(supabase),
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setRequests(r);
      setBalances(b);
      setCalendar(c);
      setEmployees(e);
      setReference(ref);
      setOrgId(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart, monthEnd]);

  useHrLoad(load);

  /**
   * Everyone the caller could read at all. RLS has already narrowed
   * `hr_employees` to HR's organisation or a manager's chain, so this set is
   * exactly "the people whose leave I might be able to decide" — which is what
   * `canDecide` needs and is why it is not computed from the role.
   */
  const visibleEmployeeIds = useMemo(
    () => new Set(employees.map((e) => e.id)),
    [employees]
  );

  const filtered = useMemo(
    () => (statusFilter ? requests.filter((r) => r.status === statusFilter) : requests),
    [requests, statusFilter]
  );

  async function decide(
    id: string,
    status: "approved" | "rejected" | "cancelled"
  ) {
    setBusyId(id);
    setError(null);
    try {
      await decideLeaveRequest(supabase, id, status);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Leave</h1>
          <p className="text-sm text-muted-foreground">
            {pending} request{pending === 1 ? "" : "s"} waiting on a decision
          </p>
        </div>
        <Button
          className="gap-1.5"
          onClick={() => setRequesting(true)}
          disabled={employees.length === 0}
        >
          <Plus className="h-4 w-4" /> Record a request
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- requests */}
        <TabsContent value="requests" className="mt-4 space-y-3">
          <NativeSelect
            className="max-w-[12rem]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(LEAVE_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>

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
                  No requests here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/hr/employees/${r.employee_id}`}
                            className="hover:underline"
                          >
                            {r.employee?.full_name ?? "—"}
                          </Link>
                          {r.reason && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {r.reason}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDateOnly(r.start_date)} — {formatDateOnly(r.end_date)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {r.leave_type?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "approved"
                                ? "default"
                                : r.status === "rejected"
                                  ? "destructive"
                                  : "outline"
                            }
                            className="font-normal"
                          >
                            {LEAVE_STATUS_LABELS[
                              r.status as keyof typeof LEAVE_STATUS_LABELS
                            ] ?? r.status}
                          </Badge>
                          {r.decided_by_profile?.full_name && (
                            <span className="block text-xs text-muted-foreground">
                              by {r.decided_by_profile.full_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canDecide(r, isHr, visibleEmployeeIds) ? (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === r.id}
                                onClick={() => decide(r.id, "rejected")}
                              >
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === r.id}
                                onClick={() => decide(r.id, "approved")}
                              >
                                Approve
                              </Button>
                            </div>
                          ) : r.status === "approved" && isHr ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === r.id}
                              onClick={() => decide(r.id, "cancelled")}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- balances */}
        <TabsContent value="balances" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Entitlement, carry-over and adjustment are set by HR. Taken, pending
            and remaining are counted from the requests and cannot be typed —
            cancelling approved leave returns the days on its own.
          </p>
          <BalanceGrid
            employees={employees}
            balances={balances}
            reference={reference}
            editable={isHr}
            onSave={async (input) => {
              if (!orgId) return;
              await saveLeaveBalance(supabase, orgId, input, userId);
              await load();
            }}
          />
        </TabsContent>

        {/* ------------------------------------------------------- calendar */}
        <TabsContent value="calendar" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Approved leave from {formatDateOnly(monthStart)} to{" "}
            {formatDateOnly(monthEnd)}.
          </p>
          <Card>
            <CardContent className="px-0">
              {calendar.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nobody is booked off in this window.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calendar.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.employee?.full_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateOnly(r.start_date)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateOnly(r.end_date)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {r.leave_type?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LeaveRequestDialog
        open={requesting}
        onOpenChange={setRequesting}
        orgId={orgId}
        employees={employees}
        leaveTypes={reference?.leaveTypes ?? []}
        balances={balances}
        onSaved={load}
      />
    </div>
  );
}

/**
 * Balances, one employee at a time.
 *
 * A grid of every employee against every leave type is the obvious rendering
 * and the wrong one: it is thirty columns wide on a phone and the number
 * somebody actually came to change is one cell in it. Picking a person first
 * makes the edit a five-row form.
 */
function BalanceGrid({
  employees,
  balances,
  reference,
  editable,
  onSave,
}: {
  employees: EmployeeRow[];
  balances: LeaveBalance[];
  reference: HrReference | null;
  editable: boolean;
  onSave: (input: {
    employee_id: string;
    leave_type_id: string;
    leave_year: number;
    entitlement_days: number | null;
    carried_over_days: number;
    adjustment_days: number;
    note: string | null;
  }) => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Falls back to the first employee during render rather than in an effect,
  // so the table never paints empty for a frame before choosing one.
  const chosenId = employeeId || employees[0]?.id || "";
  const rows = balances.filter((b) => b.employee_id === chosenId);

  return (
    <div className="space-y-3">
      <NativeSelect
        className="max-w-xs"
        value={chosenId}
        onChange={(e) => {
          setEmployeeId(e.target.value);
          setDraft({});
        }}
      >
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name ?? e.employee_number}
          </option>
        ))}
      </NativeSelect>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Leave type</TableHead>
                <TableHead className="w-28 text-right">Entitlement</TableHead>
                <TableHead className="text-right">Taken</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                {editable && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={editable ? 6 : 5}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No leave types configured.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((b) => {
                  const key = b.leave_type_id;
                  const value = draft[key] ?? String(b.entitlement_days);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">
                        {b.leave_type_name}
                        {!b.is_paid && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            unpaid
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editable ? (
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            className="ml-auto w-24 text-right"
                            value={value}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [key]: e.target.value }))
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{b.entitlement_days}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.used_days}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.pending_days}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {b.remaining_days}
                      </TableCell>
                      {editable && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || draft[key] === undefined}
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                await onSave({
                                  employee_id: b.employee_id,
                                  leave_type_id: b.leave_type_id,
                                  leave_year: b.leave_year,
                                  entitlement_days: Number(value),
                                  carried_over_days: 0,
                                  adjustment_days: 0,
                                  note: null,
                                });
                                setDraft((d) => {
                                  const next = { ...d };
                                  delete next[key];
                                  return next;
                                });
                              } catch (e) {
                                setError(e instanceof Error ? e.message : String(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Save
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {reference?.settings && (
        <p className="text-xs text-muted-foreground">
          Leave year starts in month {reference.settings.leave_year_start_month}.
        </p>
      )}
    </div>
  );
}
