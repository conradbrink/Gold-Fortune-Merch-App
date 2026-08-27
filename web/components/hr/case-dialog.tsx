"use client";

import { useState } from "react";
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
import { createCase, type CaseInput } from "@/lib/hr/disciplinary";
import { lookupsOfKind, type Lookup } from "@/lib/hr/types";
import type { EmployeeRow } from "@/lib/hr/employees";
import { toLocalDateInput } from "@/lib/date-range";

/**
 * Open a disciplinary case.
 *
 * 🔴 There is no outcome field here, and that is the design. A case is opened
 * to record and investigate an incident; what happens as a result is decided by
 * people, later, and recorded on the case once decided. Offering an outcome at
 * the moment of opening would invite it to be chosen before anybody had
 * investigated anything — and this system is explicitly not qualified to
 * suggest what an outcome should be.
 *
 * Every dropdown below is filled from `hr_lookups`, which HR edits in Settings.
 * None of these lists is compiled into the app.
 */
export function CaseDialog({
  open,
  onOpenChange,
  orgId,
  lookups,
  employees,
  fixedEmployeeId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  lookups: Lookup[];
  employees: EmployeeRow[];
  /** Set when opened from an employee's profile; hides the employee picker. */
  fixedEmployeeId?: string;
  onCreated: (caseId: string) => void;
}) {
  const supabase = createClient();
  const today = toLocalDateInput(new Date());

  const incidentTypes = lookupsOfKind(lookups, "incident_type");
  const severities = lookupsOfKind(lookups, "severity");
  const statuses = lookupsOfKind(lookups, "case_status");

  const [form, setForm] = useState<CaseInput>(() => ({
    employee_id: fixedEmployeeId ?? "",
    incident_date: today,
    incident_type: "",
    description: "",
    severity: "",
    status: "open",
    manager_id: null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens, during render rather than in an effect.
  // This is React's documented "adjusting state when a prop changes" pattern:
  // an effect would paint the previous contents for one frame first, and would
  // trip react-hooks/set-state-in-effect for a real reason rather than a
  // spurious one.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? fixedEmployeeId ?? "any" : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (open) {
      setForm({
        employee_id: fixedEmployeeId ?? "",
        incident_date: today,
        incident_type: incidentTypes[0]?.code ?? "",
        severity: severities[0]?.code ?? "",
        // The first configured status, not the literal string "open" — an
        // organisation that renames its first step should still get it.
        status: statuses[0]?.code ?? "open",
        description: "",
        manager_id: null,
      });
      setError(null);
    }
  }

  const set = <K extends keyof CaseInput>(key: K, value: CaseInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!orgId) {
      setError("Your organisation could not be resolved.");
      return;
    }
    if (!form.employee_id) {
      setError("Choose an employee.");
      return;
    }
    if (!form.description.trim()) {
      setError("Describe what happened. This is the record.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createCase(supabase, orgId, {
        ...form,
        description: form.description.trim(),
      });
      onCreated(created.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a disciplinary case</DialogTitle>
          <DialogDescription>
            A case number is issued automatically. Only HR and this
            employee&rsquo;s management chain — and the employee — can read it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {!fixedEmployeeId && (
            <Field label="Employee" className="sm:col-span-2">
              <NativeSelect
                value={form.employee_id}
                onChange={(e) => set("employee_id", e.target.value)}
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
          <Field label="Incident date">
            <Input
              type="date"
              value={form.incident_date ?? ""}
              onChange={(e) => set("incident_date", e.target.value || null)}
            />
          </Field>
          <Field label="Incident type">
            <NativeSelect
              value={form.incident_type}
              onChange={(e) => set("incident_type", e.target.value)}
            >
              {incidentTypes.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Severity"
            hint="A record of how serious it is held to be. It implies no outcome."
          >
            <NativeSelect
              value={form.severity}
              onChange={(e) => set("severity", e.target.value)}
            >
              {severities.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="What happened"
            className="sm:col-span-2"
            hint="Facts, dates and places. This is what the employee will be answering."
          >
            <Textarea
              rows={5}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
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
          <Button onClick={save} disabled={busy}>
            {busy ? "Opening…" : "Open case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
