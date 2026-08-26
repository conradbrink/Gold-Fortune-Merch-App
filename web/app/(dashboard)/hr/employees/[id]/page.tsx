"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Upload,
  Wallet,
  ShieldAlert,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Detail } from "@/components/hr/field";
import { EmployeeDialog } from "@/components/hr/employee-dialog";
import { CompensationDialog } from "@/components/hr/compensation-dialog";
import { AssetDialog } from "@/components/hr/asset-dialog";
import { LeaveRequestDialog } from "@/components/hr/leave-request-dialog";
import { DocumentDialog } from "@/components/hr/document-dialog";
import { CaseDialog } from "@/components/hr/case-dialog";
import { WarningDialog } from "@/components/hr/warning-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { formatDateOnly } from "@/lib/format-date";
import { toLocalDateInput } from "@/lib/date-range";
import {
  deleteAsset,
  fetchAssets,
  fetchCompensation,
  fetchDirectReports,
  fetchEmployee,
  fetchEmployees,
  fetchOrgId,
  fetchProfileOptions,
  returnAsset,
  type EmployeeRow,
  type ProfileOption,
} from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  fetchAttendance,
  summarise,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  EXCEPTION_LABELS,
  mapLink,
  type AttendanceDay,
} from "@/lib/hr/attendance";
import {
  fetchLeaveBalances,
  fetchLeaveRequests,
  type LeaveBalance,
  type LeaveRequestRow,
} from "@/lib/hr/leave";
import {
  fetchDocuments,
  signedDocumentUrl,
  type DocumentRow,
} from "@/lib/hr/documents";
import { fetchReviews, history, type ReviewRow } from "@/lib/hr/performance";
import {
  buildTimeline,
  fetchCases,
  fetchWarnings,
  isActiveWarning,
  type CaseRow,
  type WarningRow,
} from "@/lib/hr/disciplinary";
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  EXPIRY_LABELS,
  expiryBucket,
  formatClock,
  formatDuration,
  formatScore,
  LEAVE_STATUS_LABELS,
  lookupLabel,
  periodLabel,
  ratingBand,
  REVIEW_STATUS_LABELS,
  type Compensation,
  type EmployeeAsset,
  type EmploymentStatus,
} from "@/lib/hr/types";

/**
 * One employee, everything about them, behind seven tabs.
 *
 * The page loads what the caller is entitled to and shows the rest as absent
 * rather than as empty. That distinction matters most on the Overview tab: a
 * line manager who cannot read `hr_employee_compensation` gets "not visible to
 * you", not a blank salary — a blank one reads as "this person is unpaid",
 * which is a wrong answer rather than a withheld one.
 */
