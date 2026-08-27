"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import {
  createLeaveRequest,
  suggestDays,
  uploadLeaveDocument,
  type LeaveBalance,
} from "@/lib/hr/leave";
import type { LeaveType } from "@/lib/hr/types";
import type { EmployeeRow } from "@/lib/hr/employees";
import { toLocalDateInput } from "@/lib/date-range";

/**
 * File a leave request.
 *
 * Whoever opens this — the employee, their manager, or HR — the request lands
 * as `pending` unless HR is recording something already agreed off-system. That
 * is enforced by a database trigger, not by hiding a control here.
 *
 * The day count is a *suggestion*. `hr_working_days` counts the org's own
 * working week between the two dates, so the form and the reports agree on what
 * a week is, but public holidays are not deducted — there is no holiday
 * calendar and inventing Botswana's would hard-code the kind of rule the brief
 * forbids. The field stays editable, and half days are why it takes decimals.
 */
export function LeaveRequestDialog({
  open,
  onOpenChange,
  orgId,
  employeeId,
  employeeName,
  employees,
  leaveTypes,
  balances,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  /** The employee to file for, when the caller already knows. */
  employeeId?: string;
  employeeName?: string;
  /**
   * Offered instead of `employeeId` when the caller does not. HR filing on
   * somebody's behalf picks the person here rather than on the page behind the
   * dialog, so the whole request is one form.
   */
  employees?: EmployeeRow[];
  leaveTypes: LeaveType[];
  /** Every balance the caller can read; narrowed to the chosen employee here. */
  balances: LeaveBalance[];
  onSaved: () => void;
}) {
  const supabase = createClient();
  const today = toLocalDateInput(new Date());

  const [subjectId, setSubjectId] = useState(employeeId ?? "");
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = leaveTypes.filter((t) => t.active);
  const selected = active.find((t) => t.id === typeId) ?? null;
  const balance =
    balances.find((b) => b.leave_type_id === typeId && b.employee_id === subjectId) ??
    null;
  const subjectName =
    employeeName ??
    employees?.find((e) => e.id === subjectId)?.full_name ??
    "employee";

  // Reset when the dialog opens, during render rather than in an effect.
  // This is React's documented "adjusting state when a prop changes" pattern:
  // an effect would paint the previous contents for one frame first, and would
  // trip react-hooks/set-state-in-effect for a real reason rather than a
  // spurious one.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? employeeId ?? "any" : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (open) {
      setSubjectId(employeeId ?? employees?.[0]?.id ?? "");
      setTypeId(active[0]?.id ?? "");
      setFrom(today);
      setTo(today);
      setDays("1");
      setReason("");
      setFile(null);
      setError(null);
    }
  }

  // Re-suggest whenever the span changes. Asked of the database rather than
  // computed here so the number matches what the attendance report would count.
  useEffect(() => {
    if (!open || !orgId || !from || !to || to < from) return;
    let cancelled = false;
    suggestDays(supabase, orgId, from, to)
      .then((n) => {
        if (!cancelled) setDays(String(n));
      })
      .catch(() => {
        /* Leave whatever is in the box; it is editable anyway. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId, from, to]);

  async function submit() {
    if (!orgId) {
      setError("Your organisation could not be resolved.");
      return;
    }
    if (!subjectId) {
      setError("Choose an employee.");
      return;
    }
    if (!typeId) {
      setError("Choose a leave type.");
      return;
    }
    if (to < from) {
      setError("The end date is before the start date.");
      return;
    }
    const dayCount = Number(days);
    if (!Number.isFinite(dayCount) || dayCount <= 0) {
      setError("Enter how many days this is.");
      return;
    }
    if (selected?.requires_document && !file) {
      setError(`${selected.name} needs a supporting document.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const path = file
        ? await uploadLeaveDocument(supabase, orgId, subjectId, file)
        : null;
      await createLeaveRequest(supabase, orgId, {
        employee_id: subjectId,
        leave_type_id: typeId,
        start_date: from,
        end_date: to,
        days: dayCount,
        reason: reason.trim() || null,
        document_path: path,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request leave — {subjectName}</DialogTitle>
          <DialogDescription>
            The request goes to the employee&rsquo;s manager and to HR for a
            decision.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {!employeeId && employees && (
            <Field label="Employee" className="sm:col-span-2">
              <NativeSelect
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name ?? e.employee_number}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Leave type" className="sm:col-span-2">
            <NativeSelect value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {active.length === 0 && <option value="">No leave types configured</option>}
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_paid ? "" : " (unpaid)"}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {balance && (
            <p className="sm:col-span-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {balance.entitlement_days} day
              {balance.entitlement_days === 1 ? "" : "s"} entitlement ·{" "}
              {balance.used_days} taken · {balance.pending_days} pending ·{" "}
              <span className="font-medium text-foreground">
                {balance.remaining_days} remaining
              </span>
              {/* Stated rather than enforced. A rep who has to take a sick day
                  they have not accrued should be able to file it and let HR
                  decide, not be stopped by a form. */}
            </p>
          )}

          <Field label="From">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to < e.target.value) setTo(e.target.value);
              }}
            />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field
            label="Days"
            hint="Suggested from the working week. Change it for half days or public holidays."
          >
            <Input
              type="number"
              step="0.5"
              min="0.5"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Field
            label={
              selected?.requires_document
                ? "Supporting document (required)"
                : "Supporting document"
            }
          >
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Reason" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || active.length === 0}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
