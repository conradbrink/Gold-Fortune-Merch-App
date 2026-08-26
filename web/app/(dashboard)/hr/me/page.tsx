"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
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
import { LeaveRequestDialog } from "@/components/hr/leave-request-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { formatDateOnly } from "@/lib/format-date";
import { toLocalDateInput } from "@/lib/date-range";
import {
  fetchDirectReports,
  fetchMyEmployee,
  fetchOrgId,
  type EmployeeRow,
} from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  EXCEPTION_LABELS,
  fetchAttendance,
  summarise,
  type AttendanceDay,
} from "@/lib/hr/attendance";
import {
  decideLeaveRequest,
  fetchLeaveBalances,
  fetchLeaveRequests,
  type LeaveBalance,
  type LeaveRequestRow,
} from "@/lib/hr/leave";
import { fetchDocuments, signedDocumentUrl, type DocumentRow } from "@/lib/hr/documents";
import { fetchReviews, type ReviewRow } from "@/lib/hr/performance";
import {
  acknowledgeWarning,
  fetchCases,
  fetchWarnings,
  isActiveWarning,
  type CaseRow,
  type WarningRow,
} from "@/lib/hr/disciplinary";
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  formatClock,
  formatDuration,
  formatScore,
  LEAVE_STATUS_LABELS,
  lookupLabel,
  periodLabel,
  REVIEW_STATUS_LABELS,
  type EmploymentStatus,
} from "@/lib/hr/types";

/**
 * Employee self-service — the one HR page every role can reach.
 *
 * Reps work in the Android app and the web dashboard bounces them to
 * `/rep-notice`; this route is the deliberate exception, because somebody has
 * to be able to read their own leave balance, file a request, and acknowledge
 * their own review, and building all of that a second time in Flutter would put
 * an APK release on the critical path of every HR change.
 *
 * Nothing here is privileged. Every query is the same one the management
 * screens run, narrowed by the same row-level security — this page just does
 * not ask for anybody else. A manager who opens it also gets their team's
 * pending leave, because RLS already gives it to them and the alternative was a
 * second route for the same fact.
 */