export default function EmployeeProfilePage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const permissions = usePermissions();
  const isHr = permissions !== null && can(permissions, "hr");

  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [everyone, setEveryone] = useState<EmployeeRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [reports, setReports] = useState<EmployeeRow[]>([]);
  const [compensation, setCompensation] = useState<Compensation | null>(null);
  const [assets, setAssets] = useState<EmployeeAsset[]>([]);
  const [attendance, setAttendance] = useState<AttendanceDay[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [leave, setLeave] = useState<LeaveRequestRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [vehicles, setVehicles] = useState<
    { id: string; registration: string; make_model: string | null }[]
  >([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editingPay, setEditingPay] = useState(false);
  const [issuingAsset, setIssuingAsset] = useState(false);
  const [requestingLeave, setRequestingLeave] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [openingCase, setOpeningCase] = useState(false);
  const [issuingWarning, setIssuingWarning] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Ninety days back — a quarter, which is the review period. */
  const attendanceFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return toLocalDateInput(d);
  }, []);
  const attendanceTo = useMemo(() => toLocalDateInput(new Date()), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);

      const [emp, ref, all, profs, reps, comp, ass, att, bal, lv, docs, revs, cs, warns, veh, org] =
        await Promise.all([
          fetchEmployee(supabase, id),
          fetchHrReference(supabase),
          fetchEmployees(supabase),
          fetchProfileOptions(supabase),
          fetchDirectReports(supabase, id),
          fetchCompensation(supabase, id),
          fetchAssets(supabase, id),
          fetchAttendance(supabase, {
            from: attendanceFrom,
            to: attendanceTo,
            employeeId: id,
          }),
          fetchLeaveBalances(supabase, id),
          fetchLeaveRequests(supabase, { employeeId: id }),
          fetchDocuments(supabase, id),
          fetchReviews(supabase, { employeeId: id }),
          fetchCases(supabase, { employeeId: id }),
          fetchWarnings(supabase, { employeeId: id }),
          supabase
            .from("vehicles")
            .select("id, registration, make_model")
            .eq("active", true)
            .order("registration"),
          fetchOrgId(supabase),
        ]);

      setEmployee(emp);
      setReference(ref);
      setEveryone(all);
      setProfiles(profs);
      setReports(reps);
      setCompensation(comp);
      setAssets(ass);
      setAttendance(att);
      setBalances(bal);
      setLeave(lv);
      setDocuments(docs);
      setReviews(revs);
      setCases(cs);
      setWarnings(warns);
      setVehicles(
        (veh.data ?? []) as { id: string; registration: string; make_model: string | null }[]
      );
      setOrgId(org);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attendanceFrom, attendanceTo]);

  useHrLoad(load);

  async function openDocument(path: string) {
    try {
      const url = await signedDocumentUrl(supabase, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted/50" />
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
      </div>
    );
  }

  // A failure and an absence are different answers, and the "not found" text
  // below is a claim — that the record does not exist or is not yours. Saying
  // that when the load simply errored would be telling somebody they have no
  // access when what happened was a dropped connection.
  // Guarded on the record being absent as well: `error` is also set by actions
  // on a page that loaded fine — a signed URL that failed, an asset that would
  // not return — and those belong in the banner at the top, not in place of
  // everything.
  if (error && !employee) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load this employee</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hr/employees" />}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Employees
        </Button>
        <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {/* Not found and not permitted are the same answer on purpose: telling
              somebody an employee exists that they may not read is itself a
              disclosure. */}
          That employee could not be found, or you do not have access to them.
        </p>
      </div>
    );
  }

  const name = employee.full_name ?? employee.employee_number;
  const totals = summarise(attendance);
  const trend = history(reviews);
  const timeline = buildTimeline(cases, warnings, reference?.lookups ?? []);
  const scaleMax = reference?.settings?.rating_scale_max ?? 5;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 text-muted-foreground" nativeButton={false}
            render={<Link href="/hr/employees" />}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Employees
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{employee.employee_number}</span>
            {employee.position && <span>· {employee.position}</span>}
            {employee.department?.name && <span>· {employee.department.name}</span>}
            <Badge
              variant={
                EMPLOYMENT_STATUS_TONE[employee.employment_status as EmploymentStatus] ??
                "outline"
              }
              className="font-normal"
            >
              {EMPLOYMENT_STATUS_LABELS[
                employee.employment_status as EmploymentStatus
              ] ?? employee.employment_status}
            </Badge>
          </p>
        </div>
        {isHr && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditingPay(true)}>
              <Wallet className="mr-1.5 h-4 w-4" /> Pay details
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- overview */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-4 p-5">
                <h2 className="text-sm font-semibold">Personal</h2>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Phone">{employee.phone ?? "—"}</Detail>
                  <Detail label="Email">{employee.email ?? "—"}</Detail>
                  <Detail label="Date of birth">
                    {formatDateOnly(employee.date_of_birth)}
                  </Detail>
                  <Detail label="ID / passport">{employee.national_id ?? "—"}</Detail>
                  <Detail label="Address" className="sm:col-span-2">
                    {employee.address ?? "—"}
                  </Detail>
                  <Detail label="Emergency contact">
                    {employee.emergency_contact_name ?? "—"}
                  </Detail>
                  <Detail label="Emergency number">
                    {employee.emergency_contact_phone ?? "—"}
                  </Detail>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-5">
                <h2 className="text-sm font-semibold">Employment</h2>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Position">{employee.position ?? "—"}</Detail>
                  <Detail label="Department">{employee.department?.name ?? "—"}</Detail>
                  <Detail label="Manager">
                    {employee.manager ? (
                      <Link
                        href={`/hr/employees/${employee.manager.id}`}
                        className="hover:underline"
                      >
                        {employee.manager.full_name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Detail>
                  <Detail label="Territory">{employee.territory?.name ?? "—"}</Detail>
                  <Detail label="Employment type">
                    {EMPLOYMENT_TYPE_LABELS[
                      employee.employment_type as keyof typeof EMPLOYMENT_TYPE_LABELS
                    ] ?? employee.employment_type}
                  </Detail>
                  <Detail label="Started">{formatDateOnly(employee.start_date)}</Detail>
                  <Detail label="Probation ends">
                    {formatDateOnly(employee.probation_end_date)}
                  </Detail>
                  <Detail label="Contract">
                    {employee.contract_end_date ? (
                      <span
                        className={
                          expiryBucket(employee.contract_end_date) === "expired"
                            ? "text-destructive"
                            : undefined
                        }
                      >
                        {formatDateOnly(employee.contract_start_date)} —{" "}
                        {formatDateOnly(employee.contract_end_date)}
                      </span>
                    ) : (
                      "No end date"
                    )}
                  </Detail>
                  <Detail label="Working day">
                    {employee.work_start_time
                      ? `${employee.work_start_time.slice(0, 5)}–${
                          employee.work_end_time?.slice(0, 5) ?? "—"
                        }`
                      : "Organisation standard"}
                  </Detail>
                  <Detail label="Login">
                    {employee.account
                      ? `${employee.account.role}${
                          employee.account.is_active ? "" : " (deactivated)"
                        }`
                      : "No account"}
                  </Detail>
                  {reports.length > 0 && (
                    <Detail label="Reports" className="sm:col-span-2">
                      {reports.map((r, i) => (
                        <span key={r.id}>
                          {i > 0 && ", "}
                          <Link
                            href={`/hr/employees/${r.id}`}
                            className="hover:underline"
                          >
                            {r.full_name}
                          </Link>
                        </span>
                      ))}
                    </Detail>
                  )}
                  {employee.notes && (
                    <Detail label="Notes" className="sm:col-span-2">
                      {employee.notes}
                    </Detail>
                  )}
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Pay</h2>
                {isHr && (
                  <Button size="sm" variant="outline" onClick={() => setEditingPay(true)}>
                    {compensation ? "Edit" : "Add"}
                  </Button>
                )}
              </div>
              {!compensation ? (
                <p className="text-sm text-muted-foreground">
                  {isHr
                    ? "No pay details recorded yet."
                    : /* Withheld, not missing — see the page comment. */
                      "Pay details are not visible to you."}
                </p>
              ) : (
                <>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <Detail label="Basic salary">
                      {compensation.basic_salary == null
                        ? "—"
                        : `${compensation.currency} ${Number(
                            compensation.basic_salary
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}`}
                    </Detail>
                    <Detail label="Frequency">{compensation.pay_frequency}</Detail>
                    <Detail label="Payroll status">{compensation.payroll_status}</Detail>
                    <Detail label="Commission" className="sm:col-span-3">
                      {compensation.commission_structure ?? "—"}
                    </Detail>
                    <Detail label="Bank">{compensation.bank_name ?? "—"}</Detail>
                    <Detail label="Account">
                      {compensation.bank_account_number ?? "—"}
                    </Detail>
                    <Detail label="Tax number">{compensation.tax_number ?? "—"}</Detail>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Held for payroll. Nothing is calculated from these figures
                    yet, and every change is recorded in the audit trail.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------- attendance */}
        <TabsContent value="attendance" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label="Working days" value={totals.days} />
            <MiniStat label="Present" value={totals.present} />
            <MiniStat label="Late" value={totals.late} />
            <MiniStat label="Absent" value={totals.absent} />
            <MiniStat label="Incomplete" value={totals.incomplete} />
            <MiniStat label="Hours" value={formatDuration(totals.workedSeconds)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Last 90 days, derived from Start workday / Stop working, store visits
            and approved leave. A day with visits but no workday session is
            <span className="font-medium text-foreground"> incomplete</span>, not
            absent.
          </p>
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Start</TableHead>
                    <TableHead className="hidden sm:table-cell">End</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="hidden md:table-cell">Exceptions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.filter((a) => a.is_working_day).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No attendance in this period. Employees with no linked
                        account and no start date produce no attendance at all.
                      </TableCell>
                    </TableRow>
                  ) : (
                    attendance
                      .filter((a) => a.is_working_day)
                      .map((a) => (
                        <TableRow key={a.work_date}>
                          <TableCell className="font-medium">
                            {formatDateOnly(a.work_date)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={ATTENDANCE_STATUS_TONE[a.status] ?? "outline"}
                              className="font-normal"
                            >
                              {ATTENDANCE_STATUS_LABELS[a.status] ?? a.status}
                            </Badge>
                            {a.leave_type && (
                              <span className="block text-xs text-muted-foreground">
                                {a.leave_type}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">
                            {formatClock(a.started_at)}
                            {mapLink(a.start_lat, a.start_lng) && (
                              <a
                                href={mapLink(a.start_lat, a.start_lng)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1.5 text-xs text-muted-foreground underline"
                              >
                                map
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">
                            {formatClock(a.ended_at)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {formatDuration(a.worked_seconds)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {a.exceptions.map((x) => (
                                <Badge key={x} variant="outline" className="font-normal">
                                  {EXCEPTION_LABELS[x] ?? x}
                                </Badge>
                              ))}
                              {a.exceptions.length === 0 && (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- leave */}
        <TabsContent value="leave" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setRequestingLeave(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Request leave
            </Button>
          </div>
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Leave type</TableHead>
                    <TableHead className="text-right">Entitlement</TableHead>
                    <TableHead className="text-right">Taken</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No leave types configured.
                      </TableCell>
                    </TableRow>
                  ) : (
                    balances.map((b) => (
                      <TableRow key={b.leave_type_id}>
                        <TableCell className="font-medium">
                          {b.leave_type_name}
                          {!b.is_paid && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              unpaid
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.entitlement_days}
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
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dates</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Decided by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leave.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No leave requests.
                      </TableCell>
                    </TableRow>
                  ) : (
                    leave.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {formatDateOnly(r.start_date)} — {formatDateOnly(r.end_date)}
                        </TableCell>
                        <TableCell className="text-sm">{r.leave_type?.name ?? "—"}</TableCell>
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
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {r.decided_by_profile?.full_name ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ documents */}
        <TabsContent value="documents" className="mt-4 space-y-4">
          {isHr && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setUploadingDoc(true)}>
                <Upload className="mr-1.5 h-4 w-4" /> Upload
              </Button>
            </div>
          )}
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead className="hidden sm:table-cell">Category</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing filed yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    documents.map((d) => {
                      const bucket = expiryBucket(d.expiry_date);
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.name}</TableCell>
                          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                            {lookupLabel(
                              reference?.lookups ?? [],
                              "document_category",
                              d.category
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {d.expiry_date ? (
                              <span
                                className={
                                  bucket === "expired"
                                    ? "text-destructive"
                                    : bucket === "expiring_7"
                                      ? "text-amber-600 dark:text-amber-400"
                                      : undefined
                                }
                              >
                                {formatDateOnly(d.expiry_date)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {EXPIRY_LABELS.valid}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {formatDateOnly(d.created_at.slice(0, 10))}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDocument(d.storage_path)}
                            >
                              Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- performance */}
        <TabsContent value="performance" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/hr/performance" />}>
              <Star className="mr-1.5 h-4 w-4" /> Reviews
            </Button>
          </div>
          {trend.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <h2 className="text-sm font-semibold">Trend</h2>
                <div className="space-y-2">
                  {trend.map((r) => {
                    const score = Number(r.overall_rating);
                    return (
                      <div key={r.id} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 text-xs text-muted-foreground">
                          {periodLabel(r.period_type, r.period_year, r.period_index)}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(score / scaleMax) * 100}%` }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                          {formatScore(score, scaleMax)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
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
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No reviews yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reviews.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {periodLabel(r.period_type, r.period_year, r.period_index)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {r.reviewer?.full_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(r.overall_rating, scaleMax)}
                          <span className="block text-xs text-muted-foreground">
                            {ratingBand(r.overall_rating, scaleMax) ?? ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
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

        {/* --------------------------------------------------- disciplinary */}
        <TabsContent value="disciplinary" className="mt-4 space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setIssuingWarning(true)}>
              Issue a warning
            </Button>
            <Button size="sm" onClick={() => setOpeningCase(true)}>
              <ShieldAlert className="mr-1.5 h-4 w-4" /> Open a case
            </Button>
          </div>

          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Timeline</h2>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing on record.
                </p>
              ) : (
                <ol className="space-y-3">
                  {timeline.map((t) => (
                    <li key={t.id} className="flex gap-3">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">
                        {formatDateOnly(t.date)}
                      </span>
                      <span
                        className={
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full " +
                          (t.kind === "case" ? "bg-destructive" : "bg-amber-500")
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {t.href ? (
                            <Link href={t.href} className="hover:underline">
                              {t.title}
                            </Link>
                          ) : (
                            t.title
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{t.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warning</TableHead>
                    <TableHead className="hidden sm:table-cell">Issued</TableHead>
                    <TableHead className="hidden md:table-cell">Valid until</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warnings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        No warnings on record.
                      </TableCell>
                    </TableRow>
                  ) : (
                    warnings.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">
                          {lookupLabel(
                            reference?.lookups ?? [],
                            "warning_type",
                            w.warning_type
                          )}
                          <span className="block text-xs font-normal text-muted-foreground">
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
                          <span className="block text-xs text-muted-foreground">
                            {w.acknowledged_at
                              ? "Acknowledged"
                              : "Not yet acknowledged"}
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

        {/* --------------------------------------------------------- assets */}
        <TabsContent value="assets" className="mt-4 space-y-4">
          {isHr && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setIssuingAsset(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Issue an asset
              </Button>
            </div>
          )}
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="hidden sm:table-cell">Identifier</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Returned</TableHead>
                    {isHr && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={isHr ? 5 : 4}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Nothing issued.
                      </TableCell>
                    </TableRow>
                  ) : (
                    assets.map((a) => (
                      <TableRow key={a.id} className={a.returned_on ? "opacity-60" : ""}>
                        <TableCell className="font-medium">
                          {a.label}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {a.kind}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {a.identifier ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateOnly(a.issued_on)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {a.returned_on ? formatDateOnly(a.returned_on) : "Held"}
                        </TableCell>
                        {isHr && (
                          <TableCell className="text-right">
                            {a.returned_on ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    await deleteAsset(supabase, a.id);
                                    load();
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : String(e));
                                  }
                                }}
                              >
                                Remove
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    await returnAsset(
                                      supabase,
                                      a.id,
                                      toLocalDateInput(new Date())
                                    );
                                    load();
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : String(e));
                                  }
                                }}
                              >
                                Mark returned
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EmployeeDialog
        open={editing}
        onOpenChange={setEditing}
        employee={employee}
        orgId={orgId}
        departments={reference?.departments ?? []}
        territories={reference?.territories ?? []}
        managers={everyone}
        profiles={profiles}
        onSaved={load}
      />
      <CompensationDialog
        open={editingPay}
        onOpenChange={setEditingPay}
        employeeId={employee.id}
        employeeName={name}
        orgId={orgId}
        userId={userId}
        existing={compensation}
        onSaved={load}
      />
      <AssetDialog
        open={issuingAsset}
        onOpenChange={setIssuingAsset}
        orgId={orgId}
        userId={userId}
        employeeId={employee.id}
        employeeName={name}
        vehicles={vehicles}
        onSaved={load}
      />
      <LeaveRequestDialog
        open={requestingLeave}
        onOpenChange={setRequestingLeave}
        orgId={orgId}
        employeeId={employee.id}
        employeeName={name}
        leaveTypes={reference?.leaveTypes ?? []}
        balances={balances}
        onSaved={load}
      />
      <DocumentDialog
        open={uploadingDoc}
        onOpenChange={setUploadingDoc}
        orgId={orgId}
        userId={userId}
        employeeId={employee.id}
        employeeName={name}
        lookups={reference?.lookups ?? []}
        existing={null}
        onSaved={load}
      />
      <CaseDialog
        open={openingCase}
        onOpenChange={setOpeningCase}
        orgId={orgId}
        lookups={reference?.lookups ?? []}
        employees={everyone}
        fixedEmployeeId={employee.id}
        onCreated={() => load()}
      />
      <WarningDialog
        open={issuingWarning}
        onOpenChange={setIssuingWarning}
        orgId={orgId}
        employeeId={employee.id}
        employeeName={name}
        lookups={reference?.lookups ?? []}
        onSaved={load}
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