export default function MyHrPage() {
  const supabase = createClient();

  const [tab, setTab] = useState("overview");
  const [me, setMe] = useState<EmployeeRow | null>(null);
  const [teamLeave, setTeamLeave] = useState<LeaveRequestRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [attendance, setAttendance] = useState<AttendanceDay[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [leave, setLeave] = useState<LeaveRequestRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toLocalDateInput(d);
  }, []);
  const to = useMemo(() => toLocalDateInput(new Date()), []);

  // Read from `window` rather than `useSearchParams`, which would force this
  // page into a Suspense boundary for one string. Notification links land here
  // with `?tab=leave` and similar.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t) setTab(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employee, ref, org] = await Promise.all([
        fetchMyEmployee(supabase),
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setMe(employee);
      setReference(ref);
      setOrgId(org);
      if (!employee) return;

      const [att, bal, lv, docs, revs, cs, warns, reps] = await Promise.all([
        fetchAttendance(supabase, { from, to, employeeId: employee.id }),
        fetchLeaveBalances(supabase, employee.id),
        fetchLeaveRequests(supabase, { employeeId: employee.id }),
        fetchDocuments(supabase, employee.id),
        fetchReviews(supabase, { employeeId: employee.id }),
        fetchCases(supabase, { employeeId: employee.id }),
        fetchWarnings(supabase, { employeeId: employee.id }),
        fetchDirectReports(supabase, employee.id),
      ]);
      setAttendance(att);
      setBalances(bal);
      setLeave(lv);
      setDocuments(docs);
      setReviews(revs);
      setCases(cs);
      setWarnings(warns);

      if (reps.length > 0) {
        const all = await fetchLeaveRequests(supabase, { status: "pending" });
        const mine = new Set(reps.map((r) => r.id));
        setTeamLeave(all.filter((r) => mine.has(r.employee_id)));
      } else {
        setTeamLeave([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useHrLoad(load);

  async function open(path: string) {
    try {
      const url = await signedDocumentUrl(supabase, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted/50" />;
  }

  // A failure and an absence are different answers, and the "not found" text
  // below is a claim — that the record does not exist or is not yours. Saying
  // that when the load simply errored would be telling somebody they have no
  // access when what happened was a dropped connection.
  // Guarded on the record being absent as well: `error` is also set by actions
  // on a page that loaded fine — a signed URL that failed, an asset that would
  // not return — and those belong in the banner at the top, not in place of
  // everything.
  if (error && !me) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load your HR record</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My HR</h1>
        <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {/* An account with no employee record is a real state, not an error:
              somebody signed in whom HR has not entered yet. Say so plainly and
              name who can fix it. */}
          Your account is not linked to an employee record yet. Ask HR to add
          one — until they do, there is nothing here to show you.
        </p>
      </div>
    );
  }

  const totals = summarise(attendance);
  const scaleMax = reference?.settings?.rating_scale_max ?? 5;
  const lookups = reference?.lookups ?? [];
  const unacknowledgedReview = reviews.find((r) => r.status === "completed");
  const unacknowledgedWarnings = warnings.filter((w) => !w.acknowledged_at);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {me.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {me.employee_number}
            {me.position ? ` · ${me.position}` : ""}
            {me.department?.name ? ` · ${me.department.name}` : ""}
          </p>
        </div>
        <Badge variant="outline" className="font-normal">
          {EMPLOYMENT_STATUS_LABELS[me.employment_status as EmploymentStatus] ??
            me.employment_status}
        </Badge>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Things waiting on this person, above the tabs, because an
          acknowledgement buried on the sixth tab is an acknowledgement that
          never happens. */}
      {(unacknowledgedReview || unacknowledgedWarnings.length > 0) && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">Waiting on you</h2>
            {unacknowledgedReview && (
              <p className="text-sm">
                Your{" "}
                {periodLabel(
                  unacknowledgedReview.period_type,
                  unacknowledgedReview.period_year,
                  unacknowledgedReview.period_index
                )}{" "}
                review is ready.{" "}
                <Link
                  href={`/hr/performance/${unacknowledgedReview.id}`}
                  className="underline"
                >
                  Read and acknowledge it
                </Link>
                .
              </p>
            )}
            {unacknowledgedWarnings.map((w) => (
              <p key={w.id} className="flex flex-wrap items-center gap-2 text-sm">
                {lookupLabel(lookups, "warning_type", w.warning_type)} issued{" "}
                {formatDateOnly(w.issued_on)}.
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await acknowledgeWarning(supabase, w.id);
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Acknowledge
                </Button>
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Acknowledging records that you have seen it. It does not mean you
              agree with it.
            </p>
          </CardContent>
        </Card>
      )}

      {teamLeave.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">Your team&rsquo;s leave requests</h2>
            {teamLeave.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
              >
                <span>
                  <span className="font-medium">{r.employee?.full_name}</span>{" "}
                  {r.leave_type?.name} · {formatDateOnly(r.start_date)} —{" "}
                  {formatDateOnly(r.end_date)} · {r.days} day
                  {Number(r.days) === 1 ? "" : "s"}
                </span>
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await decideLeaveRequest(supabase, r.id, "rejected");
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await decideLeaveRequest(supabase, r.id, "approved");
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Approve
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="p-5">
              <dl className="grid gap-3 sm:grid-cols-3">
                <Detail label="Position">{me.position ?? "—"}</Detail>
                <Detail label="Department">{me.department?.name ?? "—"}</Detail>
                <Detail label="Manager">{me.manager?.full_name ?? "—"}</Detail>
                <Detail label="Territory">{me.territory?.name ?? "—"}</Detail>
                <Detail label="Employment type">
                  {EMPLOYMENT_TYPE_LABELS[
                    me.employment_type as keyof typeof EMPLOYMENT_TYPE_LABELS
                  ] ?? me.employment_type}
                </Detail>
                <Detail label="Started">{formatDateOnly(me.start_date)}</Detail>
                <Detail label="Phone">{me.phone ?? "—"}</Detail>
                <Detail label="Email">{me.email ?? "—"}</Detail>
                <Detail label="Emergency contact">
                  {me.emergency_contact_name
                    ? `${me.emergency_contact_name} · ${me.emergency_contact_phone ?? "—"}`
                    : "—"}
                </Detail>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                Something wrong here? HR can correct it — these fields are not
                editable from this page on purpose, because an employment record
                that its subject can rewrite is not a record.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MiniStat label="Working days" value={totals.days} />
            <MiniStat label="Present" value={totals.present} />
            <MiniStat label="Late" value={totals.late} />
            <MiniStat label="Incomplete" value={totals.incomplete} />
            <MiniStat label="Hours" value={formatDuration(totals.workedSeconds)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Last 30 days. <span className="font-medium text-foreground">Incomplete</span>{" "}
            means the day was worked but Start workday or Stop working was not
            pressed — it is not marked against you as an absence, but it does mean
            your hours and distance for that day are missing.
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.filter((a) => a.is_working_day).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No attendance recorded in the last 30 days.
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
                            {a.exceptions.length > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {a.exceptions
                                  .map((x) => EXCEPTION_LABELS[x] ?? x)
                                  .join(", ")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">
                            {formatClock(a.started_at)}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">
                            {formatClock(a.ended_at)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {formatDuration(a.worked_seconds)}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leave" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setRequesting(true)}>
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
                  {balances.map((b) => (
                    <TableRow key={b.leave_type_id}>
                      <TableCell className="font-medium">{b.leave_type_name}</TableCell>
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
                  ))}
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
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leave.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        You have not requested any leave.
                      </TableCell>
                    </TableRow>
                  ) : (
                    leave.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
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
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === "pending" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await decideLeaveRequest(supabase, r.id, "cancelled");
                                  await load();
                                } catch (e) {
                                  setError(e instanceof Error ? e.message : String(e));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Withdraw
                            </Button>
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

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead className="hidden sm:table-cell">Category</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        HR has not filed any documents for you.
                      </TableCell>
                    </TableRow>
                  ) : (
                    documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {lookupLabel(lookups, "document_category", d.category)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {d.expiry_date ? formatDateOnly(d.expiry_date) : "No expiry"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => open(d.storage_path)}
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

        <TabsContent value="performance" className="mt-4">
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
                        No reviews yet. Drafts are not shown until your manager
                        completes them.
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

        <TabsContent value="disciplinary" className="mt-4 space-y-3">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing on record.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cases.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.case_number}
                          <span className="block text-xs font-normal text-muted-foreground">
                            opened {formatDateOnly(c.opened_on)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {lookupLabel(lookups, "incident_type", c.incident_type)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {lookupLabel(lookups, "case_status", c.status)}
                          </Badge>
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
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {warnings.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-5">
                <h2 className="text-sm font-semibold">Warnings</h2>
                <ul className="space-y-2">
                  {warnings.map((w) => (
                    <li key={w.id} className="text-sm">
                      <span className="font-medium">
                        {lookupLabel(lookups, "warning_type", w.warning_type)}
                      </span>{" "}
                      · {formatDateOnly(w.issued_on)}{" "}
                      <Badge
                        variant={isActiveWarning(w) ? "default" : "outline"}
                        className="ml-1 font-normal"
                      >
                        {isActiveWarning(w) ? "Active" : "Lapsed"}
                      </Badge>
                      <span className="block text-xs text-muted-foreground">
                        {w.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <LeaveRequestDialog
        open={requesting}
        onOpenChange={setRequesting}
        orgId={orgId}
        employeeId={me.id}
        employeeName={me.full_name ?? me.employee_number}
        leaveTypes={reference?.leaveTypes ?? []}
        balances={balances}
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
